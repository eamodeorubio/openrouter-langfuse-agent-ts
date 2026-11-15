import path from 'node:path';
import type { Io } from '../io.js';
import { parseArgs } from './args.js';
import { DEFAULT_CALIBRATION_FILE, readOrReport } from './records.js';
import type { CalibrationRecord } from './types.js';

const USAGE = 'Usage: calibrate analyze [--file <file>]\n';

/** Where Jev puts its yes, and the line under which a threshold means Jev reads a rubric differently from Opus. */
const NEUTRAL = 0.5;
const MIN_AUC = 0.7;
const WEIGHT_AUC = 0.9;
const WEIGHT_AGREEMENT = 0.9;
const WEIGHT_SHIFT = 0.1;
const WEIGHT_CONTROLS = 0.9;
/** A weight needs this many answers of each of yes and no, or the figures rest on too little. */
const WEIGHT_SAMPLES = 20;
/** Thresholds that agree this close to the best count as best. */
const PLATEAU = 0.01;
const RUBRIC_ORDER = [
  'judge-grounding',
  'judge-relevance',
  'judge-usefulness',
  'judge-tool-usage',
];

/** A score of Jev against the answer of Opus: `label` is true for yes. */
export interface Pair {
  score: number;
  label: boolean;
  case: string;
}

export interface Agreement {
  tp: number;
  fn: number;
  tn: number;
  fp: number;
  truePositiveRate: number | null;
  trueNegativeRate: number | null;
  /** The mean of the two rates, so that a rubric that is nearly always yes cannot look good by saying yes. Null when a class is empty. */
  balanced: number | null;
}

/** How Jev agrees with Opus when a score at or above `threshold` is a yes. */
export const agreement = (pairs: Pair[], threshold: number): Agreement => {
  const yes = pairs.filter((pair) => pair.label);
  const no = pairs.filter((pair) => !pair.label);
  const tp = yes.filter((pair) => pair.score >= threshold).length;
  const tn = no.filter((pair) => pair.score < threshold).length;
  const truePositiveRate = yes.length === 0 ? null : tp / yes.length;
  const trueNegativeRate = no.length === 0 ? null : tn / no.length;
  return {
    tp,
    fn: yes.length - tp,
    tn,
    fp: no.length - tn,
    truePositiveRate,
    trueNegativeRate,
    balanced:
      truePositiveRate === null || trueNegativeRate === null
        ? null
        : (truePositiveRate + trueNegativeRate) / 2,
  };
};

export interface SweepRow extends Agreement {
  threshold: number;
}

/** The agreement at each threshold from 0 to 1 in steps of 0.05. */
export const sweep = (pairs: Pair[]): SweepRow[] =>
  Array.from({ length: 21 }, (_, step) => {
    const threshold = (step * 5) / 100;
    return { threshold, ...agreement(pairs, threshold) };
  });

/** The chance that a run Opus calls yes scores above one it calls no, ties counting half. Undefined without both classes. */
export const auc = (pairs: Pair[]): number | undefined => {
  const yes = pairs.filter((pair) => pair.label);
  const no = pairs.filter((pair) => !pair.label);
  if (yes.length === 0 || no.length === 0) return undefined;
  let wins = 0;
  for (const a of yes) {
    for (const b of no) {
      wins += a.score > b.score ? 1 : a.score === b.score ? 0.5 : 0;
    }
  }
  return wins / (yes.length * no.length);
};

export interface Best {
  /** The lowest and highest thresholds within a point of the best agreement. */
  low: number;
  high: number;
  /** The middle of the range, to two decimals. */
  threshold: number;
  balanced: number;
}

