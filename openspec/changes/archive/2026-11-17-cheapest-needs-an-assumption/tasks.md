# Tasks

One product slice: an assumption for "cheapest" questions that give no usage. Commit `feat:`. It goes on the open pull request, whose title and minor bump it keeps. If the user wants it apart, the pull request title is `feat: assume a blended price for open cheapest questions`, bump minor. Reviewers: all three.

## 1. Product slice: the rule and the description

- [x] 1.1 Write the failing tests in `instructions.test.ts`: the message tells the model to rank an open "cheapest" question by a blend at three input tokens for every output token, to say which mix it assumed, and to rank by one price alone when only that price matters; it still names no tool. Covers: Cheapest without a usage, One price alone, No tool named.
- [x] 1.2 Write the failing test in `searchModels.price.test.ts`: the description of `sort` names the blended sorts as the choice when the user states no usage, and gives the default mix 3. Covers: Sort when the user gives no usage.
- [x] 1.3 Add the rule to `instructions.ts`, in the words of the design, and make 1.1 pass.
- [x] 1.4 Add the sentence to the description of `sort` in `searchModels.ts`, and make 1.2 pass.
- [x] 1.5 Update `docs/src/content/docs/tools.md`, "Sorting by price", with what the model does when the user gives no usage, and say in the docs for the instructions, if one exists, that the rule is there. Check that no doc contradicts it.
- [x] 1.6 Run `pnpm check`, `pnpm typecheck` and `pnpm test`. Run `pnpm mutation` on the changed files and read every survivor. The two edits are constant strings, so a survivor in them needs no test of its own.
- [x] 1.7 Run `reviewer-code-high`, `reviewer-code-low` and `reviewer-docs`. Fix every must-fix finding.
- [x] 1.8 Run the core set against the branch (the user starts it in GitHub, with the free model left out until its stall is understood). Read `search/single-search`: one search, a blended sort, a stated mix. Report the result and tune the wording if it still searches twice.
- [x] 1.9 Write the full report. Wait for the user's approval, which also approves the commit. Commit. Push to the open pull request only with the user's permission.

## 2. Archive

- [x] 2.1 Run `/opsx:verify` on `cheapest-needs-an-assumption`, and fix what it finds.
- [x] 2.2 Archive the change as its own commit, `chore: archive cheapest-needs-an-assumption`, once the user has approved it.
