# Contributing

Thanks for wanting to help. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). The maintainer is the owner listed in [CODEOWNERS](.github/CODEOWNERS), who agrees the direction in issues and merges pull requests. This project is a small CLI that answers questions about OpenRouter and points people to the most cost-effective model for their use case. It stays small on purpose, and the rules below keep it that way.

Write the spec first when the change needs one, write the test first, keep each change small, and let the checks tell you when you are done.

## Set up

You need Node 26 (the version in `.nvmrc`) and [pnpm](https://pnpm.io). The exact pnpm version is pinned in `package.json`; with Corepack enabled, `corepack enable` picks it up for you.

```sh
pnpm install
pnpm check         # Biome and Prettier
pnpm format        # fix formatting
pnpm typecheck     # tsc --noEmit
pnpm test          # Vitest, with HTTP mocked by nock
pnpm test:watch    # rerun tests on every change
pnpm test:coverage # tests with a coverage report
pnpm build         # compile the CLI with tsc
pnpm docs:dev      # the documentation site, live
pnpm docs:build    # build it into docs/dist
pnpm docs:preview  # serve the built site (Ctrl+C stops it)
pnpm docs:preview:stop  # stop a detached preview server
```

Tests never touch the network. Mock HTTP with `nock`. To run the tool against real services, copy `.env.example` to `.env` and fill in your keys. Never commit `.env`. To report a security problem, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## Your first change, step by step

This is the whole path from idea to merged pull request. It is one pull request, with the spec inside it.

1. **Talk first.** Open an issue that describes the problem you want to solve. For a bug, say what you ran, what you expected and what happened. Wait for a maintainer to agree on the direction before you invest time. A trivial chore or a dependency update needs no issue.
2. **Branch.** Branch from `main`. The branch name is free; only the pull request title matters.
3. **Write the spec, if the change needs one.** See "Spec first" for when. A small fix or refactor needs none: go to step 5.
4. **Approve the spec before you build.** You review it, alone or with your agent, and approve it. It is the cheapest moment to change your mind. Link it in the issue if you want the maintainer's early view.
5. **Write a failing test.** Start with an integration test that covers the requirements, and watch it fail for the right reason.
6. **Make it pass, one piece at a time.** For each piece, write a failing unit test, then the code. Refactor only when the code falls short of the rubric.
7. **Update the docs** if users will use the product differently.
8. **Run the checks.** `pnpm check`, `pnpm typecheck` and `pnpm test` must all pass.
9. **Review your own work.** Read your diff against the [quality rubric](QUALITY_RUBRIC.md). If you use an AI agent, `.agents/reviewers/` holds the instructions for three read-only reviewers (`reviewer-code-high`, `reviewer-code-low` and `reviewer-docs`, described in [AGENTS.md](AGENTS.md)) that anyone can run. Fix every must-fix finding.
10. **Commit.** Write commit messages in the Conventional Commits form (see "Commits"). One product slice is one commit.
11. **Push and ask for review.** Give the pull request a Conventional Commits title (see "Commits"). Describe what changed for the user.
12. **Respond to review.** Push fixes to the same branch. Only must-fix findings block the merge.
13. **Archive the spec.** Once review fixes are in, archive the OpenSpec change in a last commit, `chore: archive <change-name>`, just before the merge. If you cannot, the merge is not blocked and the change is archived afterwards.

### What each kind of change needs

| Change                            | Spec | Failing test first            | Commit                         | Bump          |
| --------------------------------- | ---- | ----------------------------- | ------------------------------ | ------------- |
| New or changed behavior           | yes  | yes                           | `feat:` (`feat!:` if breaking) | minor (major) |
| Fix that needs a design decision  | yes  | yes                           | `fix:`                         | patch         |
| Small fix, no design decision     | no   | yes                           | `fix:`                         | patch         |
| Substantial refactor              | yes  | no, existing tests stay green | `refactor:`                    | none          |
| Small refactor                    | no   | no, existing tests stay green | `refactor:`                    | none          |
| Tests only                        | no   | no                            | `test:`                        | none          |
| Docs only                         | no   | no                            | `docs:`                        | none          |
| Tooling, CI, dependencies, chores | no   | no                            | `chore:`, `ci:`                | none          |

Steps 3 to 6 above apply as the row says. A technical decision worth remembering needs a spec whatever the row says. When two rows fit, take the stricter one: more required, such as a spec or a failing test. Output wording counts as behavior. The pull request title decides the real bump. Only the title reaches `main`; the branch commits matter for the commit-message check and for the reviewer reading the history. [AGENTS.md](AGENTS.md) adds which agent reviewers run on each row.

### Two worked examples

Both features below are invented to show the shape of the work. Neither is on the roadmap.

#### A feature with two specs

Say you want the tool to list the cheapest model for a given monthly token budget, and to export the ranking as CSV.

- **Issue.** "Let me ask for the cheapest model within a monthly budget, and export the result." A maintainer agrees.
- **Branch.** `budget-ranking`. The whole feature lives on it, spec included.
- **Specs.** Run `openspec new change budget-ranking`. The proposal names a new capability. The spec holds one requirement, "Rank models by monthly cost", with a decision table under its scenario: token mix and budget in, cheapest model out. A second requirement covers errors in a small table: unknown model, negative budget, missing prices. A second change, `csv-export`, specifies the export. Both pass `openspec validate --strict`, and you approve them before any code. A `docs: specify budget ranking and CSV export` commit may carry them, or they may ride along inside the first product slice. Either is fine.
- **Product slice 1, `feat:`.** A failing integration test asserts the ranking for three rows of the table. Unit tests drive the cost calculation and the sort. The code makes them pass. The docs gain a usage section. The commit is `feat: rank models by monthly cost`.
- **Product slice 2, `feat:`.** This product slice shows the cost breakdown per model, with its own failing tests first. Its commit is `feat: show the cost breakdown per model`.
- **Product slice 3, `feat:`.** This product slice exports the ranking as CSV. Its commit is `feat: export the ranking as CSV`.
- **Chore work.** Commits that bump nothing sit beside the product slices, such as `test: cover ties in ranking` or `docs: add budget ranking example`. A reviewer can read them one at a time.
- **Archive.** The last commits are `chore: archive budget-ranking` and `chore: archive csv-export`.

Two specs produced three product slices, delivered in one pull request. The title is `feat: rank models by monthly cost`, and it sets a minor version bump. The squash merge puts that title on `main` and lists every branch commit, one line each, in the description, so the CSV export is recorded there.

#### A small fix with no spec

Say the tool prints a price of `NaN` when a model has no completion price.

- **Issue.** "Show a clear message when a model has no completion price." A maintainer agrees.
- **Branch.** `missing-completion-price`. There is no OpenSpec change: it is a bug fix with no design decision worth remembering, so the pull request says so.
- **Product slice, `fix:`.** A failing test feeds the tool a model with no completion price and expects the message. A unit test pins the price formatter. The code makes both pass. The commit is `fix: report models with no completion price`.

The title is `fix: report models with no completion price`, and it sets a patch bump. The pull request has one product slice and no archive commit.

## Spec first

A change needs a spec, written with [OpenSpec](https://github.com/Fission-AI/OpenSpec), when it alters what the product does, makes a substantial refactor, or takes a technical decision worth remembering. A refactor is substantial when it changes the package layout, an interface other code depends on, or a design decision someone will ask about later. If unsure, ask in the issue before you start.

The spec comes before the code it covers and ships in the same pull request. There is no spec-only pull request. A pull request that adds or changes a capability without a spec will be sent back. A pull request normally holds one or two OpenSpec changes; split the work when a reviewer could not take it in.

1. Install the OpenSpec CLI at the version CI uses, with `pnpm add -g @fission-ai/openspec@1.14.3`, or run it ad hoc with `pnpm dlx @fission-ai/openspec@1.14.3 <command>`. Then read `openspec/config.yaml`. It holds the writing rules for each kind of artifact.
2. Propose the change: `openspec new change <name>`, or `/opsx:propose` if you work with Claude Code.
3. Fill in the proposal, the spec deltas, the design and the tasks. Requirements may use scenarios, tables, rules, invariants or examples. Pick the form that says the thing most clearly.
4. Run `openspec validate <name> --strict` until it passes.
5. Approve the spec yourself before you build. The pull request is not where it gets approved.
6. Implement the tasks as product slices on the same branch. Commit the spec on its own as `docs:` if that helps the reviewer, or let it ride along in another commit.
7. Once review fixes are in, make the last commit archive the change (`chore: archive <change-name>`). Do this before the merge when you can. If you cannot, the merge goes ahead and the change is archived afterwards in a `chore:` pull request.

Chores, tooling, dependency updates, docs fixes and small refactors need no spec. A small fix needs none either, but it is still a product slice. If an OpenSpec change already exists but has no spec delta, mark it with `skip_specs: true` in its `.openspec.yaml`.

## How we build

Work in small product slices. A product slice is the smallest change that adds one increment of user-facing functionality, and it is one `feat:`, `fix:` or breaking (`feat!:`) commit. Everything else is chore work: `chore:`, `refactor:`, `test:`, `docs:` and `ci:` commits, which bump nothing. Chore work sits beside the product slices, or alone in its own pull request. A pull request of chore work only, such as a substantial refactor, may still carry a spec and its archive commit. Renames, moves and refactors that prepare the ground can stay in a product slice's commit or travel as chore work of their own, whichever reads more easily.

Size a product slice for the person who will review it: small enough to review well, large enough to mean something. There is no line count to hit. If your change is growing past what a reviewer can take in, split it so each part still adds something a user can notice. A pull request holds the product slices that deliver its OpenSpec changes, so reviewers can go through it commit by commit.

- **Test first.** Write a failing test, make it pass, refactor if the code falls short of the [quality rubric](QUALITY_RUBRIC.md), and check again. The test must fail for the right reason before you write any code.
- **Start wide.** Begin each product slice with an integration test that covers the requirements, then add unit tests as the pieces appear.
- **Cover requirements.** Test the happy paths and the edge cases. Skip trivial tests and any test that would pass even if the behavior broke.
- **Reuse before you write.** Look for existing code first. Extract duplication, but not at the cost of cohesion, readability or clean interfaces.
- **Refactor with a reason.** Name the rubric criterion the code fails. Do not refactor for taste, and do not overbuild.
- **Update the docs.** If users will use the product differently, the docs change in the same product slice.

The same rules appear in more detail in [AGENTS.md](AGENTS.md), which AI coding agents read. They apply to people just as much.

## Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). A commit-msg hook and CI both enforce it. The table shows what each type does to the version when it is the pull request title.

| Type                                              | Effect on the version         |
| ------------------------------------------------- | ----------------------------- |
| `fix:`                                            | patch                         |
| `feat:`                                           | minor                         |
| `feat!:`, `fix!:`, or a `BREAKING CHANGE:` footer | major (minor while below 1.0) |
| `docs:`, `chore:`, `ci:`, `test:`, `refactor:`    | none                          |

Pull requests are squash-merged. The pull request title becomes the one commit on `main`, and the title alone sets the version bump. It should carry the largest bump among the product slices inside. The squash description lists one line per commit squashed. Your branch commits still have to follow the format, because the hook and CI check them. CI checks the title with the same rules and re-runs when you edit it.

Do not edit the version by hand. [release-please](https://github.com/googleapis/release-please) reads the history, opens a release pull request, and bumps the version and the changelog.

Product slices exist for review; releases are decided at the pull request. Its scope decides which product slices ship together, and its title decides the bump: a title that bumps nothing ships nothing. Release-please gathers the pull requests with product slices into its release pull request, and merging that one cuts the version. A pull request whose changes all sit outside `packages/cli` bumps nothing, whatever its title says.

## Pull requests

- Branch from `main`. A pull request holds one or more product slices, any chore work, and the OpenSpec changes they deliver. Or it holds chore work only, and bumps nothing. There is no line limit; size it for the reviewer, who can read the branch commit by commit.
- Give the pull request a Conventional Commits title (see "Commits").
- Link the OpenSpec changes it implements, or say why it has none (a small fix or refactor, for example). Say whether they are archived yet.
- CI must pass: commit messages, the pull request title, OpenSpec validation, formatting and lint, types, tests, and the docs build.
- Describe what changed for the user, and list anything you did not verify.
- Expect a review against the [quality rubric](QUALITY_RUBRIC.md). Findings come in three grades: must fix, should fix and nit. Only must-fix findings block a merge.

## Documentation

The user-facing docs live in `docs/` and are published to GitHub Pages when `main` changes. Preview them with `pnpm docs:dev`. Write in plain, concrete English, and follow the prose settings in the "Writing" section of `AGENTS.md`.

## When something goes wrong

- **The commit is rejected.** A hook runs `commitlint` on your message. Read its output: it names the rule you broke, usually a missing type or a subject that is empty or too long. Fix the message and commit again, or run `git commit --amend` to rewrite the last one.
- **The pre-commit hook rewrote my files.** That is `lint-staged` formatting what you staged and adding the result to the commit. Review the diff and commit again. If it reports an error it cannot fix, fix it by hand.
- **`pnpm check` fails on formatting.** Run `pnpm format`, then check again. Biome formats code and JSON, and Prettier formats Markdown and YAML.
- **`openspec validate` fails.** The usual causes are a requirement with no `#### Scenario:` header (exactly four hashes), a requirement statement over 500 characters, or a requirement that does not say SHALL or MUST.
- **A test needs the network.** It must not. Mock the call with `nock` so the test runs offline.
- **The Husky hook does not run.** Run `pnpm install` again. The `prepare` script installs the hooks.

## Questions and bugs

Open an issue. For a bug, say what you ran, what you expected and what happened. For an idea, describe the problem before the solution.
