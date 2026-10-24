---
title: Ask a question
description: Send one question to an OpenRouter model from the command line, let it check the live catalog and do its sums, watch the answer and the model's thinking arrive, see which model answered and how many tokens it used, and keep a trace of the run in Langfuse.
---

The tool sends one question to one OpenRouter model and prints the answer as it arrives, word by word, without waiting for the end. If the model thinks before it answers, the tool shows that too. Before it answers, the model may also check OpenRouter's live catalog for the facts it needs and work out the arithmetic with a calculator, and you still see one question and one answer. On the side, the tool tells you which model answered and how many tokens the exchange used. Give it the credentials of a Langfuse project and it also leaves a trace of the run behind.

## Before you start

Install the dependencies with `pnpm install`. You need Node.js 26 or newer. You also need an OpenRouter key, which you can create at [openrouter.ai/keys](https://openrouter.ai/keys), and the name of a model.

The tool reads two settings to ask a question, and three more if you want a trace of the run (see [Tracing with Langfuse](#tracing-with-langfuse)):

| Setting              | Meaning                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY` | Your key. Required.                                                                         |
| `OPENROUTER_MODEL`   | The model that answers your question, such as `openai/gpt-4o-mini`. `--model` overrides it. |

There is no default model. A default would hide a spending decision inside a constant, and choosing models carefully is what this project is for. If you give no model, the tool says so and stops.

Put the settings in the environment, or in a file named `.env` in the directory you run the tool from. A value already present in the environment wins over the file. The repository ships a template:

```sh
cp .env.example packages/cli/.env
```

The file belongs in `packages/cli/` because `pnpm dev` runs the tool from there. The `.gitignore` keeps it out of Git.

## Ask

Give the question with `-q`:

```sh
pnpm dev -q "What is a token, and why do providers charge for them?"
```

Or pipe it in:

```sh
echo "What is a token, and why do providers charge for them?" | pnpm dev
cat long-prompt.txt | pnpm dev --model openai/gpt-4o-mini
```

When both are present, `-q` wins and the pipe is left unread. Surrounding whitespace is trimmed. If you give neither, and the input is a terminal, the tool prints its usage message and exits instead of waiting for you to type.

`-q` takes the next argument as the question, whatever it starts with, so `-q "-5 degrees in Fahrenheit"` works. The price is that `-q --model` reads `--model` as the question.

## The model's tools

A model's memory goes stale. OpenRouter's catalog changes often, and a price remembered from training is often wrong by the time you read it. So the tool gives the model a way to check. It offers three tools. `get_model` fetches the details of a single model by its slug: `author/name`, with an optional variant such as `:free`. The result carries the description, the context window, the input and output modalities, the supported parameters, the prices, the reasoning support and the benchmark scores. `search_models` finds models when the model does not know a slug yet. `calculate` does the arithmetic. The last two are described below, under Searching the catalog and Doing the arithmetic.

Prices come back in US dollars per million tokens, the unit OpenRouter uses on its model pages. The API sends them per token, as decimal strings, and the tool moves the decimal point itself so the model never has to. Prices that are not per token, such as a flat fee per request or per image, are left out. Conditional prices, like a higher rate above a certain prompt size, are kept. A routing model such as `openrouter/auto` has no fixed price, and its price shows as `null`.

The system instructions tell the model to use its tools instead of its memory, to call independent lookups together, and to write nothing until it has the data. Asked to compare two models, a model usually requests both at once, and the tool runs the two lookups at the same time.

The tool sends your question, reads the model's request for lookups, runs them, sends the results back and reads the next response. It repeats that until a response holds no further request. Each pass is a round. The text of every round goes to stdout as it arrives, with a newline between rounds when the text does not already end in one. The instructions ask the model not to talk before a lookup, but a model may add a remark anyway, and you will see it.

Lookups are quiet by default. Add `--verbose` and the tool writes one line to stderr for each call, just before it runs:

```text
$ pnpm dev --verbose -q "How much does openai/gpt-oss-20b cost per million input and output tokens, and what is its context window? Compare with openai/gpt-oss-120b."
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

### Searching the catalog

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
$ pnpm dev --model anthropic/claude-haiku-4.5 --verbose -q "Find me the 3 cheapest models that support tool calling and have at least a 200k context window. Give prices per million tokens."
tool: search_models {"supported_parameters": ["tools"], "min_context_length": 200000, "sort": "pricing-low-to-high", "limit": 50}
The 3 cheapest models that support tool calling with a 200k+ context window are all free:

1. **cohere/north-mini-code:free** - $0/$0 (input/output per million tokens), 256k context
2. **dots-studio/dots-3-note-preview:free** - $0/$0 (input/output per million tokens), 512k context
3. **google/gemma-4-26b-a4b-it:free** - $0/$0 (input/output per million tokens), 262k context

All three are free tier models on OpenRouter. If you need paid models, the cheapest paid option is **inclusionai/ling-3.0-flash** at $0.021/$0.063 (input/output per million tokens) with a 262k context window.
model: anthropic/claude-haiku-4.5
tokens: 11010 prompt, 318 completion, 11328 total
```

### Doing the arithmetic

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
$ pnpm dev --model anthropic/claude-haiku-4.5 --verbose -q "What would 5 million input tokens and 1 million output tokens cost on openai/gpt-oss-120b, and on openai/gpt-oss-20b?"
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

## Tracing with Langfuse

A run can leave a record. Give the tool the credentials of a [Langfuse](https://langfuse.com) project and it sends one trace for every question: what you asked, each request to the model with the messages it carried, what the model sent back, each tool call and what it returned, and the answer. Open the trace in Langfuse and you can see what the model was shown, why it reached for a tool, and where the time went.

Three settings switch it on:

| Setting               | Meaning                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `LANGFUSE_PUBLIC_KEY` | The public key of the project, from its settings under API keys. It starts with `pk-lf-`.                                           |
| `LANGFUSE_SECRET_KEY` | The secret key of the same pair. It starts with `sk-lf-`.                                                                           |
| `LANGFUSE_BASE_URL`   | Where Langfuse lives: `https://cloud.langfuse.com` (EU), `https://us.cloud.langfuse.com` (US) or your own server. An `http(s)` URL. |

They live in the same two places as the other settings, the environment and `.env`, and the environment wins. The tool works with Langfuse Cloud and with a self-hosted Langfuse server from version 4.59.0.

Set all three or none. With none, the tool runs untraced and writes one line to stderr to say so. That line is a reminder, not an error: stdout and the exit code stay as they were. With one or two, the tool stops before it reads your question, exits with code 1 and names the settings that are missing. A half-configured setup is almost always a typo, and a trace that quietly never arrives is worse than a refusal.

With all three, the tool checks the keys before it asks the model anything. It asks Langfuse for the project the keys belong to. If Langfuse rejects the keys, or does not answer within ten seconds, the tool prints one line, sends nothing to OpenRouter and exits with code 2. You find out in the first second, and no tokens were spent.

### What the trace holds

The root of the trace is an `agent` observation named `answer-question`. Its input is your question and its output is the final answer. Under it, in the order they happened:

- One `generation` named `generate-response` for each request to the model. It holds the model you asked for and the model that served the request, the messages that went out as a conversation (system, user, assistant and tool messages, with each tool result matched to its call), the reply with its text, its tool calls and its thinking, and the reason the model stopped. A request that was retried after a failure is still one generation, with the number of retries in its metadata.
- One `tool` for each tool call, named after the tool: `get_model`, `search_models` or `calculate`. It holds the arguments the model sent and the result that went back. A call that failed is marked as an error, with the reason as its status message. A tool sits beside the generation that asked for it, never inside it, so the tree reads like the run did.

When a run fails, the error marks the root and the request that failed. The trace of a failed run is delivered like any other.

### What leaves your machine

The question, the answer, the thinking, and the arguments and results of every tool call go to Langfuse in full. That is the point of a trace, and it is also a decision to make with open eyes. The tool replaces your OpenRouter key and the two Langfuse keys with `[REDACTED]` wherever they appear in what it sends. It looks for nothing else. A name, an address or a number that you type into a question, or that a model repeats, is stored as it is. Do not ask a traced run what you would not want written on that server.

### When the run ends

The tool sends the trace before it exits and waits at most ten seconds for Langfuse to take it. If it cannot, it writes one line saying the trace may be incomplete. A run that would have exited with 0 then exits with 2, so a script notices that the record is missing. A run that had already failed keeps its own exit code.

Press Ctrl-C, or stop the process with `SIGTERM`, and the tool does not walk away from the trace. The observations still open are closed and marked as interrupted, the trace is sent, and the exit code is 130 for Ctrl-C and 143 for `SIGTERM`, the codes a shell shows for a process a signal killed.

## What you see

The tool writes to two channels. Stdout carries the result: the answer, as it arrives. Stderr carries everything else that is about the run rather than the result, which means the model's thinking (when there is some and when it is shown), the lookup lines (when you ask for them with `--verbose`), one line saying tracing is off when no Langfuse settings are present, and two status lines once the answer is complete:

```text
$ pnpm dev -q "Name three primary colors, one per line."
The user wants three primary colors, listed one per line. ...

Red
Yellow
Blue
model: nvidia/nemotron-3-ultra-550b-a55b:free
tokens: 25 prompt, 122 completion (128 reasoning), 147 total
```

On a terminal the thinking is dimmed. When stdout is a terminal too, a blank line separates it from the answer. The `model:` line names the model that actually served the request, which can differ from the one you asked for. Ask for a routing alias such as `openrouter/auto` and the line tells you where the request landed. When the model reports how many tokens it spent thinking, the `tokens:` line shows that count in parentheses after the completion count. Providers count in their own ways, so the reasoning figure can even exceed the completion figure, as it does above. The tool prints the numbers as reported.

Because the streams are separate, pipes and redirects stay clean:

```sh
pnpm dev -q "Name three primary colors, one per line." > answer.txt
```

The answer lands in the file, and the thinking and the status lines stay on your screen. The banner lines that pnpm prints go to stderr as well.

How early the first words appear depends on the model. Some models send their answer a piece at a time and the text flows. Others hold the whole answer back and deliver it in one burst; some free models behave this way. The tool prints each piece the moment it arrives, so a burst shows up as one block.

Some servers do not stream at all. A proxy in front of OpenRouter may answer with the whole response at once. The tool treats that as a stream of one piece: the thinking, if it is shown, and the answer arrive together, and the status lines follow as usual. You see no error, only a single block. If that whole response holds no answer or no token count, it fails the way a stream does, with exit code 2.

## Watching the model think

Some models think before they answer, and OpenRouter passes that thinking along as plain text. The tool writes it to stderr, never to stdout, so the answer in a pipe or a file stays the answer and nothing else.

By default the thinking shows when you are watching stderr on your screen. The tool's own words for that are "stderr is a terminal", and the idea is simple. A terminal is the live window where you type commands. When you run the tool and redirect nothing, stdout and stderr both print in that window, so stderr is a terminal. When you send stderr somewhere else, with `2> log.txt` to a file or through a pipe to another program, nothing is printed in the window for it, and stderr is no longer a terminal. The default follows that: a person watching a screen sees the thinking, and a log or a pipeline does not fill with reasoning nobody asked for.

To read the table, ask where stderr went. You can try it yourself: add `2> /dev/null` to any command, and the thinking, which lived on stderr, disappears from the window.

| You run                                 | Thinking shows? | Why                          |
| --------------------------------------- | --------------- | ---------------------------- |
| `pnpm dev -q "..."`                     | yes             | stderr is your screen        |
| `pnpm dev -q "..." > answer.txt`        | yes             | only stdout went to the file |
| `pnpm dev -q "..." 2> log.txt`          | no              | stderr went to a file        |
| `pnpm dev -q "..." 2>&1 \| tee run.log` | no              | stderr joined the pipe       |
| the same command in a CI job            | no              | there is no terminal         |
| any of these with `--thinking`          | yes             | you asked for it             |
| any of these with `--no-thinking`       | no              | you asked for silence        |

Two flags override the default. `--thinking` shows the thinking even when stderr is not a terminal, and `--no-thinking` hides it even when it is. Giving both is a mistake, and the tool says so and stops.

The dimming is a terminal feature. It applies only when stderr is a terminal, and it switches off when the `NO_COLOR` environment variable is set to anything other than an empty value. Thinking written to a file or a pipe is plain text.

Only readable thinking is shown. Some providers return their reasoning encrypted, or only as a short summary. The tool writes nothing for those, and the wait stays quiet. The reasoning count on the `tokens:` line still tells you the model thought.

## When it fails

| Exit code | Meaning                                                                                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0         | The model answered, completely.                                                                                                                                      |
| 1         | Something you can fix: no question, an unknown option, both thinking flags, no key, no model, an unreadable `.env`, or Langfuse settings that are only partly there. |
| 2         | The call failed, in one of the ways listed next.                                                                                                                     |
| 3         | The model was stopped at a limit: it kept calling tools after eight rounds of them.                                                                                  |

Exit code 2 covers these cases:

- The API refused the request, for example because of a bad key or a rate limit.
- Langfuse rejected the keys or did not answer, or the trace could not be delivered at the end.
- The network was down.
- The model went quiet for 60 seconds.
- The response held no answer or no token count.
- The stream broke halfway.
- Something unexpected failed inside the tool itself.

A failure prints a message to stderr. The message says what went wrong and, when the API gave one, quotes the status and its reason. A mistake in the arguments, or a missing question, adds the usage text after the message. The tool never prints your key in a message it writes, even when an API error echoes it. The text the model generates, its answer and its thinking, passes through as received, since the tool cannot vouch for what a model says.

Before any text has appeared, a failure leaves stdout empty. After text has started, streaming changes that. If the stream breaks halfway, you keep what already arrived: the partial answer stays on stdout and the tool ends its line, then writes the error to stderr and exits with code 2. A script that needs an answer to be complete or absent should check the exit code, which is 0 only for a complete answer.

Brief trouble on the API side does not end the run at once. When OpenRouter answers 429 (too many requests) or any 5xx error, when an error arrives before any answer or thinking has, or when the connection fails or the stream drops before any output, the tool waits and tries again, up to four more times. The first wait is about 300 milliseconds, and each one doubles: roughly 0.3, 0.6, 1.2 and 2.4 seconds, each varied by a quarter either way so that many clients do not retry in step. If the last attempt fails, you get that error and exit code 2. Nothing else is retried: a bad key, a malformed request, a timeout and a response with no answer fail on the first attempt. Retrying also stops the moment a request has produced its first piece of answer or thinking, shown or not, because a second attempt could repeat words you have already read. The rule applies to each request on its own. If the request for the third round fails before it has produced any text, it is retried, even though the first two rounds wrote some. In the worst case the waiting adds a little over five and a half seconds to each request.

The tool waits up to 60 seconds for the first sign of life from the model, and up to 60 seconds between one piece of the stream and the next. There is no limit on the total time, so a long answer that keeps flowing is never cut off. A silence longer than 60 seconds ends the run with exit code 2.

## What is not here yet

The status lines show model and tokens only. The trace does not carry token counts or costs yet, and nothing prints its id. Those arrive with the next piece, together with the masking of email addresses and bearer tokens.
