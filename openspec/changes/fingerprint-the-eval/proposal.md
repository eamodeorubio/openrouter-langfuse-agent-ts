## Why

Two eval runs of the same CLI can measure different evals, and nothing in the run says so. A case added, a rubric tuned or a check fixed changes what a score means, and the folder of a run holds the target, the instructions and the catalog snapshot, but not the eval. The commit of the repository does not fill the gap. It changes with every edit to the CLI, so two runs of the same eval on different commits look different, and a downloaded artifact or a local run does not carry it at all.

The next merge shows the cost. The published 1.1.0 report was measured with eleven cases. After the case for acceptable alternatives, the same CLI is measured with twelve and a new class, and the numbers are no longer comparable. Nobody can tell from the artifacts alone.

## What Changes

- Every run writes `eval.txt` beside its results: a fingerprint of the eval, twelve characters.
- The fingerprint is a hash of what decides what a run asks and how it judges: the cases, the rubrics, the config, and the sources of the checks, the oracle, the judge, the provider and the hook. It ignores the CLI, the tests, the docs, the reporter and the calibration.
- The report names it on its second line, after the target.
- A command, `fingerprint`, prints the fingerprint of a checkout. It gives the old eval a name, from the commit that held it.
- The README and the docs page say what the fingerprint covers and how to read two of them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `eval-run`: a run writes `eval.txt`; a command prints the fingerprint of a checkout.
- `eval-report`: the report names the fingerprint of the run.

## Impact

- `packages/evals/src/fingerprint.ts` (new), `src/hooks.ts`, `src/report/cli.ts`, and a script `fingerprint` in `packages/evals/package.json`.
- `packages/evals/test/`: tests for the fingerprint, the hook and the report header.
- `packages/evals/README.md` and `docs/src/content/docs/evals.md`.
- No change to the CLI or its product. A run costs a few milliseconds more.
- The catalog snapshot is not part of the fingerprint. It is data of the run, and `catalog.json` already records it with its time.
