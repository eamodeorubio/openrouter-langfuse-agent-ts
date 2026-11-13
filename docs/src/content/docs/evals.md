---
title: Evals
description: How the evals test the agent against real models, the error taxonomy that names every way a run can fail, and how to run them against a local build.
---

The tests of this repository mock every request. They know that a tool returns the right shape and that the loop stops when it should. They cannot know whether a real model, given the system prompt and the tool descriptions, does the right thing. The evals ask the model.

An eval run starts the built `ask-openrouter` CLI against real models on OpenRouter, many times for each question, and writes down what happened. It talks to real services with your key and it costs real money, which depends on the models and which the report prints. So it never runs as part of `pnpm test`, and it never runs in CI. It starts when you start it.

## Running the evals

You need two things: a built CLI and your OpenRouter key in the environment. From the root of the repository:

```sh
pnpm build
export OPENROUTER_API_KEY=...
pnpm --filter ask-openrouter-evals run eval
```

This evaluates **the local build**, `packages/cli/dist/index.js`. It is the CLI as the branch you are on would ship it. Each question runs on each model ten times, with no cache, so that every repeat is a new request. Before the first question, the run fetches OpenRouter's public model list, which needs no key, and saves it beside the results as `catalog.json`. That snapshot is the oracle: it says which models are good answers to a question such as "the cheapest paid model with 200,000 tokens of context and tool calling", so that no question holds a model name that next week's catalog will outdate.

The report goes to stdout, one block per model, and ends with how long the whole eval took. This example is abridged to one case of one model:

```text
anthropic/claude-haiku-5.5
  lookup/known-model  n=10  c=10  err=0  pass@1=1.0000 pass@3=1.0000 pass@5=1.0000  pass^1=1.0000 pass^3=1.0000 pass^5=1.0000
                      cost 0.0008 (10 runs)  latency 3382 ms  rounds 1.00 (10 runs)  cost/solved 0.0008
  mean                n=10  c=10  err=0  ...
  by error class
    run-failed     judged=10  passed=10  failed=0  pass@1=1.0000 pass@3=1.0000 pass@5=1.0000  pass^1=1.0000 pass^3=1.0000 pass^5=1.0000
    memory-answer  judged=10  passed=10  failed=0  pass@1=1.0000 pass@3=1.0000 pass@5=1.0000  pass^1=1.0000 pass^3=1.0000 pass^5=1.0000
    wrong-value    judged=10  passed=10  failed=0  pass@1=1.0000 pass@3=1.0000 pass@5=1.0000  pass^1=1.0000 pass^3=1.0000 pass^5=1.0000

wall time 114.2 s for 60 runs (concurrency 4)
```

Under each model, the block **by error class** counts how many runs every class judged, passed and failed, with pass@k and pass^k of its own. A class judges a run when one of its checks ran on it, and a run that an earlier class failed is not judged by a later one, so the counts say how often a check passed when it was asked. `n` is how many times a question ran, `c` how many runs passed, and `err` how many ended in a provider error, which counts as a failed run. **pass@k** is the chance that at least one of k runs passes: "if I may try k times, will it work?" **pass^k** is the chance that all k pass: "can I rely on it every time?" It is the harsher figure, and it falls as k rises. The package [README](https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/blob/main/packages/evals/README.md) lists every flag.

## The error taxonomy

A run passes when no error class fires. Every failed check carries the code of its class, so that a failed run says what went wrong and not only that it did. The report counts the classes of each question, on the line that starts with `failed:`.

