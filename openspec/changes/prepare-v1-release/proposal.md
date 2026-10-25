# Proposal

## Why

The tool works, but nobody outside this repository can run it. The package is marked private, the only way in is a clone and `pnpm dev`, and `--help` does not exist. The usage text appears only after a mistake. A first user needs to install it with one command, learn its flags from the terminal, and find docs that match what shipped. Version 1.0.0 is the point where we say the CLI and its JSON output are stable enough to depend on.

## What Changes

- The `packages/cli` package becomes public on npm as `ask-openrouter`, renamed from `openrouter-langfuse-agent-ts`. The command has the same name. It installs with `npm i -g`, `pnpm add -g`, and runs with `npx`.
- The release job publishes to npm, with provenance, when Release Please creates a release.
- The first release is 1.0.0. Release Please is told so in its config; the override is removed after the release.
- `--version` and `-v` print the installed version to stdout and exit 0.
- `--help` and `-h` print full instructions to stdout and exit 0. An unknown flag, or any other usage error, prints the error and the same full instructions to stderr and exits 1.
- Every error for a mistake in the arguments, the input or the settings says what is wrong and how to fix it. A missing model names `--model` and `OPENROUTER_MODEL` and shows a slug. Parser wording such as `Option '-q, --q <value>' argument missing` is replaced. Errors from OpenRouter and Langfuse that the user can act on gain a remedy.
- No error shows the program's insides: no library or exception text, no operating-system code, no validation dump. An unexpected failure says so plainly and points to the issue tracker; `--verbose` adds the detail on stderr.
- The README and the docs site are rewritten for a person who has never seen the project: install, set up, use, flags, output, exit codes, troubleshooting. Contributor material moves apart from user material.
- The `.claude/settings.json` allowlist edit made earlier ships with this work.

No existing behavior breaks. The CLI flags, output and exit codes are unchanged.

## Capabilities

### New Capabilities

- `cli-help`: the full help text, how `--help` and `-h` print it, when a usage error prints it, and how `--version` and `-v` print the version.
- `npm-distribution`: what the published package contains, how it is installed and run, how a release publishes it, and how its version and the schema `$id` follow the release.

- `error-guidance`: the cause-and-remedy rule, the exact messages for usage and configuration errors, and the remedies appended to service errors.

### Modified Capabilities

- `ask-question`: "Unknown arguments" now prints the full help, as `cli-help` defines it.

## Impact

- `packages/cli/package.json`, `packages/cli/src/index.ts` (shebang), `packages/cli/src/args.ts`, `packages/cli/src/cli.ts`, a new help module, a pack script.
- `.github/workflows/ci.yml` (publish step), `release-please-config.json` (`release-as`), `.gitignore`.
- `README.md`, `docs/src/content/docs/*`, `docs/astro.config.mjs` (sidebar).
- Uses the `NPM_TOKEN` repository secret for the first release. The maintainer has created it, and it expires seven days after creation, so the move to trusted publishing must land before then.
- `packages/cli/src/args.ts`, `config.ts`, `input.ts`, `failures.ts`, `tracing/credentials.ts` and `tracing/langfuse.ts` (message wording only).
- The tests that read the usage text change to read the help text.
