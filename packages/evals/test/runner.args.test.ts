import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseRunArgs } from '../src/runner.js';
import { MIN_CLI_VERSION, parseCliVersion } from '../src/target.js';

const parse = (argv: string[]) =>
  parseRunArgs(argv, () => new Date('2026-11-13T21:30:00.123Z'));

describe('--cli-version', () => {
  it.each(['1.1.0', '1.1.1', '1.2.0', '1.2.3', '2.0.0', '10.20.30'])(
    'accepts the exact version %s',
    (version) => {
      expect(parseCliVersion(version)).toBe(version);
      const options = parse(['--cli-version', version]);
      expect(typeof options).toBe('object');
      expect((options as { cliVersion?: string }).cliVersion).toBe(version);
    },
  );

  it.each([
    'latest',
    '^1.1.0',
    '~1.1.0',
    '1.1',
    '1',
    'v1.1.0',
    '01.1.0',
    '1.01.0',
    '1.1.00',
    '1.1.0-beta.1',
    '1.1.0+build',
    '1.1.0 ',
    ' 1.1.0',
    '1.1.0\n',
    '1.1.0; rm -rf /',
    '1.1.0 && echo',
    '$(id)',
    '',
  ])('refuses %j, and names the rule', (version) => {
    expect(parseCliVersion(version)).toBeUndefined();
    expect(parse(['--cli-version', version])).toBe(
      `--cli-version takes an exact version from ${MIN_CLI_VERSION}, such as ${MIN_CLI_VERSION}, got ${JSON.stringify(version)}. A range, a tag or a pre-release is not accepted.`,
    );
  });

  it.each(['1.0.1', '1.0.9', '0.9.9', '1.0.0', '0.0.0-stage'])(
    'refuses the version %s, and says that it is too old, or not exact',
    (version) => {
      expect(parseCliVersion(version)).toBeUndefined();
      expect(parse(['--cli-version', version])).toBe(
        version.includes('-')
          ? `--cli-version takes an exact version from 1.1.0, such as 1.1.0, got ${JSON.stringify(version)}. A range, a tag or a pre-release is not accepted.`
          : `--cli-version ${version} is too old: ask-openrouter lists its tool calls in --json from 1.1.0, and the checks read them. Use 1.1.0 or later.`,
      );
    },
  );

  it('is no option of the local build, and is read in any order', () => {
    expect(
      (parse(['--set', 'full']) as { cliVersion?: string }).cliVersion,
    ).toBeUndefined();
    const options = parse([
      '--cli-version',
      '1.1.0',
      '--repeat',
      '5',
      '--set',
      'full',
    ]) as { cliVersion?: string; repeat: number };
    expect(options.cliVersion).toBe('1.1.0');
    expect(options.repeat).toBe(5);
  });

  it('refuses a flag with no value', () => {
    expect(parse(['--cli-version'])).toBe('Unexpected argument: --cli-version');
  });

  it('is refused before the other arguments are judged for a request', () => {
    expect(typeof parse(['--cli-version', 'latest', '--repeat', '5'])).toBe(
      'string',
    );
  });

  it('accepts exactly the versions that are three whole numbers from 1.1.0', () => {
    const part = fc.nat({ max: 50 });
    fc.assert(
      fc.property(part, part, part, (major, minor, patch) => {
        const version = `${major}.${minor}.${patch}`;
        const old = major < 1 || (major === 1 && minor < 1);
        expect(parseCliVersion(version)).toBe(old ? undefined : version);
      }),
    );
  });

  it('accepts no text that is not three whole numbers joined by dots', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        fc.pre(!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(text));
        expect(parseCliVersion(text)).toBeUndefined();
      }),
    );
  });
});

describe('--model', () => {
  it('is kept as written, and absent when it is not given', () => {
    expect(parse(['--model', 'a/b,c/d'])).toMatchObject({ model: 'a/b,c/d' });
    expect(parse([])).not.toHaveProperty('model');
  });

  it('keeps any text, so that the setup is the one to refuse it, and the empty string too', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(parse(['--model', text])).toMatchObject({ model: text });
      }),
    );
  });

  it('needs a value', () => {
    expect(parse(['--model'])).toBe('Unexpected argument: --model');
  });
});
