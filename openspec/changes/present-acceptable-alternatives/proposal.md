## Why

A question like "what is the cheapest model with 200,000 tokens of context and tool calling?" has more than one good answer. A free model is the cheapest of all. The cheapest paid model is the one most users can build on. The cheapest by input price and the cheapest by output price differ again. An answer that names only one of them hides the others.

No eval case measures that. `search/cheapest-blended` accepts one set of paid models, and `search/single-search` accepts the first row of one search. Haiku already tends to give both a free and a paid answer, but nothing records it, and nothing would catch a later change to the instructions that hides free models. The case also gives us the evidence we lacked when we considered a rule about free models.

## What Changes

- A new oracle query `free` returns every free model that meets the constraints.
- A case can declare `alternatives`: a minimum and a list of groups, each a query with its parameters. The answer must name an acceptable model from at least that many groups.
- A new check and error class, `missing-alternative`, fails a run whose answer names acceptable models from fewer groups than the minimum. The check compares slugs, not wording.
- A new case, `search/alternatives`, asks for the cheapest model with 200,000 tokens of context and tool support, and does not say free or paid. Its groups are the free models, the cheapest paid by blend, and the cheapest paid by input price, with a minimum of 2.
- The core set grows from eleven to twelve cases, because the suite requires a core case for every error class.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `eval-oracle`: a new query, `free`.
- `eval-checks`: a new requirement, "Acceptable alternatives"; "Cases and sets" gains the case and its row in the table.

## Impact

- `packages/evals/src/oracle/queries.ts`: the `free` query.
- `packages/evals/src/checks/`: the check, its registration, the declaration in `caseSpec.ts`.
- `packages/evals/cases/search.yaml`: one case. `packages/evals/test/`: tests for the query, the check, the declaration and the case.
- `packages/evals/README.md` and `docs/src/content/docs/evals.md`: the class, the case and the counts (eleven becomes twelve).
- No change to the CLI or the product. A run of the core set costs one more case per model.
