import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveCheck } from '../src/rejudge/checks.js';
import { loadSuite, RejudgeError } from '../src/rejudge/suite.js';
import { FIXTURE_CASES, tempDir, writeConfig } from './rejudgeFixture.js';

const realRoot = path.resolve(import.meta.dirname, '..');

describe('loadSuite', () => {
  it('reads the javascript checks of defaultTest, then those of the case, and the metadata of the case', () => {
    const root = writeConfig([
      {
        id: 'fx/one',
        metadata: { needsLookup: true },
        checks: [{ metric: 'wrong-answer', name: 'wrongAnswer' }],
      },
    ]);
    const suite = loadSuite(root);
    expect(suite.defaults.map((a) => a.metric)).toEqual([
      'run-failed',
      'memory-answer',
      'invented-data',
    ]);
    const one = suite.cases.get('fx/one');
    expect(one?.metadata).toEqual({ id: 'fx/one', needsLookup: true });
    expect(one?.assert.map((a) => a.metric)).toEqual(['wrong-answer']);
  });

  it('leaves out the rubric files a case lists and any assertion that is not javascript', () => {
    const root = writeConfig([
      {
        id: 'fx/one',
        assert: [
          'file://rubrics/judge-relevance.yaml',
          { type: 'llm-rubric', metric: 'judge-x', value: 'Is it good?' },
          {
            type: 'javascript',
            metric: 'wrong-answer',
            value: 'file://src/checks/assertions.ts:wrongAnswer',
          },
        ],
      },
    ]);
    expect(
      loadSuite(root)
        .cases.get('fx/one')
        ?.assert.map((a) => a.metric),
    ).toEqual(['wrong-answer']);
  });

  it('holds every case of the files under cases/ by its id', () => {
    const ids = [...loadSuite(writeConfig(FIXTURE_CASES)).cases.keys()];
    expect(ids.sort()).toEqual(['fx/lookup', 'fx/plain']);
  });

  it('refuses a config that is missing, naming the file', () => {
    expect(() => loadSuite('/nonexistent/evals-root')).toThrow(RejudgeError);
    expect(() => loadSuite('/nonexistent/evals-root')).toThrow(
      /promptfooconfig\.yaml/,
    );
  });

  it('loads the real config, and every javascript check of every case names a check', () => {
    const suite = loadSuite(realRoot);
    expect(suite.cases.size).toBeGreaterThan(10);
    const unnamed = [...suite.cases.values()]
      .flatMap((one) => [...suite.defaults, ...one.assert])
      .filter((assertion) => resolveCheck(assertion.value) === undefined)
      .map((assertion) => `${assertion.metric}: ${String(assertion.value)}`);
    expect(unnamed).toEqual([]);
  });
});

describe('loadSuite: odd files', () => {
  /** A config root with the YAML text of its config and of each file under `cases/`. */
  const rootWith = (config: string, files: Record<string, string>): string => {
    const root = tempDir('rejudge-odd-');
    fs.mkdirSync(path.join(root, 'cases'));
    fs.writeFileSync(path.join(root, 'promptfooconfig.yaml'), config);
    for (const [name, text] of Object.entries(files)) {
      fs.writeFileSync(path.join(root, 'cases', name), text);
    }
    return root;
  };
  const CONFIG = 'defaultTest:\n  assert: []\n';

  it('reads a case with no assert, and a config with no defaultTest', () => {
    const suite = loadSuite(
      rootWith('description: x\n', {
        'a.yaml': '- metadata:\n    id: a/one\n',
      }),
    );
    expect(suite.defaults).toEqual([]);
    expect(suite.cases.get('a/one')?.assert).toEqual([]);
  });

  it('reads a defaultTest with no assert', () => {
    expect(
      loadSuite(rootWith('defaultTest:\n  vars: {}\n', {})).defaults,
    ).toEqual([]);
  });

  it('leaves out a javascript assertion with no metric', () => {
    const suite = loadSuite(
      rootWith(CONFIG, {
        'a.yaml':
          '- metadata:\n    id: a/one\n  assert:\n    - type: javascript\n      value: file://src/checks/assertions.ts:runFailed\n',
      }),
    );
    expect(suite.cases.get('a/one')?.assert).toEqual([]);
  });

  it.each([
    ['a file that is no list', '{}'],
    ['an empty file', ''],
    ['an item that is no object', '- null\n- text\n- 3\n'],
    ['metadata that is no object', '- metadata: text\n'],
    ['an item with no metadata', '- description: x\n'],
    ['an id that is no text', '- metadata:\n    id: 42\n'],
    ['metadata with no id', '- metadata:\n    set: [full]\n'],
  ])('holds no case for %s', (_label, text) => {
    expect(loadSuite(rootWith(CONFIG, { 'a.yaml': text })).cases.size).toBe(0);
  });

  it('reads only the files that end in .yaml', () => {
    const suite = loadSuite(
      rootWith(CONFIG, {
        'a.yaml': '- metadata:\n    id: a/one\n',
        'notes.txt': 'not: [yaml',
        'b.yaml.bak': 'not: [yaml',
      }),
    );
    expect([...suite.cases.keys()]).toEqual(['a/one']);
  });

  it('refuses a case that the config holds twice, naming its id', () => {
    const text = '- metadata:\n    id: a/one\n';
    expect(() =>
      loadSuite(rootWith(CONFIG, { 'a.yaml': text, 'b.yaml': text })),
    ).toThrow(/a\/one.*twice/);
  });

  it('refuses a file that is no YAML, naming it', () => {
    expect(() =>
      loadSuite(rootWith(CONFIG, { 'a.yaml': 'not: [yaml' })),
    ).toThrow(/a\.yaml/);
  });
});

describe('resolveCheck', () => {
  it('resolves an export of assertions.ts', () => {
    expect(
      resolveCheck('file://src/checks/assertions.ts:runFailed'),
    ).toBeTypeOf('function');
  });

  it.each([
    ['an unknown export', 'file://src/checks/assertions.ts:nope'],
    ['an object property', 'file://src/checks/assertions.ts:toString'],
    ['a prototype key', 'file://src/checks/assertions.ts:constructor'],
    ['another file', 'file://src/checks/search.ts:wrongAnswer'],
    ['no name', 'file://src/checks/assertions.ts'],
    ['an empty name', 'file://src/checks/assertions.ts:'],
    ['inline code', 'output.length > 0'],
    ['a number', 42],
    ['nothing', undefined],
  ])('refuses %s', (_label, value) => {
    expect(resolveCheck(value)).toBeUndefined();
  });
});
