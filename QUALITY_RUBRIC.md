# Quality rubric

The single yardstick for writing, refactoring and reviewing code in this repo. Implementers use it to decide when to refactor. Reviewers use it to grade a change (a product slice or chore work).

## Criteria

1. **Correctness.** The code behaves as the requirements say, and tests prove it.
2. **Test coverage of requirements.** Tests cover the happy paths and the edge cases. No trivial tests. No test that passes without really testing anything: each one must fail when the behavior it guards breaks. Where a rule holds for every input, a property test pins it, and surviving mutants are either killed or justified as equivalent.
3. **Readability.** Code and names are easy to understand and easy to review.
4. **Single responsibility.** Each function, class and package has one responsibility at its own level.
5. **High cohesion.** Code that changes together sits together. Code for the same responsibility sits together.
6. **Low coupling.** Code with different responsibilities depends on each other as little as possible.
7. **No leaky abstractions.** Implementation details do not show up in the interface.
8. **Fail clearly and safely.** Untrusted input is validated at the boundary. Errors carry a clear message and are handled in one place.
9. **Safe and secure.** No insecure practices: no secrets in code or logs, no unchecked input reaching a shell, file path, URL or query.

## Using it to decide on refactors

- Refactor only when the code fails a criterion above. Name the criterion.
- No trivial refactors and no overengineering. Weigh the complexity a change adds against the quality it buys.
- Reuse existing code and extract duplication into shared utilities, but never at the cost of cohesion, single responsibility, coupling, abstraction or readability. A refactor that breaks the rubric is not allowed, even to remove duplication.
- At most 3 refactor passes per product slice.

## Severity

Reviewers classify every finding as one of:

- **must fix:** violates a criterion in a way that blocks the change (wrong behavior, missing requirement test, security flaw, broken boundary).
- **should fix:** a real weakness that should be addressed unless there is a stated reason not to.
- **nit:** minor taste or polish. Optional.

Only **must fix** findings block a change.
