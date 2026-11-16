# Proposal

## Why

The evals ask two models every case, and the models are fixed in the config. A run that wants one model asks both, and pays for both. That matters now because the manual GitHub workflow is about to collect A/A runs: the same code, run again and again, to learn how much a pass rate moves by chance. Noise per model is the figure of interest, and the free model's request caps make a joint run slower and flakier than a run of the paid model alone.

## What Changes

- The eval script takes `--model <id[,id...]>`. With it, the run asks only those models. Without it, nothing changes: the run keeps the models of `defaultTest.vars.model` in `promptfooconfig.yaml`.
- Every id must already be in that list. An unknown id stops the run before any request, with a message that names the id and lists the models the config holds. The flag narrows the matrix and never widens it.
- The run names the models it asked in `target.txt`, so the first line of the report tells two A/A artifacts apart. A run without `--model` writes the file it writes today.
- The free-model pick for placeholders avoids only the models in the run.
- The GitHub workflow gains an optional `model` input that passes the flag. It ships in the same pull request, after the runner change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `eval-run`: adds the requirement that `--model` narrows the matrix, the refusal of unknown ids, and the models line of the target.

## Impact

- `packages/evals/src/runner.ts` parses the flag and hands it to promptfoo through the environment, as it does the CLI version.
- `packages/evals/src/models.ts` (new) holds the narrowing: it checks the ids against the suite and cuts `defaultTest.vars.model` down. `packages/evals/src/hooks.ts` calls it and returns the suite to promptfoo. The hook returns nothing today.
- `packages/evals/src/hooks.ts` also words the models line of the target, in the function that writes `target.txt`.
- `packages/evals/README.md` and `docs/src/content/docs/evals.md` document the flag.
- `.github/workflows/evals.yml` gets the `model` input.
- No change to `packages/cli`. The commits are typed `test:` and the pull request bumps no version of the CLI.
