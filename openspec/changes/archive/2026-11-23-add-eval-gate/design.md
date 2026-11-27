# Design

## Context

The evals package runs the built CLI against real models and prints a report. `eval` exits 0 whenever it produced a report, whatever the pass rates: it measures and does not judge. The only way to run it on GitHub today is the Evals workflow, by hand. The motivation is in proposal.md, Why.

What exists and is reused:

- `src/report/results.ts`, `readRuns`, turns a promptfoo results file into runs, each with its model, case, `passed` and `error`. A provider error already counts as not passed.
- `src/report/estimators.ts`, `passHatK`, is the unbiased pass^k estimator the report prints.
- `test/resultsFixture.ts` builds results files for tests.
- `packages/cli/test/release.workflow.test.ts` shows how this repo tests a workflow file: it reads the YAML as text and checks jobs and steps.
- `.github/workflows/evals.yml` and `.github/scripts/mutation-pr.sh` show the shape of a run on GitHub and of a diff against the base: `git diff --name-only origin/<base>...HEAD` after a checkout with `fetch-depth: 0`.

The figures that seed the floors come from the published runs of 1.2.0, 1.2.1 and 1.2.2, core cases on Haiku, ten runs each. Ten of the eleven cases passed every run but two, which passed 9 of 10 once. `ambiguity/cheapest-for-chatbot` passed 10, 9 and 8. In 1.1.0, judged by older checks, `search/single-search` passed 3 of 10 and `ambiguity/cheapest-for-chatbot` 6.

## Goals / Non-Goals

**Goals:**

- A gate that fails a pull request when a core case on Haiku drops by a margin that chance alone rarely produces.
- Few false alarms from provider trouble: errors make a run inconclusive, never a failure.
- Floors that live in one reviewed file, so that later noise measurements change data and not code.

**Non-Goals:**

- Measuring the noise (A/A runs) is done: see "The A/A measurement". The seeds below are where the floors started.
- Gating on the judge rubrics. They have weight 0, and the gated run does not ask them.
- Gating Nemotron, the `judge` set or the `full` set.
- A second, confirming run inside one job. One run of ten per case, then a verdict.
- Making the check required. That is a repository setting.

## Decisions

### pass^k, not pass@k

The CLI answers once. A user does not ask again until an answer looks right, so pass@k, the chance that one of k tries passes, measures something the CLI never offers. pass^k is the chance that k separate users all get a right answer, which is the promise the CLI makes. The gate reads pass^k alone.

At a fixed n, pass^k is a monotone function of c, the number of passes. A floor on pass^3 at n 10 is a floor on c, written in the unit the report prints. The table for n 10 and k 3:

| c | 10 | 9 | 8 | 7 | 6 | 5 | 4 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| pass^3 | 1.0000 | 0.7000 | 0.4667 | 0.2917 | 0.1667 | 0.0833 | 0.0333 |

k is 3 because its values are spread far enough apart to read. At k 5, the floor for 5 of 10 would be 0.004. The choice is a key of `gate.yaml`.

A floor sits between two values the estimator can take, never on one, so that rounding in the file cannot move a verdict. The comparison is with the raw value, and a value equal to its floor passes.

### The seeds

`gate.yaml` holds one floor for every core case, with no default, so that the floors measured later map one to one onto its lines. A case with no floor is refused, so a pull request that adds a core case adds its floor too.

| Floor | Value | Means at n 10 | Chance of a false alarm, if the case is as good as the published runs |
| --- | --- | --- | --- |
| each of the ten cases below | 0.4 | 8 of 10 or more | about 1 in 10,000 for a case that passes 99 runs in 100 |
| `ambiguity/cheapest-for-chatbot` | 0.05 | 5 of 10 or more | about 3 in 1,000 at 83 in 100 |
| `mean` | 0.85 | | the three 1.2.x runs scored 0.92 to 1.00 |

The A/A measurement, below, replaced three of these values before the merge.

The ten cases at 0.4: `calculation/given-prices`, `discipline/parallel-lookups`, `discipline/typo-recovery`, `hostile/key-in-question`, `hostile/prompt-injection`, `lookup/known-model`, `recommendation/budget-chatbot`, `search/cheapest-blended`, `search/none-exists` and `search/single-search`. Each line of the file carries a comment with the minimum passes of 10 it stands for.

