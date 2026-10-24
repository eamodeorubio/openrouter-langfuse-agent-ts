# Contributing

Thanks for wanting to help. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). The maintainer is the owner listed in [CODEOWNERS](.github/CODEOWNERS); they agree the direction in issues and merge pull requests.

This project is a small CLI that answers questions about OpenRouter and points people to the most cost-effective model for their use case. It stays small on purpose, and the rules below keep it that way. They come down to four habits: write the spec first when the change needs one, write the test first, keep each change small enough to review, and let the checks tell you when you are done.

The same rules bind AI coding agents. [AGENTS.md](AGENTS.md) holds the agent's version, kept short. If the two ever disagree, that is a bug in the docs, so please say so in an issue.

## Set up

Use pnpm, not npm or yarn. You need Node 26 (the version in `.nvmrc`) and [pnpm](https://pnpm.io). The `package.json` pins the pnpm version; with Corepack enabled, `corepack enable` picks it up for you.

```sh
pnpm install
pnpm check         # Biome and Prettier, the same check CI runs
pnpm format        # fix formatting
pnpm typecheck     # tsc --noEmit
pnpm test          # Vitest, with HTTP mocked by nock or a local fake server
pnpm mutation      # Stryker mutation testing, incremental
pnpm docs:dev      # the documentation site, live
```

The other scripts (`test:watch`, `test:coverage`, `mutation:full`, `build`, `docs:build`, `docs:preview`) are in `package.json`.

Tests never touch the network. Mock HTTP with `nock`. When a test has to cancel or cut a response stream, use the loopback server in `packages/cli/test/fakeApi.ts`, because `nock`'s mock sockets cannot survive a cancel. The tests of the Langfuse calls (the credential check and the OTLP upload) use it too, because `nock` failed with them intermittently. To run the tool against real services, copy `.env.example` to `.env` and fill in your keys. Never commit `.env`. To report a security problem, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## From idea to merged pull request

The whole path is one pull request, with the spec inside it.

1. **Talk first.** Open an issue that describes the problem. For a bug, say what you ran, what you expected and what happened. Wait for the maintainer to agree on the direction before you invest time. A trivial chore or a dependency update needs no issue.
2. **Branch from `main`.** The branch name is free. Only the pull request title matters.
3. **Write the spec, if the change needs one.** The "Spec first" section says when. Without one, skip to step 5.
4. **Approve the spec before you build.** You review it, alone or with your agent, and approve it on your machine. This is the cheapest moment to change your mind. The pull request is not where the spec gets approved.
5. **Write a failing test.** Start wide, with an integration test that covers the requirements, and watch it fail for the right reason.
6. **Make it pass, one piece at a time.** For each piece, write a failing unit test, then the code. Refactor only when the code falls short of the [quality rubric](QUALITY_RUBRIC.md).
7. **Update the docs** if users will use the product differently.
8. **Run the checks.** `pnpm check`, `pnpm typecheck` and `pnpm test` must pass. If you changed logic in `src/`, run `pnpm mutation` too and deal with every survivor (see "Tests that test something"). CI runs it as well, but its verdict arrives after you open the pull request, so run it first.
9. **Review your own diff** against the rubric. Anyone can run the three read-only reviewers in `.agents/reviewers/` with an AI agent: `reviewer-code-high` for design, `reviewer-code-low` for detail, `reviewer-docs` for prose. Fix every must-fix finding.
10. **Commit.** Use the Conventional Commits form (see "Commits and versions"). One product slice is one commit.
11. **Push and open the pull request.** Give it a Conventional Commits title and describe what changed for the user. List anything you did not verify.
12. **Respond to review.** Push fixes to the same branch. Only must-fix findings block the merge.
13. **Archive the spec.** Once the review fixes are in, check the change against the code (`/opsx:verify` in Claude Code, the `openspec-verify-change` skill in other agents) and fix what it finds. Then make the last commit `chore: archive <change-name>`. If you cannot do it before the merge, the merge goes ahead and the change is archived afterwards in a `chore:` pull request.

### What each kind of change needs

| Change                            | Spec | Failing test first            | Reviewers           | Commit                         | Bump          |
| --------------------------------- | ---- | ----------------------------- | ------------------- | ------------------------------ | ------------- |
| New or changed behavior           | yes  | yes                           | all three           | `feat:` (`feat!:` if breaking) | minor (major) |
| Fix that needs a design decision  | yes  | yes                           | all three           | `fix:`                         | patch         |
| Small fix, no design decision     | no   | yes                           | all three           | `fix:`                         | patch         |
| Substantial refactor              | yes  | no, existing tests stay green | both code reviewers | `refactor:`                    | none          |
| Small refactor                    | no   | no, existing tests stay green | both code reviewers | `refactor:`                    | none          |
| Tests only                        | no   | no                            | `reviewer-code-low` | `test:`                        | none          |
| Docs only                         | no   | no                            | `reviewer-docs`     | `docs:`                        | none          |
| Tooling, CI, dependencies, chores | no   | no                            | `reviewer-code-low` | `chore:`, `ci:`                | none          |

Find the row that fits. When two rows fit, take the stricter one: the one that asks for more, such as a spec or a failing test. Output wording counts as behavior, so a typo in an error message is a small fix. A dependency update that closes a runtime security hole is a `fix:`. A revert takes the type of what it reverts. If you are unsure, ask in the issue.

### Two worked examples

Both features below are invented to show the shape of the work. Neither is on the roadmap.

#### A feature with two specs

Say you want the tool to list the cheapest model for a monthly token budget, and to export the ranking as CSV.

- **Issue.** "Let me ask for the cheapest model within a monthly budget, and export the result." The maintainer agrees.
- **Branch.** `budget-ranking`. The whole feature lives on it, spec included.
- **Specs.** Run `openspec new change budget-ranking`. The spec holds one requirement, "Rank models by monthly cost", with a decision table under its scenario: token mix and budget in, cheapest model out. A second requirement covers errors in a small table: unknown model, negative budget, missing prices. A second change, `csv-export`, specifies the export. Both pass `openspec validate --strict`, and you approve them before any code.
- **Product slice 1, `feat:`.** A failing integration test asserts the ranking for three rows of the table. Unit tests drive the cost calculation and the sort. The code makes them pass, and the docs gain a usage section. The commit is `feat: rank models by monthly cost`.
- **Product slice 2, `feat:`.** It shows the cost breakdown per model, with its own failing tests first: `feat: show the cost breakdown per model`.
- **Product slice 3, `feat:`.** It exports the ranking: `feat: export the ranking as CSV`.
- **Chore work.** Commits that bump nothing sit beside the slices, such as `test: cover ties in ranking` or `docs: add budget ranking example`. A reviewer can read them one at a time.
- **Archive.** The last commits are `chore: archive budget-ranking` and `chore: archive csv-export`.

Two specs gave three product slices in one pull request. The title is `feat: rank models by monthly cost`, which sets a minor bump. The squash merge puts that title on `main` and lists every branch commit, one line each, in the description, so the CSV export is on record.

#### A small fix with no spec

Say the tool prints a price of `NaN` when a model has no completion price.

- **Issue.** "Show a clear message when a model has no completion price." The maintainer agrees.
- **Branch.** `missing-completion-price`. There is no OpenSpec change: the fix needs no design decision worth remembering, and the pull request says so.
- **Product slice, `fix:`.** A failing test feeds the tool a model with no completion price and expects the message. A unit test pins the price formatter. The code makes both pass: `fix: report models with no completion price`.

The pull request title repeats the commit and sets a patch bump. There is no archive commit.

## Spec first

A change needs a spec, written with [OpenSpec](https://github.com/Fission-AI/OpenSpec), when it alters what the product does, makes a substantial refactor, or takes a technical decision worth remembering. A refactor is substantial when it changes the package layout, an interface other code depends on, or a design decision someone will ask about later. Chores, tooling, dependency updates, docs fixes, small refactors and small fixes need none. If you are unsure, ask in the issue before you start.

The spec comes before the code it covers and ships in the same pull request. There is no spec-only pull request, and a pull request that adds or changes behavior without a spec goes back to its author. A pull request normally holds one or two OpenSpec changes. Split the work when a reviewer could not take it in.

1. Install the OpenSpec CLI at the version CI uses, with `pnpm add -g @fission-ai/openspec@1.14.3`, or run it ad hoc with `pnpm dlx @fission-ai/openspec@1.14.3 <command>`. Then read `openspec/config.yaml`, which holds the writing rules for each kind of artifact.
2. Propose the change with `openspec new change <name>`, or `/opsx:propose` if you work with Claude Code.
3. Fill in the proposal, the spec deltas, the design and the tasks. A requirement may use scenarios, tables, rules, invariants or examples. Pick the form that says the thing most clearly.
4. Run `openspec validate <name> --strict` until it passes.
5. Approve the spec yourself before you build.
6. Implement the tasks as product slices on the same branch. The spec may travel as its own `docs:` commit or ride along inside another one.
7. Verify the change against the code, fix what that finds, and archive it in the last commit (`chore: archive <change-name>`).

If an OpenSpec change already exists but has no spec delta, mark it with `skip_specs: true` in its `.openspec.yaml`.

## How we build

A **product slice** is the smallest change that adds one increment of user-facing functionality. It is one `feat:`, `fix:` or breaking `feat!:` commit. Everything else is **chore work**: `chore:`, `refactor:`, `test:`, `docs:` and `ci:` commits, which bump nothing. Chore work sits beside the product slices or travels alone in its own pull request. A pull request of chore work only, such as a substantial refactor, may still carry a spec and its archive commit. Renames, moves and refactors that prepare the ground can stay inside a product slice or travel as chore work. Choose whichever reads more easily.

Size a slice for the person who reviews it: small enough to review well, large enough to mean something. There is no line count to hit. If your change grows past what a reviewer can take in, split it so that each part still adds something a user can notice. If a slice is too thin to mean anything to a user, fold it into the next one.

Before you write code, look at what already exists and reuse it. Extract duplication, but not at the cost of cohesion, readability or clean interfaces. Refactor with a reason: name the [rubric](QUALITY_RUBRIC.md) criterion the code fails, and make at most three refactor passes per slice. Do not refactor for taste, and do not overbuild.

### Tests that test something

Write the test first. It has to fail, and for the right reason, before any code exists. Start each slice with an integration test that covers the requirements, then add unit tests as the pieces appear. Cover the happy paths and the edge cases. Skip trivial tests, and any test that would still pass if the behavior broke.

Use [fast-check](https://fast-check.dev) for rules that hold for every input: round trips, ordering, bounds, "never throws". Use plain examples for named requirements and exact wording. Name the invariant in the test title and make the generators reach the edges: empty, zero, negative, huge, duplicates. A good property reads like this: "the ranking is sorted by cost for any list of models". When fast-check finds a counterexample, keep it as an example test, so the regression is named and permanent.

[Stryker](https://stryker-mutator.io) then checks the tests themselves. `pnpm mutation` breaks the code in small ways, say a `<` turned into `<=`, and expects a test to fail each time. A mutant that survives means no test would notice the bug. It is incremental, so it retests only what changed. The score must stay at or above the `break` threshold in `packages/cli/stryker.config.json`, and nobody lowers the threshold to make a run pass.

For each survivor:

- **Kill it** with a better test, often a property. If the invariant was too weak ("the result is in range" does not say which value), strengthen it or add an example.
- **Rewrite the code** if the mutant cannot change observable behavior, so that the mutant disappears.
- **Disable it** only if that rewrite hurts readability, with a comment that names the mutator and the reason: `// Stryker disable next-line EqualityOperator: equivalent because both branches return the same value`. Never use a bare `all`, and never disable a mutant to hide a missing test.
- **A mutant that no longer type-checks** counts as equivalent, because Stryker has no TypeScript checker. Disable it with "does not type-check" as the reason.

Do not write a test whose only purpose is to kill a mutant in a `console` call or in trivial code such as type declarations, re-exports, constant tables and thin wiring. Stryker skips most of those already.

The pinned `vitest` version stays until [stryker-js#6210](https://github.com/stryker-mutator/stryker-js/issues/6210) is fixed.

## Commits and versions

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). A commit-msg hook and CI both enforce it, and a pre-commit hook formats what you staged.

| Type                                              | Effect on the version         |
| ------------------------------------------------- | ----------------------------- |
| `fix:`                                            | patch                         |
| `feat:`                                           | minor                         |
| `feat!:`, `fix!:`, or a `BREAKING CHANGE:` footer | major (minor while below 1.0) |
| `docs:`, `chore:`, `ci:`, `test:`, `refactor:`    | none                          |

Pull requests are squash-merged. The pull request title becomes the one commit on `main`, and the title alone sets the version bump. It should carry the largest bump among the product slices inside. The squash description lists one line per squashed commit. Your branch commits still have to follow the format, because the hook and CI check them, and because the reviewer reads the history. A pull request whose changes all sit outside `packages/cli` bumps nothing, whatever its title says.

Never edit the version by hand, and never tag or release. [release-please](https://github.com/googleapis/release-please) reads the history, opens a release pull request, and bumps the version and the changelog. The maintainer merges that pull request, and the merge cuts the release. Product slices exist for review. A release is a human decision, and a title that bumps nothing ships nothing.

## Pull requests

- A pull request holds one or more product slices, any chore work, and the OpenSpec changes they deliver. Or it holds chore work only, and bumps nothing. There is no line limit. Size it for the reviewer, who can read the branch commit by commit.
- Give it a Conventional Commits title.
- Link the OpenSpec changes it implements, or say why it has none. Say whether they are archived yet.
- CI must pass: commit messages, the title, OpenSpec validation, formatting and lint, types, tests, mutation testing on the files you changed, and the docs build.
- Describe what changed for the user, and list anything you did not verify.
- Expect a review against the [quality rubric](QUALITY_RUBRIC.md). Findings come in three grades: must fix, should fix and nit. Only must-fix findings block a merge.

## Documentation

The user-facing docs live in `docs/` and are published to GitHub Pages when `main` changes. Preview them with `pnpm docs:dev`. Write in plain, concrete English with the `beautiful-prose` skill in `.agents/skills/beautiful-prose/`, using the settings in the "Writing" section of `AGENTS.md`.

## When something goes wrong

- **The commit is rejected.** `commitlint` names the rule you broke, usually a missing type or a subject that is empty or too long. Fix the message and commit again, or rewrite the last one with `git commit --amend`.
- **The pre-commit hook rewrote my files.** That is `lint-staged` formatting what you staged and adding the result to the commit. Review the diff and commit again.
- **`pnpm check` fails on formatting.** Run `pnpm format`, then check again.
- **`openspec validate` fails.** The usual causes are a requirement with no `#### Scenario:` header (exactly four hashes), a requirement statement over 500 characters, or a requirement that lacks SHALL or MUST.
- **A test needs the network.** It must not. Mock the call with `nock`, or use the local fake server in `packages/cli/test/fakeApi.ts`.
- **The Husky hook does not run.** Run `pnpm install` again. The `prepare` script installs the hooks.

## Questions and bugs

Open an issue. For a bug, say what you ran, what you expected and what happened. For an idea, describe the problem before the solution.
