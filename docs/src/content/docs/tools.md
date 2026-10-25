---
title: How the model finds answers
description: The three tools the model can use while it answers, a lookup for one model, a search of the live catalog and a calculator, and how to watch them work.
---

A model's memory goes stale. OpenRouter's catalog changes often, and a price remembered from training is often wrong by the time you read it. So the tool gives the model a way to check. It offers three tools. `get_model` fetches the details of a single model by its slug: `author/name`, with an optional variant such as `:free`. The result carries the description, the context window, the input and output modalities, the supported parameters, the prices, the reasoning support and the benchmark scores. `search_models` finds models when the model does not know a slug yet. `calculate` does the arithmetic. The last two are described below, under Searching the catalog and Doing the arithmetic.

Prices come back in US dollars per million tokens, the unit OpenRouter uses on its model pages. The API sends them per token, as decimal strings, and the tool moves the decimal point itself so the model never has to. Prices that are not per token, such as a flat fee per request or per image, are left out. Conditional prices, like a higher rate above a certain prompt size, are kept. A routing model such as `openrouter/auto` has no fixed price, and its price shows as `null`.

The system instructions tell the model to use its tools instead of its memory, to call independent lookups together, and to write nothing until it has the data. Asked to compare two models, a model usually requests both at once, and the tool runs the two lookups at the same time.

## Watching it work

The tool sends your question, reads the model's request for lookups, runs them, sends the results back and reads the next response. It repeats that until a response holds no further request. Each pass is a round. The text of every round goes to stdout as it arrives, with a newline between rounds when the text does not already end in one. The instructions ask the model not to talk before a lookup, but a model may add a remark anyway, and you will see it.

Lookups are quiet by default. Add `--verbose` and the tool writes one line to stderr for each call, just before it runs:

```text
$ ask-openrouter --verbose -q "How much does openai/gpt-oss-20b cost per million input and output tokens, and what is its context window? Compare with openai/gpt-oss-120b."
tool: get_model {"slug":"openai/gpt-oss-20b"}
tool: get_model {"slug":"openai/gpt-oss-120b"}
**OpenRouter pricing (USD per million tokens)**
| Model | Prompt (input) | Completion (output) | Context window |
|-------|----------------|---------------------|----------------|
| `openai/gpt-oss-20b` | **$0.018** | **$0.09** | 131 072 tokens |
| `openai/gpt-oss-120b` | **$0.15** | **$0.60** | 131 072 tokens |

**Comparison**

- **Cost**: `gpt-oss-20b` is roughly **8.3 × cheaper for prompts** and **6.7 × cheaper for completions** than `gpt-oss-120b`.
- **Context window**: Both models share the same 131 072‑token window, so you can use the same prompt length with either.

These figures come directly from OpenRouter’s catalog at the time of your question.
model: openai/gpt-oss-20b
tokens: 2678 prompt, 360 completion (84 reasoning), 3038 total
```

The line shows the arguments as the model sent them, on one line, cut after 200 characters. It appears whether or not the thinking is shown, and it never goes to stdout. The `tokens:` line adds up every round, because every round is billed. The `model:` line names the model that served the last one.

Models that reason keep their train of thought across rounds. The tool sends the reasoning back with the lookup results, exactly as it received it, signatures and all, and the model resumes where it stopped. There is nothing to configure.

A lookup that fails does not end the run. An unknown slug, a bad argument, a lookup that takes longer than 60 seconds or an API error goes back to the model as the result of that call. The model can correct the slug and try again, or tell you it could not find the model. Lookups follow the same retry rule as the model itself: a 429, a 5xx or a dropped connection is tried again up to four more times.

A model that keeps asking for lookups gets stopped. After eight rounds that end in tool calls, the tool sends one more request that forbids tools, which gives the model a last chance to answer with what it has. If it asks for a tool anyway, the tool writes one line to stderr and exits with code 3. Whatever text it had written stays on stdout.

## Searching the catalog

`search_models` asks OpenRouter to filter and sort its catalog, so the model can request "the ten cheapest models with a 200k context window that can call tools" and receive just those, instead of the whole catalog. Every argument is optional, and the ones the model gives are passed to OpenRouter as filters:

| Argument                                                          | What it filters                                                                  |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `query`                                                           | free text over names and slugs                                                   |
| `category`                                                        | use case, such as `programming` or `translation`                                 |
| `sort`                                                            | server-side order: price, age, popularity, context size, speed, benchmark scores |
| `input_modalities`, `output_modalities`                           | kinds of input and output the model must handle                                  |
| `supported_parameters`                                            | request parameters the model must support, such as `tools`                       |
| `min_context_length`                                              | smallest context window, in tokens                                               |
| `min_prompt_price`, `max_prompt_price`                            | input price bounds, in USD per million tokens                                    |
| `min_completion_price`, `max_completion_price`                    | output price bounds, in USD per million tokens                                   |
| `architecture`, `authors`, `providers`                            | model family, author slugs, hosting providers                                    |
| `min_intelligence_index`, `min_coding_index`, `min_agentic_index` | Artificial Analysis benchmark floors                                             |
| `min_tool_success_rate`                                           | tool-calling reliability floor, from 0 to 1                                      |
| `max_age_days`                                                    | only recent models                                                               |
| `zero_data_retention`                                             | only models with zero-data-retention endpoints                                   |
| `limit`, `offset`                                                 | the page: 1 to 50 entries (10 by default), and where it starts                   |

