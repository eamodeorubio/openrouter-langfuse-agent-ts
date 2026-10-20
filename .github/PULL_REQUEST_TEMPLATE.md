## What changed for the user

<!-- Describe the change as a user would notice it. -->

## Links

- Issue: closes #
- OpenSpec changes: <!-- names and whether archived, or say why there are none -->

## Checklist

- [ ] The title follows Conventional Commits (it becomes the commit on `main` and sets the version bump)
- [ ] The spec came first and passes `openspec validate --strict`, or this is a small fix, a small refactor, or a chore, docs or tooling change that needs none
- [ ] The OpenSpec changes are archived in the last commit, or I say below why not
- [ ] For behavior changes and fixes, tests came first and cover the requirements, including edge cases; for refactors, tests, docs and chores, existing tests stay green
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass
- [ ] The human-facing docs are updated if users will use the product differently
- [ ] I reviewed my diff against `QUALITY_RUBRIC.md`

## Not verified

<!-- List anything you did not check. -->
