# Proposal

## Why

The test suite mocks every request, so it can say nothing about what a real model does with the system prompt and the tool descriptions. Whether the agent looks a price up or recites it from memory, whether it sets the right filters, whether it reports the number the tool returned: only a live run answers these, and today nobody runs one. A prompt edit or a tool rename can degrade the agent while every test stays green.

Models are also non-deterministic. One run proves little. The useful figure is how often a case passes over many runs, and how often it passes every time.

## What Changes

- A new package, `packages/evals`, built on `promptfoo`. It runs the real CLI against real services, an explicit exception to the offline rule that governs the rest of the repository. It is never part of `pnpm test`.
- A provider that runs the CLI with `--json` and hands promptfoo the parsed result: the local build (`dist`) by default, or a published version through `pnpm dlx` with `--cli-version`, from 1.1.0. The model under test arrives through `vars.model`. Two models form the matrix: `nvidia/nemotron-3-ultra-550b-a55b:free` and `anthropic/claude-haiku-5.5`. A third, `thinkingmachines/inkling:free`, left the free tier and was dropped. Cost and token usage map onto the fields promptfoo already reports.
- An oracle: a catalog snapshot written before the first run, and named queries over it (for example the cheapest paid model with a given context, tools support and token mix). Cases take their expected answers from the oracle or from the run's own tool outputs, never from constants that rot with the catalog. A case may also draw a variable from the snapshot, such as a free model to ask about.
- Deterministic checks, inline in the promptfoo config where trivial and in tested modules where not. Each check is tagged with an error class, from `run-failed`, `memory-answer`, `invented-data` and `wrong-value` to the classes of search quality, tool use, recommendation, ambiguity and hostile input. The `eval-checks` spec holds the full table, and the docs page the same table with an example and the cases that provoke each class.
- Judge checks: `llm-rubric` graded by Jev 1.14 through OpenRouter, yes/no questions only, for grounding, relevance, usefulness and tool usage. They are recorded with weight 0 and a 0.7 threshold until calibrated, so they do not yet count toward a pass.
- Cases in two sets, grown over several slices. The core set (`lookup/known-model`, `calculation/given-prices`, `search/cheapest-blended`) is one case for each family of question: a lookup, a calculation with no lookup, and a filtered search. The full set adds search and count cases, recommendation and affordability cases, lookup-discipline cases, ambiguity cases, hostile-input cases, and `lookup/free-variant`, `lookup/router-model`, `calculation/monthly-workload` and `calculation/two-model-ratio`, each with the classes and checks that detect its failure.
- A page on the docs site: the error taxonomy, with for each class its definition, an example, how it is detected and the cases built to provoke it, and how to run the evals against the local build and against a published version.
- A reporter that reads promptfoo's `results.json` and prints, per model and case, pass@k and pass^k for k = 1, 3, 5 from n = 10 runs, using the unbiased estimators. Errored runs count as failures and are shown per cell. It also prints informational means: cost, latency, tool rounds, cost per solved task, and the judge pass rate. None of these fail the run.
- Unit tests, property tests and mutation testing for the package's own code (provider, oracle, slug and number matching, estimators, reporter), all offline.

Out of scope, each for a later proposal: running evals in CI, A/A calibration of thresholds, and numeric grounding beyond the asked figure.

## Capabilities

### New Capabilities

- `eval-run`: how an eval run executes the CLI and what it records. The target (the local build or a published version), the provider contract, the model matrix, repeats without cache, the treatment of non-zero exits and the handling of the API key.
- `eval-oracle`: the catalog snapshot, the named queries over it, and variables drawn from it.
- `eval-checks`: the error classes and their precedence, the deterministic checks, the judge checks and their weights, and the cases with their sets.
- `eval-report`: the estimators, the per-cell table, the informational metrics and the report's exit behavior.

### Modified Capabilities

None. The CLI's behavior does not change.

## Impact

- New package `packages/evals`, picked up by the existing `packages/*` workspace glob. Its `test` script runs the offline unit tests; the live run uses a separate `eval` script, so the root `pnpm test` and CI never reach a paid service.
- New dependencies: `promptfoo`, plus `vitest`, `fast-check` and Stryker for the package's own tests. `vitest` and `@vitest/coverage-v8` stay pinned, as the repository already requires.
- `AGENTS.md` records the exception: evals call real OpenRouter and Jev, with the user's key, and run only when the user asks. The mutation scripts and the Stryker setup extend to the new package.
- Docs gain a short guide to running the evals. Results, caches and snapshots go in `.gitignore`. The key stays in the environment and must not appear in saved results.
- No change to the CLI, its version or its release. The work lands as chore or test commits and bumps nothing.
- Open facts the design settles first with an offline spike against a stub CLI and a loopback server: the shape of `results.json`, whether `--repeat` bypasses the cache, the order of transforms, how a weight-0 assertion is recorded, which path and model slug the Jev provider sends to OpenRouter, whether the key leaks into saved results, and how large the judge state gets.
