# Design

## Context

`ask.ts` sends one streamed request and yields events (`thinking`, `content`, `done`). `run` turns them into writes. Retry, idle timeout and failure mapping live around that one request. Motivation is in `proposal.md`; behavior is in `specs/`.

What the SDK offers (1.4.25), read from its types:

- `chat.send` takes `tools`, `toolChoice` and `parallelToolCalls`. A streamed delta carries `toolCalls` as fragments: an `index`, then `id` and `function.name` once, then `function.arguments` in pieces.
- Assistant messages accept `toolCalls` and `reasoningDetails`. A `tool` message takes `toolCallId` and `content`.
- `models.list` and `models.get` exist and take the filters the API documents. The API's docs say a 403 asks for a management key. That contradicts the endpoint being a plain catalog, so task 1.1 checked it with a real call (it answered 200; see Risks).

Two facts shape the loop. A streamed response may end in tool calls with no text at all. And reasoning models need their reasoning blocks back, unmodified, on the next request; Anthropic-style blocks are signed and a dropped or edited one is rejected or silently degrades the next step.

## Goals / Non-Goals

**Goals:**

- Each requirement is reachable by an in-process test against the real-socket fake API, with paced rounds.
- The loop, one request, the tools and the retry rule each sit in their own module and change for separate reasons.
- A tool is data (name, schema, run function). A third tool is one file and one registry line.

**Non-Goals:**

- No caching of catalog calls between rounds or runs.
- No tool for endpoints (per-provider prices and uptime). `get_model` links to them; adding it later is the registry line above.
- No Langfuse yet. The loop and the executor are where it will attach.
- No cap on concurrent tool calls. Retry absorbs a 429.

## Decisions

### Layout

```
ask.ts        ask(config, question): the loop. Yields AskEvent.
chat.ts       one streamed request, with retry and idle timeout (today's ask.ts body)
retry.ts      the retry rule, shared by chat.ts and the tools
instructions.ts   the system message
tools/        registry.ts, getModel.ts, searchModels.ts, catalog.ts (SDK calls and shaping), prices.ts
client.ts     builds the SDK client (key, no SDK retry, serverURL)
```

`ask` keeps its name and signature, so `run` changes only where it must. The SDK is now imported in `client.ts`, `chat.ts` and `catalog.ts`; "one module" no longer holds, and this change drops it on purpose. The alternative, a single gateway module for every SDK call, would bundle streaming, retry and catalog shaping under one reason to change.

### The loop

```
messages = [system, user]
for round in 1..:
  response = chat(messages, tools, toolChoice = round > 8 ? none : auto)   // streams events through
  if response.toolCalls is empty: done
  messages += assistant(response)            // text, toolCalls, reasoningDetails: as received
  messages += await all(toolCalls.map(run))  // concurrent; results in call order
```

`chat` yields the events it yields today and returns a `Response`: text, tool calls, reasoning details, usage, model. The loop adds usage across rounds and emits one `done` at the end, with the last round's model. The sum is in the loop, not in `status.ts`, so the formatter stays a pure function of one `Completion`.

Round 9 forbids tools with `toolChoice: 'none'` and the cap fails only if the model calls one anyway. The alternative, failing at round 9 outright, wastes the user's tokens for an answer the model could have given from what it had.

### Assembling a streamed response

Tool-call fragments are joined by `index`: `id` and `name` from the first fragment, `arguments` concatenated. Arguments are parsed once, after the stream ends. A parse failure is a tool failure for that call, reported to the model, not a crash.

Reasoning details stream as fragments too. They are joined by `index`: text-like fields (`text`, `summary`, `data`) are concatenated, identifying fields (`id`, `type`, `format`, `signature`) are taken from the fragment that carries them. Task 1.2 recorded real streams (`openai/gpt-oss-20b` and `anthropic/claude-haiku-4.5`) and confirmed the rule:

- A fragment is `{ type: 'reasoning.text', text, format, index }`. Text pieces of one `index` concatenate in arrival order.
- For Anthropic models the signature arrives in a last fragment of the same `index` with no `text` key. It joins into the same block, which then holds `type, text, format, index, signature`.
- Parallel tool calls arrive on separate `index` values, interleaved by position, never mixed within one `index`. `id` and `function.name` come in the first fragment (with empty `arguments`); `arguments` pieces follow.
- A joined assistant message (`content: null`, the tool calls, the joined details) with one tool message per call was accepted on round 2 (HTTP 200), signature included.
- The final chunk carries `finish_reason: "tool_calls"` twice (two chunks); the loop treats the first as the end of the round's calls and ignores the repeat.
- A model may emit one tool call where two were possible (gpt-oss did). The loop makes no assumption of parallelism.

The recording lives in `test/fixtures/chat-tool-calls.stream.sse`.

The assistant message is rebuilt from the assembled parts. It repeats the same `model` on the next request; a router such as `openrouter/auto` may serve a different model in round 2, and the signed blocks of the first would not fit. See Risks.

### The round limit is exit 3

`errors.ts` gains `LimitError`, thrown by the loop when the model calls a tool after tools were forbidden. `run` maps it to exit 3, beside the existing three mappings. The alternative, reusing `ApiError`, would put a model that misbehaves under the same code as a dead network, and a script could not tell "retry later" from "ask differently". Timeouts stay code 2: they are about the network, not a limit the CLI imposes.

### Tool failures stay inside the run

`run` of a tool returns `{ ok: true, value }` or `{ ok: false, message }`; it does not throw for expected failures. The executor serialises either as the tool message content. A 404 from `get_model` is the common case, and the model's recovery (a search by name) is what the user wanted. Only an unexpected exception, a bug, escapes to `run`'s catch.