A case whose true rate falls to one pass in two breaches its floor about 95 times in 100, and one that falls to seven in ten about 62 times. The seeds pass the three runs of 1.2.x and would have failed 1.1.0 on `search/single-search`. The chances assume independent runs, which only an A/A measurement can confirm.

### The mean floor

Each case floor sits low enough to let noise through, so a change that costs every case a pass or two passes every case floor. If all eleven cases fall to 8 of 10, each sits at 0.4667, above its floor of 0.4, and the mean falls from about 0.95 to 0.4667. Noise seldom pulls many cases down in one run, so a low mean is evidence that one case cannot give. The case floors catch one case that collapses. The mean catches a slight fall everywhere.

The mean is of the cases' pass^k, each case with equal weight, as the report's model row computes it. Its floor is set from the A/A data by simulation: draw many gate runs from the measured p of each case, compute the mean pass^k of each, and put the floor where the share of draws below it equals the false-alarm budget. The seed, 0.85, sat below the lowest of the three published runs.

### The A/A measurement

Ten runs of the Evals workflow on `main`, 23 to 27 November 2026, all of 1.2.2 on Haiku, n 10: a hundred answers per case. Nine cases passed all hundred. `recommendation/budget-chatbot` passed 98, and `ambiguity/cheapest-for-chatbot` 86, between 6 and 10 of 10 a run. The variance of each noisy case across runs matched a binomial (ratio 1.14 and 0.91), so the runs look independent.

A case at 100 of 100 does not have a true rate of 1, so each case's rate carries a Jeffreys prior. The false-alarm budget is 1 in 1,000 for each case and for the mean. A floor is the largest count whose chance of being undercut by a healthy case stays within it, and the mean floor is the 0.1% quantile of 400,000 simulated gate runs (random seed 20261127).

| Floor | Seed | Measured | Means at n 10 |
| --- | --- | --- | --- |
| the nine perfect cases | 0.4 | 0.4 | 8 of 10 or more |
| `recommendation/budget-chatbot` | 0.4 | 0.25 | 7 or more |
| `ambiguity/cheapest-for-chatbot` | 0.05 | 0.02 | 4 or more |
| `mean` | 0.85 | 0.83 | simulated 0.1% quantile 0.833 |

The ambiguity floor has little power: it stays quiet for a true rate down to about 0.6, so the 6 of 10 of 1.1.0 would pass. The case is too noisy to gate tighter at n 10. A larger n for that case is the lever.

### Haiku, ten repeats

Haiku cost 0.0018 USD a run in 1.2.2, so 110 runs cost about 0.20 USD and take two to three minutes at promptfoo's default concurrency. Nemotron is free but has request caps, takes three times as long, can leave the free tier, and its pass^5 was 0.78 against Haiku's 0.92. A cap reached counts as a failed run, and a noisier model needs a larger drop before a gate can see it.

Ten repeats is what the published runs used, so the seeds are in the same unit.

### The gate is a command of the evals package

The decision needs the results, the estimator and a file of floors. Those are in the package already, with tests and a mutation run. A `jq` script in the workflow would duplicate the reading of promptfoo's format and could not be tested here.

`src/gate/` holds three parts with one job each: reading and checking `gate.yaml` (`config.ts`), the decision from runs and config (`decide.ts`, pure), and the command that reads files, prints and returns the exit code (`cli.ts`, with `main.ts` as the entry).

Exit codes: 0 pass, 1 fail, 4 inconclusive, 2 for every input the command cannot judge. 3 stays the setup failure of `eval`. The workflow only needs non-zero, and the distinct codes keep the log readable.

### Inconclusive

A provider error says nothing about the agent. Counting errored runs as passed gives the best result the run could have had. If even that breaches, the agent is at fault and the verdict is fail. If it clears, the errors may be the cause and the verdict is inconclusive. The job fails either way, since a required check must not pass on a run that measured nothing, and the line tells the reader to run it again.

### A failed filter job is inconclusive

If `changes` fails, say on an API error of `dorny/paths-filter` or a failed checkout, nobody knows whether the gate concerns the pull request. That is the same case as provider errors that hide the answer: nothing was measured, so the verdict is inconclusive and the check must be red. A job that `needs` a failed job is skipped by default, and a skipped job counts as passed for a required check. Left alone, the one case that measured nothing would look exactly like the case with nothing to measure, and a pull request could merge unjudged with a single required check.

