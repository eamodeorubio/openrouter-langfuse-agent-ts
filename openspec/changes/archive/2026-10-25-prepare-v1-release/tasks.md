# Tasks

Pull request title: `feat: publish the CLI to npm, with --help, --version and clearer errors`. Bump: minor, overridden to 1.0.0 by `release-as`.

## 1. Slice 1: `--help`, `--version` and help after usage errors (`feat:`)

- [x] 1.1 Write the failing integration test: `--help`, `-h`, help over other arguments and `--json`, help without configuration, and the help text after an unknown flag, a missing question and a stray positional, with `--json` printing the object alone. Add the cases for `--version`, `-v`, version over other arguments and `--json`, help over version with the version in its title, and an unreadable manifest. Covers `cli-help`: Help flag, Version flag, Help after a usage error, and `ask-question`: Unknown arguments. Verify it fails because no help exists.
- [x] 1.2 Write the failing unit tests for `args.ts`: `-h` and `--help` set a `help` flag, and `-v` and `--version` a `version` flag. Add a property test: help is the result for any argument list that holds the flag, and parsing never throws anything but a usage error. Covers Help flag.
- [x] 1.3 Write the failing tests for the text: every flag in the parser's options is named, each variable in the spec table is named, the exit codes are listed, the title line carries the version (and the name alone when the version cannot be read), and the text is the same under different environments. Covers Help content, Help text is not a result.
- [x] 1.4 Add `help.ts`, replace `USAGE` in `cli.ts`, handle help, then version, before configuration. Verify 1.1 to 1.3 pass.
- [x] 1.5 Update the existing tests that read the old usage text.
- [x] 1.6 Document `--help` and `--version` in the usage guide. Verify `pnpm docs:build` passes.
- [x] 1.7 Run `pnpm check`, `pnpm typecheck`, `pnpm test`, and `pnpm mutation`. Handle every survivor.
- [x] 1.8 Run `reviewer-code-high`, `reviewer-code-low`, `reviewer-docs`. Fix every must-fix finding.
- [x] 1.9 Write the full report. Wait for approval, which also approves the commit. Commit `feat: add --help and --version, and print the help after a usage error`, with the `.claude/settings.json` edit in a separate `chore:` commit.

## 2. Slice 2: errors that say how to fix them (`feat:`)

- [x] 2.1 Write the failing integration test: run the CLI under each condition in the `error-guidance` tables (usage, configuration) and assert stderr, stdout, the exit code and that no request was sent. Include the missing model, with and without `--json`. Add the unexpected failure with a thrown `TypeError`, with and without `--verbose` and `--json`, and the 502 with an HTML body. Covers Cause and remedy, Usage error messages, Configuration error messages, No implementation details. Verify it fails on the old wording.
- [x] 2.2 Write the failing unit tests for `args.ts`: each parser failure maps to its message, the flag name is taken from the error, and an unknown parser code falls back to the parser's message. Add a property test: for any argument list, a failure is a `UsageError` with a non-empty message that never holds `--q`. Covers Usage error messages.
- [x] 2.3 Write the failing unit tests for `config.ts` and `input.ts`: the exact messages of the tables. Covers Configuration error messages.
- [x] 2.4 Write the failing unit tests for the remedies: for each row of Remedies for service errors, a fake server or `nock` reply gives the status, and stderr ends with the remedy on the same line. Add a property test: for any status and message, the line holds no newline and no key. Covers Remedies for service errors.
- [x] 2.4b Write the failing unit tests for `classify.ts` and `failures.ts`: for any thrown value the unexpected message is fixed and holds none of its text (property test, with hostile values kept as examples); each row of Messages replaced maps from its failure; the `detail:` line appears only with `--verbose` and without `--json`. Covers No implementation details.
- [x] 2.5 Rewrite the messages in `args.ts`, `input.ts`, `config.ts`, `failures.ts`, `classify.ts`, `ask.ts`, `version.ts`, `cli.ts`, `tracing/credentials.ts` and `tracing/langfuse.ts`. Verify 2.1 to 2.4b pass, and update the old tests that pin the old wording.
- [x] 2.6 Document the messages and their fixes in a troubleshooting section of the usage guide. Verify `pnpm docs:build` passes.
- [x] 2.7 Run `pnpm check`, `pnpm typecheck`, `pnpm test`, and `pnpm mutation`. Handle every survivor.
- [x] 2.8 Run `reviewer-code-high`, `reviewer-code-low`, `reviewer-docs`. Fix every must-fix finding.
- [x] 2.9 Write the full report. Wait for approval, which also approves the commit. Commit `feat: tell the user how to fix a failed run`.

