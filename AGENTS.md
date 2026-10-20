# openrouter-langfuse-agent-ts

A small TypeScript CLI that answers users' questions about OpenRouter, specialized in helping them discover which model is the most cost-effective for their use case.

The agent will be instrumented with Langfuse.

## Stack

- **Package manager:** `pnpm` (workspace: the CLI in `packages/cli/`, the docs site in `docs/`, and the repo tooling at the root). Never use npm or yarn.
- **Language:** TypeScript (latest) on Node 26 (see `.nvmrc`), ESM, strict mode.
- **Format and lint:** `biome` (config in `biome.json`) for TypeScript, JavaScript and JSON. `prettier` (config in `.prettierrc.json`) only for Markdown and YAML. Each file type has one owner. Indentation, line endings and charset come from `.editorconfig`, which both tools read. `.gitattributes` forces LF line endings in Git.
- **Tests:** `vitest`, in `packages/cli/test/`. Mock HTTP with `nock`; tests must not hit the network.
- **Running TypeScript:** `tsx`.
- **Docs:** Starlight (Astro) in `docs/`, published to GitHub Pages by `.github/workflows/docs.yml` when `main` changes.
- **CI:** GitHub Actions in `.github/workflows/`: Biome check, commit message and PR title lint, OpenSpec validation, typecheck, tests, build and docs build on every push and PR, with the pnpm store cached. On `main`, once the checks pass, the same workflow runs `release-please`.
- **Security:** `.github/workflows/security.yml` runs CodeQL, dependency review (PRs) and gitleaks. Secrets live in `.env` (git-ignored); `.env.example` lists the variables. Never commit keys.
- **Claude Code settings:** `.claude/settings.json` is shared. It allows the repo's check scripts and read-only `git` and `openspec` commands, asks before `git commit`, `git push`, `gh pr create`, `gh pr edit` and `pnpm add`/`remove`, and denies force pushes, pushes to `main`, `git tag`, `git merge`, `gh pr merge` and reading `.env` files. Personal overrides go in `.claude/settings.local.json`, which is git-ignored.
- **Dependencies:** Dependabot updates npm (root and `docs/`) and Actions weekly.

## Engineering constraints

These bind every spec, design and implementation.

- Tests never touch the network. Mock HTTP with `nock`.
- API keys come from the environment (see `.env.example`). Never log them, print them, commit them, or send them to Langfuse in traces or metadata.
- Validate untrusted input (arguments, environment, API responses) at the boundary, with clear error messages.
- Results go to stdout. Diagnostics and errors go to stderr. A failed run exits non-zero.
- Where the CLI loads `.env` from is decided in the first spec. Never read or print `.env` contents while working on the repo.

## Commands

- `pnpm dev`: run the CLI with `tsx`.
- The `openspec` CLI is a prerequisite and is not in `package.json`. CI pins `@fission-ai/openspec@1.14.3`; install that version (`pnpm add -g @fission-ai/openspec@1.14.3`) or run it with `pnpm dlx`.
- `pnpm check`: Biome format, lint and import-order check, plus the Prettier check for Markdown and YAML (what CI runs). `pnpm lint` lints only.
- `pnpm format`: apply Biome and Prettier formatting. `pnpm format:check` only checks formatting.
- `pnpm typecheck`: `tsc --noEmit`.
- `pnpm test`: run tests once. `pnpm test:watch` watches. `pnpm test:coverage` reports coverage.
- `pnpm build`: compile `packages/cli/src/` to `packages/cli/dist/` with `tsc`.
- `pnpm docs:dev`: serve the docs site with live reload (add `-- --open` to open the browser). `pnpm docs:build`: build it into `docs/dist`. `pnpm docs:preview`: serve the built site, so run `docs:build` first. In a terminal it runs in the foreground and Ctrl+C stops it. Astro detaches the server into the background when it detects an agent session (for example `AI_AGENT` or `CLAUDECODE` is set) or has no terminal, and `pnpm docs:preview:stop` stops it. The docs scripts use `pnpm --dir docs`, not `--filter`, because `--filter` prints `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` on Ctrl+C.

