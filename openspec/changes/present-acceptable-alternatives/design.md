# Design

## Context

Checks that need the snapshot read the case's `oracle` (a query and its parameters) and compare slugs found in the answer with the slugs the query returns: `wrongAnswer` and `topOfSearch` in `search.ts` and `searchChecks.ts`. A case declares what it needs in `metadata`, and `readCase` in `caseSpec.ts` fails loudly on a declaration it does not know or one of the wrong kind. The suite requires that every error class has a case in the core set (`config.test.ts`). The oracle has four queries: `cheapest-blended`, `cheapest-input`, `matching` and `within-budget`.

## Goals / Non-Goals

**Goals:**
- A check that says whether an answer presents enough of the acceptable alternatives, whatever its wording.
- A case where free and paid answers are both good.
- A declaration that other cases can reuse with other groups.

**Non-Goals:**
- Replacing `unstated-assumption`. It measures whether the answer says what it assumed, which this check does not. A calibrated rubric for it is a separate change.
- A rule about free models in the instructions. This case is the evidence first.
- Judging the quality or the order of the alternatives.

## Decisions

**Groups, not a flat list of slugs.** A group is a query with its parameters. An answer reaches a group when it names a slug that the query returns. A flat union would let three free models count as three alternatives. Groups say what the alternatives are, and a minimum of two means two different kinds.

**The minimum falls with empty groups.** If the catalog holds no free model that meets the constraints, a minimum of 2 out of 3 becomes 2 out of 2. The case would otherwise fail for a reason that has nothing to do with the answer. This is the rule that `wrong-answer` already follows, where an empty acceptable set passes.

**A new query, `free`.** It returns every model that meets the constraints with input and output price both 0. A free model has no "cheapest": they tie at 0, so any of them is acceptable. A model with a `null` price is left out, as `cheapest-blended` does.

**A new error class, `missing-alternative`, after `wrong-answer`.** Reusing `wrong-answer` would hide the difference between naming no acceptable model and naming too few. The class goes in the chain after `wrong-answer` and `phantom-match`, and a run that already failed on `wrong-search` is left to it. Alternative: reuse `wrong-answer` and skip the taxonomy change. It is cheaper, and the report would read worse.

**The case enters the core set.** The suite insists that every class has a core case. The core set grows to twelve cases. The cost is one more case per model on the core run.

**The question leaves free or paid unsaid.** "What is the cheapest model with at least 200,000 tokens of context that supports tools?" Declared filters: `min_context_length` 200000 and `supported_parameters` `tools`, so `wrong-search` guards the search itself.

**The case asks for two of three groups.** The groups are the free models, the cheapest paid by blend and the cheapest paid by input price, with a minimum of 2. An answer with a free model and a paid one passes, and so does an answer with two paid models that differ by price. Requiring a free model would make the case about free models only, and the user's question does not say free. A case that needs a free model declares a group set where it is the only way to reach the minimum.

**The declaration is validated at load.** An empty list of groups, a minimum below 1, or a group that names an unknown query fails loading, with the declaration named. This follows `readCase`.

## Risks / Trade-offs

- [A model answers with a free and a paid model by luck, or gives five models and reaches the groups by chance] → The groups are disjoint queries over the snapshot, so naming a slug of a group is a deliberate act, not a wording accident.
- [Groups that overlap, such as the cheapest paid by blend and by input naming the same model] → One model can reach two groups. The minimum then counts both. This is acceptable: the model is the answer to both questions. The design keeps it simple instead of demanding distinct models.
- [The free model of the matrix is rate-limited and the case fails for that reason] → The run already reports that as an error, not as `missing-alternative`.
- [The case is noisy at a small `repeat`] → It sits in the core set, which runs at `repeat` 10 in CI.

## Migration Plan

None. Roll back by reverting the commit.
