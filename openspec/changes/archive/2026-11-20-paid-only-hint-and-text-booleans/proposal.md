## Why

The evals of 1.2.1 (run `44691387152`) confirm the fix of 1.2.1: Nemotron had no rejected call, against 169 in 55 of 210 runs on 1.2.0 (run `44247364171`). Two causes of failure remain, and both sit in the tool.

The first is advice. The last sentence of the `sort` description says "add paid_only to skip free models", with no condition. Where only a free model fits the user's budget, Claude Haiku followed it: on 1.2.0 and 1.2.1 every failure of that model on one affordability case used `paid_only: true` in its only search, and so never saw a free model. That is 3 of 10 runs, then 1 of 10. The advice is right when the user asks for a paid model and wrong when they do not.

The second is spelling. 1.2.1 reads the texts `"true"` and `"false"`, and refuses `"True"`. Nemotron sent `"True"` and `"False"` on 1.2.0, so a call that had a clear meaning failed for its capital letter.

## What Changes

- The advice on `paid_only` becomes conditional: use it only when the user asks for a paid model. When the question does not ask for one, a free model is a valid answer, so leave it out. The condition sits in the `sort` description, and in the `paid_only` description, where a model reads it as it fills the argument.
- Every boolean argument, `paid_only` and `zero_data_retention`, reads the text `true` or `false` in any letter case. `"True"`, `"FALSE"` and `"tRuE"` are read. Anything else is still refused with the existing error: `"yes"`, `"1"`, `""`, a number.
- The descriptions of both arguments say that the text is read in any letter case.
- The fix is general. No description, instruction or line of code names an eval case, a question or a model id.
- `docs/src/content/docs/tools.md` follows: the paragraph on text values, and one sentence in the paragraph on sorting by price. The table row of `paid_only` describes the filter and stays as it was; the advice lives in the prose and in the schema.
- No eval case and no check changes in this pull request. If a check proves to need a change, the work stops, and the change goes in its own pull request with a re-judge of the baselines first.

The other descriptions of `search_models` and `packages/cli/src/instructions.ts` were checked for the same unconditional advice. The tool description and the `paid_only` description state what the filter does and give no advice, and the instructions never mention `paid_only` or free models. Only the last sentence of `sort` needs the condition.

Commit type `fix:`, released as 1.2.2 (patch). It ships in one pull request with `rejudge-eval-runs`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-tools`: the advice on `paid_only` is conditional on the question; boolean text is read in any letter case, and the descriptions say so.

## Impact

- `packages/cli/src/tools/searchModels.ts` (the `sort` and `paid_only` descriptions) and `packages/cli/src/tools/lenientArgs.ts` (`flag` and `FLAG_NOTE`).
- Tests in `packages/cli/test/`: the existing text tests of `search_models` and the schema tests grow; no new fixture.
- `docs/src/content/docs/tools.md`.
- The schema of a boolean argument offers `boolean | string`, where it offered `boolean | "true" | "false"`. The tool contract widens: every call that was valid stays valid.
- Verification after the release is by evals, which the user starts. The plan is in `tasks.md`.