/** The thresholds that agree best, as a range, and the middle of it. */
export const bestThreshold = (rows: SweepRow[]): Best | undefined => {
  const scored = rows.filter(
    (row): row is SweepRow & { balanced: number } => row.balanced !== null,
  );
  if (scored.length === 0) return undefined;
  const top = Math.max(...scored.map((row) => row.balanced));
  // The plateau is the run of consecutive thresholds around the first best one,
  // so that a second peak far away cannot widen it. The small epsilon keeps a
  // row exactly one point below the best from falling out by rounding.
  const near = (row: { balanced: number }): boolean =>
    // Stryker disable next-line EqualityOperator: equivalent because the epsilon puts every row that is exactly a point below on the same side whichever way the bound is written
    row.balanced >= top - PLATEAU - 1e-9;
  const peak = scored.findIndex((row) => row.balanced === top);
  let first = peak;
  while (first > 0 && near(scored[first - 1] as { balanced: number })) first--;
  let last = peak;
  while (
    last < scored.length - 1 &&
    near(scored[last + 1] as { balanced: number })
  ) {
    last++;
  }
  const low = (scored[first] as SweepRow).threshold;
  const high = (scored[last] as SweepRow).threshold;
  const middle =
    Math.round((Math.round(low * 100) + Math.round(high * 100)) / 2) / 100;
  return { low, high, threshold: middle, balanced: top };
};

export interface Controls {
  /** How many controls expected to fail the rubric Opus judged. */
  count: number;
  /** The share of them Opus rejected, 0 when none was judged. */
  opusRejected: number;
  /** The share of those Jev scored that it rejected. Null when it scored none. */
  jevRejected: number | null;
}

export interface WeightAdvice {
  weight: 'keep 0' | 'may count';
  unmet: string[];
}

const percent = (rate: number): number => Math.round(rate * 100);

/** Whether a rubric agrees with Opus well enough to count toward a pass, and what falls short when it does not. */
export const weightAdvice = (figures: {
  yes: number;
  no: number;
  auc: number;
  /** The agreement on the cases that the threshold was not fitted on. Null when it cannot be worked out. */
  balanced: number | null;
  maxShift: number;
  controls: Controls;
}): WeightAdvice => {
  const unmet: string[] = [];
  for (const [name, count] of [
    ['yes', figures.yes],
    ['no', figures.no],
  ] as const) {
    if (count < WEIGHT_SAMPLES) {
      unmet.push(`only ${count} ${name} answers, under ${WEIGHT_SAMPLES}`);
    }
  }
  if (figures.auc < WEIGHT_AUC) {
    unmet.push(`AUC ${figures.auc.toFixed(2)} is under ${WEIGHT_AUC}`);
  }
  if (figures.balanced === null) {
    unmet.push('no agreement on a case left out can be worked out');
  } else if (figures.balanced < WEIGHT_AGREEMENT) {
    unmet.push(
      `agreement on the cases left out ${figures.balanced.toFixed(2)} is under ${WEIGHT_AGREEMENT}`,
    );
  }
  if (figures.maxShift > WEIGHT_SHIFT) {
    unmet.push(
      `the threshold moves by ${figures.maxShift.toFixed(2)} when a case is left out, over ${WEIGHT_SHIFT}`,
    );
  }
  const { controls } = figures;
  if (controls.count === 0) {
    unmet.push('no controls were judged');
  } else {
    if (controls.opusRejected < WEIGHT_CONTROLS) {
      unmet.push(
        `Opus rejects ${percent(controls.opusRejected)}% of the controls, under ${percent(WEIGHT_CONTROLS)}%`,
      );
    }
    if (controls.jevRejected === null) {
      unmet.push('Jev scored none of the controls');
    } else if (controls.jevRejected < WEIGHT_CONTROLS) {
      unmet.push(
        `Jev rejects ${percent(controls.jevRejected)}% of the controls, under ${percent(WEIGHT_CONTROLS)}%`,
      );
    }
  }
  return { weight: unmet.length === 0 ? 'may count' : 'keep 0', unmet };
};

export type Recommendation =
  | { kind: 'threshold'; threshold: number }
  | { kind: 'suspect' }
  | { kind: 'not-worth' }
  | { kind: 'not-enough' };

export interface RubricAnalysis {
  rubric: string;
  samples: { yes: number; no: number; ambiguous: number; unscored: number };
  ambiguousShare: number;
  auc: number | undefined;
  sweep: SweepRow[];
  best: Best | undefined;
  recommendation: Recommendation;
  /** How Jev agrees with Opus at the threshold of the config. */
  atConfig: Agreement;
  atRecommended: Agreement | undefined;
  leaveOneCaseOut: {
    maxShift: number;
    shifts: Record<string, number>;
    /** The balanced agreement on each case when the threshold is fitted on the others, pooled. */
    heldOut: number | null;
  };
  /** How many of the answers in the fit are controls. */
  controlsInFit: number;
  controls: Controls;
  weight: WeightAdvice;
}

