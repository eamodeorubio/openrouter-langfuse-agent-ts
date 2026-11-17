# Design

## Context

`searchModels.ts` maps its arguments one to one onto `client.models.list` and shapes one page. The `sort` enum is a copy of the API's. The SDK says `pricing-low-to-high` orders by "average prompt/completion price", and the eval snapshot agrees: sorting 316 matching models by input plus output reproduces the order the models saw. The API has no sort by one price.

The eval cases show what the tool must allow. `cheapest-input` and `image-input` want the lowest input price among paid models. `cheapest-blended` wants a 3:1 weighted price. `single-search` asks for "the cheapest model" with no mix and checks that the answer is the top row of one sorted search. `none-exists` and `count` use only filters. The oracle calls a model paid when the price in question is above 0, and counts a model with a `null` price as not paid. In the snapshot, 470 models: 8 have no price, 17 cost nothing on input, 2 charge for input and not for output, none charges for output and not for input.

## Goals / Non-Goals

**Goals:**
- A price sort that does what its name says, for input, output and a blend.
- One request set per question, not one per page.
- A tool contract that every eval case can satisfy.

**Non-Goals:**
- Reliable API sorts other than pricing. They stay as they are until a case shows one failing.
- Serving the API filters from a cached catalog. The filters stay on the server.
- Changing the instructions.

## Decisions

**Price sorts are values of `sort`.** `input-price-low-to-high` and five more, next to the API's values. One argument, so a call cannot ask for two orders. A separate `sort_by_price` argument would need a rule for the call that sets both. The two `pricing-*` values leave the enum, because a model that sees them will pick them.

**A blended sort takes `input_per_output`, default 3.** The oracle's own default is 3, and the model in `cheapest-blended` states its mix in words. A call with no mix gets the 3:1 price, which is also the answer to "cheapest model" with no usage given. `single-search` moves to `blended-price-low-to-high`. Alternative: a plain average (mix 1). It matches the old API order, but no eval case wants it, and output tokens are the smaller share in most chat workloads.

**`paid_only` is a flag, not an epsilon on `min_prompt_price`.** A bound at `0.000001` would work for input only, reads as a trick, and would not cover a blended or output sort. The flag drops models whose two prices are both 0 or which have a `null` price, which is the oracle's rule for a blended price. The oracle's `cheapest-input` asks for an input price above 0. The two differ only for a model that is free on input and not on output, and the snapshot has none. The flag is refused without a price sort, because without one the tool does not see the whole list, and `total` could not be right.

**Missing prices come last in both directions.** The API does the same for scores ("models without a score come last"). A model with no price never wins a cheapest or a dearest question. Ties break by `id`, so a page is the same on every call.

**The cache is keyed by the API filters.** The key is every argument that goes to the API, minus `sort`, `limit` and `offset`. A price-sorted call fetches the matches 1000 at a time, the API's maximum, and stores the list in a map on the tool context for the run. Today's catalog fits in one request. The CLI answers one question and exits, so the map needs no expiry and no size bound beyond the page cap. A rejected fetch is not stored. A fetch past 5 pages (5,000 models, ten times today's catalog) returns a message asking the model to narrow the filters.
Alternative considered: cache the whole catalog once and filter it in the tool. That needs the tool to reimplement every API filter, with its exact semantics, and the user asked to leave it out for now. This design keeps that door open: the cache holds a list of models, whatever its key.

**The instructions stay as they are.** "Ask for what you need, with the filters and sort order a tool offers" is true again. A line that warns about price sorts would describe a sort the model cannot pick. `instructions.test.ts` keeps its rule that no tool name appears in them.

**Descriptions state meaning, values and compatibility.** The model reads only the schema and its descriptions, and a zod enum cannot describe its values one by one. So the description of `sort` carries the list. The draft, to be tuned against the eval:

- `sort`: "How to order the results. Orders the API applies: most-popular, top-weekly, newest (creation date), context-high-to-low, throughput-high-to-low, latency-low-to-high, intelligence-high-to-low, coding-high-to-low, agentic-high-to-low, design-arena-elo-high-to-low. Models without a score come last. Orders this tool applies over every match: input-price-low-to-high and input-price-high-to-low (input price), output-price-low-to-high and output-price-high-to-low (output price), blended-price-low-to-high and blended-price-high-to-low (input and output weighted by input_per_output). Prices are USD per million tokens. A free model has price 0 and comes first in a low-to-high order; a model with no price comes last. Equal prices come in id order. For the cheapest model by one price, sort by it and set limit to 1."
- `input_per_output`: "Input tokens for each output token, above 0, default 3. Only for blended-price-low-to-high and blended-price-high-to-low; with any other sort the call fails. Use the ratio the user states."
- `paid_only`: "true drops free models (input and output price both 0) and models with no price. Needs a price sort: input-, output- or blended-price-*. total counts the models that remain. false or absent keeps them all."
- `min_prompt_price`, `max_prompt_price`: "Keep models whose input price is at least (at most) this many USD per million input tokens, bound included. A free model has price 0, so a minimum of 0 keeps it. Applies before any sort."
- `min_completion_price`, `max_completion_price`: the same, for the output price.
- `limit`, `offset`: "Models per page, 1 to 50, default 10" and "Models to skip, default 0. Use next_offset of the previous result."
- Tool description: one added sentence, "Price sorts and paid_only are applied by this tool over every match, so the first row of a price sort is the cheapest by that price."

A test derives from the schema each of these facts, so a value cannot be added to the enum without a line in its description.

## Risks / Trade-offs

- [A price sort costs one large request the first time, about 280 KB for the whole catalog] → One fetch per filter set per run. The retries of `withRetry` apply to each page. A call with an API sort still makes one request.
- [A slow or flaky page fails the whole fetch] → The failure is a tool result, as for any catalog call, and is not cached, so the model may retry.
- [A model keeps asking for `pricing-low-to-high` from habit] → Validation fails with the list of accepted values, and the model corrects itself in the next round.
- [The tool and the oracle define "paid" in two ways] → They agree on the snapshot. The mutation and property tests of the sort state the tool's rule.
- [The catalog changes during a run] → A run lasts seconds, and the cache holds the list the run started with.

## Migration Plan

None. The sort values are arguments of the model's tool call, not of the user's command line. A script that replays recorded tool calls with `pricing-*` sees a validation failure that names the new values. Roll back by reverting the commit.

## Open Questions

- None. The API reference lists `limit` up to 1000 on `/models`, which the maintainer confirms. The tool's own cap for the model stays at 50.
