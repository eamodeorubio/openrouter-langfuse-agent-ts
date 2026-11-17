# Design

## Context

`instructions.ts` holds the system message: the job, units, tools before memory, arithmetic with the calculator, parallel lookups, brevity. One rule there already asks the model to compare prices against how the user will use the model and to say which assumption it made. It says nothing about a question that gives no usage. `instructions.test.ts` pins each rule with a pattern and forbids tool names.

The `sort` description in `searchModels.ts` ends with "For the cheapest model by one price, sort by it and set limit to 1". In the local run, a model that read "cheapest" with no usage took that sentence as an order to search each price. See proposal.md for the case.

## Goals / Non-Goals

**Goals:**
- One search, one stated assumption, for a question that names no usage.
- A rule general enough to cover any "cheapest" or "best value" question, not only the eval case.

**Non-Goals:**
- A code path that picks the sort. The model chooses; the instructions steer.
- Changing the case `search/single-search`. It stays the measure.
- Teaching the model other search strategies. This change adds one.

## Decisions

**The strategy goes in the instructions.** What to do with an open question is strategy, and the instructions are where the repository already puts strategy (units, arithmetic, parallel calls). The tool description says what each sort does. Alternative: only the tool description. A model that never reads a sort description in detail would still search twice, and a description cannot say "state your assumption".

**The default mix is three input tokens for every output token.** It is the tool's own default for a blended sort and the oracle's default for `cheapest-blended`, so the three agree. A chat workload reads more than it writes. The rule says the user's own ratio wins.

**One price alone is a stated exception.** The rule names the case where input or output is the real cost, so a model asked about a long prompt does not blend by reflex.

**The wording is general, not tied to the case.** The draft: "A question about the cheapest model that says nothing about usage has no single answer, because models differ in their input and output prices. Rank by a blend of both, three input tokens for every output token unless the user says otherwise, and say which mix you assumed. When one price alone matters, such as input for a long prompt, rank by that price alone." It names no tool. The exact words may change while the tests are written; the spec's scenarios fix the meaning.

**The `sort` description gains one sentence.** "When the user states no usage, use blended-price-low-to-high or blended-price-high-to-low; the default mix is 3." The number comes from the exported `DEFAULT_MIX`, which moved to `priceSort.ts` so that the tool, its description and a test of the instructions share it. The sentence repeats the rule where the model chooses a sort. Duplication costs a sentence and reinforces the choice at the point of use.

## Risks / Trade-offs

- [A model blends when the user wanted the cheapest to read] → The rule names the one-price exception, and the answer states the mix, so the user can correct it.
- [The rule does not stop the second search] → The eval is the check. A core run of `search/single-search` shows it. If Haiku still searches twice, the wording is tuned again.
- [The system message grows] → One sentence, about thirty words. The cost per request is small.
- [The instructions repeat the default mix, which lives in the tool] → The instructions cannot name the tool, so a test ties the number in their words to the exported default. A change of the default fails it.
- [A stated mix of three misleads a user who writes far more than they read] → The answer shows the assumption, and the user's ratio overrides it.

## Migration Plan

None. Roll back by reverting the commit.
