import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadQuestions } from '../src/calibrate/rubrics.js';

describe('loadQuestions', () => {
  it('reads the question of each rubric of the package, by metric', () => {
    expect(loadQuestions()).toEqual({
      'judge-grounding':
        'Is every price, context size and capability that the answer states about a model given in the tool results? Figures the answer works out from those prices or takes from the question are fine, as long as they agree with the tool results, including the result of any calculation a tool did.',
      'judge-relevance': 'Does the answer address the question that was asked?',
      'judge-usefulness': 'Would the answer let the person decide or act?',
      'judge-tool-usage': 'Were the tool calls relevant to the question?',
    });
  });

  it('reads only the YAML files, and only those that name a metric and a question', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-questions-'));
    const write = (name: string, text: string) =>
      fs.writeFileSync(path.join(dir, name), text);
    write('good.yaml', 'metric: judge-a\nvalue: Is it a?\n');
    write('notes.txt', 'metric: judge-b\nvalue: Is it b?\n');
    write('no-metric.yaml', 'value: Is it c?\n');
    write('no-value.yaml', 'metric: judge-d\n');
    write('number-metric.yaml', 'metric: 3\nvalue: Is it e?\n');
    write('number-value.yaml', 'metric: judge-f\nvalue: 3\n');
    write('list.yaml', '- metric: judge-g\n  value: Is it g?\n');
    expect(loadQuestions(dir)).toEqual({ 'judge-a': 'Is it a?' });
  });
});