Each entry in the answer is compact: the slug and name, the creation date, the context window, the maximum output size, the input and output prices in USD per million tokens, the modalities, whether the model reasons, and its benchmark indices (or `null` when it has none). The description is left out; `get_model` gives it. The answer also carries the total number of matches and the offset of the next page, or `null` on the last one, so the model can ask for more when the first page is not enough.

Every result stays in the conversation and is sent again with each later request, so a large page costs tokens on every round. The run below, whose model asked for a page of 50, used 11,010 prompt tokens across its two rounds. The two-lookup comparison above used 2,678. The model chooses the page size; the limit of 50 caps it.

Here is a real run. Its model made a single search and asked for a page of 50:

```text
$ ask-openrouter --model anthropic/claude-haiku-4.5 --verbose -q "Find me the 3 cheapest models that support tool calling and have at least a 200k context window. Give prices per million tokens."
tool: search_models {"supported_parameters": ["tools"], "min_context_length": 200000, "sort": "pricing-low-to-high", "limit": 50}
The 3 cheapest models that support tool calling with a 200k+ context window are all free:

1. **cohere/north-mini-code:free** - $0/$0 (input/output per million tokens), 256k context
2. **dots-studio/dots-3-note-preview:free** - $0/$0 (input/output per million tokens), 512k context
3. **google/gemma-4-26b-a4b-it:free** - $0/$0 (input/output per million tokens), 262k context

All three are free tier models on OpenRouter. If you need paid models, the cheapest paid option is **inclusionai/ling-3.0-flash** at $0.021/$0.063 (input/output per million tokens) with a 262k context window.
model: anthropic/claude-haiku-4.5
tokens: 11010 prompt, 318 completion, 11328 total
```

## Doing the arithmetic

Models are fluent with words and unreliable with sums. A cost estimate is a sum of products, five million input tokens at one price plus one million output tokens at another, and a slip in it looks as confident as a correct figure. So the tool gives the model a calculator, `calculate`. The system instructions tell it to use the calculator for every cost, and to show the formula and the result in its answer.

The calculator is deliberately small. It accepts decimal numbers (a decimal point needs digits on both sides, so `.5` and `5.` are refused), `+`, `-`, `*`, `/`, parentheses and spaces, and a sign in front of a number or a bracket (`-5 + 2`, `2 - -3`). The usual precedence applies, and operators of equal rank go left to right. Because prices are in dollars per million tokens, the millions of tokens in a workload multiply them directly: `5 * 0.018 + 1 * 0.09` is the cost of five million input and one million output tokens on a model that charges $0.018 and $0.09.

Everything else is refused, and the refusal tells the model why. The tool does not hand the text to `eval`, to a shell or to any other interpreter. It reads the characters itself, one at a time, so a line such as `process.exit(1)` stops at its first letter, with a message that names the letter and its position. These are the cases:

| The model sends                               | The result it gets back                                          |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `5 * 0.018 + 1 * 0.09`                        | the formula, a `=` and the result: `5 * 0.018 + 1 * 0.09 = 0.18` |
| `10 / (5 - 5)`                                | an error: division by zero                                       |
| `2 ** 3`, `1e3`, `7 % 2`, `Math.PI`           | an error naming the first character outside the grammar          |
| `(1 + 2`, `1 +`                               | an error saying what is missing                                  |
| more than 200 characters, or 33 brackets deep | an error naming the limit                                        |

Every step is rounded to twelve significant digits, which clears the noise of binary arithmetic (`0.1 + 0.2` is `0.3`, and `0.1 + 0.2 - 0.3` is `0`, so dividing by it is reported as a division by zero) and leaves the prices in the catalog exact in practice. Results are written in plain decimal, never with an exponent, so the model can paste a formula back. The formula is shown with single spaces around the operators, so you can check it against the `--verbose` line. As with any tool, a failed calculation is not a failed run: the error goes back to the model, which can fix its expression or say it could not compute.

Here is a real run. The model looked up both models, then computed both costs, each pair of calls running together:

```text
$ ask-openrouter --model anthropic/claude-haiku-4.5 --verbose -q "What would 5 million input tokens and 1 million output tokens cost on openai/gpt-oss-120b, and on openai/gpt-oss-20b?"
tool: get_model {"slug": "openai/gpt-oss-120b"}
tool: get_model {"slug": "openai/gpt-oss-20b"}
tool: calculate {"expression": "5 * 0.15 + 1 * 0.6"}
tool: calculate {"expression": "5 * 0.018 + 1 * 0.09"}
Now I'll calculate the costs for each model:
Based on current OpenRouter pricing:

**openai/gpt-oss-120b**: $1.35
- Formula: 5 million × $0.15 + 1 million × $0.60 = $1.35

**openai/gpt-oss-20b**: $0.18
- Formula: 5 million × $0.018 + 1 million × $0.09 = $0.18

The 20b model is significantly cheaper—about 7.5× less expensive for this usage pattern. The 120b model costs more because it has much higher per-token pricing ($0.15 input, $0.60 output vs $0.018 input, $0.09 output).
model: anthropic/claude-haiku-4.5
tokens: 10004 prompt, 411 completion, 10415 total
```

The line "Now I'll calculate the costs for each model:" is a remark the instructions ask the model not to make. The tool prints it, as it prints everything the model writes.
