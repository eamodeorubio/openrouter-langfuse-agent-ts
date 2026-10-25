import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderSchemaFile, schemaId } from '../scripts/schemaFile.js';
import { EXAMPLES } from './outputExamples.js';
import {
  docsPageText,
  matchesPublishedSchema,
  publishedSchemaText,
} from './schema.js';

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

describe('the published JSON Schema', () => {
  it('is the schema generated from the Zod schema; run pnpm schema:generate when it is not', () => {
    expect(publishedSchemaText).toBe(renderSchemaFile(version));
  });

  it('names itself by the raw GitHub URL of the file at the tag of the release', () => {
    expect(JSON.parse(publishedSchemaText).$id).toBe(
      `https://raw.githubusercontent.com/eamodeorubio/openrouter-langfuse-agent-ts/v${version}/docs/public/schemas/json-output.schema.json`,
    );
  });

  it('keeps the id and the marker of Release Please on one line, and nothing else on it', () => {
    const lines = publishedSchemaText
      .split('\n')
      .filter((line) => line.includes('x-release-please-version'));
    expect(lines).toEqual([
      `  "$id": "${schemaId(version)}", "$comment": "x-release-please-version",`,
    ]);
  });

  it('declares draft 2020-12', () => {
    expect(JSON.parse(publishedSchemaText).$schema).toBe(
      'https://json-schema.org/draft/2020-12/schema',
    );
  });

  it.each(EXAMPLES)(
    'accepts or rejects %s (valid: %s)',
    (_name, object, valid) => {
      expect(matchesPublishedSchema(object)).toBe(valid);
    },
  );

  it('is the schema the docs page shows: the page imports the file as it is and renders it', () => {
    expect(docsPageText).toContain(
      "import schema from '../../../public/schemas/json-output.schema.json?raw';",
    );
    expect(docsPageText).toContain('<Code code={schema}');
  });
});
