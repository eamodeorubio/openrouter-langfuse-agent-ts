# Tasks

One product slice: the conditional `paid_only` advice and text booleans in any letter case. Commit `fix:`, released as 1.2.2. Bump: patch. Row: fix that needs a design decision, so a spec, a failing test first, all three reviewers, a full report. It ships in one pull request with `rejudge-eval-runs`, whose slice (`test:`) comes first.

Pull request title: `fix: advise paid_only only for a paid question and read text booleans in any case`. It is proposed to the user, who decides whether to push and open it.

Rules that hold for every task: no description, instruction or code names an eval case, a question or a model id. No eval case or check changes. If a check turns out to need a change, stop and tell the user: it goes in its own pull request, with a re-judge of the baselines first.

## 1. Product slice: conditional advice and boolean case

- [x] 1.1 Write the failing integration test through the registry: a call with `paid_only: "True"` and a price sort drops free models, as `true` does, and a call with `zero_data_retention: "False"` sends no `zdr`. Covers: Numbers and booleans may be sent as text.
- [x] 1.2 Write the failing tests of the boolean reader:
  - example table: each accepted and each refused value of "Boolean text", including `"falſe"`, `" true"` and `null`.
  - property: any per-character case variant of `"true"` reads `true` and of `"false"` reads `false`; the result equals the boolean's.
  - property: any string whose lower-cased form is neither `true` nor `false` is refused, with the message that shows it.
  - property: the reader never throws on any value.
  - the exact error for `"Yes"`. Covers: Boolean text, Refused booleans keep the error, Case does not change the call.
- [x] 1.3 Write the failing schema tests: the `sort` and `paid_only` descriptions state the condition (user asks for a paid model; otherwise a free model is valid); the text `add paid_only to skip free models` is absent; every sentence of the tool description, the argument descriptions and the system message that mentions `paid_only` is conditional; the descriptions of both boolean arguments say any letter case; no description or message holds a case id or a model slug. Covers: Advice on paid_only is conditional.
- [x] 1.4 Run the new tests and verify each fails for the right reason: the old sentence, and `"True"` refused.
- [x] 1.5 Implement: `flag` over `z.boolean()` and `z.string()` with a lower-cased comparison and the existing error; `FLAG_NOTE` says any letter case; reword the last sentence of `SORT_DESCRIPTION` and the `paid_only` description. Verify: the tests of 1.1 to 1.3 pass.
- [x] 1.6 Update `docs/src/content/docs/tools.md`: the `paid_only` row (use it when the user asks for a paid model) and the paragraph on text values (boolean text in any letter case; the refusals that remain). Verify: `docs.test.ts` passes, and the text agrees with the schema.
- [x] 1.7 Run `pnpm check`, `pnpm typecheck` and `pnpm test`. Run `pnpm mutation`; the score stays at or above the `break` threshold. Read every survivor, and kill it with a test, or rewrite the code, or disable it with a reason.
- [x] 1.8 Run `reviewer-code-high`, `reviewer-code-low` and `reviewer-docs`. Fix every must-fix finding.
- [ ] 1.9 Write the full report. Wait for the user's approval, which also approves the commit. Commit `fix: advise paid_only only for a paid question and read text booleans in any case`.

## 2. Archive

- [ ] 2.1 Run `/opsx:verify` on `paid-only-hint-and-text-booleans` and fix what it finds.
- [ ] 2.2 Archive as its own commit, `chore: archive paid-only-hint-and-text-booleans`, once the user has approved it. It is the last commit before merge.

## Verification after the release

These steps follow the merge and the release of 1.2.2. The user triggers every eval run; the agent does not. They are plain steps, not tracked tasks, since they cannot finish before the archive.

1. Re-judge the baselines with the checks on `main`: `rejudge` of `44247364171` (1.2.0) and of `44691387152` (1.2.1). Keep both `rejudged/` directories. Every later comparison uses these, never the saved verdicts.
2. The user starts the full run of 1.2.2: set `full`, repeat 10, `k` 1,3,5, `cli_version` 1.2.2, both models.
3. Compare 1.2.2 with both re-judged runs, all judged by the same checks:
   - **Mechanism first.** In `recommendation/flagship-affordability` and `recommendation/budget-chatbot`, count the runs whose searches sent `paid_only: true`, from the tool calls in `results.json`. Expected: 0. Pass counts at n = 10 are noisy, so the tool calls are the evidence.
   - **Must hold.** `search/cheapest-input`, `search/cheapest-blended` and `search/single-search` stay at 10 of 10 for both models. Their questions ask for a paid model, so `paid_only` still applies.
   - **Rejected calls.** 0 for both models, apart from the expected not-found errors of `discipline/unknown-model`.
   - **No regression.** Flag a case whose pass count is 3 or more below the lower of its two baselines, and run it once more before any conclusion. Compare cost and tool rounds per run too.
4. If a check proves to need a change, stop. It goes in its own pull request, with a re-judge of the baselines first.
5. Report the comparison to the user, with the counts and the tool calls that carry the conclusion.
