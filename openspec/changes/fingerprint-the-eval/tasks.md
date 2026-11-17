# Tasks

One slice: the fingerprint of the eval. It changes the evals only. Commit `test:`. It joins the pull request of `present-acceptable-alternatives`, whose title and bump it keeps. Reviewers: `reviewer-code-low`, and `reviewer-docs` for the docs it touches.

## 1. Slice: the fingerprint, the file, the report line and the script

- [ ] 1.1 Write the failing integration test in `hooks.test.ts`: a run writes `eval.txt` with twelve characters of the alphabet beside `target.txt`, for a local build and for a published version; and one in `report.test.ts`: the report starts with `target:` and `eval:` lines. Covers: The eval has a fingerprint, The report names the eval.
- [ ] 1.2 Write the failing unit and property tests for `fingerprint.ts` on a fixture directory: the value is twelve characters of the alphabet; a known fixture gives a pinned value, so that a change of encoding or of input shows; it is equal when files are read in any order, with `\r\n` or `\n`, and in a copy of the directory elsewhere; it differs when any included file changes by one byte, is added or is renamed; it is equal when a test, a README, a file of the report or the calibration changes. Covers: What the fingerprint covers.
- [ ] 1.3 Write the failing test for the script: its stdout is the fingerprint of the package, one line; an unreadable package gives a message on stderr and a non-zero exit. Covers: A command prints the fingerprint.
- [ ] 1.4 Write the failing report test for a folder without `eval.txt`: the report is what it was. Covers: An older run.
- [ ] 1.5 Implement `fingerprint.ts` and make 1.2 pass.
- [ ] 1.6 Write `eval.txt` in the hook before the first request, and print the line in the reporter, and make 1.1 and 1.4 pass.
- [ ] 1.7 Add the script `fingerprint` to `packages/evals/package.json` and make 1.3 pass.
- [ ] 1.8 Update `packages/evals/README.md` and `docs/src/content/docs/evals.md`: the file in the results folder, what the fingerprint covers and leaves out, how to read two of them, and how to name an old eval with the script. Add the fingerprint of the eval behind the 1.1.0 report to the docs, from a checkout of its commit.
- [ ] 1.9 Run `pnpm check`, `pnpm typecheck` and `pnpm test`. Run `pnpm mutation:evals` on the changed files and read every survivor.
- [ ] 1.10 Run `reviewer-code-low` and `reviewer-docs`. Fix every must-fix finding.
- [ ] 1.11 Write the short report. Wait for the user's approval, which also approves the commit. Commit.

## 2. Archive

- [ ] 2.1 Run `/opsx:verify` on `fingerprint-the-eval`, and fix what it finds.
- [ ] 2.2 Archive the change as its own commit, `chore: archive fingerprint-the-eval`, once the user has approved it.