So `eval gate` also runs when `changes` did not succeed. Its first step then writes an error annotation and a summary line, `verdict: inconclusive (the filter job failed, so it is not known whether the gate concerns this pull request; run the workflow again)`, and exits 1. No later step runs, since none has `always()`: nothing is installed or built and no model is asked. The key does not matter here, because the failed filter outranks the empty key. A cancelled run does not start the job, so a push that replaces a run leaves no red check behind.

### The rubrics of weight 0 are removed in the hook

A gated run on Haiku would send up to 350 requests to Jev, whose scores never change a verdict and which the gate does not read. They cost money, add latency, and are one more service that can fail.

The `beforeAll` hook in `src/hooks.ts` already returns a rewritten suite when `--model` narrows the matrix. The removal takes the same path: the runner reads `--skip-weightless-rubrics` and sets `EVAL_SKIP_WEIGHTLESS_RUBRICS=1` for promptfoo, as it sets `EVAL_MODELS_FILTER`, and drops a value left in the shell when the flag is absent. The hook applies the narrowing and then the removal, and returns one suite. A pure function in a module of its own, `src/rubrics.ts`, takes a suite and returns it without the rubrics of weight 0, leaving every other field and the order of the remaining assertions as they were.

A rubric counts as weight 0 only when its `weight` is the number 0. promptfoo gives a missing weight the value 1, so a rubric with no `weight` key counts and stays.

The cases name their rubrics as `file://rubrics/judge-*.yaml`. A probe in task 2.1 settled what the hook receives: promptfoo has already loaded each file, so `suite.tests[].assert` holds objects such as `{ type: 'llm-rubric', metric, weight, threshold, value, transform }`, not strings. The function therefore only filters the `assert` lists, and reads no file.

The flag also appears in `target.txt`, so that the report of a gated run says why it has no judge lines.

Alternatives: a second config file without rubrics would duplicate every case. A promptfoo filter on assertions does not exist.

### The path rule is a file of globs

GitHub's `paths:` filter skips the whole workflow, and a required check from a skipped workflow stays pending: the pull request cannot merge. So the workflow runs on every pull request, and the decision sits in a job of its own. A job skipped by its `if:` counts as passed for a required check.

The globs live in `.github/eval-gate-paths.yml`, under one filter, `eval`, and nowhere else. `dorny/paths-filter` reads them in the first job, `changes`, from the changed files that the GitHub API lists for the pull request. It lists the changed files through the API, so it needs no history and no install, and finishes in seconds. It does read the filter file from disk, so the job checks the repository out first, without keeping the token. A rule written as data reads at a glance, and repeating it in a test would only copy it. A test pins the entries that matter and applies the globs to changed-file lists, the "Concerned" and "Not concerned" scenarios of the spec, with Node's `path.matchesGlob`. It cannot prove that `dorny/paths-filter` reads the file the same way, so the pull requests themselves show whether the gate ran. The action sets picomatch's `dot` option, matches a deleted file as it matches any other, and filters by status only when a filter asks for it.

The filter holds positive globs only, so that the default quantifier, any match, is the whole rule:

```yaml
eval:
  - packages/cli/src/**
  - packages/cli/scripts/**
  - packages/cli/package.json
  - packages/cli/tsconfig*.json
  - tsconfig.base.json
  - packages/evals/src/**
  - packages/evals/cases/**
  - packages/evals/rubrics/**
  - packages/evals/promptfooconfig.yaml
  - packages/evals/package.json
  - packages/evals/gate.yaml
  - .github/workflows/eval-gate.yml
  - .github/eval-gate-paths.yml
  - .nvmrc
```

Tests sit under `test/`, outside every glob, and so do the docs, the READMEs, the Stryker configs and the lockfile. A deleted file matches too, since a removed case changes the run.

`pnpm-lock.yaml` is left out. Dependabot changes it every week, mostly for the docs and the tooling. A bump of a runtime dependency of the CLI changes `packages/cli/package.json` too, and that path is in.

`dorny/paths-filter` is a third-party action. It is pinned to a full commit SHA, with the version in a comment, and runs in a job that has no environment and no secret, so it never sees the key.

### The workflow

Two jobs in `.github/workflows/eval-gate.yml`, separate from `ci.yml` because the gate has a secret, a cost and an environment.

`changes`: `permissions: contents: read` and `pull-requests: read`, two steps: `actions/checkout` with `persist-credentials: false`, then `dorny/paths-filter` with `filters: .github/eval-gate-paths.yml`. Its output `eval` is `true` or `false`.

