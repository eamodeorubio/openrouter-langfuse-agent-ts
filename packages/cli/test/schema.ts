import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { DOCS_PAGE_PATH, SCHEMA_PATH } from '../scripts/schemaFile.js';

/**
 * The file sits at the root of the repository. Searching upwards finds it
 * from the package and from the sandbox Stryker copies the package into.
 */
const findUp = (path: string): string => {
  for (
    let dir = dirname(fileURLToPath(import.meta.url));
    dir !== dirname(dir);
    dir = dirname(dir)
  ) {
    const candidate = join(dir, path);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`${path} not found above the tests.`);
};

/** The published schema, as a user reads it. */
export const publishedSchemaText = readFileSync(findUp(SCHEMA_PATH), 'utf8');

/** The page of the docs that shows the schema. */
export const docsPageText = readFileSync(findUp(DOCS_PAGE_PATH), 'utf8');

/** Whether `object` is valid under the published schema. */
export const matchesPublishedSchema = new Ajv2020({ strict: true }).compile(
  JSON.parse(publishedSchemaText),
);