Tool HTTP calls use `retry.ts`, extracted from `ask.ts` with its wait rule unchanged. They carry a 60 s deadline per call. The calls are not streamed, so a total limit is correct here.

### Validation and schemas: zod

Arguments are untrusted input from a model, so each tool validates with a zod schema and the same schema renders the JSON Schema offered to the LLM (`z.toJSONSchema`). One definition cannot drift from the other. The SDK already depends on zod 4 (`zod/v4`); this change declares it directly instead of leaning on a transitive dependency. Strict objects reject unknown keys, which the spec requires and which tells a model it invented an argument.

Argument names differ from the API's (`query` for `q`, `min_context_length` for `context`, `zero_data_retention` for `zdr`, price floors named for what they filter). The names are chosen for the model: they say what is measured, and the price units are in the description. `catalog.ts` maps them to the SDK's camelCase fields.

### The calculator

`calculate` is a hand-written recursive-descent parser over a short grammar: expression, term, factor, with unary signs and parentheses. It reads characters and builds a number as it goes; it never builds source text and never calls `eval` or `Function`. The input comes from a model, and the model's input comes from a user and from web-sized catalog text, so "evaluate a restricted string" is the wrong tool, and a library for a grammar of five operators costs more review than the 60 lines it would save. Unary signs are allowed because models write `-5 + 2` and `2 - -3`. Number syntax is deliberately narrow (no exponent, no leading or trailing point, no separators): a rejected number is a message the model can fix, an accepted ambiguous one is a wrong cost.

Floats are the representation. Binary rounding noise is removed at the end by rounding to 12 significant digits, which keeps `0.1 + 0.2` at `0.3` and leaves every price in the catalog exact: prices are at most six decimals, token counts are small integers in millions, so a product stays far inside the 15 to 16 digits a double holds. A result that is `Infinity` or `NaN` is an error. Length (200) and nesting (32) are capped so that a hostile or runaway expression cannot exhaust the stack.

`formula` is the input with its whitespace normalised to single spaces around binary operators, then ` = ` and the result. It lets the model, and the user reading `--verbose`, check the arithmetic. The system message asks the model to repeat the formula and result in its answer when it states a cost.

The property test compares the parser with an independent oracle: random expression trees are printed with random spacing and redundant parentheses, and the parser must give the same value as evaluating the tree directly. Another property feeds arbitrary strings and requires a result or an error message, never a throw.

### Prices

The API returns per-token decimal strings; its own filters take dollars per million. A model comparing `0.0000015` with `max_prompt_price: 2` will get it wrong. Every tool price is therefore dollars per million. The conversion shifts the decimal point in the string (six places) and parses the result. It never multiplies floats, which would turn `0.000003` into `2.9999999999999996` for some inputs. Anything that is not a non-negative decimal string, such as the `-1` OpenRouter uses for routers, becomes `null`. A property test covers the round trip and the bound.

### Result shape

`get_model` returns a trimmed, flattened model. The raw object carries fields the model cannot use (`links`, `per_request_limits`, voices) and costs tokens in every later round, because the history is resent. `search_models` leaves out the description for the same reason; `get_model` is the follow-up. The default page is 10, the cap 50, and `next_offset` lets the model ask for more only when it needs them.

### Output

A new event, `{ kind: 'tool', name, arguments }`, reaches the presenter before the call runs. The loop always emits it; the presenter decides. With `--verbose` it writes the `tool:` line to stderr, closing an open thinking line first; without, it drops the event. `args.ts` gains the flag and `Io`-level plumbing stays as it is. Text from consecutive rounds is separated by one newline so `Checking.` and `Done.` do not fuse. Tool lines do not depend on `--thinking`. They are off by default because most runs want the answer and the status lines only; `--verbose` is for the person who wants to see how the answer was reached.

Intermediate text goes to stdout with the answer, because a stream cannot know a round is not the last until it ends. The system message asks the model to call tools without commentary. It is the only defence, and a model can ignore it.

### System message

Short, in code, tested only for what the spec pins (it exists, comes first, names the units). Its content: the role, cost-effectiveness as the lens, USD per million tokens, tools before memory because the catalog changes, independent calls together, no narration before a tool call, state that figures come from OpenRouter at query time.

### Tests

The fake API on `127.0.0.1` gains a script of responses per request path and records bodies, so a test asserts what round 2 sent: the tool messages, their order, the reasoning details. Tool endpoints are plain request/response, so `nock` serves their unit tests; anything that cancels a stream stays on the fake API. Fixtures for `/models` and `/model/...` are recorded once, bodies only, with the user's permission. Property tests: price conversion, argument validation never throws, tool results always parse as JSON, fragment joining equals the unfragmented message for any split.

## Risks / Trade-offs

- **A router switches model between rounds, and signed reasoning blocks no longer fit.** → The CLI sends the same model string each round. If a recording shows the API rejecting such a case, the loop will pin the served model for later rounds.
- **Fragment joining may differ for other providers.** → Settled for the two recorded (plain text and signed text). An unknown fragment type is joined by `index` like the rest and passed back unchanged; a provider that rejects it exits 2 with the API's message.
- **The history grows each round, and so does the bill.** → Trimmed results, a default page of 10, a cap of 8 rounds. The summed `tokens:` line shows the cost.
- **Preamble text reaches stdout.** → The system message asks for silence; the spec makes the separator explicit. A user who pipes the answer sees any narration the model adds.
- **A management-key requirement on the models endpoints.** → Checked in task 1.1: a normal key gets 200 on both endpoints, so the docs' 403 note does not apply to them.
- **Many parallel calls hit a rate limit.** → Retry waits and retries; if they run out the model gets an error and may try again.
- **`search_models` filters are broad and a model may pass poor combinations.** → Descriptions state units and meaning; validation errors name the argument.
