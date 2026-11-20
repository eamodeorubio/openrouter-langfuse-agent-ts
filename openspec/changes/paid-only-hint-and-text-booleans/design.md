## Context

`SORT_DESCRIPTION` ends with: "For the cheapest model by one price the user names, sort by it and set limit to 1; add paid_only to skip free models. When the user states no usage, use a blended sort." The sentence about `paid_only` has no condition. A model reads it as a rule. Where the user's budget leaves only free models, a model that obeys it never sees one, since `paid_only` drops them before the first page. The model cannot tell afterwards: its search looks complete.

`flag` in `lenientArgs.ts` is a union of `z.boolean()` and `z.enum(['true', 'false'])`, then a transform. `"True"` fails the enum.

## Goals / Non-Goals

**Goals:**
- A model uses `paid_only` when the user asks for a paid model, and not otherwise.
- A boolean sent as text is read whatever its letter case.
- The fix reads the same for any question and any model.

**Non-Goals:**
- Naming a case, a question or a model in any description, instruction or code. A fix tuned to the evals would pass them and say nothing about the product.
- Changing the instructions. They hold no advice on `paid_only`.
- Trimming spaces from boolean text. Numbers are trimmed and booleans are not, as in 1.2.1. A model that sends `" true"` gets the error.
- Changing any eval case or check. See the proposal.

## Decisions

**The condition is a single sentence, in two places.** The `sort` description ends with: "For the cheapest model by one price the user names, sort by it and set limit to 1. Add paid_only only when the user asks for a paid model; when they do not, a free model is a valid answer, so leave it out." The `paid_only` description gains the same rule after what the filter does. The model reads the first while it picks a sort and the second while it fills the argument. Both say the same, and a test pins the pair so one cannot drift. Alternative: put it in the instructions. The instructions never mention the argument, and a rule about one argument belongs with the argument.

**The sentence states the user's condition, not the case.** "The user asks for a paid model" covers "paid", "not free" and "no free tier". It does not mention budgets, since a budget is a reason to prefer a free model, not a reason to filter it out; the model decides that from the question.

**`flag` compares lower-cased text.** The union becomes `z.boolean()` or `z.string()`, then a transform that lower-cases the text and accepts `true` or `false`, and otherwise raises the existing error with the value shown. `String.prototype.toLowerCase` and an equality test do the work. A regular expression with the `i` flag is out: with the `u` flag, case folding maps `ſ` (long s) to `s`, and `"falſe"` would read as `false`. A test pins `"falſe"` as refused.

**The error message stays.** `must be true or false, sent as a boolean or as the text "true" or "false"; got "yes".` is still true and still tells the model what to send. A model that sent `"Yes"` is told to send `true` or `false`, and that is the fix it needs. The message does not list letter cases, which would only teach the wrong habit.

**The schema loses the enum.** An enum of `"true"` and `"false"` cannot list every case, so the schema offers `boolean | string`. The description carries the rule: `FLAG_NOTE` becomes `true or false, as a boolean or as the text "true" or "false" in any letter case.` A provider that validated the enum before the call no longer rejects `"yes"`; the tool does, with the message above.

**One reader for both booleans.** `paid_only` and `zero_data_retention` already share `flag`, so the change is made once.

## Risks / Trade-offs

- [A model that asks for the cheapest model and states no payment now may get a free model first, where 1.2.1 told it to skip them] → That is the intent: a free model is the cheapest, and the answer says so. The sorts that put free models first stay, and the cases that ask for a paid model still say "paid", so the filter still applies. The verification checks it by the tool calls.
- [A model ignores the conditional, as it ignored nothing before] → The wording is the most a description can do. The tool calls of the 1.2.2 run are the evidence, not the pass counts.
- [`boolean | string` is a wider type than the old enum] → The tool is the validator, and it states the rule in its error.

## Verification

A pass count at n = 10 is noisy: one case moved by up to 4 of 10 between two runs of one version. The evidence for the hint is the tool calls. The plan is in `tasks.md`, after the release, and the user starts each run.

## Open Questions

None.
