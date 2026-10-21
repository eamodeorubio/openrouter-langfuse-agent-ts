---
title: Ask a question
description: Send one question to an OpenRouter model from the command line, watch the answer and the model's thinking arrive, and see which model answered and how many tokens it used.
---

The first thing the tool does is small, and everything after it builds on it. It sends one question to one OpenRouter model and prints the answer as it arrives, word by word, without waiting for the end. If the model thinks before it answers, the tool shows that too. On the side, it tells you which model answered and how many tokens the exchange used. The agent that weighs models against your budget comes later.

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

## What you see

The tool writes to two channels. Stdout carries the result: the answer, as it arrives. Stderr carries everything else that is about the run rather than the result, which means the model's thinking (when there is some and when it is shown) and two status lines once the answer is complete:

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

Exit code 2 covers these cases:

- The API refused the request, for example because of a bad key or a rate limit.
- The network was down.
- The model went quiet for 60 seconds.
- The response held no answer or no token count.
- The stream broke halfway.
- Something unexpected failed inside the tool itself.

A failure prints a message to stderr. The message says what went wrong and, when the API gave one, quotes the status and its reason. A mistake in the arguments, or a missing question, adds the usage text after the message. The tool never prints your key in a message it writes, even when an API error echoes it. The text the model generates, its answer and its thinking, passes through as received, since the tool cannot vouch for what a model says.

Before any text has appeared, a failure leaves stdout empty. After text has started, streaming changes that. If the stream breaks halfway, you keep what already arrived: the partial answer stays on stdout and the tool ends its line, then writes the error to stderr and exits with code 2. A script that needs an answer to be complete or absent should check the exit code, which is 0 only for a complete answer.

Brief trouble on the API side does not end the run at once. When OpenRouter answers 429 (too many requests) or any 5xx error, when an error arrives before any answer or thinking has, or when the connection fails or the stream drops before any output, the tool waits and tries again, up to four more times. The first wait is about 300 milliseconds, and each one doubles: roughly 0.3, 0.6, 1.2 and 2.4 seconds, each varied by a quarter either way so that many clients do not retry in step. If the last attempt fails, you get that error and exit code 2. Nothing else is retried: a bad key, a malformed request, a timeout and a response with no answer fail on the first attempt. Retrying also stops the moment the model has produced its first piece of answer or thinking, shown or not, because a second attempt could repeat words you have already read. In the worst case the waiting adds a little over five and a half seconds.

The tool waits up to 60 seconds for the first sign of life from the model, and up to 60 seconds between one piece of the stream and the next. There is no limit on the total time, so a long answer that keeps flowing is never cut off. A silence longer than 60 seconds ends the run with exit code 2.

## What is not here yet

The status lines show model and tokens only. The cost in dollars, the steps an agent takes, and a link to the trace in Langfuse arrive with the slices that build them. The tool also sends your question as it is, with no system prompt.
