# Design

## Context

After `fix-retired-benchmark-indexes`, search entries hold one score, `intelligence_index`. The catalog API sorts and filters by each index. On 2026-11-27, of 219 models with Artificial Analysis scores, between 43 (cyber) and 148 (openness) had each new one, and 4 had a decision score.

## Goals / Non-Goals

**Goals:**

- The agent can rank by a field of work and read each score correctly.
- Prompt growth stays small.

**Non-Goals:**

- Floors on the new indexes.
- The decision index as a sort: it needs non-text output and covers 4 models.
- New eval cases, which would be separate `test:` work.

## Decisions

**Hints live in tool descriptions.** A legend inside each result would repeat in the history on every later round. A description is sent once per request and is there before the model chooses a sort. One list in the code holds name, meaning and scale, and both descriptions are built from it. The full legend sits on `get_model`; `sort` names its values and one naming rule, since both travel together.

**Sorts, no floors.** Nine floors would add nine described arguments to every request. A sort already puts the strongest models first, with their price beside the score. Floors can follow if answers show the need.

**One extra field per sorted search.** All indexes in every entry would cost about nine fields times up to 50 entries. The entry shows the score it was ranked by.

**Drop null scores from `get_model`.** Most are null for most models. The description states that absence means unscored.

**Keep only listed indexes.** A score the list does not name would reach the model with no meaning or scale. An index the API adds stays hidden until the list names it. This also drops the retired ones.

**The API ranks.** The new sorts pass through, like `intelligence-high-to-low`. No client-side sort.

## Risks / Trade-offs

- [Longer descriptions raise cost and may shift model behaviour] → The eval gate catches a regression on its core cases only. The one benchmark case, `search/best-legal`, is outside that set. The report states the size of the added text.
- [A ranked page is not a price comparison] → The entry carries both prices. Combining a score with a price sort is out of scope.
- [The index list drifts from the API] → A type check ties each sort to the SDK's accepted values.