## Commits and versions

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`, `test:`, `refactor:`). A husky hook and CI enforce this with commitlint. A husky pre-commit hook runs `lint-staged`, which formats and lints staged files (Biome for code and JSON, Prettier for Markdown and YAML) and re-stages them.
- Versions follow [SemVer](https://semver.org/). `release-please` reads the commit history for `packages/cli` (commits that touch only other paths, such as `docs/`, never bump the version), opens a release PR, and bumps the version and changelog. Merging that PR (a human's job, never yours) creates the tag and the GitHub release. Do not edit the version by hand. A product slice is a commit that exists for review; a release is a human decision made through the PR title, so a merged product slice does not release on its own.
- Nothing is released yet. `packages/cli/package.json` and `.release-please-manifest.json` both say `0.0.0`, so the first `feat:` mints `v0.1.0` (and a `fix:` before any feature would mint `v0.0.1`). Never tag or release by hand: release-please creates the tag and the GitHub release when its release PR is merged, and tags have no component prefix (`v0.1.0`).
- `fix:` bumps the patch. `feat:` bumps the minor. A breaking change bumps the major: write `feat!:` (or `fix!:`) or add a `BREAKING CHANGE:` footer in the commit body. Below 1.0 the major bump becomes a minor bump.

## Spec-driven development

This repo uses [OpenSpec](https://github.com/Fission-AI/OpenSpec). Specs and change proposals live in `openspec/`.

- **When a spec is needed.** The change alters user-facing functionality, makes a substantial refactor, or takes a technical decision we want to remember. A refactor is substantial when it changes the package layout, an interface other code depends on, or a design decision someone will ask about later; otherwise it is small. If unsure, ask. A small fix (one that needs no design decision), a small refactor, a chore, tooling and a docs fix need no spec.
- **Writing it.** The spec exists before the code it covers. Propose it with `/opsx:propose` in Claude Code or the `openspec-propose` skill in other agents. `skip_specs: true` in a change's `.openspec.yaml` is only for a change that already exists but has no spec delta.
- **Approving it.** The user reviews and approves the spec locally, in the dev session, before implementation starts. The pull request is not where the spec gets approved.
- **Delivering it.** The spec ships in the same pull request as the code, so there is no spec-only pull request. A `docs:` commit for the spec is optional; it may also land inside the first product slice or in a chore-work commit. A pull request with product slices normally holds one or two OpenSpec changes. A pull request of chore work only, such as a substantial refactor, may carry its spec too.
- **Archiving it.** Archiving moves the finished change out of `openspec/changes/` and folds its spec into `openspec/specs/`. Archive each change with `chore: archive <change-name>`, ideally as the last commit before merge, and commit it once the user has approved it. This is a preference, not a gate (see "Change types").
- **Issues.** Issues are where humans agree the direction with the maintainer before starting work; see [CONTRIBUTING.md](CONTRIBUTING.md). Agents start from the user's request and do not open issues.

Skills for other agents are in `.agents/skills/`.

## How we work

These rules apply to every agent working in this repo. The quality yardstick is [QUALITY_RUBRIC.md](QUALITY_RUBRIC.md). "The user" means the human the agent works for, maintainer or contributor alike.

### Change types

Find the row that fits the change. It tells you what to do. When two rows fit, take the stricter one. If unsure, ask.

| Change                            | Spec | Failing test first            | Reviewers           | Commit                         | Bump          | Report |
| --------------------------------- | ---- | ----------------------------- | ------------------- | ------------------------------ | ------------- | ------ |
| New or changed behavior           | yes  | yes                           | all three           | `feat:` (`feat!:` if breaking) | minor (major) | full   |
| Fix that needs a design decision  | yes  | yes                           | all three           | `fix:`                         | patch         | full   |
| Small fix, no design decision     | no   | yes                           | all three           | `fix:`                         | patch         | full   |
| Substantial refactor              | yes  | no, existing tests stay green | both code reviewers | `refactor:`                    | none          | short  |
| Small refactor                    | no   | no, existing tests stay green | both code reviewers | `refactor:`                    | none          | short  |
| Tests only                        | no   | no                            | `reviewer-code-low` | `test:`                        | none          | short  |
| Docs only                         | no   | no                            | `reviewer-docs`     | `docs:`                        | none          | short  |
| Tooling, CI, dependencies, chores | no   | no                            | `reviewer-code-low` | `chore:`, `ci:`                | none          | short  |

A technical decision we want to remember needs a spec whatever the row says. "Stricter" means more required: a spec, a failing test, more reviewers. Output wording counts as behavior, so a typo in it is a small fix. A dependency update that fixes a runtime security issue is a `fix:`. A revert takes the type of what it reverts. The first three rows are product slices; the rest are chore work. A change that alters behavior is a product slice, never chore work. The bump column is the version change a commit would cause on its own, and only changes under `packages/cli` can bump at all; the PR title decides the real bump (see "Git").

The path through any row:

1. Spec, if the row says yes: write it and wait for the user to approve it before any code.
2. Build: test first if the row says so, and refactor only where the rubric calls for it (at most 3 passes).
3. Update the human-facing docs if usage changes, run the checks, run the row's reviewers and fix every must-fix finding.
4. Give the report (full or short, see below) and wait for the user's approval. That approval is the only gate: it approves the work and its commit, so commit once it is given. The next product slice starts only after this approval.
5. At the end of the PR: archive each OpenSpec change as the last commit, `chore: archive <change-name>`, once the user has approved it. If that cannot happen before the merge, the PR merges anyway and the change is archived afterwards in a `chore:` PR. Push and open the PR only with the user's permission. The agent never merges.

### Before writing code

- Check what already exists in the repo and reuse it when it is relevant or useful.
- Do not reinvent the wheel or duplicate code. Reuse existing code, or extract the duplication into a common utility. Never do this at the cost of cohesion, single responsibility, coupling, abstraction or readability. Do not refactor in ways that break the rubric.

### Test-driven development

- Always TDD for behavior (see "Change types" for what is exempt): write a failing test, write the code that makes it pass, refactor if the code fails the rubric, then check again.
- A new test must fail first, and it must fail for the right reason.
- Tests cover the requirements: happy paths and edge cases. No trivial tests. No tests that pass without really testing anything.
- Start each product slice with a failing integration test (in the wide sense) that covers the requirements. Then implement the pieces with failing unit tests where code is added. The integration test may stay red until the small pieces are done.

### Refactoring

- Use the rubric to decide when to refactor. No trivial refactors, no overengineering: weigh added complexity against quality gained.
- At most 3 refactor passes per product slice.

### Checks

All code must be formatted, pass lint, compile, pass tests, and pass any other check or verification tool this repo has. Run them before calling a product slice done. If a check is not configured yet, say so in the product slice report.

### Product slices

- A product slice is the smallest code change that adds one increment of user-facing functionality. It is one `feat:`, `fix:` or breaking (`feat!:`) commit. A small fix is a product slice, with or without a spec.
- Everything else is **chore work**: `chore:`, `refactor:`, `test:`, `docs:` and `ci:` commits, which bump nothing. Chore work sits beside the product slices in the same pull request, or alone in its own pull request. Mechanical changes (renames, moves, formatting) and refactors that prepare the ground may also stay inside a product slice's commit. Choose whichever makes the work easier to review.
- A pull request with product slices holds one or more of them plus any chore work. A pull request of chore work only bumps nothing. The PR title sets the bump (see "Git").
- Size a product slice and a pull request for the human reviewer: small enough to review well, large enough to be one meaningful increment. There is no numeric limit. If a product slice is growing past what a person can review well, stop and tell the user, and propose how to split it so that each part still adds something a user can notice. Do not quietly let it grow. If a product slice is too thin to mean anything to a user, fold it into the next one.
- If a product slice changes how users use the product, update the human-facing docs, either in the product slice commit or in a `docs:` commit in the same pull request.

### Review before done

After each change, and before saying it is done, run the reviewers its row in "Change types" names. Each is read-only and reports findings classified **must fix**, **should fix** or **nit** (definitions in the rubric).

| Reviewer             | Looks at                                                                                                      | Cites                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `reviewer-code-high` | Architecture, design, package and module structure. Weighs single responsibility, cohesion and coupling most. | Files, packages, modules, design units |
| `reviewer-code-low`  | Code detail against the rubric.                                                                               | File and line                          |
| `reviewer-docs`      | Human-facing docs with the `beautiful-prose` skill: prose, global coherence, completeness.                    | File and line                          |

- Only **must fix** findings block the change. Address the others where it makes sense.
- Tell the user which findings you did not address and why, and what you are unsure about.
- Chore work gets a short report instead of the full product slice report: the files changed, the checks and their results, the reviewer findings and what was not verified. Skipping a reviewer the row names needs the user's agreement.

The reviewer instructions live in `.agents/reviewers/` as plain Markdown, so any agent can use them: start a subagent (or a fresh session) with the file as its prompt, and give it read access to the repo. Claude Code finds them as subagents of the same names in `.claude/agents/`, which only point at those files. Edit the instructions in `.agents/reviewers/`, never in `.claude/agents/`.

### Product slice report

Before saying a product slice is done, give the user this report:

- Files changed, and how big the change is, so the human reviewer can judge the load
- Tests added (names) and their results
- Format, lint and typecheck results, with the commands used
- Checks left to CI
- Anything not verified
- Reviewer findings, and what you did with each
- Open questions

### Git

- Approval and commit are one gate. The user's approval of a report (full or short) approves the commit, with no second prompt. An archive commit is approved the same way, when the user okays archiving. Never commit before that approval, and never on your own.
- You may push a feature branch and open a pull request, but only with the user's permission, and ask first every time. Never push to `main`, never force-push, and never push tags.
- Use the semantic commit rules in "Commits and versions".
- Work on a branch, never on `main`. The branch name is free; only the PR title matters.
- Propose the PR title and description to the user. With the user's permission you may push the branch and open or edit the PR with `gh pr create` or `gh pr edit`. Never merge, tag or release.
- Pull requests are squash-merged. The PR title becomes the one commit on `main`, so it must be a Conventional Commit, and it alone sets the version bump, the largest among its product slices. The squash description lists one line per commit squashed (GitHub's "pull request title and commit details" setting does this). Branch commits must still be Conventional Commits. CI lints the title.

### When uncertain

Ask.

## Writing

Write human-facing docs (README, guides, and similar) with the `beautiful-prose` skill in `.agents/skills/beautiful-prose/`, using these settings:

```
REGISTER: journalistic
DENSITY: standard
HEAT: warm
LENGTH: long
```

Headings and bullets are fine in docs where they help the reader. The skill's other rules still apply.

Spec artifacts have their own settings in `openspec/config.yaml`. They are deliberately terser than the human docs: cold steel for requirements and tasks, a cool journalistic voice for proposals and designs.
