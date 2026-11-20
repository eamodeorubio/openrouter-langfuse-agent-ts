## Why

An eval run is judged once, by the checks of the day. When a check changes, the old runs no longer compare with the new ones. In run `44247364171` (1.2.0) the top-of-search check failed Nemotron's runs that named the right model, because a search without `paid_only` listed free models first. The check was fixed afterwards. The run was not re-judged, so its pass counts still carry the old verdict. Comparing 1.2.2 with them would measure the checks as much as the CLI.

The saved results hold everything the deterministic checks read: the output of each run, the catalog snapshot and the instructions of the run. Judging them again costs no model call. Only the llm rubrics need a model, and they stay as they were.

## What Changes

- A new command, `pnpm --filter ask-openrouter-evals run rejudge <results.json>`, judges the runs of a saved results file again with the current deterministic checks.
- It points `EVAL_CATALOG` and `EVAL_INSTRUCTIONS` at the `catalog.json` and `instructions.txt` beside the file, so each run is judged against its own snapshot.
- It maps each row by `metadata.id` to the case of the current config, and runs the case's `javascript` assertions and those of `defaultTest` on the saved output. It makes no model call and no request. The judge rubrics keep their saved scores and their weight of 0.
- It writes a complete run directory, `rejudged/` beside the input, with a `results.json` that the existing `report` command reads. The report has one format.
- It prints every flip: the case, the model, the repeat, the check that changed, and its verdict before and after.
- The input is never modified. A row that ended in a provider error is copied as it was.

This is chore work: `packages/evals` only, no change to a check, a case or the CLI. Commit type `test:`, no bump.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `eval-run`: gains the re-judge of a saved run. The capability already owns the run directory (results, target, snapshot, instructions) and the two `EVAL_*` variables the checks read. `eval-report` is not touched: the report reads the re-judged file as it reads any other, which is the point.

## Impact

- New `packages/evals/src/rejudge/` (the logic, and a `main.ts` of thin wiring), and a `rejudge` script in `packages/evals/package.json`.
- New tests in `packages/evals/test/`, with a small results fixture.
- `packages/evals/stryker.config.json`: `src/rejudge/main.ts` joins the excluded wiring files, as `src/report/main.ts` is.
- `docs/src/content/docs/evals.md` and `packages/evals/README.md`: one section on re-judging.
- No change to `packages/cli`, to any case or to any check.
