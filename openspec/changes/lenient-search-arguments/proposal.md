## Why

Weaker models send a number or a boolean as text. Nemotron sent `paid_only: "true"`, the tool rejected it, and the model searched again without the filter. Its next search listed a free model first, and the `topOfSearch` check judged the right answer wrong: 8 of its 10 single-search runs failed that way, in the evals run `44247364171`. The same models send `"200000"` for a context length. The tool can read these values. It should, and say plainly what it accepts.

## What Changes

- Every numeric argument of `search_models` accepts a number or the text of one: `input_per_output`, the four price bounds, `min_context_length`, the three index floors, `min_tool_success_rate`, `max_age_days`, `limit` and `offset`. Both boolean arguments, `paid_only` and `zero_data_retention`, accept a boolean or the text `"true"` or `"false"`.
- The tool reads the text itself and sends the API the number or boolean it read. Text that is not a number, hex, `Infinity`, a number too large to hold, and any boolean text other than `"true"` and `"false"` fail validation.
- The error for any such failure names the argument, shows the value sent and says what to send, such as `limit: must be a whole number from 1 to 50; got "many".`
- The schema offers each of these arguments as `number | string` or `boolean | "true" | "false"`, and each description says so. The description of `paid_only` is reworded to say plainly what `true`, `false` and absence do.
- The `wrong-search` check reads a required number the way the tool does, so `min_context_length: "200000"` carries a requirement of 200000.
- The top-of-search check, which raises `wrong-answer`, skips models that are not paid when the question asks for a paid model, since a search that did not send `paid_only` lists free models first.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `model-tools`: `search_models` reads numbers and booleans sent as text; the errors of every numeric and boolean argument tell the model what to send; the descriptions say text is accepted.
- `eval-checks`: the search constraint check reads numeric text; the top-of-search check skips unpaid models for a question that asks for a paid one.

## Impact

- `packages/cli/src/tools/searchModels.ts`, and a new `packages/cli/src/tools/lenientArgs.ts` for the readers of text numbers and booleans.
- `packages/cli/test/`: a new `searchModels.text.test.ts`, and two assertions of `searchModels.price.test.ts`.
- `packages/evals/src/checks/search.ts`, `searchChecks.ts` and `json.ts`, with tests in `search.test.ts` and `misfires.test.ts`.
- `docs/src/content/docs/tools.md`: one paragraph. `docs/src/content/docs/evals.md`: one clause in each of the `wrong-search` and `wrong-answer` rows.
- The tool contract is wider, not narrower: every call that was valid stays valid.
