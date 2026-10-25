# Design

## Context

`ask` builds the outcome of each round in one place, a `finally` that hands `GenerationResult` to the generation. The same function decides a few lines later whether the response was the answer: no tool calls and some text. The tracer writes the metadata of a generation in `succeeded` and `failed` (`tracing/langfuse.ts`). See proposal.md for why a reader needs the flag.

## Goals / Non-Goals

**Goals:**
- One boolean, set in the one place that knows what the answer is.
- A flag a filter can use on either value.

**Non-Goals:**
- A flag on the root, the tools or the events. The root already holds the answer as its output.
- Flags for other roles, such as "the first generation" or "a generation that called a tool".
- A change to what the user sees on stdout or stderr.

## Decisions

**A boolean in the metadata of the generation, named `final_answer`.** Metadata is where Langfuse keeps run-specific values, and it takes a filter. Alternatives: a tag, rejected because tags are fixed when the observation is made and the loop does not know a round is the last until its response is read; a separate observation or a level, which are for other things; the root, which the user did not ask for and which cannot say which generation did it.

**`false` on the others, not absent.** With the key absent, a filter on `final_answer = false` finds nothing, and "the generations that are not answers" is as useful a question as the other. The cost is one key on each generation. Langfuse JS/TS v6 stores a metadata value as JSON text and, for now, as a string in the table, so the filter is on `true` and `false` as text. Checked against a real project: the API filter on the metadata key returned the one `true` generation, and the two `false` ones for the other value.

**The flag is computed where the outcome is built, from what the response held.** In `ask.ts` the outcome gains `final: isAnswer(response)`, where `isAnswer` is true for a response with no tool calls and some text. The same predicate ends the run with an answer, so the flag and the loop cannot drift apart; the checks for usage come after it. So a response whose text was written but whose usage is missing is `true` while the run fails with exit 2: its text reached the user, which is what the flag says. The scenario records it. The tracer writes the value; it decides nothing.

**A generation that never got a response is `false`.** The default outcome of a round that is cut short, or whose request failed, holds no `final`, and the tracer writes `false` for an absent value.

## Risks / Trade-offs

- [The flag is a string in the table today] → The scenarios and the guide name the filter in terms that survive a native boolean.
- [A key on every generation, true or not] → It is one short key; the alternative, absence, makes half the question unanswerable.
- [The `trace-content` main spec is not on `main` yet] → The change is stacked on pull request #23 and is not pushed before the merge.

## Open Questions

- Rounds that hold only tool calls get no first-token event and no time to first token (two of three generations in the first real run). Counting the first chunk of a tool call would fill the gap, but it changes *Stream events*, so it needs its own decision.