`eval gate`: `needs: changes`, `if: ${{ !cancelled() && (needs.changes.result != 'success' || needs.changes.outputs.eval == 'true') }}`, `environment: eval-gate`, `permissions: contents: read`, `timeout-minutes: 30`.

0. First, `if: needs.changes.result != 'success'`: the step of "A failed filter job is inconclusive". It exits 1, so the steps below, which have no `always()`, do not run.
1. Checkout, pnpm, Node from `.nvmrc`, `pnpm install --frozen-lockfile`.
2. GitHub refuses `secrets` in a step's `if:`, so the job's `env:` holds `HAS_KEY: ${{ secrets.OPENROUTER_API_KEY != '' }}`, which is `true` or `false` and never the key. If `HAS_KEY` is not `true`, one step writes a warning annotation and the summary line, and the steps below do not run.
3. `pnpm build`, then `pnpm --filter ask-openrouter-evals run eval --set core --model anthropic/claude-haiku-5.5 --repeat 10 --k 3 --skip-weightless-rubrics --out "$OUT" | tee "$OUT/report.txt"`, with the key in the `env:` of this step alone.
4. `pnpm --filter ask-openrouter-evals run gate "$OUT/results.json" | tee "$OUT/gate.txt"`, with `set -o pipefail`.
5. Always: the summary (commit, gate output, report) and `actions/upload-artifact` of `$OUT`, named `eval-gate-<run id>`, kept 90 days. When the filter failed, the first step has written the heading and the line, so the summary step writes no second heading.

The model, repeats and k are written in the workflow and in `gate.yaml`. The gate refuses a results file whose model or n differ from its file, so a drift between the two fails loudly.

Triggers: `pull_request` with `opened`, `synchronize` and `reopened`. `edited` is left out, since a title edit changes no code. `pull_request_target` is never used: it would run the code of a fork with the key.

Concurrency, at the level of the workflow: the group `eval-gate-<pull request number>`, with `cancel-in-progress: true`. A push cancels the paid run of the commit it replaces. Different pull requests run side by side, since Haiku has no shared cap.

### The key

A GitHub environment `eval-gate` holds `OPENROUTER_API_KEY`: a key of its own with a hard monthly limit, such as 10 USD. The `evals` environment cannot serve, because its advice is a required reviewer or protected branches, and either would stop every pull request.

Forks and Dependabot get no secrets on `pull_request`. Their job passes without a run and says so in a warning. Failing it would block every Dependabot bump of a CLI dependency. A maintainer can run the Evals workflow on such a branch by hand.

## Risks / Trade-offs

- [The floors rest on one version and ten runs] → They come from the A/A measurement of 1.2.2 over five days. A different model or a catalog shift can move the noise, and the measurement is then redone. Run the job without making it required for a few weeks.
- [Anyone with write access can edit the workflow on a branch and read the key] → The key is dedicated and capped. The same gap exists for `evals.yml` and is documented there.
- [A fork or a Dependabot pull request merges ungated] → The summary and the warning say the gate did not run. A maintainer can dispatch the Evals workflow on the branch.
- [The catalog moves every week] → The oracle is computed per run from its own snapshot, so the checks stay valid. A catalog change can still make a case harder. That is noise the floors must absorb, and the A/A measurement should span several days to see it.
- [Each push costs money] → About 0.20 USD, no judge calls, and a new push cancels the run before it. The credit limit caps the month.
- [A rubric given a weight above 0 later starts to count in the gate] → Intended: once a rubric decides verdicts, the gate must ask it. Its floors then need measuring again.
- [A failed filter job turns every pull request red until the workflow runs again] → Intended: failing closed is the cost of never merging unjudged. It also makes one required check enough: `eval gate`.
- [A gated pull request that changes `gate.yaml` can lower its own floors] → The diff shows it, and the review is the guard.

## Migration Plan

1. Merge the pull request. The job runs on later pull requests and is not required.
2. The maintainer creates the `eval-gate` environment and its key. Until then the job passes with the warning that no key is set.
3. After a trial period, and after the floors have held, the maintainer makes `eval gate` a required check. It is the only one needed: a failed `changes` job ends it inconclusive, and a skipped one means that no file matched.

Rollback: delete `eval-gate.yml`. Nothing else depends on it.
