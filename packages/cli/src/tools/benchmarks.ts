import type { ModelsListResponse } from '@openrouter/sdk/models';

type Scores = NonNullable<
  NonNullable<
    ModelsListResponse['data'][number]['benchmarks']
  >['artificialAnalysis']
>;

/** An Artificial Analysis index as the model reads about it. */
interface Index {
  /** The name of the score in a tool result. */
  field: string;
  /** The same score as the SDK names it. */
  key: keyof Scores;
  measures: string;
  scale: '0 to 100' | '0 to 1';
  /** The order of `search_models` that ranks by it, when there is one. */
  sort?: string;
}

/**
 * Every index a tool can return, and no other reaches a result. Both tools build
 * what they say about the scores from this list, so that the two cannot drift. The decision index has
 * no sort: it ranks decision models, which a search lists only when asked for
 * their kind of output.
 */
const INDEXES = [
  {
    field: 'intelligence_index',
    key: 'intelligenceIndex',
    measures: 'general intelligence',
    scale: '0 to 100',
    sort: 'intelligence-high-to-low',
  },
  {
    field: 'finance_and_accounting_index',
    key: 'financeAndAccountingIndex',
    measures: 'finance and accounting work',
    scale: '0 to 100',
    sort: 'finance-and-accounting-high-to-low',
  },
  {
    field: 'strategy_and_ops_index',
    key: 'strategyAndOpsIndex',
    measures: 'strategy and operations work',
    scale: '0 to 100',
    sort: 'strategy-and-ops-high-to-low',
  },
  {
    field: 'legal_index',
    key: 'legalIndex',
    measures: 'legal work',
    scale: '0 to 100',
    sort: 'legal-high-to-low',
  },
  {
    field: 'healthcare_and_medical_index',
    key: 'healthcareAndMedicalIndex',
    measures: 'healthcare and medical work',
    scale: '0 to 100',
    sort: 'healthcare-and-medical-high-to-low',
  },
  {
    field: 'engineering_index',
    key: 'engineeringIndex',
    measures: 'engineering work',
    scale: '0 to 100',
    sort: 'engineering-high-to-low',
  },
  {
    field: 'economics_index',
    key: 'economicsIndex',
    measures: 'economics work',
    scale: '0 to 100',
    sort: 'economics-high-to-low',
  },
  {
    field: 'cyber_index',
    key: 'cyberIndex',
    measures: 'cybersecurity work',
    scale: '0 to 100',
    sort: 'cyber-high-to-low',
  },
  {
    field: 'openness_index',
    key: 'opennessIndex',
    measures: 'how open the model is',
    scale: '0 to 100',
    sort: 'openness-high-to-low',
  },
  {
    field: 'multilingual_index',
    key: 'multilingualIndex',
    measures: 'skill across languages',
    scale: '0 to 1',
    sort: 'multilingual-high-to-low',
  },
  {
    field: 'decision_index',
    key: 'decisionIndex',
    measures: 'decision tasks',
    scale: '0 to 100',
  },
] as const satisfies readonly Index[];

type Entry = (typeof INDEXES)[number];
type SortedIndex = Extract<Entry, { sort: string }>;

const SORTED: readonly SortedIndex[] = INDEXES.filter(
  (index): index is SortedIndex => 'sort' in index,
);

/** The orders of `search_models` that rank by an index. The API applies them. */
export const INDEX_SORTS = SORTED.map((index) => index.sort);

const LISTED: ReadonlySet<string> = new Set(INDEXES.map((index) => index.key));

const about = ({ field, measures, scale }: Index): string =>
  `${field} (${measures}, ${scale})`;

const UNSCORED = 'the model is unscored, never zero.';
const CREDIT = 'Name Artificial Analysis when you quote a score.';

/** How to read every score `get_model` can return. */
export const SCORES_LEGEND = [
  'The Artificial Analysis benchmark scores:',
  `${INDEXES.map(about).join('; ')}.`,
  'Higher is better.',
  `A missing or null score means ${UNSCORED}`,
  'Each score is the best across the configurations tested, so two indexes of one model may come from different configurations.',
  CREDIT,
].join(' ');

/** What each index sort ranks by, and how to read the score an entry then shows. `get_model` holds the rest, and travels in the same request. */
export const INDEX_SORTS_LEGEND = [
  `Orders by an Artificial Analysis score, applied by the API: ${INDEX_SORTS.join(', ')}.`,
  'Each ranks by the index of the same name, with underscores for hyphens, such as legal-high-to-low by legal_index.',
  'The description of get_model says what each index measures.',
  'multilingual_index runs from 0 to 1, the others from 0 to 100, and higher is better.',
  'Models without a score come last: they are unscored, never zero.',
  'No index measures coding alone.',
  'Each entry shows the intelligence index and the score it is ordered by.',
  CREDIT,
].join(' ');

/**
 * The score a sort ranks by, as the field a search entry shows for it. Nothing
 * for any other sort. For the intelligence sort it is the field every entry
 * already holds.
 */
export const rankedScore = (
  sort: string | undefined,
  scores: Scores | undefined,
): Record<string, number | null> => {
  const index = SORTED.find((candidate) => candidate.sort === sort);
  return index === undefined
    ? {}
    : { [index.field]: scores?.[index.key] ?? null };
};

interface Benchmarks {
  artificialAnalysis?: object | undefined;
}

/**
 * The benchmarks of a model as a tool returns them: of the Artificial Analysis
 * scores, those of a listed index that the model has, and no entry for them
 * when none is left. A retired index is not listed, so it is dropped without
 * reading a field the SDK may remove.
 */
export const currentBenchmarks = (benchmarks: Benchmarks | undefined) => {
  if (!benchmarks?.artificialAnalysis) {
    return benchmarks;
  }
  const { artificialAnalysis, ...others } = benchmarks;
  const scored = Object.entries(artificialAnalysis).filter(
    ([name, score]) => score !== null && LISTED.has(name),
  );
  return scored.length > 0
    ? { ...others, artificialAnalysis: Object.fromEntries(scored) }
    : others;
};
