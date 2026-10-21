# openrouter-langfuse-agent-ts

A small TypeScript CLI that answers users' questions about OpenRouter, specialized in helping them discover which model is the most cost-effective for their use case.

The agent will be instrumented with Langfuse.

The stack, scripts and CI are in `package.json`, the config files and `.github/workflows/`. The quality yardstick is [QUALITY_RUBRIC.md](QUALITY_RUBRIC.md). The contributor process (issues, branches, PR rules, commit and version rules) is in [CONTRIBUTING.md](CONTRIBUTING.md). "The user" means the human the agent works for, maintainer or contributor alike.

## Constraints

These bind every spec, design and implementation.

- Tests never reach the public network. Mock HTTP with `nock`. Where a test must cancel, cut or stall a response stream, use a real server on `127.0.0.1` instead (`packages/cli/test/fakeApi.ts`): `nock`'s mock sockets cannot survive a cancel, and the failures they cause are intermittent.
- API keys come from the environment (see `.env.example`). Never log them, print them, commit them, or send them to Langfuse in traces or metadata. Never read or print `.env` contents.
- Use pnpm, never npm or yarn.
- Validate untrusted input (arguments, environment, API responses) at the boundary, with clear error messages.
- Results go to stdout. Diagnostics and errors go to stderr. A failed run exits non-zero.
- The `openspec` CLI is not in `package.json`. CI pins `@fission-ai/openspec@1.14.3`; install that version (`pnpm add -g @fission-ai/openspec@1.14.3`) or run it with `pnpm dlx`.
- Docs scripts: Astro detaches the preview server into the background in agent sessions, and `pnpm docs:preview:stop` stops it.
- `vitest` and `@vitest/coverage-v8` stay pinned until [stryker-js#6210](https://github.com/stryker-mutator/stryker-js/issues/6210) is fixed. Stryker has no TypeScript checker (it does not support TypeScript 7), so a mutant that no longer compiles can survive.

## Spec-driven development

This repo uses [OpenSpec](https://github.com/Fission-AI/OpenSpec). Specs and change proposals live in `openspec/`.

- **When a spec is needed.** The change alters user-facing functionality, makes a substantial refactor, or takes a technical decision we want to remember. A refactor is substantial when it changes the package layout, an interface other code depends on, or a design decision someone will ask about later. If unsure, ask.
- **Writing it.** The spec exists before the code it covers. Propose it with `/opsx:propose` in Claude Code or the `openspec-propose` skill in other agents.
- **Approving it.** The user reviews and approves the spec locally, in the dev session, before implementation starts. The pull request is not where the spec gets approved.
- **Delivering it.** The spec ships in the same pull request as the code. There is no spec-only pull request.
- **Archiving it.** Archive each change with `chore: archive <change-name>`, ideally as the last commit before merge, once the user has approved it. This is a preference, not a gate.
- **Issues.** Agents start from the user's request and do not open issues.

Skills for other agents are in `.agents/skills/`.

## How we work

### Change types

Find the row that fits the change. When two rows fit, take the stricter one (more required: a spec, a failing test, more reviewers). If unsure, ask.

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

A technical decision we want to remember needs a spec whatever the row says. Output wording counts as behavior, so a typo in it is a small fix. A dependency update that fixes a runtime security issue is a `fix:`. A revert takes the type of what it reverts. The first three rows are product slices; the rest are chore work. The PR title decides the real bump (see CONTRIBUTING.md).

### The path through any row

1. Spec, if the row says yes: write it and wait for the user to approve it before any code.
2. Build, test first if the row says so (see "Test-driven development"). Refactor only where the rubric calls for it, at most 3 passes per product slice.
3. Update the human-facing docs if usage changes, run `pnpm check`, `pnpm typecheck` and `pnpm test`, run the row's reviewers and fix every must-fix finding.
4. Give the report (full or short) and wait for the user's approval. That approval is the only gate: it approves the work and its commit, so commit once it is given. Never commit before it, and never on your own. The next product slice starts only after this approval.
5. At the end of the PR, archive each OpenSpec change as the last commit, once the user has approved it.

### Test-driven development

- Always TDD for behavior: write a failing test, write the code that makes it pass, refactor if the code fails the rubric, then check again. A new test must fail first, and for the right reason.
- Start each product slice with a failing integration test (in the wide sense) that covers the requirements. Then implement the pieces with failing unit tests. The integration test may stay red until the small pieces are done.
- Tests cover the requirements: happy paths and edge cases. No trivial tests. No tests that pass without really testing anything.
- Use property tests (`fast-check`) for invariants: round trips, idempotence, ordering, bounds, monotonicity, "never throws on any input". Use example tests for named requirements, exact output wording and specific error cases. A property test states the invariant in its name, uses generators that reach the edge cases (empty, zero, negative, huge, duplicates), and stays offline and fast. When `fast-check` finds a counterexample, keep it as an explicit example test.

### Mutation testing

- Run `pnpm mutation` whenever you change `src/` logic. The score must stay at or above the `break` threshold in `stryker.config.json`. Do not lower `thresholds` to make a run pass. CI runs it too, but its result arrives after the PR is opened, so run it first and report the result.
- Read every survivor. Kill it with a better test, often a property test. If the invariant was too weak, strengthen it or add an example.
- Equivalent mutants (a change that cannot alter observable behavior): first try to rewrite the code so the mutant is gone. Only if that harms readability, disable it with `// Stryker disable next-line <MutatorName>: equivalent because <reason>`. Never use a bare `all`, and never disable a mutant to hide a missing test. A survivor that no longer type-checks counts as equivalent: give "does not type-check" as the reason.
- Do not write tests whose only purpose is to kill a mutant in `console` calls or trivial code (declarations, re-exports, constant tables, thin wiring).

### Product slices

- A product slice is the smallest code change that adds one increment of user-facing functionality: one `feat:`, `fix:` or `feat!:` commit. Everything else is chore work, which bumps nothing and sits beside the product slices in the same PR or alone.
- Size a product slice for the human reviewer. If it is growing past what a person can review well, stop and tell the user, and propose how to split it so each part still adds something a user can notice. If it is too thin to mean anything to a user, fold it into the next one.
- Before writing code, check what already exists and reuse it, unless that costs cohesion, single responsibility, coupling, abstraction or readability.

### Review before done

Run the reviewers its row names. Each is read-only and reports findings classified **must fix**, **should fix** or **nit** (definitions in the rubric). Only **must fix** blocks the change. Tell the user which findings you did not address and why, and what you are unsure about. Skipping a reviewer needs the user's agreement. The instructions live in `.agents/reviewers/`; edit them there, never in `.claude/agents/`.

### Reports

A **full** report (product slices) lists:

- Files changed, and how big the change is
- Tests added (names) and their results
- Format, lint and typecheck results, with the commands used
- Mutation score, the survivors and what was done with each
- Checks left to CI
- Anything not verified
- Reviewer findings, and what you did with each
- Open questions

A **short** report (chore work) lists the files changed, the checks and their results, the reviewer findings and what was not verified.

### Git

- Work on a branch, never on `main`.
- Commits follow Conventional Commits. Do not edit the version by hand.
- Push a feature branch and open or edit a pull request only with the user's permission, asked every time. Propose the PR title and description first. Never force-push, push to `main`, push tags, merge, tag or release.
- The PR title becomes the one squash commit on `main` and alone sets the bump, the largest among its product slices.

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
