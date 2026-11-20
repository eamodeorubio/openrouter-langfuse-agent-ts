/** Builders for the re-judge tests: a config directory, rows shaped like the ones promptfoo saves, and a run directory. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stringify } from 'yaml';
import type { CatalogModel } from '../src/oracle/snapshot.js';
import { snapshotFile } from './oracleFixture.js';

const ASSERTIONS = 'file://src/checks/assertions.ts';

/** The export of `assertions.ts` that each metric of the fixtures names. */
const CHECK_NAMES: Record<string, string> = {
  'run-failed': 'runFailed',
  'memory-answer': 'memoryAnswer',
  'invented-data': 'inventedModels',
  'wrong-answer': 'wrongAnswer',
};

export interface Saved {
  metric: string;
  pass: boolean;
  reason?: string;
}

export interface RowSpec {
  caseId: string;
  model?: string;
  repeat?: number;
  output?: unknown;
  /** The verdicts of the `javascript` checks as saved. */
  saved: Saved[];
  /** The scores of the judge rubrics as saved. */
  rubrics?: Record<string, number>;
  providerError?: boolean;
}

/** The success object of the CLI. Each call is `failed` or not. */
export const success = (
  answer: string,
  calls: { failed?: boolean; output?: string }[] = [],
  question = 'Which model is cheapest?',
) => ({
  success: true,
  question,
  answer,
  toolCalls: calls.map((call, index) => ({
    round: index + 1,
    name: 'search_models',
    arguments: '{}',
    output: call.output ?? '{}',
    failed: call.failed ?? false,
  })),
});

/** The three checks every case of the fixture config passes through, all saved as passed, with the reasons the checks give a run that looked a model up. */
export const ALL_PASS: Saved[] = [
  { metric: 'run-failed', pass: true, reason: 'The run has an answer.' },
  { metric: 'memory-answer', pass: true, reason: 'A tool call succeeded.' },
  {
    metric: 'invented-data',
    pass: true,
    reason:
      'Every model the answer names is in the question or in a tool output.',
  },
];

/** A row as promptfoo saves it, built by the rules the report and the re-judge rely on. */
export const savedRow = (spec: RowSpec): Record<string, unknown> => {
  const {
    caseId,
    model = 'm/one',
    repeat = 0,
    output = success('An answer.', [{}]),
    saved,
    rubrics = {},
    providerError = false,
  } = spec;
  const question = 'Which model is cheapest?';
  const testCase = {
    description: caseId,
    vars: { question },
    metadata: { id: caseId },
  };
  const base = {
    id: `${caseId}:${model}:${repeat}`,
    vars: { model, question },
    repeatIndex: repeat,
    testIdx: 0,
    testCase,
    latencyMs: 100,
  };
  if (providerError) {
    return {
      ...base,
      response: { error: 'The CLI timed out.' },
      success: false,
      score: 0,
      failureReason: 2,
      error: 'The CLI timed out.',
      cost: 0,
    };
  }
  const components = [
    ...saved.map((verdict) => ({
      pass: verdict.pass,
      score: verdict.pass ? 1 : 0,
      reason:
        verdict.reason ??
        (verdict.pass ? 'Passed.' : `${verdict.metric} failed.`),
      assertion: {
        type: 'javascript',
        metric: verdict.metric,
        value: `${ASSERTIONS}:${CHECK_NAMES[verdict.metric] ?? 'x'}`,
      },
    })),
    ...Object.entries(rubrics).map(([metric, score]) => ({
      pass: true,
      score,
      reason: `Jev Noul probability ${score} >= threshold 0`,
      assertion: { type: 'llm-rubric', metric, weight: 0, threshold: 0.53 },
    })),
  ];
  const failing = components.filter((component) => !component.pass);
  const passed = failing.length === 0;
  const reason = passed
    ? 'All assertions passed'
    : (failing[failing.length - 1] as { reason: string }).reason;
  const checks = components.filter(
    (component) => component.assertion.type === 'javascript',
  );
  const score =
    checks.length === 0
      ? 0
      : checks.filter((component) => component.pass).length / checks.length;
  const namedScores = Object.fromEntries(
    components.map((component) => [
      component.assertion.metric,
      component.score,
    ]),
  );
  const namedScoreWeights = Object.fromEntries(
    components.map((component) => [component.assertion.metric, 1]),
  );
  return {
    ...base,
    response: { output, cost: 0.01 },
    cost: 0.01,
    success: passed,
    score,
    failureReason: passed ? 0 : 1,
    ...(passed ? {} : { error: reason }),
    namedScores,
    gradingResult: {
      pass: passed,
      score,
      reason,
      namedScores,
      namedScoreWeights,
      componentResults: components,
    },
  };
};

