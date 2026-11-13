# Evals

The test suite of this repository mocks every request. It knows the tools return the right shape and the loop stops when it should. It cannot know whether a real model, handed the system prompt and the tool descriptions, does the right thing. This package asks the model.

An eval run starts the built `ask-openrouter` CLI against real models on OpenRouter, many times per question, and records what happened. A reporter then turns the results into two figures per case and model: how often at least one of k runs passes, and how often all k do. It talks to real services with your key and costs real money. It never runs as part of `pnpm test`, and it never runs in CI.

## What a run needs

- A built CLI. From the repository root, run `pnpm build`. The run stops before any request, with a message, when `packages/cli/dist/index.js` is missing.
- Your OpenRouter key in the environment: `export OPENROUTER_API_KEY=...`. The key stays in the environment. Nothing the run writes holds it, and a test checks that.

Then:

```sh
pnpm --filter ask-openrouter-evals run eval
```

The run asks each case of [`promptfooconfig.yaml`](promptfooconfig.yaml) of two models, ten times each, with no cache, so that every repeat is a new request. The models are `nvidia/nemotron-3-ultra-550b-a55b:free` and `anthropic/claude-haiku-5.5`. The free model has request caps, and a free model can leave the free tier, as `thinkingmachines/inkling:free` did. A run that hits a cap or a 404 counts as a failed run, so a small set of cases keeps a full run inside the limits.

The report needs `n` of at least the widest `k`, which is 5 by default. A run whose `--k` is wider than its `--repeat` is refused before the first request, so that a paid run never ends without a report. To try the harness cheaply, shrink the run:

```sh
pnpm --filter ask-openrouter-evals run eval --repeat 2 --k 1,2
```

## Reading the report

The report goes to stdout, one block per model and one line group per case:

```
anthropic/claude-haiku-5.5
  A1    n=10  c=6  err=1  pass@1=0.6000 pass@3=0.9667 pass@5=1.0000  pass^1=0.6000 pass^3=0.1667 pass^5=0.0238
        failed: memory-answer=2 wrong-value=1
        cost 0.0100 (9 runs)  latency 4210 ms  rounds 1.00 (9 runs)  cost/solved 0.0150
  mean  n=10  c=6  err=1  ...

wall time 20.4 s for 20 runs (concurrency 4)
```

`n` is how many times the case ran, `c` how many runs passed, and `err` how many ended in a provider error. The `mean` row averages each estimator over the cases, every case with equal weight. Its counts and costs pool every run of the model. A provider error counts as a failed run: the estimators need a fixed n, and a model that always errors should score 0.

- **pass@k** is the chance that at least one of k runs, drawn from the n you made, passes. It answers "if I may try k times, will it work?"
- **pass^k** is the chance that all k pass. It answers "can I rely on it every time?" It falls as k rises, and it is the harsher figure.

Both use the unbiased estimators, so the ten runs say something about any k up to ten. A `k` above `n` is an error.

A run passes when no error class fired. Each failed check carries the name of its class, and the `failed:` line counts them:

| Class           | The run                                                       |
| --------------- | ------------------------------------------------------------- |
| `run-failed`    | ended without an answer                                       |
| `memory-answer` | needed a lookup and made no successful tool call              |
| `wrong-search`  | made lookups that never returned the model it was asked about |
| `invented-data` | named a model that no source holds                            |
| `wrong-value`   | left out a figure the tool returned for the asked model       |

More classes arrive with the cases that need them. The classes form a chain. A run that never looked anything up carries `memory-answer` and nothing after it, so one cause is counted once.

The report ends with the wall time of the whole eval, as promptfoo measured it, with the number of runs and how many ran at once. The last line of each cell is informational and never fails anything. It shows the mean cost over the runs that reported one, the mean latency, the mean tool rounds, and the cost per solved task: total cost divided by passing runs. A figure that does not exist reads `n/a` or `-`, never 0.

## Where the results go

Each run writes `results/<timestamp>/results.json`, a promptfoo results file, in a folder named for the start time, such as `results/2026-11-13T10-20-30-123Z/`. The newest is last in the list. `--out <dir>` puts the run somewhere else. The directory is ignored by git. The reporter only reads that file, so you can rerun it for free, with other values of k:

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
