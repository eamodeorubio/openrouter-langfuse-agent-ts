import fs from 'node:fs';
import path from 'node:path';
import { finite, isObject } from '../json.js';

/** OpenRouter's public model list. The snapshot of a run is taken from here. */
export const CATALOG_URL = 'https://openrouter.ai/api/v1/models';

export const SNAPSHOT_FILE = 'catalog.json';

const DEFAULT_TIMEOUT_MS = 30_000;
const TOKENS = 6;
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** What a run keeps of a model of the catalog: what the queries read. A price is null when the API gave none. */
export interface CatalogModel {
  id: string;
  contextLength: number | null;
  supportedParameters: string[];
  /** USD per million tokens. */
  inputPrice: number | null;
  /** USD per million tokens. */
  outputPrice: number | null;
}

export interface Snapshot {
  /** When the model list was fetched, as an ISO time. */
  fetchedAt: string;
  models: CatalogModel[];
}

export class SnapshotError extends Error {}

/**
 * A per-token price of the API as USD per million tokens, by an exact shift of
 * the decimal point. Null for anything that is not a non-negative decimal
 * string, such as the `-1` of a routing model.
 */
export const perMillion = (price: unknown): number | null => {
  if (typeof price !== 'string') return null;
  const match = DECIMAL.exec(price);
  if (!match) return null;
  const fraction = (match[2] ?? '').padEnd(TOKENS, '0');
  const rest = fraction.slice(TOKENS);
  const shifted = Number(
    `${match[1]}${fraction.slice(0, TOKENS)}${rest ? `.${rest}` : ''}`,
  );
  return Number.isFinite(shifted) ? shifted : null;
};

const toModel = (entry: unknown): CatalogModel | undefined => {
  if (!isObject(entry) || typeof entry.id !== 'string' || entry.id === '') {
    return undefined;
  }
  const pricing = isObject(entry.pricing) ? entry.pricing : {};
  return {
    id: entry.id,
    contextLength: finite(entry.context_length) ? entry.context_length : null,
    supportedParameters: Array.isArray(entry.supported_parameters)
      ? entry.supported_parameters.filter(
          (name): name is string => typeof name === 'string',
        )
      : [],
    inputPrice: perMillion(pricing.prompt),
    outputPrice: perMillion(pricing.completion),
  };
};

/** The models of the API's answer, without the entries that have no id. */
export const toModels = (body: unknown): CatalogModel[] => {
  const data = isObject(body) ? body.data : undefined;
  if (!Array.isArray(data)) {
    throw new SnapshotError('the answer has no list of models.');
  }
  return data.flatMap((entry) => toModel(entry) ?? []);
};

/** Why a request did not complete, in a few words. */
const reasonOf = (error: unknown, timeoutMs: number): string => {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return `timed out after ${timeoutMs} ms`;
  }
  const cause = error instanceof Error ? error.cause : undefined;
  const code = isObject(cause) ? cause.code : undefined;
  if (typeof code === 'string') return code;
  return error instanceof Error ? error.message : String(error);
};

/** Fetches the model list once and stamps it with the time. Throws a `SnapshotError` that says why it could not. */
export const fetchSnapshot = async (
  url: string,
  options: {
    timeoutMs?: number;
    now?: () => Date;
    fetch?: typeof fetch;
  } = {},
): Promise<Snapshot> => {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    now = () => new Date(),
    fetch: request = fetch,
  } = options;
  const fail = (reason: string) =>
    new SnapshotError(
      `Could not fetch the model catalog from ${url}: ${reason}`,
    );

  let response: Response;
  try {
    response = await request(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw fail(`${reasonOf(error, timeoutMs)}.`);
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    throw fail(`the API answered ${response.status}.`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw fail(
      error instanceof Error && error.name === 'TimeoutError'
        ? `timed out after ${timeoutMs} ms.`
        : 'the answer is not JSON.',
    );
  }
  try {
    return { fetchedAt: now().toISOString(), models: toModels(body) };
  } catch (error) {
    throw fail(error instanceof Error ? error.message : String(error));
  }
};

/** Saves the snapshot as `catalog.json` in the directory and returns the path. */
export const writeSnapshot = (dir: string, snapshot: Snapshot): string => {
  const file = path.join(dir, SNAPSHOT_FILE);
  try {
    fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);
  } catch (error) {
    throw new SnapshotError(
      `The snapshot ${file} cannot be written: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return file;
};

const isPrice = (value: unknown): boolean => value === null || finite(value);

const isModel = (value: unknown): value is CatalogModel =>
  isObject(value) &&
  typeof value.id === 'string' &&
  (value.contextLength === null || finite(value.contextLength)) &&
  Array.isArray(value.supportedParameters) &&
  value.supportedParameters.every((name) => typeof name === 'string') &&
  isPrice(value.inputPrice) &&
  isPrice(value.outputPrice);

/** Reads a snapshot file back. Throws a `SnapshotError` that names the file when it is missing or is not a snapshot. */
export const loadSnapshot = (file: string): Snapshot => {
  let body: unknown;
  try {
    // Stryker disable next-line StringLiteral: equivalent because JSON.parse reads a Buffer as its UTF-8 text
    body = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new SnapshotError(
      `The snapshot ${file} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    !isObject(body) ||
    typeof body.fetchedAt !== 'string' ||
    !Array.isArray(body.models) ||
    !body.models.every(isModel)
  ) {
    throw new SnapshotError(
      `The snapshot ${file} is not a snapshot: it needs a fetch time and a list of models.`,
    );
  }
  return { fetchedAt: body.fetchedAt, models: body.models };
};
