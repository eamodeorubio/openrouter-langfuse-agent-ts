# Design

## Context

Five checks of `packages/evals/src/checks/` judged correct answers wrong in the run of 1.1.0. See proposal.md for the count. Each judges text with a rule that is too coarse. The fixes narrow or widen those rules. No check changes its class or its place in the precedence.

## Goals / Non-Goals

**Goals:**
- No correct answer from the 1.1.0 run fails a check it should pass.
- No answer that failed rightly starts to pass: a price stated for the unknown model, a recovery that never happened, a missing statement about the router, an answer that names a model the search did not list.

**Non-Goals:**
- Rerunning 1.1.0. The zip keeps the verdicts of the old checks.
- The `~` of alias slugs. The catalog lists `~anthropic/claude-haiku-latest`. An answer that writes `anthropic/claude-haiku-latest` names a slug OpenRouter does not know, and `invented-data` is right to say so.
- Changes to the agent. The failures that are the agent's own, such as `search/cheapest-input`, stay.

## Decisions

**A price counts when it follows the unknown slug.** The check looks at the text after each mention of the unknown slug, up to the next model slug, and asks whether that text states a price. A price in a later sentence counts, because "I could not find it. It would cost about $2" is the shape of an invention. A price written before the slug is not read as its price. Alternatives: look at the sentence alone, which misses that shape; or only forbid dollar figures within a fixed number of characters, which is arbitrary. An answer that never names the slug is read sentence by sentence: a price before any other model counts. A full stop after `e.g.`, `i.e.`, `approx.`, `vs.`, `etc.` or `ca.` ends no sentence. The costs are a missed price written before the slug ("$2 for `openai/gpt-9`"), and a price that follows the slug with no model between, though it belongs to something else, such as "$1 for any model of that family". The rubric `judge-grounding` reads the answer too, and catches the first.

**The correction counts from the round of the failed lookup.** `recovered` compares with `>=` and not `>`. The model sends both lookups in one step; neither can use the other's result, and it sent the right one. A correction read in an earlier round than the failure still fails: the run did not recover from anything.

**A ladder of words for "no price".** Two patterns. One allows up to two words, joined by spaces or hyphens, between a negation with a kind (`no published`) and a price word. The other allows a verb of stating, an article and up to two words between a negation and `price` or `pricing`, and leaves out `cost` and `rate`, which are too common: "does not offer a rate limit" says nothing of price. That takes in `no published per-token price`, `does not list a per-token price` and `doesn't publish a fixed price`, and keeps out "it routes requests quickly", which the existing tests hold. Alternative: ask a judge. It costs a request for each run, and the check is meant to be deterministic.

**A tie is the same pair of prices.** The first search lists models in the server's order. `topOfSearch` accepts the answer when it names the first or any model of that output with the same input price and output price. It reads the prices from the output of the first search, as it reads the first id today. A model the output does not list never ties. Alternative: accept any model that the oracle accepts. That would hide a search that sorted wrongly.

**`no single model` and `no one model` join the no-match list.** The existing `no model` does not match them, because a word stands between. Alternative: allow any word. It would match "no, models differ".

## Risks / Trade-offs

- Wider patterns can let a wrong answer pass. Each new pattern has a test for the wording it must still refuse.
- The window of the price check is a heuristic. A model that writes the price in a table cell after the slug is caught; one that writes it in a separate sentence about the model is not.
