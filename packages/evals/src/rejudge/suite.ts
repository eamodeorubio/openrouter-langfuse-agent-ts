import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { isObject } from '../json.js';

/** The re-judge cannot go on: its input or the config is not what it needs. The message says what, and names the case, the model and the repeat when one row is at fault. */
export class RejudgeError extends Error {}

/** A `javascript` assertion of the config, as the config states it. */
export interface Assertion {
  metric: string;
  value: unknown;
}

/** A case of the config: what the checks read of it, and the checks it declares. */
export interface CaseDef {
  metadata: Record<string, unknown>;
  assert: Assertion[];
}

/** The config of the working tree, cut down to what judging needs. */
export interface Suite {
  /** The checks every case passes through, from `defaultTest`. */
  defaults: Assertion[];
  cases: Map<string, CaseDef>;
}

const CONFIG_FILE = 'promptfooconfig.yaml';
const CASES_DIR = 'cases';

const readYaml = (file: string): unknown => {
  try {
    return parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new RejudgeError(`Cannot read ${file}: ${reason}`);
  }
};

/** The `javascript` assertions of a list. A rubric file the list names, and any other kind, are left out: the re-judge does not run them. */
const javascriptOf = (list: unknown): Assertion[] => {
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) =>
    isObject(item) &&
    item.type === 'javascript' &&
    typeof item.metric === 'string'
      ? [{ metric: item.metric, value: item.value }]
      : [],
  );
};

/** Reads the config and the cases under `root`, the root of the evals package. Throws a `RejudgeError` for a file it cannot read. */
export const loadSuite = (root: string): Suite => {
  const config = readYaml(path.join(root, CONFIG_FILE));
  const defaultTest = isObject(config) ? config.defaultTest : undefined;
  const defaults = javascriptOf(
    isObject(defaultTest) ? defaultTest.assert : undefined,
  );
  const cases = new Map<string, CaseDef>();
  const dir = path.join(root, CASES_DIR);
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.yaml'));
  for (const name of files) {
    const list = readYaml(path.join(dir, name));
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const metadata = isObject(item) ? item.metadata : undefined;
      if (
        isObject(item) &&
        isObject(metadata) &&
        typeof metadata.id === 'string'
      ) {
        if (cases.has(metadata.id)) {
          throw new RejudgeError(
            `The case ${metadata.id} is in the config twice, and the command cannot tell which one judges.`,
          );
        }
        cases.set(metadata.id, { metadata, assert: javascriptOf(item.assert) });
      }
    }
  }
  return { defaults, cases };
};
