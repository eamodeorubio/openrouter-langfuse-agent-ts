import { finite, isObject } from '../json.js';
import { parseWorkload, type Workload } from '../oracle/workload.js';
import { SET_NAMES, type SetName } from '../sets.js';

/** A case declared something the checks cannot read. Raised before the check judges anything. */
export class CaseError extends Error {}

/** The figures a case may ask the answer to hold. */
export const FIGURE_NAMES = [
  'inputPrice',
  'outputPrice',
  'contextLength',
] as const;
export type FigureName = (typeof FIGURE_NAMES)[number];

/** What a case declares about the models the snapshot accepts: a named query and its parameters. */
export interface Oracle {
  query: string;
  params: Record<string, unknown>;
}

/** What a good search sends: a number is a lower bound, text is an exact value, a list must be held whole. */
export type SearchRequirements = Record<string, number | string | string[]>;

/** What a case declares in its `metadata`, and the checks read. */
export interface CaseSpec {
  id?: string;
  /** The sets the case belongs to: the core run asks the core cases, the judge run the cases a rubric grades, the full run asks them all. */
  set?: SetName[];
  needsLookup?: boolean;
  needsArithmetic?: boolean;
  expectedCost?: number;
  askedModel?: string;
  askedFigures?: FigureName[];
  oracle?: Oracle;
  search?: SearchRequirements;
  /** What the case asks a chatbot to do in a month, for the cost of it. */
  workload?: Workload;
  /** The models of the question are independent, and a good run reads them in one round. */
  parallelLookups?: boolean;
  /** A slug the question holds that is not a model, and the model it was meant to name. */
  recovery?: Recovery;
  /** A slug that the snapshot lacks, which the question asks about. */
  unknownModel?: string;
  /** The question leaves out something the answer needs, so a good answer asks for it or says what it assumed. */
  underspecified?: boolean;
  /** The start of a slug of a model the answer may assume. */
  assumes?: string;
}

export interface Recovery {
  misspelled: string;
  correction: string;
}

export const KNOWN_DECLARATIONS = [
  'id',
  'set',
  'needsLookup',
  'needsArithmetic',
  'expectedCost',
  'askedModel',
  'askedFigures',
  'oracle',
  'search',
  'workload',
  'parallelLookups',
  'recovery',
  'unknownModel',
  'underspecified',
  'assumes',
] as const;

const SET_RULE = `'${SET_NAMES.slice(0, -1).join("', '")}' or '${SET_NAMES.at(-1)}', or a list of them`;

const wrong = (name: string, rule: string, value: unknown): CaseError =>
  new CaseError(
    `The declaration ${name} of a case must be ${rule}, got ${JSON.stringify(value)}.`,
  );

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

const isFigureList = (value: unknown): value is FigureName[] =>
  Array.isArray(value) &&
  value.every((name) => FIGURE_NAMES.includes(name as FigureName));

const RECOVERY_RULE =
  'an object of misspelled and correction, two different slugs';

const readRecovery = (value: unknown): Recovery => {
  if (
    !isObject(value) ||
    Object.keys(value).length !== 2 ||
    !isText(value.misspelled) ||
    !isText(value.correction) ||
    value.misspelled.toLowerCase() === value.correction.toLowerCase()
  ) {
    throw wrong('recovery', RECOVERY_RULE, value);
  }
  return { misspelled: value.misspelled, correction: value.correction };
};

const ORACLE_KEYS = ['query', 'params'];

const readOracle = (value: unknown): Oracle => {
  if (!isObject(value) || typeof value.query !== 'string') {
    throw new CaseError('The oracle declaration of a case needs a query name.');
  }
  for (const key of Object.keys(value)) {
    if (!ORACLE_KEYS.includes(key)) {
      throw new CaseError(
        `Unknown key "${key}" in the oracle declaration of a case. The known ones are: ${ORACLE_KEYS.join(', ')}.`,
      );
    }
  }
  const params = value.params === undefined ? {} : value.params;
  if (!isObject(params)) {
    throw new CaseError(
      'The oracle declaration of a case takes params as an object.',
    );
  }
  return { query: value.query, params };
};

const readSearch = (value: unknown): SearchRequirements => {
  if (!isObject(value)) {
    throw wrong('search', 'an object of requirements', value);
  }
  for (const [name, required] of Object.entries(value)) {
    const list =
      Array.isArray(required) &&
      required.every((item) => typeof item === 'string');
    if (typeof required !== 'number' && typeof required !== 'string' && !list) {
      throw new CaseError(
        `The search requirement ${name} of a case must be a number, text or a list of text.`,
      );
    }
  }
  return value as SearchRequirements;
};

