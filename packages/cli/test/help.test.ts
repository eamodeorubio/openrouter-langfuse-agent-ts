import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { INFO_FLAGS, OPTIONS } from '../src/args.js';
import {
  EXIT_API,
  EXIT_LIMIT,
  EXIT_OK,
  EXIT_USAGE_OR_CONFIG,
} from '../src/classify.js';
import { helpText } from '../src/help.js';

const text = helpText('1.2.3');

const VARIABLES = [
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
  'LANGFUSE_BASE_URL',
  'LANGFUSE_TRACING_ENVIRONMENT',
  'LANGFUSE_RELEASE',
  'NO_COLOR',
];

/** The lines of the section that starts with `heading`, up to the next blank line. */
const section = (heading: string): string[] => {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(heading));
  expect(start, `no section ${heading}`).toBeGreaterThan(-1);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line === '');
  return rest.slice(0, end === -1 ? undefined : end);
};

describe('helpText', () => {
  it('opens with the command name and the version', () => {
    expect(text.split('\n')[0]).toBe('ask-openrouter 1.2.3');
  });

  it('opens with the name alone when the version is unknown', () => {
    expect(helpText(undefined).split('\n')[0]).toBe('ask-openrouter');
  });

  it('describes every flag the parser accepts', () => {
    const options = section('Options:');
    for (const [name, option] of Object.entries(OPTIONS)) {
      const short = 'short' in option ? `-${option.short} ` : undefined;
      const line = options.find(
        (entry) =>
          entry.trimStart().startsWith(`--${name} `) ||
          (short !== undefined && entry.trimStart().startsWith(short)),
      );
      expect(line, `--${name} is not described`).toBeDefined();
      // A flag, then at least two spaces, then a sentence.
      expect(line).toMatch(/\S {2,}\S.{9,}/);
    }
    for (const flag of INFO_FLAGS) {
      expect(
        options.some(
          (line) =>
            line.trimStart().startsWith(flag) ||
            line.includes(`${flag},`) ||
            line.includes(`, ${flag} `),
        ),
        `${flag} is not described`,
      ).toBe(true);
    }
  });

  it.each(VARIABLES)('names %s', (name) => {
    expect(section('Environment').join('\n')).toContain(name);
  });

  it('says that .env is read from the current directory and that the environment wins', () => {
    const heading = text.split('\n').find((l) => l.startsWith('Environment'));
    expect(heading).toContain('.env');
    expect(heading).toContain('current directory');
    expect(heading).toContain('environment wins');
  });

  it.each([[EXIT_OK], [EXIT_USAGE_OR_CONFIG], [EXIT_API], [EXIT_LIMIT]])(
    'lists exit code %i',
    (code) => {
      expect(
        section('Exit codes:').some((line) => line.startsWith(`  ${code}  `)),
      ).toBe(true);
    },
  );

  it('gives examples: a question, stdin and --json', () => {
    const examples = section('Examples:').join('\n');
    expect(examples).toMatch(/ask-openrouter -q /);
    expect(examples).toMatch(/\| ask-openrouter/);
    expect(examples).toContain('--json');
  });

  it('ends with the address of the documentation', () => {
    expect(text.trimEnd().split('\n').pop()).toBe(
      'Documentation: https://eamodeorubio.github.io/openrouter-langfuse-agent-ts/',
    );
  });

  it('keeps its parts in the order of the spec', () => {
    const heads = [
      'Usage:',
      'Options:',
      'Environment',
      'Exit codes:',
      'Examples:',
      'Documentation:',
    ];
    const at = heads.map((head) => text.indexOf(head));
    expect(at.every((index) => index > -1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('differs between versions only in its first line', () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: undefined }), (version) => {
        const rest = (value: string) => value.split('\n').slice(1).join('\n');
        expect(rest(helpText(version?.replaceAll('\n', ' ')))).toBe(rest(text));
      }),
    );
  });
});
