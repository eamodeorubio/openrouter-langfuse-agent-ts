---
title: Ask a question
description: Send one question to an OpenRouter model from the command line, and see which model answered and how many tokens the exchange used.
---

The first thing the tool does is small, and everything after it builds on it. It sends one question to one OpenRouter model and prints the answer. On the side, it tells you which model answered and how many tokens the exchange used. The agent that weighs models against your budget comes later.

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

The answer goes to stdout. Two status lines go to stderr:

```text
$ pnpm dev -q "Name one planet." --model openrouter/auto
Mars.
model: openai/gpt-4o-mini
tokens: 14 prompt, 3 completion, 17 total
```

The `model:` line names the model that actually served the request, which can differ from the one you asked for. Ask for a routing alias such as `openrouter/auto` and the line tells you where the request landed.

Because the streams are separate, pipes and redirects stay clean:

```sh
pnpm dev -q "Name one planet." > answer.txt
```

The answer lands in the file, and the status lines stay on your screen. The banner lines that pnpm prints go to stderr as well.

## When it fails

| Exit code | Meaning                                                                                                                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0         | The model answered.                                                                                                                                                                                                                                    |
| 1         | Something you can fix: no question, an unknown option, no key, no model, or an unreadable `.env`.                                                                                                                                                      |
| 2         | The call failed: the API refused it (a bad key, a rate limit), the network was down, or a single attempt took longer than 60 seconds. A response with no answer or no token count also counts, and so does an unexpected error inside the tool itself. |

A failure prints a message to stderr and nothing to stdout. The message says what went wrong and, when the API gave one, quotes the status and its reason. A mistake in the arguments, or a missing question, adds the usage text after the message. The tool never prints your key, even when an API error message echoes it.

Brief trouble on the API side does not end the run at once. When OpenRouter answers 429 (too many requests) or any 5xx error, or when the connection fails, the tool waits and tries again, up to four more times. The first wait is about 300 milliseconds, and each one doubles: roughly 0.3, 0.6, 1.2 and 2.4 seconds, each varied by a quarter either way so that many clients do not retry in step. If the last attempt fails, you get that error and exit code 2. Nothing else is retried: a bad key, a malformed request, a timeout and a response with no answer fail on the first attempt. In the worst case the waiting adds a little over five and a half seconds.

## What is not here yet

The status lines show model and tokens only. The cost in dollars, the steps an agent takes, and a link to the trace in Langfuse arrive with the slices that build them. The tool also sends your question as it is, with no system prompt.
