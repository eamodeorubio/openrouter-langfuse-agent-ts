import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSchemaFile, SCHEMA_PATH } from './schemaFile.js';

const root = new URL('../../../', import.meta.url);
const { version } = JSON.parse(
  await readFile(new URL('packages/cli/package.json', root), 'utf8'),
);
const target = fileURLToPath(new URL(SCHEMA_PATH, root));
await mkdir(dirname(target), { recursive: true });
await writeFile(target, renderSchemaFile(version));
