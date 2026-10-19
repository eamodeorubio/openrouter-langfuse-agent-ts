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
- **Claude Code settings:** `.claude/settings.json` is shared. It allows the repo's check scripts and read-only `git` and `openspec` commands, asks before `git commit` and `pnpm add`/`remove`, and denies `git push`, `git tag`, `git merge`, `gh pr merge` and reading `.env` files. Personal overrides go in `.claude/settings.local.json`, which is git-ignored.
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
- Versions follow [SemVer](https://semver.org/). `release-please` reads the commit history for `packages/cli` (commits that touch only other paths, such as `docs/`, never bump the version), opens a release PR, and bumps the version and changelog. Merging that PR (the user's job, never yours) creates the tag and the GitHub release. Do not edit the version by hand. Commits, reviews and releases run on separate clocks. A slice is a commit and exists for review. A release is a human decision made at the PR level, through the title: the PR scope decides which slices ship together, and the title decides the bump (a non-bumping title ships nothing). Release-please gathers bumping PRs into its release PR, and merging that cuts the version. A merged slice does not release on its own.
- Nothing is released yet. `packages/cli/package.json` and `.release-please-manifest.json` both say `0.0.0`, so the first `feat:` mints `v0.1.0` (and a `fix:` before any feature would mint `v0.0.1`). Never tag or release by hand: release-please creates the tag and the GitHub release when its release PR is merged, and tags have no component prefix (`v0.1.0`).
- `fix:` bumps the patch. `feat:` bumps the minor. A breaking change bumps the major: write `feat!:` (or `fix!:`) or add a `BREAKING CHANGE:` footer in the commit body. Below 1.0 the major bump becomes a minor bump.

## Spec-driven development

This repo uses [OpenSpec](https://github.com/Fission-AI/OpenSpec). Specs and change proposals live in `openspec/`.

- Spec first is mandatory. Any change to what the product does starts with an OpenSpec change, and no code is written before it exists. Propose it with `/opsx:propose` in Claude Code or the `openspec-propose` skill in other agents. Chores, refactors, tooling and docs fixes alter no behavior and need no OpenSpec change. `skip_specs: true` in a change's `.openspec.yaml` is only for a change that already exists but has no spec delta.
- Contributors follow the same flow and open an issue before starting work; see [CONTRIBUTING.md](CONTRIBUTING.md). Agents working for the maintainer start from the user's request and do not open issues.
- A spec change and a slice are independent. One spec change is delivered by one or more slices (commits), normally in one pull request (a soft limit), and a slice can exist with no spec change (see "Slices").
- The spec lands first, as a `docs:` commit in its own non-bumping, spec-only pull request that the user approves before implementation starts. The implementation pull request then holds the slices, and its last commit archives the change (`chore: archive <change-name>`).
- Skills for other agents are in `.agents/skills/`.

## How we work

These rules apply to every agent working in this repo. The quality yardstick is [QUALITY_RUBRIC.md](QUALITY_RUBRIC.md).

### Before writing code

- Check what already exists in the repo and reuse it when it is relevant or useful.
- Do not reinvent the wheel or duplicate code. Reuse existing code, or extract the duplication into a common utility. Never do this at the cost of cohesion, single responsibility, coupling, abstraction or readability. Do not refactor in ways that break the rubric.

### Test-driven development

- Always TDD: write a failing test, write the code that makes it pass, refactor if the code fails the rubric, then check again.
- A new test must fail first, and it must fail for the right reason.
- Tests cover the requirements: happy paths and edge cases. No trivial tests. No tests that pass without really testing anything.
- Start each slice with a failing integration test (in the wide sense) that covers the requirements. Then implement the pieces with failing unit tests where code is added. The integration test may stay red until the small pieces are done.

### Refactoring

- Use the rubric to decide when to refactor. No trivial refactors, no overengineering: weigh added complexity against quality gained.
- At most 3 refactor passes per slice.

### Checks

All code must be formatted, pass lint, compile, pass tests, and pass any other check or verification tool this repo has. Run them before calling a slice done. If a check is not configured yet, say so in the slice report.

### Slices

- A slice is the smallest code change that adds one increment of user-facing functionality.
- One slice is one `feat:`, `fix:` or breaking (`feat!:`) commit. A slice maps to a commit, not necesarily to a pull request. Supporting commits that bump nothing (`chore:`, `test:`, `docs:`, `refactor:`) sit beside the slices, and a reviewer can read the branch commit by commit: slice by slice, or chore by chore.
- A slice does not need a spec change, and a spec change does not need to be a single slice. A pull request that bumps the version holds one or more slices.
- Size a slice for the human reviewer. It must be small enough that a person can review it well without being overloaded, and large enough to be one meaningful, semantic increment. There is no numeric limit. Judge it case by case.
- If a slice is growing past what a person can review well, stop and tell the user. Propose how to split it, so that each part still adds something a user can notice. Do not quietly let it grow.
- If a slice is too thin to mean anything to a user, fold it into the next one.
- Mechanical changes (renames, moves, formatting) and refactors that prepare the ground may stay inside a slice's commit, go as their own commits in the same pull request, or go as their own pull request that bumps nothing. Choose whichever makes the work easier to review.
- Pull requests are OpenSpec-change granular. A bumping PR holds one or more slices plus any supporting commits, and should cover one OpenSpec change as a soft limit (part of one change is fine). Its title decides the bump and carries the largest bump among its slices. A non-bumping PR holds only commits that bump nothing: chores, refactors, docs, tooling, or a spec-only change. A chore or refactor has no OpenSpec change. Both kinds are sized by judgement for the reviewer, with no numeric limit.
- Do not start the next slice until the user approves the current one.
- If a slice changes how users use the product, update the human-facing docs, either in the slice commit or in a `docs:` commit in the same pull request.

### Review before done

After each slice, and before saying it is done, run the three agent reviewers on it. Each is read-only and reports findings classified **must fix**, **should fix** or **nit** (definitions in the rubric).

| Reviewer             | Looks at                                                                                                      | Cites                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `reviewer-code-high` | Architecture, design, package and module structure. Weighs single responsibility, cohesion and coupling most. | Files, packages, modules, design units |
| `reviewer-code-low`  | Code detail against the rubric.                                                                               | File and line                          |
| `reviewer-docs`      | Human-facing docs with the `beautiful-prose` skill: prose, global coherence, completeness.                    | File and line                          |

- Only **must fix** findings block the slice. Address the others where it makes sense.
- Tell the user which findings you did not address and why, and what you are unsure about.
- Work that is not a slice (a chore, a docs change, tooling, a spec-only PR) follows the same approval rule. Run the agent reviewers that fit the change: the docs reviewer for docs, the code reviewers for code. Skipping one for a pure tooling change needs the user's agreement. Give a short report instead of the full slice report.

The reviewer instructions live in `.agents/reviewers/` as plain Markdown, so any agent can use them: start a subagent (or a fresh session) with the file as its prompt, and give it read access to the repo. Claude Code finds them as subagents of the same names in `.claude/agents/`, which only point at those files. Edit the instructions in `.agents/reviewers/`, never in `.claude/agents/`.

### Slice report

Before saying a slice is done, give the user this report:

- Files changed, and how big the change is, so the human reviewer can judge the load
- Tests added (names) and their results
- Format, lint and typecheck results, with the commands used
- Checks left to CI
- Anything not verified
- Reviewer findings, and what you did with each
- Open questions

### Git

- Commit only after the user approves the slice. Never commit on your own.
- Never push. Pushing is the user's job.
- Use the semantic commit rules in "Commits and versions".
- Work on a branch named `type/short-name` (`feat/`, `fix/`, `docs/`, `chore/`, `ci/`, `test/`, `refactor/`), never on `main`.
- Propose the PR title and description to the user. The user pushes, opens and merges the PR. Never merge, tag or release.
- Pull requests are squash-merged. The PR title becomes the one commit on `main`, so it must be a Conventional Commit, and it alone sets the version bump. The squash description lists one line per commit squashed (GitHub's "pull request title and commit details" setting does this). Branch commits must still be Conventional Commits. CI lints the title.

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
