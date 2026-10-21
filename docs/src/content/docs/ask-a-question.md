---
title: Ask a question
description: Send one question to an OpenRouter model from the command line, let it check the live catalog, watch the answer and the model's thinking arrive, and see which model answered and how many tokens it used.
---

The tool sends one question to one OpenRouter model and prints the answer as it arrives, word by word, without waiting for the end. If the model thinks before it answers, the tool shows that too. Before it answers, the model may also check OpenRouter's live catalog for the facts it needs, and you still see one question and one answer. On the side, the tool tells you which model answered and how many tokens the exchange used.

## Before you start

Install the dependencies with `pnpm install`. You need Node.js 26 or newer. You also need an OpenRouter key, which you can create at [openrouter.ai/keys](https://openrouter.ai/keys), and the name of a model.

The tool reads two settings:

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

## How the model looks things up

A model's memory goes stale. OpenRouter's catalog changes often, and a price remembered from training is often wrong by the time you read it. So the tool gives the model a way to check. It offers one tool, `get_model`, which fetches the details of a single model by its slug: `author/name`, with an optional variant such as `:free`. The result carries the description, the context window, the input and output modalities, the supported parameters, the prices, the reasoning support and the benchmark scores.

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

## What you see

The tool writes to two channels. Stdout carries the result: the answer, as it arrives. Stderr carries everything else that is about the run rather than the result, which means the model's thinking (when there is some and when it is shown), the lookup lines (when you ask for them with `--verbose`) and two status lines once the answer is complete:

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

| Exit code | Meaning                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------------- |
| 0         | The model answered, completely.                                                                                        |
| 1         | Something you can fix: no question, an unknown option, both thinking flags, no key, no model, or an unreadable `.env`. |
| 2         | The call failed, in one of the ways listed next.                                                                       |
| 3         | The model was stopped at a limit: it kept calling tools after eight rounds of them.                                    |

Exit code 2 covers these cases:

- The API refused the request, for example because of a bad key or a rate limit.
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

The model's only tool fetches one model by its slug. Searching the whole catalog by price, context size and capability, so that it can find candidates without knowing their names, is the next piece. The status lines show model and tokens only. The cost in dollars and a link to the trace in Langfuse arrive with the slices that build them.
