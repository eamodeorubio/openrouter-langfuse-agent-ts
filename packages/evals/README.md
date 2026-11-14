# Evals

The test suite of this repository mocks every request. It knows the tools return the right shape and the loop stops when it should. It cannot know whether a real model, handed the system prompt and the tool descriptions, does the right thing. This package asks the model.

An eval run starts the built `ask-openrouter` CLI against real models on OpenRouter, many times per question, and records what happened. A reporter then turns the results into two figures per case and model: how often at least one of k runs passes, and how often all k do. It talks to real services with your key and costs real money. It never runs as part of `pnpm test`, and it never runs in CI.

## What a run needs

- A built CLI. From the repository root, run `pnpm build`. The run stops before any request, with a message, when `packages/cli/dist/index.js` is missing.
- Your OpenRouter key in the environment: `export OPENROUTER_API_KEY=...`. The key stays in the environment. Nothing the run writes holds it, and a test checks that.
- A network that reaches `openrouter.ai`. Before the first case, the run fetches OpenRouter's public model list, which needs no key, and saves it as `catalog.json` beside the results. That snapshot is the oracle: it says which models are good answers to a question like "the cheapest model with 200,000 tokens of context and tools", so that no case holds a model name that the weekly catalog will outdate. A run that cannot fetch it stops before any case.

Then:

```sh
pnpm --filter ask-openrouter-evals run eval
```

The run asks each of the six core cases of [`promptfooconfig.yaml`](promptfooconfig.yaml) of two models, ten times each, with no cache, so that every repeat is a new request. The models are `nvidia/nemotron-3-ultra-550b-a55b:free` and `anthropic/claude-haiku-5.5`. The free model has request caps, and a free model can leave the free tier, as `thinkingmachines/inkling:free` did. A run that hits a cap or a 404 counts as a failed run, so a small set of cases keeps a full run inside the limits.

The report needs `n` of at least the widest `k`, which is 5 by default. A run whose `--k` is wider than its `--repeat` is refused before the first request, so that a paid run never ends without a report. To try the harness cheaply, shrink the run:

```sh
pnpm --filter ask-openrouter-evals run eval --repeat 2 --k 1,2
```

## The cases

