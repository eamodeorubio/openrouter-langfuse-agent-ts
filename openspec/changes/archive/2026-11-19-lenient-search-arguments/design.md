# Design

## Context

`searchModels.ts` validated its arguments with zod. A number was `z.number()` and a boolean `z.boolean()`, so a model that sent `"true"` or `"200000"` got zod's default message, `Invalid input: expected boolean, received string`, which names no value to send. Nemotron sent `paid_only: "true"`, read that message, and searched again without the filter. The tool offered `paid_only` as a boolean in its JSON schema, so a model that follows the schema to the letter sent what the schema said and still failed in practice.

The evals read the arguments of a run too. One check, `carries`, compares a required number with the number the call sent, and a string never matched. Every other check reads a slug or the sort, both text.

## Goals / Non-Goals

**Goals:**
- A weaker model that sends text for a number or a boolean gets the call it meant.
- A value the tool cannot read gets an error that says what to send.
- The checks judge the run by what the tool accepts, not by a stricter rule.

**Non-Goals:**
- Reading `"True"`, `"yes"`, `1` or `"1,000"`. The tool reads two boolean texts and plain decimal numbers, and refuses the rest with a message that says so.
- Coercion for `get_model` and `calculate`. They take only strings.
- Sharing code between the CLI and the evals package. The evals judge the built CLI from outside.

## Decisions

**One module reads the loose types.** `lenientArgs.ts` holds `flag`, `numeric` and `NUMERIC_NOTE`. `searchModels.ts` keeps the tool and its argument list. The next tool with a number will import the same readers.

**`numeric(what, accepts)` validates by predicate.** It takes a number or a string, reads the text with one regular expression (`^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$`, after trimming), and refuses what is not finite. A value that is not a number, not numeric text, or fails `accepts` gets one error: `must be <what>; got <value>.` The phrase `what` and the predicate are written together at the argument, so the message states the rule the predicate applies. Alternative: `z.coerce.number()`. It reads `""` as 0, `true` as 1 and `"0x10"` as 16, and its error names no value.

**The pipe is a union and a transform, not a preprocess.** A zod `preprocess` hides its input type from the JSON schema. A union of `number` and `string`, then a transform, shows `number | string` to the model. The range moves from the schema into the predicate, so the schema no longer carries `minimum` and `maximum`. Every range stays in the description and in the error.

**`flag` accepts exactly four values.** `true`, `false`, `"true"`, `"false"`. The model that sends `"True"` gets `must be true or false, sent as a boolean or as the text "true" or "false"; got "True".` One more spelling is one more thing to document, and the error costs one round.

**Each description says text works.** Thirteen numeric descriptions end with `A number; numeric text such as "3" is read as one.` It repeats, because a model reads the description of the argument it fills in and not the tool description. The two boolean descriptions open with `true or false, as a boolean or as the text "true" or "false"`, then say what `true`, `false` and absence do. The `paid_only` text changes from a sentence that starts with `true drops…` to labelled halves.

**`carries` reads a required number the way the tool does.** `numberOf` in the evals package repeats the tool's rule: a finite number, or text of the same shape. The two copies can drift, as the copy of `isPaid` can. Each package tests its copy on examples of the same kinds: padded text, exponents, hex, an empty string and a number too large to hold.

**The top-of-search check skips unpaid models for a paid question.** A model that does not send `paid_only` gets free models first, and the check read that as the right answer. The check now takes the first paid model when the question holds `paid model` or `paid models`. The rule of `paid` is the tool's: both prices are numbers and one is above 0. The pattern is a heuristic on the question, as the case set writes questions in that form.

## Risks / Trade-offs

- [The schema loses `minimum` and `maximum`, so a provider that validates the schema before the call no longer rejects `limit: 99`] → The tool rejects it, with a message that names the range.
- [A union of `number` and `string` renders as `anyOf` or a type list, which some providers handle badly] → The description says the same in words. One smoke run of the core set with Nemotron called the tool correctly with it.
- [The reader of text and the check of the evals can drift] → Both are tested on the same examples.
- [The question pattern misses "non-free model"] → The check then judges as before, and a case that needs it can name a paid model.

## Migration Plan

None. Every call that was valid stays valid. Roll back by reverting the commit.

## Open Questions

- None.
