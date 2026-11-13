# Design

## Context

The CLI package has a vitest suite that mocks every request. The workspace globs `packages/*`, and the root `test` script runs each package's `test` script, so anything named `test` runs in CI. The CLI's `--json` object already carries what an eval needs: the answer, the usage and cost, and every tool call with its arguments, output and failure flag, grouped by round. The tools return prices in USD per million tokens and turn a routing model's `-1` into `null`.

Promptfoo supplies the runner: repeats, a results file, named metrics, inline JavaScript assertions, an `llm-rubric` assertion with a TypeSafe grader, and `beforeAll` and `afterAll` hooks. It supplies neither pass@k nor pass^k. See `proposal.md` for the motivation.

## Goals / Non-Goals

**Goals:**
- Reuse what promptfoo ships. Write code only where it has no answer: the provider, the oracle, the matchers, the estimators.
- Keep every line of custom code testable offline, under the repository's mutation threshold.
- Make a failed run name its cause, and make the numbers survive a rerun of the reporter.

**Non-Goals:**
- No CI job. Thresholds wait for A/A runs.
- No published-version target, and no judge-based check that counts toward a pass.
- No change to the CLI. A defect an eval finds in a tool goes to the regular suite as a mock test.

## Decisions

**1. A JavaScript provider, not `exec:`.** The exec provider passes the prompt and the context as trailing arguments and treats stdout as plain text. Reading `vars.model` would need a wrapper script anyway, and baking the model into the command string moves the matrix out of `vars` and puts the question through a shell. A `file://` provider reads `context.vars.model` directly, starts the CLI with an argument array and returns structured `cost` and `tokenUsage`. Alternative: one `exec:` entry per model, rejected for the shell and the lost matrix.

**2. The reporter is a separate script over `results.json`.** Promptfoo's `derivedMetrics` sum named scores across all tests and cannot see a case's `c`. The `afterAll` hook sees every result but ties the arithmetic to a paid run. A script that reads the saved file reruns for free, takes other values of k, and carries its own unit and property tests. The cost is that the figures live beside promptfoo's report, not in it.

**3. Two tiers of assertion.** Every check, the one-liners too, is a module under `src/checks/`, so the unit tests and the mutants reach it. They sit in one file per family (universal, lookup, search, tool use), and `assertions.ts` gathers them, so that the config names one place. A one-line check stays inline in the config, shared through `defaultTest` with a YAML anchor: the run succeeded, a `calculate` call exists. Anything with edge cases becomes a `file://` module with unit tests: slug extraction, figure matching, value lookup in tool outputs, the oracle checks. Inline YAML gets no tests and no mutants, so logic does not belong there.

**4. Classes are metric names.** The search check reads the calls of the run, not its answer: `wrong-search` fails when no successful call output holds a model the snapshot accepts, or when the run searched and no `search_models` call sent every constraint the case requires, and a run that only read models with `get_model` has no search to judge. Each assertion sets `metric` to its class. Promptfoo records the failed metric per result, and the reporter counts them. No separate classifier exists to drift from the assertions. The precedence rule lives in the modules: a later check returns a pass when an earlier class already fired, so the counts add up.

**5. The oracle is a module the runner calls.** `snapshot` fetches the public list with plain HTTP, not through the CLI's SDK, so it stays independent of the tools it checks. The runner takes the snapshot before it starts promptfoo, saves it as `catalog.json` beside the results and passes its path in `EVAL_CATALOG`, so that a failed fetch stops the run before any case and no hook sits between the fetch and the first case. The checks read the file. The `freeModel` variable of slice 4 will read the same file. Queries live in a registry keyed by name, so each is a pure function with examples and properties as tests. A query returns the models that qualify, and a tighter constraint can let a dearer model in when it removes the cheapest one, so the invariant is that every model returned meets every constraint.

**6. The judge reads a built state.** The TypeSafe grader sends only the output and the rubric. An assertion-level `transform` builds a text state from the parsed object: question, tool calls, answer, as each rubric needs. The provider config sets `threshold: 0.7` and no levels. Each assertion sets `weight: 0`, which promptfoo documents as recording the metric without requiring a pass. Above 32,000 bytes the state is not cut, because a cut state grades something other than the run.

**7. Layout.**

```
packages/evals/
  package.json              scripts: test (offline), eval, eval:full, report
  promptfooconfig.yaml      core set; promptfooconfig.full.yaml adds the rest
  src/provider/             the JS provider
  src/oracle/               snapshot, queries, free model
  src/checks/               slugs, figures, search checks
  src/report/               estimators, aggregation, table
  test/                     fixtures, unit and property tests
```

**8. Names.** `test` runs the offline unit tests and is the only script the root picks up. `eval` and `eval:full` need a built CLI and a key, and the root never calls them. The results directory is `results/`, in `.gitignore`.

**9. Mutation testing.** The package gets its own Stryker config at the same pinned concurrency as the CLI's, and its own root scripts, `mutation:evals` and `mutation:evals:full`. The root `mutation` script stays on the CLI, because CI and `.github/scripts/mutation-pr.sh` pass it CLI paths. Evals mutation is manual until a later change wires it into CI. The config points `tsconfigFile` at a file that does not exist, as the CLI's does, because Stryker has no TypeScript 7 checker.

