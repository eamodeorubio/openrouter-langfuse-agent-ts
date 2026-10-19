# Contributing

Thanks for wanting to help. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). This project is a small CLI that answers questions about OpenRouter and points people to the most cost-effective model for their use case. It stays small on purpose, and the rules below keep it that way.

Write the spec first, write the test first, keep each change small, and let the checks tell you when you are done.

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

This is the whole path from idea to merged pull request.

1. **Talk first.** Open an issue that describes the problem you want to solve. For a bug, say what you ran, what you expected and what happened. Wait for a maintainer to agree on the direction before you invest time.
2. **Branch.** Branch from `main` with a prefix that matches the kind of change: `feat/`, `fix/`, `docs/`, `chore/`, `ci/`, `test/` or `refactor/`. Nothing else about the name matters.
3. **Write the spec.** If the change alters what the product does, create an OpenSpec change and get it validated (see "Spec first"). If it alters no behavior, skip to step 5.
4. **Open a pull request with the spec.** Wait for approval of the spec before you build it. This is the cheapest moment to change your mind.
5. **Write a failing test.** Start with an integration test that covers the requirements, and watch it fail for the right reason.
6. **Make it pass, one piece at a time.** For each piece, write a failing unit test, then the code. Refactor only when the code falls short of the rubric.
7. **Update the docs** if users will use the product differently.
8. **Run the checks.** `pnpm check`, `pnpm typecheck` and `pnpm test` must all pass.
9. **Review your own work.** Read your diff against the [quality rubric](QUALITY_RUBRIC.md). If you use an AI agent, `.agents/reviewers/` holds the instructions for three read-only reviewers (`reviewer-code-high`, `reviewer-code-low` and `reviewer-docs`, described in [AGENTS.md](AGENTS.md)) that anyone can run. Fix every must-fix finding.
10. **Commit.** Write commit messages in the Conventional Commits form (see "Commits").
11. **Push and ask for review.** Give the pull request a Conventional Commits title (see "Commits"). Describe what changed for the user.
12. **Respond to review.** Push fixes to the same branch. Only must-fix findings block the merge.

### A worked example

The feature below is invented to show the shape of the work. It is not on the roadmap.

Say you want the tool to list the cheapest model for a given monthly token budget.

- **Issue.** "Let me ask for the cheapest model within a monthly budget." A maintainer agrees.
- **Spec.** Branch `docs/budget-ranking-spec`. Run `openspec new change budget-ranking`. The proposal names a new capability. The spec holds one requirement, "Rank models by monthly cost", with a decision table under its scenario: token mix and budget in, cheapest model out. Another requirement covers errors in a small table: unknown model, negative budget, missing prices. `openspec validate budget-ranking --strict` passes, and the spec pull request, titled `docs: specify budget ranking`, is approved. It holds no slice and bumps nothing.
- **Slice 1, `feat:`.** The implementation pull request is on branch `feat/budget-ranking` and delivers the whole spec as two slices, each its own commit. A failing integration test asserts the ranking for three rows of the table. Unit tests drive the cost calculation and the sort. The code makes them pass. The docs gain a usage section. The commit is `feat: rank models by monthly cost`.
- **Slice 2, `feat:`.** This slice shows the cost breakdown per model, with its own failing tests first. Its commit is `feat: show the cost breakdown per model`.
- **Supporting commits.** The branch may also carry commits that bump nothing, next to the slice commits, such as `test: cover ties in ranking` or `docs: add budget ranking example`. They are separate commits on the branch, so a reviewer can read them one at a time.

One spec produced two slices, delivered in one pull request. The title is `feat: rank models by monthly cost`, and it sets a minor version bump. The squash merge puts that title on `main` and lists every branch commit, one line each, in the description. The spec pull request before it held no slice and bumped nothing.

## Spec first

