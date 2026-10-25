# Design

## Context

The CLI compiles with `tsc` to `dist/`, and `src/index.ts` is the entry point. `src/cli.ts` already holds a short `USAGE` constant that it appends to usage errors. `version.ts` reads `package.json` from one level above `src/` and `dist/`, so the compiled code finds the manifest in the package. Release Please runs in `ci.yml` on `main`, with `release-type: node` for `packages/cli`, and rewrites the schema `$id` through a `generic` extra file. The repository README sits at the root, not in the package. See proposal.md for motivation.

## Goals / Non-Goals

**Goals:**
- One command installs or runs the tool, and one text explains it from the terminal.
- A release publishes without a human running `npm publish`.
- The user docs read as a path: what, install, set up, use, look up, fix.

**Non-Goals:**
- A shorter bin alias, a scoped package name, or a bundler.
- Changing any flag, output or exit code.
- Trusted publishing through OIDC in this change. It needs the package to exist first, so it is the first follow-up after 1.0.0.

## Decisions

**Help lives in one module.** A `help.ts` exports the text as a constant. `args.ts` recognises `-h` and `--help` and returns a `help` flag; `cli.ts` prints the text to stdout before it loads any configuration. `--help` is checked on the raw `argv` first, as `--json` is, because help wins over arguments that would not parse. The existing `USAGE` constant is replaced by it, so the usage error and `--help` cannot drift. A test compares the flags in `parseArgs` options with the flags the text names.
*Alternative:* generate the text from the option table. The text then loses its examples and its grouping, and the table has no descriptions to generate from.

**The version reuses `readVersion`.** The function already reads `package.json` for the Langfuse release tag, from one level above `src/` and `dist/`, so a packed install finds it. `--version` and `-v` are read from the raw `argv`, like `--help` and `--json`, before configuration. The order is help, then version, then everything else. The version is printed bare so that `$(ask-openrouter --version)` works in a script.

**The text is a function of the version.** `help.ts` exports `helpText(version)`. The title line carries the version, and nothing else varies: no environment, no terminal width. The same bytes go to stdout and to stderr, which keeps the requirement testable with a plain equality. When `readVersion` fails, the title shows the name alone. A broken manifest must not turn a usage error into exit 2 or hide the help that would explain the call; only `--version` itself reports that failure.

**Name the package `ask-openrouter`.** The old name, `openrouter-langfuse-agent-ts`, is 28 characters and names the stack, not the job. `ask-openrouter` is free on npm, short, and reads as what the tool does. The package and the command share one name, so `npx ask-openrouter` works without `--package`. The repository keeps its name; npm and GitHub names are independent. The rename reaches `package.json`, the root scripts that filter by package name, the usage line of the help text, and the docs.
*Alternatives:* `ask-about-openrouter` (20 characters), `which-openrouter-model` (22, names the main job but not the whole range of questions), `orask` (cryptic), and a package name that differs from its `bin`, which breaks the bare `npx` call.

**Pack with an allowlist.** `files: ["dist"]` keeps the archive small. npm adds `package.json`, README and LICENSE itself. A `prepack` script copies the root README and LICENSE into `packages/cli/`, and `.gitignore` lists the copies, so the text has one source. `tsconfig.build.json` already limits the build to `src`, so tests do not reach `dist`.
*Alternative:* a second README in the package. It would drift.

**The shebang goes in the source.** `tsc` keeps a leading `#!` line, and `tsx` runs it. The executable bit is set by the package manager at install from `bin`.

**Publish in the existing release job.** Release Please exposes `releases_created` and `packages/cli--release_created`. A second step, gated on that output, installs, builds, checks the pack list and runs `pnpm publish --provenance --access public --no-git-checks` with `NODE_AUTH_TOKEN` from the `NPM_TOKEN` secret. The job gains `id-token: write` for provenance. The step runs in the same job as the release so that it needs no second trigger. A tag-triggered workflow would not fire when the tag comes from the default token.
*Alternative:* OIDC trusted publishing, with no token. It is better, and it needs a package that already exists on npm. The follow-up chore after 1.0.0 moves to it: the job already has `id-token: write`, so the change is the npm-side configuration and dropping the token.