| Code                 | Definition                                                                                 | Example                                                                                                        | How it is detected                                                                                                                                 | Cases built to provoke it                        |
| -------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `run-failed`         | The run ended without an answer: an API error, the round limit, a timeout, or a blank one. | The model is gone from the free tier and the API answers `404: This model is unavailable for free`.            | The CLI exits non-zero, or the answer is empty. A provider error counts as a failed run, and the report shows the number of them.                  | every case                                       |
| `memory-answer`      | The question needs a lookup, and the run made no successful tool call.                     | It states that `openai/gpt-oss-20b` costs $0.05 per million tokens without ever calling `get_model`.           | The case declares that it needs a lookup, and no call of the run has `failed: false`.                                                              | `lookup/known-model`, `search/cheapest-blended`  |
| `wrong-search`       | The lookups never surfaced a model that is a good answer, or the search dropped a filter.  | Asked about `openai/gpt-oss-20b`, it reads `openai/gpt-oss-120b`. Or it searches without `min_context_length`. | The tool outputs of the run against the model asked about, or against the models the snapshot accepts. The arguments of each `search_models` call. | `lookup/known-model`, `search/cheapest-blended`  |
| `wrong-answer`       | The lookups were right, and the answer names none of the models that are good answers.     | The search listed the cheapest model and the answer recommends a dearer one.                                   | The oracle query of the case runs on the snapshot, and the answer must name one of its models, by exact slug.                                      | `search/cheapest-blended`                        |
| `invented-data`      | The answer names a model that no source holds.                                             | "Use `openai/gpt-9`." Nothing the user or a tool said holds it.                                                | The slugs of the answer against the question and the tool outputs. A name counts when its author is known to the snapshot, or it is in backticks.  | `lookup/known-model`, `search/cheapest-blended`  |
| `wrong-value`        | The answer leaves out a figure the tool returned, or the cost the question implies.        | The tool says the input price is 0.03 and the answer says $0.30. Or it states $4 for a job that costs $3.      | The figure, in its usual spellings, against the run's own tool output, or against the cost of the case within 1%. The tools are trusted.           | `lookup/known-model`, `calculation/given-prices` |
| `arithmetic-in-head` | The question needs arithmetic, and the run never called the calculator.                    | It says "that costs $3.00" and no `calculate` call is in the run.                                              | The case declares that it needs arithmetic, and no `calculate` call succeeded.                                                                     | `calculation/given-prices`                       |
| `needless-lookup`    | The question held the data, and the run looked something up anyway.                        | The prices are in the question, and the run calls `get_model` for the model.                                   | The case declares that its data is given, and the run called `get_model` or `search_models`, whether the call worked or not.                       | `calculation/given-prices`                       |

The classes that judge the content of a run form a chain, so that one cause is counted once: `run-failed`, then `memory-answer`, then `wrong-search`, then `wrong-answer`, then `invented-data` and `wrong-value`. A run that looked nothing up carries `memory-answer` and nothing after it. `arithmetic-in-head` and `needless-lookup` stand beside the chain.

A passing run is a run with none of these classes. It is not a run that did everything right: a run can pass with a failed tool call in the middle.

## The cases

The cases live in `packages/evals/cases/`, one file for each family of question. A case's code is `family/short-name`, and its `metadata.set` says whether the core run asks it: `--set full` asks them all.

Each case has a code and a one-line description of what it tests. The core set is one case for each family of question: a lookup, a calculation with no lookup, and a filtered search.

| Case                       | It asks                                                                                   | A good run                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `lookup/known-model`       | The prices and the context window of `openai/gpt-oss-20b`.                                | Looks the model up and reports the figures the tool returned.                  |
| `calculation/given-prices` | The cost of 3 million input and 1 million output tokens at 0.50 and 1.50 USD per million. | Looks nothing up, calls the calculator, and states 3.00 USD.                   |
| `search/cheapest-blended`  | The cheapest paid model with 200,000 tokens of context and tool calling.                  | Searches with both filters, finds a model the snapshot accepts, and names one. |

"Cheapest" in `search/cheapest-blended` means the lowest blended price, with three input tokens for every output token, and the question says so.

## What the figures do not tell you

The catalog changes every week, so two runs a month apart are comparable in behavior and not in identical output. The checks look for the figure the tool returned, in the answer. They prove that the right number appears. A wrong number beside it goes unseen. And ten runs say little about a model that passes every time: its pass^k of 1.0 is a limit of n, not proof.
