import { z } from 'zod';
import { outputSchema } from '../src/output.js';

/** Where the schema is published, from the root of the repository. */
export const SCHEMA_PATH = 'docs/public/schemas/json-output.schema.json';

/** The page of the docs that shows the schema, from the root of the repository. */
export const DOCS_PAGE_PATH = 'docs/src/content/docs/json-output.mdx';

const REPOSITORY = 'eamodeorubio/openrouter-langfuse-agent-ts';

/** The raw GitHub URL of the file at the tag of release `version`. */
export const schemaId = (version: string): string =>
  `https://raw.githubusercontent.com/${REPOSITORY}/v${version}/${SCHEMA_PATH}`;

/**
 * The text of the published file. `$id` and the marker Release Please looks
 * for share one line, so that a release rewrites the version in the URL.
 */
export const renderSchemaFile = (version: string): string => {
  const { $schema, ...rest } = z.toJSONSchema(outputSchema);
  const [open, ...body] = JSON.stringify({ $schema, ...rest }, null, 2).split(
    '\n',
  );
  const pinned = `  "$id": ${JSON.stringify(schemaId(version))}, "$comment": "x-release-please-version",`;
  const second = body[0];
  return [
    open,
    second?.endsWith(',') ? second : `${second},`,
    pinned,
    ...body.slice(1),
    '',
  ].join('\n');
};
