# Proposal

## Why

The offline suite proves that the CLI's code holds together. It cannot tell whether a change to the instructions, a tool description or a check makes a real model answer worse. Today only a hand-started Evals run can show that, and nobody is forced to start one. Version 1.1.0 shipped with Haiku passing `search/single-search` three times in ten, and the run that found it came after the release.

A gate on every pull request that touches the agent or its evals catches that kind of drop before merge, at the price of one small paid run.

## What Changes

- A new workflow, `.github/workflows/eval-gate.yml`, runs on pull requests. When the pull request changes the CLI or the evals, it builds the CLI, runs the core set against `anthropic/claude-haiku-5.5` ten times per case, and fails the job when the gate says so. When it changes neither, the job is skipped, which a required check counts as passed.
- A new command in `packages/evals`, `gate`, reads a results file and a gate file and decides: pass, fail or inconclusive. The decision rests on pass^k per case, since a user of the CLI gets one attempt and needs it to be right every time. pass@k measures retries the CLI does not make, and the gate ignores it.
- A new file, `packages/evals/gate.yaml`, holds the model, the repeats, the k, one floor for each case, and a floor for the mean pass^k over the cases. A case with no floor is refused, so a new case comes with its floor. A change to a floor is a reviewed diff.
- Provider errors never fail the gate by themselves. A breach that clears when the errored runs count as passed is inconclusive, and the job says to run it again.
- A new option of `eval`, `--skip-weightless-rubrics`, removes the judge rubrics of weight 0 before the first request. They never change a verdict, and the gate does not read their scores, so a gated run sends no request to the judge. The Evals workflow does not pass it, and keeps its scores.
- A file of globs, `.github/eval-gate-paths.yml`, says which changed files concern the gate. It is the one place the rule lives.
- The constraint that CI never starts an eval run changes: the gate workflow is the one exception. `AGENTS.md`, `CONTRIBUTING.md`, the evals README and the docs page say so.

The A/A measurement of the noise is out of scope. The floors ship as seeds drawn from the published runs of 1.2.0 to 1.2.2, and later measurements change `gate.yaml` alone.

## Capabilities

### New Capabilities

- `eval-gate`: the decision that turns one eval run into pass, fail or inconclusive, the gate file it reads, the rule that says which pull requests it concerns, and the workflow that runs it on pull requests.

### Modified Capabilities

- `eval-run`: the requirement "Evals stay out of the offline suite" allows one CI path, the gate workflow, to start an eval run. A new requirement, "Skipping the rubrics of weight 0", adds the option `--skip-weightless-rubrics`.

## Impact

- New files: `.github/workflows/eval-gate.yml`, `.github/eval-gate-paths.yml`, `packages/evals/gate.yaml`, `packages/evals/src/gate/`, and their tests in `packages/evals/test/`.
- `packages/evals/package.json` gains the script `gate`.
- A third-party action, `dorny/paths-filter`, pinned to a commit, in a job that holds no secret.
- No change to the CLI, its output or its version. The pull request bumps nothing.
- `packages/evals/src/runner.ts` and `src/hooks.ts` gain the option and the removal of the rubrics.
- Cost: about 0.20 USD of Haiku per gated push, and no call to the judge. A new push to the same pull request cancels the run before it.
- The repository needs a GitHub environment `eval-gate` holding `OPENROUTER_API_KEY`: a key of its own with a hard credit limit, open to every branch and with no required reviewer, or every pull request would wait on a click. Making the job a required check is a setting of the repository, for the maintainer to switch on after a trial period.
- Pull requests from forks and from Dependabot get no secrets. Their gate job passes without a run and says so in its summary.
