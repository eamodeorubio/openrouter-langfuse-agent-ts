## Why

The CLI sends one question to one model and prints what comes back. The model answers from memory, and memory is the wrong source for OpenRouter's catalog: prices, context limits and new releases change weekly. The tool exists to say which model is the most cost-effective for a use case. It cannot do that without current data.

## What Changes

- The agent gets system instructions that fix its job: answer questions about OpenRouter and weigh models by cost against need.
- The agent gets three tools. Two are backed by OpenRouter's models API:
  - `get_model` returns the details of one model by slug.
  - `search_models` filters and sorts the catalog server-side, so the model asks for the ten cheapest long-context candidates instead of paging through hundreds of entries.
- The third, `calculate`, does exact arithmetic with a strict parser: numbers and `+ - * / ( )`, no evaluation of code. A cost such as 5M input and 1M output tokens is a sum of products the model should compute, not guess. The result carries the formula and the answer.
- One question can now take several round trips to the LLM. The model may call tools, read the results and call more. The user still sees one prompt and one answer.
- The model may request several tool calls in one round. The agent runs them concurrently.
- Between rounds, the agent hands back the model's reasoning blocks exactly as received. Reasoning models lose their thread otherwise.
- With the new `--verbose` flag, tool activity appears on stderr, one line per call. The `tokens:` line sums every round.
- Exit codes are now written down: 0 success, 1 usage or configuration, 2 model or network error, 3 stopped by a limit. Code 3 is new; today's only limit-like case does not exist yet, so no caller sees a code change.
- **BREAKING**: none for callers. Existing flags, exit codes and streams are unchanged. The `tokens:` line now covers all rounds of a question, not one request.

## Capabilities

### New Capabilities

- `agent-loop`: the round trips between the CLI and the LLM: instructions, tool offer, parallel execution, reasoning continuity, round limit, tool failures, activity lines.
- `model-tools`: the contract of `get_model` and `search_models`: arguments, validation, result shape and units, failure reports.
- `calculator`: the contract of `calculate`: grammar, result, failures, and the guarantee that no input is ever evaluated as code.

### Modified Capabilities

- `ask-question`: token totals sum across rounds; the retry rule applies to each request; a round that only calls tools is not an empty response; the `--verbose` flag; the exit-code table with the new code 3.

## Impact

- `packages/cli/src`: `ask.ts` is split. A single streamed request keeps its retry and timeout rules in its own module. A new loop module runs the rounds. New tool modules wrap the models endpoints.
- New direct dependency: `zod`, already present through the SDK, now declared. It validates tool arguments and renders their JSON Schema.
- Tests: new fixtures recorded from the two endpoints (with the user's permission), a paced fake API for multi-round runs, property tests for price conversion and argument validation.
- Docs: README and the usage guide describe the tools, the stderr lines and the new token totals.
- Langfuse stays out of this change. The loop and the tool executor are the seams where it will attach.