/**
 * Leaves each case out in turn: how far the best threshold moves, and how well
 * the threshold fitted on the others agrees with Opus on the case left out,
 * pooled over the cases. The second figure is not biased by the fit.
 */
const leaveOneCaseOut = (
  pairs: Pair[],
  whole: number,
): RubricAnalysis['leaveOneCaseOut'] => {
  const shifts: Record<string, number> = {};
  let predictions = { tp: 0, fn: 0, tn: 0, fp: 0 };
  for (const name of new Set(pairs.map((pair) => pair.case))) {
    const rest = pairs.filter((pair) => pair.case !== name);
    if (auc(rest) === undefined) continue;
    const threshold = (bestThreshold(sweep(rest)) as Best).threshold;
    shifts[name] = Math.round(Math.abs(threshold - whole) * 100) / 100;
    const out = agreement(
      pairs.filter((pair) => pair.case === name),
      threshold,
    );
    predictions = {
      tp: predictions.tp + out.tp,
      fn: predictions.fn + out.fn,
      tn: predictions.tn + out.tn,
      fp: predictions.fp + out.fp,
    };
  }
  const yes = predictions.tp + predictions.fn;
  const no = predictions.tn + predictions.fp;
  return {
    maxShift: Math.max(0, ...Object.values(shifts)),
    shifts,
    heldOut:
      yes === 0 || no === 0
        ? null
        : (predictions.tp / yes + predictions.tn / no) / 2,
  };
};

/** The controls expected to fail a rubric that Opus judged, and how often each judge rejected them at `threshold`. */
const controlsOf = (
  records: CalibrationRecord[],
  rubric: string,
  threshold: number,
): Controls => {
  const judged = records.flatMap((record) => {
    const verdict = record.opusScore?.[rubric];
    return record.control !== undefined &&
      record.expectedFail?.includes(rubric) &&
      verdict !== undefined
      ? [{ verdict, score: record.jevAssertScores[rubric] }]
      : [];
  });
  const scores = judged.flatMap((item) =>
    item.score === undefined ? [] : [item.score],
  );
  return {
    count: judged.length,
    opusRejected:
      judged.length === 0
        ? 0
        : judged.filter((item) => item.verdict === 'no').length / judged.length,
    jevRejected:
      scores.length === 0
        ? null
        : scores.filter((score) => score < threshold).length / scores.length,
  };
};

/** What to do with a rubric, from how well it separates the runs and where the best thresholds lie. */
const recommend = (
  value: number | undefined,
  best: Best | undefined,
): Recommendation => {
  // The AUC and the best threshold exist together: when a class is empty, neither does.
  if (value === undefined) return { kind: 'not-enough' };
  const { high, threshold } = best as Best;
  if (value < MIN_AUC) return { kind: 'not-worth' };
  if (high < NEUTRAL) return { kind: 'suspect' };
  return { kind: 'threshold', threshold };
};

const analyzeRubric = (
  records: CalibrationRecord[],
  rubric: string,
): RubricAnalysis => {
  const samples = { yes: 0, no: 0, ambiguous: 0, unscored: 0 };
  const pairs: Pair[] = [];
  let controlsInFit = 0;
  for (const record of records) {
    const verdict = record.opusScore?.[rubric];
    if (verdict === undefined) continue;
    const score = record.jevAssertScores[rubric];
    if (verdict === 'ambiguous') {
      samples.ambiguous += 1;
    } else if (score === undefined) {
      samples.unscored += 1;
    } else {
      samples[verdict] += 1;
      pairs.push({ score, label: verdict === 'yes', case: record.case });
      if (record.control !== undefined) controlsInFit += 1;
    }
  }
  const answered = samples.yes + samples.no + samples.ambiguous;
  const value = auc(pairs);
  const rows = sweep(pairs);
  const best = bestThreshold(rows);
  const recommendation = recommend(value, best);
  const atRecommended =
    recommendation.kind === 'threshold'
      ? agreement(pairs, recommendation.threshold)
      : undefined;
  const loco = leaveOneCaseOut(pairs, best?.threshold ?? NEUTRAL);
  const controls = controlsOf(
    records,
    rubric,
    recommendation.kind === 'threshold' ? recommendation.threshold : NEUTRAL,
  );
  // A threshold is recommended only when both classes were answered, so the AUC and the agreement exist.
  const weight =
    atRecommended === undefined
      ? { weight: 'keep 0' as const, unmet: ['no threshold is recommended'] }
      : weightAdvice({
          yes: samples.yes,
          no: samples.no,
          auc: value as number,
          balanced: loco.heldOut,
          maxShift: loco.maxShift,
          controls,
        });
  return {
    rubric,
    samples,
    ambiguousShare: answered === 0 ? 0 : samples.ambiguous / answered,
    auc: value,
    sweep: rows,
    best,
    recommendation,
    atConfig: agreement(pairs, NEUTRAL),
    atRecommended,
    leaveOneCaseOut: loco,
    controlsInFit,
    controls,
    weight,
  };
};