## 3. Slice 3: publish to npm (`feat:`)

- [x] 3.1 Write the failing pack test, in two parts: pure rules for a manifest and for an archive listing (the paths of the Package contents table, a shebang on the `bin` file, the manifest fields), tested against the real manifest and against examples; and a script, `pack:check`, that packs for real into a temporary directory and feeds the listing to the same rules. Verify the test fails on the private manifest.
- [x] 3.2 Edit `packages/cli/package.json`: rename the package to `ask-openrouter`, update the `--filter` in the root `package.json` scripts and any workflow that names the old package, remove `private`, add `bin`, `files`, `keywords`, `publishConfig`, `prepack`. Add the shebang to `src/index.ts` and the pack script, and ignore the copies. Verify 3.1 passes.
- [x] 3.3 Verify by hand, outside the repository: install the packed archive into an empty directory and run `--help`, then run a question against a local fake server with `.env` in the directory. State what was and was not run.
- [x] 3.4 Edit `ci.yml`: split the release job from a gated `publish` job (read-only, alone with `id-token: write` and the token), and run the pack check in the `check` job too. Edit `release-please-config.json`: add `release-as: 1.0.0`. Verify with `actionlint` or a read-through that the gate is the created-release output, and with a dry run that Release Please proposes 1.0.0 from the branch config.
- [x] 3.5 Run the real `release-please` generic updater on the schema file with version `1.0.0`. Verify only the `$id` line changes and that `json.schema.test.ts` still guards the marker.
- [x] 3.6 Run `pnpm check`, `pnpm typecheck`, `pnpm test`. Run `reviewer-code-low` and `reviewer-code-high` on the code and workflow, and `reviewer-docs` on the docs it touches. Fix every must-fix finding.
- [x] 3.7 Write the full report, listing what only CI can show (the publish itself, provenance, the 1.0.0 proposal). Wait for approval, then commit `feat: publish the CLI to npm`.

## 4. Docs revamp (`docs:`)

- [x] 4.1 Rewrite the README for a first-time visitor (Node 22 or newer for users; contributors use the version in `.nvmrc`), with absolute links (the npm page cannot resolve relative ones): what it is, install, set up, first question, links to the site, license. Move contributor material to the end. Verify every command in it runs as written, apart from the ones that need a real key.
- [x] 4.2 Restructure the docs site: Overview, Install, Set up, Ask a question, JSON output, Tracing with Langfuse, Troubleshooting, How changes are made. Fix the sidebar order in `astro.config.mjs`. Remove "no release yet" and the `pnpm dev` first path. Verify `pnpm docs:build` passes and no link is broken.
- [x] 4.3 Check each page against the code: flags against `--help`, variables against `.env.example`, exit codes against `classify.ts`, JSON fields against the schema.
- [x] 4.4 Run `pnpm check`. Run `reviewer-docs` in depth on every page, read-through for a stranger's path from nothing to a first answer. Fix every must-fix finding.
- [x] 4.5 Write the short report. Wait for approval, then commit `docs: rewrite the user documentation for the first release`.

## 5. Close

- [x] 5.1 Run `/opsx:verify` and fix what it finds.
- [x] 5.2 With the user's approval, commit `chore: archive prepare-v1-release`.
- [ ] 5.3 Ask the user before every push and before the pull request.

## Workflow follow-up

- The `NPM_TOKEN` secret exists and expires seven days after creation. Merge the release pull request, and then the trusted-publisher chore, before it lapses. If it lapses first, the maintainer issues a new token.
- After 1.0.0 is published, open a `chore:` pull request that removes `release-as`, `bump-minor-pre-major` and `bump-patch-for-minor-pre-major`, adds the npm version badge to the README (it needs the package to exist), and switches the publish step to npm trusted publishing (check first that the runner's npm meets npm's minimum version for it): configure the trusted publisher for `ask-openrouter` on npmjs.com (this repository, the workflow file, the environment if any), drop the `NPM_TOKEN` secret and `NODE_AUTH_TOKEN` from `ci.yml`, keep `id-token: write`, and delete the secret once a release has published without it.