/** A temporary directory, removed by the OS in time. */
export const tempDir = (prefix = 'rejudge-'): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), prefix));

export interface FixtureCase {
  id: string;
  metadata?: Record<string, unknown>;
  /** The checks of the case, as `{ metric, name }`, `name` being an export of `assertions.ts`. */
  checks?: { metric: string; name: string }[];
  /** A raw `assert` list, which replaces the one built from `checks`. */
  assert?: unknown[];
}

const javascript = (check: { metric: string; name: string }) => ({
  type: 'javascript',
  metric: check.metric,
  value: `${ASSERTIONS}:${check.name}`,
});

export const DEFAULT_CHECKS = [
  { metric: 'run-failed', name: 'runFailed' },
  { metric: 'memory-answer', name: 'memoryAnswer' },
  { metric: 'invented-data', name: 'inventedModels' },
];

/** The cases of the fixture config: one that needs a lookup, one that does not. */
export const FIXTURE_CASES: FixtureCase[] = [
  { id: 'fx/lookup', metadata: { needsLookup: true } },
  { id: 'fx/plain' },
];

/** Writes a package root with a `promptfooconfig.yaml` and `cases/fx.yaml`, and returns it. */
export const writeConfig = (
  cases: FixtureCase[] = FIXTURE_CASES,
  defaults: unknown[] = DEFAULT_CHECKS.map(javascript),
): string => {
  const root = tempDir('rejudge-config-');
  fs.mkdirSync(path.join(root, 'cases'));
  fs.writeFileSync(
    path.join(root, 'promptfooconfig.yaml'),
    stringify({
      description: 'fixture',
      defaultTest: { vars: { model: ['m/one'] }, assert: defaults },
      tests: 'file://cases/*.yaml',
    }),
  );
  fs.writeFileSync(
    path.join(root, 'cases/fx.yaml'),
    stringify(
      cases.map((one) => ({
        description: one.id,
        vars: { question: 'Which model is cheapest?' },
        metadata: { id: one.id, ...one.metadata },
        assert: one.assert ?? [
          ...(one.checks ?? []).map(javascript),
          'file://rubrics/judge-relevance.yaml',
        ],
      })),
    ),
  );
  return root;
};

export interface RunDirOptions {
  models?: CatalogModel[];
  target?: string | null;
  instructions?: string | null;
  catalog?: boolean;
}

/** Writes a run directory with the rows, its snapshot and its instructions, and returns the path of `results.json`. */
export const writeRun = (
  rows: unknown[],
  options: RunDirOptions = {},
): string => {
  const dir = tempDir('rejudge-run-');
  const file = path.join(dir, 'results.json');
  const count = (test: (row: Record<string, unknown>) => boolean): number =>
    rows.filter((row) => test(row as Record<string, unknown>)).length;
  const errors = count((row) => row.failureReason === 2);
  const failures = count(
    (row) => row.success === false && row.failureReason !== 2,
  );
  fs.writeFileSync(
    file,
    JSON.stringify({
      results: {
        results: rows,
        stats: {
          successes: rows.length - failures - errors,
          failures,
          errors,
          durationMs: 1000,
        },
      },
    }),
  );
  if (options.catalog !== false) {
    fs.copyFileSync(
      snapshotFile(options.models ?? []),
      path.join(dir, 'catalog.json'),
    );
  }
  if (options.instructions !== null) {
    fs.writeFileSync(
      path.join(dir, 'instructions.txt'),
      options.instructions ?? 'Instructions of the fixture CLI.',
    );
  }
  if (options.target !== null) {
    fs.writeFileSync(
      path.join(dir, 'target.txt'),
      options.target ?? 'ask-openrouter@1.2.0',
    );
  }
  return file;
};