Every change to what the product does starts with a spec, written with [OpenSpec](https://github.com/Fission-AI/OpenSpec). Code comes after the spec, never before it. A pull request that changes behavior without a matching spec change will be sent back.

1. Install the OpenSpec CLI at the version CI uses, with `pnpm add -g @fission-ai/openspec@1.14.3`, or run it ad hoc with `pnpm dlx @fission-ai/openspec@1.14.3 <command>`. Then read `openspec/config.yaml`. It holds the writing rules for each kind of artifact.
2. Propose the change: `openspec new change <name>`, or `/opsx:propose` if you work with Claude Code.
3. Fill in the proposal, the spec deltas, the design and the tasks. Requirements may use scenarios, tables, rules, invariants or examples. Pick the form that says the thing most clearly.
4. Run `openspec validate <name> --strict` until it passes.
5. Open the pull request with the spec first. Discuss and approve the spec before you build it.
6. Implement the tasks in a second pull request, as slices. Make its last commit archive the change (`chore: archive <change-name>`).

Some changes alter no behavior: a refactor, tooling, dependency updates, or a fix to the docs. They need no spec delta. Mark the change with `skip_specs: true` in its `.openspec.yaml`, or skip the change entirely for trivial chores. If you are unsure which side your change falls on, ask in the issue before you start.

## How we build

Work in small slices. A slice is the smallest change that adds one increment of user-facing functionality. Size it for the person who will review it: small enough to review well, large enough to mean something. There is no line count to hit. If your change is growing past what a reviewer can take in, split it so each part still adds something a user can notice. Renames, moves and refactors that prepare the ground can stay in the slice or travel as their own commits that bump nothing, whichever reads more easily. A slice is one `feat:`, `fix:` or breaking (`feat!:`) commit. It maps to a commit, not to a pull request, and supporting `chore:`, `test:` or `docs:` commits sit beside it. A pull request holds the slices that deliver one OpenSpec change, so reviewers can go through it commit by commit.

- **Test first.** Write a failing test, make it pass, refactor if the code falls short of the [quality rubric](QUALITY_RUBRIC.md), and check again. The test must fail for the right reason before you write any code.
- **Start wide.** Begin each slice with an integration test that covers the requirements, then add unit tests as the pieces appear.
- **Cover requirements.** Test the happy paths and the edge cases. Skip trivial tests and any test that would pass even if the behavior broke.
- **Reuse before you write.** Look for existing code first. Extract duplication, but not at the cost of cohesion, readability or clean interfaces.
- **Refactor with a reason.** Name the rubric criterion the code fails. Do not refactor for taste, and do not overbuild.
- **Update the docs.** If users will use the product differently, the docs change in the same slice.

The same rules appear in more detail in [AGENTS.md](AGENTS.md), which AI coding agents read. They apply to people just as much.

## Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). A commit-msg hook and CI both enforce it. The table shows what each type does to the version when it is the pull request title.

| Type                                              | Effect on the version         |
| ------------------------------------------------- | ----------------------------- |
| `fix:`                                            | patch                         |
| `feat:`                                           | minor                         |
| `feat!:`, `fix!:`, or a `BREAKING CHANGE:` footer | major (minor while below 1.0) |
| `docs:`, `chore:`, `ci:`, `test:`, `refactor:`    | none                          |

Pull requests are squash-merged. The pull request title becomes the one commit on `main`, and the title alone sets the version bump. It should carry the largest bump among the slices inside. The squash description lists one line per commit squashed. Your branch commits still have to follow the format, because the hook and CI check them. Keep the title in the same form: `feat: rank models by monthly cost`. CI checks the title with the same rules and re-runs when you edit it.

Do not edit the version by hand. [release-please](https://github.com/googleapis/release-please) reads the history, opens a release pull request, and bumps the version and the changelog.

Slices exist for review. Releases are decided at the pull request, through its title. The scope of the pull request decides which slices ship together. The title decides what the pull request does to the version: a `fix:`, `feat:` or breaking title puts its slices into the next release with that bump, and a title that bumps nothing ships nothing. Release-please gathers the bumping pull requests into its release pull request, and merging that one cuts the version. A pull request whose changes all sit outside `packages/cli` bumps nothing, whatever its title says.

## Pull requests

- Branch from `main` with the type prefix from step 2 of "Your first change". Pull requests follow the size of one OpenSpec change. A pull request that bumps the version holds one or more slices (`feat:`, `fix:` or breaking commits) plus any supporting commits, and should cover one OpenSpec change as a soft limit. Its title decides the bump. A pull request that bumps nothing (a chore, refactor, docs change or a spec-only change) has no slice, and a chore or refactor has no OpenSpec change. There is no line limit; size it for the reviewer, who can read the branch commit by commit.
- Give the pull request a Conventional Commits title (see "Commits").
- Link the OpenSpec change it implements, or say why it has none (a chore or refactor, for example).
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