/** The analysis of each rubric that Opus answered, in the order of the rubrics. */
export const analyze = (records: CalibrationRecord[]): RubricAnalysis[] => {
  const found = new Set(
    records.flatMap((record) => Object.keys(record.opusScore ?? {})),
  );
  const ordered = [
    ...RUBRIC_ORDER.filter((rubric) => found.has(rubric)),
    ...[...found].filter((rubric) => !RUBRIC_ORDER.includes(rubric)).sort(),
  ];
  return ordered.map((rubric) => analyzeRubric(records, rubric));
};

const two = (value: number | null | undefined): string =>
  value === null || value === undefined ? 'n/a' : value.toFixed(2);

const recommendationLine = (analysis: RubricAnalysis): string => {
  const { recommendation } = analysis;
  const best = analysis.best as Best;
  switch (recommendation.kind) {
    case 'threshold':
      return `threshold ${two(recommendation.threshold)} (the thresholds from ${two(best.low)} to ${two(best.high)} agree best, balanced agreement ${two(best.balanced)})`;
    case 'suspect':
      return `suspect: the thresholds that agree best with Opus lie below ${NEUTRAL}, so Jev reads this rubric differently from Opus: review its wording and its state. No threshold is recommended.`;
    case 'not-worth':
      return `not worth a threshold: the AUC is under ${MIN_AUC}, so Jev's scores hardly separate what Opus calls yes from no.`;
    case 'not-enough':
      return 'not enough yes and no answers to calibrate.';
  }
};

/** The analysis as text, one block for each rubric. */
export const formatAnalysis = (results: RubricAnalysis[]): string => {
  if (results.length === 0) return 'No rubric has an answer from Opus yet.\n';
  return `${results
    .map((analysis) => {
      const { samples, controls, weight, leaveOneCaseOut: loco } = analysis;
      return [
        analysis.rubric,
        `  samples: ${samples.yes} yes, ${samples.no} no, ${samples.ambiguous} ambiguous (${(analysis.ambiguousShare * 100).toFixed(1)}%), ${samples.unscored} unscored; ${analysis.controlsInFit} of the yes and no answers are controls`,
        `  AUC ${two(analysis.auc)}`,
        `  ${recommendationLine(analysis)}`,
        `  at the config's ${NEUTRAL}: balanced agreement ${two(analysis.atConfig.balanced)}`,
        `  leaving each case out moves the threshold by at most ${two(loco.maxShift)}, and the agreement on the case left out is ${two(loco.heldOut)}`,
        `  controls: ${controls.count} judged, Opus rejects ${controls.count === 0 ? 'n/a' : `${percent(controls.opusRejected)}%`}, Jev rejects ${controls.jevRejected === null ? 'n/a' : `${percent(controls.jevRejected)}%`}`,
        `  weight: ${weight.weight}${weight.unmet.length === 0 ? '' : ` (${weight.unmet.join('; ')})`}`,
      ].join('\n');
    })
    .join('\n\n')}\n`;
};

/** Prints the analysis of the file. Changes nothing. Returns the exit code. */
export const runAnalyze = (argv: string[], io: Io): number => {
  const parsed = parseArgs(argv, { values: ['--file'] }, USAGE);
  if (typeof parsed === 'string') {
    io.err(parsed);
    return 2;
  }
  const file = path.resolve(
    parsed.values['--file'] ?? DEFAULT_CALIBRATION_FILE(),
  );
  const records = readOrReport(file, io);
  if (records === undefined) return 1;
  io.out(formatAnalysis(analyze(records)));
  return 0;
};