/**
 * What a case declares, read once and checked: a declaration that is not known,
 * or is of the wrong kind, fails loudly, so that a typo cannot turn a check into
 * a pass. The metadata comes from the test case promptfoo hands a check.
 */
export const readCase = (context: unknown): CaseSpec => {
  const test = isObject(context) ? context.test : undefined;
  const metadata = isObject(test) ? test.metadata : undefined;
  if (metadata === undefined) return {};
  if (!isObject(metadata)) {
    throw new CaseError('The metadata of a case must be an object.');
  }

  for (const name of Object.keys(metadata)) {
    if (!(KNOWN_DECLARATIONS as readonly string[]).includes(name)) {
      throw new CaseError(
        `Unknown declaration "${name}" in the metadata of a case. The known ones are: ${KNOWN_DECLARATIONS.join(', ')}.`,
      );
    }
  }

  const spec: CaseSpec = {};
  const { id, needsLookup, needsArithmetic, expectedCost, askedModel } =
    metadata;
  if (id !== undefined) {
    if (!isText(id)) throw wrong('id', 'text', id);
    spec.id = id;
  }
  if (metadata.set !== undefined) {
    const names = Array.isArray(metadata.set) ? metadata.set : [metadata.set];
    if (
      names.length === 0 ||
      !names.every((name) => SET_NAMES.includes(name as SetName)) ||
      new Set(names).size !== names.length
    ) {
      throw wrong('set', SET_RULE, metadata.set);
    }
    spec.set = names as SetName[];
  }
  if (needsLookup !== undefined) {
    if (typeof needsLookup !== 'boolean') {
      throw wrong('needsLookup', 'true or false', needsLookup);
    }
    spec.needsLookup = needsLookup;
  }
  if (needsArithmetic !== undefined) {
    if (typeof needsArithmetic !== 'boolean') {
      throw wrong('needsArithmetic', 'true or false', needsArithmetic);
    }
    spec.needsArithmetic = needsArithmetic;
  }
  if (expectedCost !== undefined) {
    if (!finite(expectedCost)) {
      throw wrong('expectedCost', 'a finite number', expectedCost);
    }
    spec.expectedCost = expectedCost;
  }
  if (askedModel !== undefined) {
    if (!isText(askedModel)) throw wrong('askedModel', 'text', askedModel);
    spec.askedModel = askedModel;
  }
  if (metadata.askedFigures !== undefined) {
    if (!isFigureList(metadata.askedFigures)) {
      throw wrong(
        'askedFigures',
        `a list of figure names (${FIGURE_NAMES.join(', ')})`,
        metadata.askedFigures,
      );
    }
    spec.askedFigures = metadata.askedFigures;
  }
  if (metadata.oracle !== undefined) spec.oracle = readOracle(metadata.oracle);
  if (metadata.search !== undefined) spec.search = readSearch(metadata.search);
  if (metadata.workload !== undefined) {
    const workload = parseWorkload(metadata.workload);
    if (!workload) {
      throw wrong(
        'workload',
        'an object of chatsPerDay, inputTokens, outputTokens and days, each a number from 0',
        metadata.workload,
      );
    }
    spec.workload = workload;
  }
  if (metadata.parallelLookups !== undefined) {
    if (typeof metadata.parallelLookups !== 'boolean') {
      throw wrong('parallelLookups', 'true or false', metadata.parallelLookups);
    }
    spec.parallelLookups = metadata.parallelLookups;
  }
  if (metadata.recovery !== undefined) {
    spec.recovery = readRecovery(metadata.recovery);
  }
  if (metadata.unknownModel !== undefined) {
    if (!isText(metadata.unknownModel)) {
      throw wrong('unknownModel', 'text', metadata.unknownModel);
    }
    spec.unknownModel = metadata.unknownModel;
  }
  if (metadata.underspecified !== undefined) {
    if (typeof metadata.underspecified !== 'boolean') {
      throw wrong('underspecified', 'true or false', metadata.underspecified);
    }
    spec.underspecified = metadata.underspecified;
  }
  if (metadata.assumes !== undefined) {
    if (!isText(metadata.assumes)) {
      throw wrong('assumes', 'text', metadata.assumes);
    }
    if (spec.underspecified !== true) {
      throw new CaseError(
        'The declaration assumes of a case needs underspecified to be true.',
      );
    }
    spec.assumes = metadata.assumes;
  }
  return spec;
};