The core set holds six cases, so that every error class has at least one case built to provoke it. `--set full` adds the other cases. The [docs page](https://eamodeorubio.github.io/openrouter-langfuse-agent-ts/evals/) lists what each case asks, and the class each one is built to provoke. The core cases are:

| Case                            | What it asks                                                                             | What a good run does                                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lookup/known-model`            | The prices and the context window of `openai/gpt-oss-20b`                                | Looks the model up and reports the figures the tool returned                                                                                                |
| `calculation/given-prices`      | The cost of 3M input and 1M output tokens, at prices the question gives                  | Looks nothing up, calls the calculator, and states 3.00 USD                                                                                                 |
| `search/cheapest-blended`       | The cheapest paid model with 200,000 tokens of context and tool calling                  | Searches with both filters, finds a model the snapshot accepts, and names one. Cheapest means by a price that weighs three input tokens to one output token |
| `search/none-exists`            | A model with 2 million tokens of context, image output and an input price under 0.01 USD | Searches with the filters, finds none, and says that no model meets the request                                                                             |
| `search/single-search`          | The cheapest model with 200,000 tokens of context that supports tools                    | Makes one search that filters and sorts on the server, and names the model it listed first                                                                  |
| `recommendation/budget-chatbot` | A model for a support chatbot with tool calling, 2,000 chats a day and 300 USD a month   | Reads prices, calls the calculator, and names a model that fits the budget and supports tools                                                               |

The cases live in [`cases/`](cases), one file for each family of question: `lookup.yaml`, `calculation.yaml`, `search.yaml`, `recommendation.yaml`. A case has a one-line description of what it tests, and its code in `metadata.id`, written `family/short-name`, such as `lookup/known-model`, where the family is the name of its file. `metadata.set` says which run asks it: `core` or `full`. The run asks the core cases unless you say `--set full`:

```sh
pnpm --filter ask-openrouter-evals run eval --set full
```

The report also counts, for each model, how many runs every error class judged, passed and failed, with pass@k and pass^k of its own. It sits under the model, after the `mean` row. A class judges a run when one of its checks ran on it, and a run that an earlier class of the chain failed is not judged by a later one, so the counts of a class say how often that check passed when it was asked.

## Reading the report

The report goes to stdout, one block per model and one line group per case:

```
anthropic/claude-haiku-5.5
  lookup/known-model  n=10  c=6  err=1  pass@1=0.6000 pass@3=0.9667 pass@5=1.0000  pass^1=0.6000 pass^3=0.1667 pass^5=0.0238
                      failed: memory-answer=2 wrong-value=1
                      cost 0.0100 (9 runs)  latency 4210 ms  rounds 1.00 (9 runs)  cost/solved 0.0150
  mean                n=10  c=6  err=1  ...
  by error class
    run-failed     judged=10  passed=9  failed=1  pass@1=0.9000 pass@3=1.0000 pass@5=1.0000  pass^1=0.9000 pass^3=0.7000 pass^5=0.5000
    memory-answer  judged=9   passed=7  failed=2  pass@1=0.7778 pass@3=1.0000 pass@5=1.0000  pass^1=0.7778 pass^3=0.4167 pass^5=0.1667
    wrong-value    judged=7   passed=6  failed=1  pass@1=0.8571 pass@3=1.0000 pass@5=1.0000  pass^1=0.8571 pass^3=0.5714 pass^5=0.2857

wall time 114.2 s for 60 runs (concurrency 4)
```

`n` is how many times the case ran, `c` how many runs passed, and `err` how many ended in a provider error. The `mean` row averages each estimator over the cases, every case with equal weight. Its counts and costs pool every run of the model. A provider error counts as a failed run: the estimators need a fixed n, and a model that always errors should score 0.

- **pass@k** is the chance that at least one of k runs, drawn from the n you made, passes. It answers "if I may try k times, will it work?"
- **pass^k** is the chance that all k pass. It answers "can I rely on it every time?" It falls as k rises, and it is the harsher figure.

Both use the unbiased estimators, so the ten runs say something about any k up to ten. A `k` above `n` is an error.

A run passes when no error class fired. The page [Evals](https://eamodeorubio.github.io/openrouter-langfuse-agent-ts/evals/) on the docs site holds the full taxonomy: for each class its definition, an example, how a check detects it and the cases built to provoke it. Each failed check carries the name of its class, and the `failed:` line counts them:

| Class                | The run                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------- |
| `run-failed`         | ended without an answer                                                                 |
| `memory-answer`      | needed a lookup and made no successful tool call                                        |
| `wrong-search`       | made lookups that never surfaced a model the snapshot accepts, or that dropped a filter |
| `wrong-answer`       | had an acceptable model in its lookups and named none                                   |
| `bad-recommendation` | named no model that fits the budget and the features the question asks for              |
| `phantom-match`      | presented a model as a match for a request that no model meets                          |
| `invented-data`      | named a model that no source holds                                                      |
| `wrong-value`        | left out a figure the tool returned, or the cost or the count the question implies      |
| `arithmetic-in-head` | needed arithmetic and never called the calculator                                       |
| `needless-lookup`    | looked up data the question already held                                                |
| `wasteful-search`    | searched more than once, or without a sort, when one sorted search answers              |

The classes that judge the content of a run form a chain: `run-failed`, then `memory-answer`, then `wrong-search`, then `wrong-answer`, `phantom-match` or `bad-recommendation`, then `invented-data` and `wrong-value`. A run that never looked anything up carries `memory-answer` and nothing after it, so one cause is counted once. `arithmetic-in-head` and `needless-lookup` stand beside the chain. A judge that grades relevance and usefulness arrives with a later change.

The report ends with the wall time of the whole eval, as promptfoo measured it, with the number of runs and how many ran at once. The last line of each cell is informational and never fails anything. It shows the mean cost over the runs that reported one, the mean latency, the mean tool rounds, and the cost per solved task: total cost divided by passing runs. A figure that does not exist reads `n/a` or `-`, never 0.

## Where the results go

Each run writes `results/<timestamp>/results.json`, a promptfoo results file, and `catalog.json`, the snapshot of the catalog it judged by, in a folder named for the start time, such as `results/2026-11-13T10-20-30-123Z/`. The newest is last in the list. `--out <dir>` puts the run somewhere else. The directory is ignored by git. The reporter only reads that file, so you can rerun it for free, with other values of k:

```sh
pnpm --filter ask-openrouter-evals run report results/<timestamp>/results.json --k 1,5,10
```

promptfoo keeps its own state in `packages/evals/.promptfoo/`, also ignored. Its telemetry and update check are off.

## What these figures do not tell you

The catalog changes every week, so two runs a month apart are comparable in behavior and not in identical output. The checks look for the figure the tool returned, in the answer. They prove the right number appears. A wrong number beside it goes unseen.

## Tests of the package itself

The checks, the provider and the reporter are code, and they have their own tests. They run offline, with a stub CLI and fixture files, and a guard refuses any request that leaves the loopback interface. The guard covers the test process. The promptfoo and stub-CLI processes the integration tests start are offline by construction: the stub makes no request, and promptfoo's telemetry and update check are off.

```sh
pnpm --filter ask-openrouter-evals run test
```

Of this package's scripts, only `test` runs under the root `pnpm test`. The mutation tests run with `pnpm mutation:evals` from the repository root, and the score stays at or above the threshold in `stryker.config.json`.
