import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { isObject } from '../json.js';

const RUBRIC_DIR = path.resolve(import.meta.dirname, '../../rubrics');

/** The question of each rubric, by metric, from the files that the cases reference. */
export const loadQuestions = (dir = RUBRIC_DIR): Record<string, string> =>
  Object.fromEntries(
    fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.yaml'))
      .flatMap((name) => {
        const rubric: unknown = parse(
          fs.readFileSync(path.join(dir, name), 'utf8'),
        );
        return isObject(rubric) &&
          typeof rubric.metric === 'string' &&
          typeof rubric.value === 'string'
          ? [[rubric.metric, rubric.value] as const]
          : [];
      }),
  );
