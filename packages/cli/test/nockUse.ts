import { readFileSync } from 'node:fs';

/** Whether a test file imports nock, which answers its requests and has to turn net connect off. */
export const usesNock = (file: string | undefined): boolean =>
  file !== undefined && /from 'nock'/.test(readFileSync(file, 'utf8'));

/** Whether a test file turns net connect off. */
export const disablesNetConnect = (file: string): boolean =>
  /nock\.disableNetConnect\(\)/.test(readFileSync(file, 'utf8'));