**10. The target is an argument, not a case variable.** Which CLI is evaluated is a property of the run, so `--cli-version` selects it and the provider starts it: `node dist/index.js` for the local build, `pnpm dlx ask-openrouter@<version>` for a published one, in both cases with an argument array. The version is checked against exact semver from 1.1.0 before anything starts, because it ends up in a process invocation. The target joins the provider id, so that promptfoo's state never mixes two targets, and the report names it. The first `pnpm dlx` run of a version downloads it, so the runner warms it once before the eval, which keeps that time out of the latency figures.

**11. The docs page is the home of the taxonomy.** The docs site holds one page, `evals.md`, in the Contributing group. Its table has one row per error class: code, definition, an example, how a check detects it, and the cases built to provoke it. The page also says how to run the evals against the local build and against a published version. Every slice that adds a class or a case adds its rows, so that the page and the specs never differ for long. The package README keeps the commands and the flags.

## Risks / Trade-offs

- **Promptfoo behaviors the docs left open** → Settled by the spike, see Spike findings. The original list: An offline spike comes first, against a stub CLI and a loopback server. It settles: the shape of `results.json` and how errors, repeats and weight-0 assertions appear; whether `--repeat` bypasses the cache; whether the test-level transform reaches the assertion-level one as an object; which path and model slug the TypeSafe provider sends to OpenRouter; whether the resolved key reaches the saved results; the size of a judge state on real tool output. Each has a fallback: `--no-cache` already covers the cache; a small `file://` assertion replaces a transform that does not chain; a stripped results copy replaces a leaking one. A fact that contradicts a spec amends the spec before code.
- **Catalog drift** → The snapshot is older than the agent's lookups. Acceptable sets are ties within 1%, the snapshot time is saved with the results, and the risk is accepted.
- **Free-model limits** → The free model has daily and per-minute caps, so 60 core runs can hit them, and a free model can leave the free tier, as `thinkingmachines/inkling:free` did: its runs all failed with a 404 that names the paid slug. Errors count as failures and show per cell, which keeps n fixed. A delay and low concurrency go in the config. `-n` or `--filter-sample` give small local runs.
- **A passing run can hide a failed tool call** → The class list is short on purpose. The spec says a pass means no listed class fired.
- **Figure matching is a heuristic** → It proves the right number appears, not that no wrong one appears beside it. The judge covers that after calibration.
- **Judge noise** → Weight 0 keeps it out of the pass numbers until calibration.
- **Free text in `lookup/free-variant` and `lookup/router-model`** → "Says it is free" and "says there is no fixed price" rest on phrase lists. The question wording can tighten them, and A/A runs measure the false rate.

## Spike findings

Run offline with promptfoo 0.125.1, a stub CLI and a loopback server standing in for Jev (task 1.1). Each finding says what the code and the spec rely on.

- **Results shape.** `results.results.results[]` holds one entry per run: `vars`, `repeatGroupId` (one per test and vars combination), `repeatIndex`, `success`, `score`, `namedScores`, `cost`, `latencyMs`, `response.output` (the parsed object) and `gradingResult.componentResults[]` with each assertion's `metric`, `pass` and `score`. The reporter groups cells by `vars.model` and the case code in `testCase.metadata.id`, so the codes must be unique.
- **Errors.** A provider error is an entry with `failureReason: 2`, `success: false`, no grading and `cost: 0`. The reporter must not read that 0 as a reported cost. A failed check has `failureReason: 1` and also an `error` text, its reason, so `error` alone does not tell the two apart.
- **Exit code.** Failed or errored runs make promptfoo exit 100, which would skip a trailing reporter. `PROMPTFOO_FAILED_TEST_EXIT_CODE=0` gives exit 0, and any other non-zero exit stays fatal.
- **Cache.** A custom provider is never cached, so every repeat starts the CLI. The Jev grader is cached when the cache is on. `--no-cache` stays, for the grader.
- **Transforms.** The provider returns the success object itself, and promptfoo hands it to string-expression and `file://` assertions as an object, so the deterministic checks need no transform. An assertion-level transform also receives the object, so the judge state builder reads `output.answer` and `context.vars.question` as planned.
- **Weight 0.** The assertion records its score under its metric and leaves the overall score and pass untouched. Its own `pass` is true whatever the score, so the reporter compares the score with the threshold, read from the provider config in `results.config`.
- **Jev request.** The provider posts to `{apiBaseUrl}/v1/systemone` with `Authorization: Bearer <key>`. It sends the text after `typesafe:` as the model, so the id is `typesafe:typesafe/jev-1.14` and the request holds `typesafe/jev-1.14`. With `apiBaseUrl` set to `https://openrouter.ai/api` the path is OpenRouter's System One path. Provider errors are never graded. The provider reports no cost for 1.14, so judge cost is not in promptfoo's figures.
- **The key.** The saved config shows `apiKey` as `[REDACTED]`. The dummy key appears in no results file and not in promptfoo's own config directory. The fallback in Risks is not needed.
- **Judge state size.** A compact search entry is about 345 bytes, so a 50-model page is about 17 KB and fits. Two full pages exceed 32,000 bytes and record no score, as the spec says.
- **TypeScript.** Promptfoo loads `.ts` providers and `file://path.ts:name` assertions directly, with no build step.
- **Case declarations.** A check reads what its case declares from `context.test.metadata`.
- **Pnpm.** `pnpm run <script> --flag` passes the flags through. A `--` before them reaches the script as a literal argument.