**Reach 1.0.0 with `release-as`.** `bump-minor-pre-major` turns even a breaking change into 0.6.0 while the version is below 1. A `Release-As: 1.0.0` footer would have to survive the squash merge. The config key is visible and reviewable. It stays until 1.0.0 is out, then a `chore:` pull request removes it; left in place, it would hold every later release at 1.0.0. The same pull request drops `bump-minor-pre-major` and `bump-patch-for-minor-pre-major`, which no longer apply.

**The `$id` already rewrites.** The `generic` updater replaces the semver on any line holding `x-release-please-version`, and the generator puts the marker and `$id` on one line. A test in `json.schema.test.ts` already guards that. This change adds a one-off check with the real updater from `release-please`, run against the committed file with version `1.0.0`, and records the result. A dry run against GitHub found no unreleased commits, so it cannot show the diff before the next release.

**Messages are rewritten at the boundary that raises them.** `args.ts` currently passes `parseArgs`' text through, and a raw `Option '-q, --q <value>' argument missing` names a long flag that does not exist. The parser's failures carry a `code` (`ERR_PARSE_ARGS_UNKNOWN_OPTION`, `ERR_PARSE_ARGS_INVALID_OPTION_VALUE`, `ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL`); `args.ts` maps each code to the message in the spec, taking the flag name from the error text. An unrecognised code falls back to the parser's message, so a new Node version cannot hide an error. Service remedies are added where the error is built (`failures.ts`, `credentials.ts`, `langfuse.ts`), keyed on the status, so the one place that knows the status is the one place that words the hint. A test lists every message in the spec table against its condition, so a new error without a remedy shows as a gap in review.
**Unexpected errors hide their text.** `classify` stops printing `Unexpected error: <text>`. It returns the fixed message, and the reason goes to a separate `detail:` line only under `--verbose` and without `--json`, so a bug report can still carry it and the JSON object keeps its shape. Masking still applies to that line. The same applies to the client library's texts: `failures.ts` maps each class of failure to our own sentence, and keeps only the service's message for an API error, cut to one line.
*Alternative:* print the text and hope it reads well. It does not: `Cannot read properties of undefined` helps nobody and shows our code.

*Alternative:* one catalogue module holding all messages. It would separate each message from the condition that raises it, for no gain with about twenty messages.

**The docs are reorganised, not appended.** User pages: Overview, Install, Set up, Ask a question, JSON output, Tracing with Langfuse, Troubleshooting. Contributor pages: How changes are made. The README shrinks to what a visitor needs, with a pointer to the site. The existing usage guide is split so no page holds both setup and reference.

## Risks / Trade-offs

- [First publish fails, or the name is taken between now and then] → The name was free at proposal time. A failed publish fails the job and the release PR is already merged; the fix is a rerun of the publish step with the token corrected.
- [`NPM_TOKEN` missing or expired] → The step fails loudly. The secret exists and expires seven days after creation, so the release and the switch to trusted publishing must both happen inside that window. If the token lapses first, the maintainer issues a new one.
- [A remedy that is wrong, such as 404 for a cause other than the slug] → The 404 remedy is conditional ("If the model is unknown"), and the API's own text stays first.
- [A leaked or over-broad token] → Use an automation token limited to this package, and move to OIDC after 1.0.0.
- [`release-as` left in] → A task and a note in the pull request. A spec scenario covers the removal.
- [The README copy goes stale in the package] → It is copied at pack time, never committed.
- [`engines` says Node 26 and few have it] → Stated in the install docs; the package manager warns. Lowering the range is a separate decision.

## Migration Plan

1. Merge this pull request.
2. Check that the `NPM_TOKEN` secret is still valid. It expires seven days after creation.
3. Merge the release pull request that proposes 1.0.0. The job tags, releases and publishes.
4. Check `npx ask-openrouter --help` from a clean directory.
5. Open a `chore:` pull request that removes `release-as` and switches the publish step to trusted publishing, then deletes the `NPM_TOKEN` secret.

Rollback: `npm deprecate` the version and release a patch. Unpublishing is not planned.
