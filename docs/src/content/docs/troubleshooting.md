---
title: Troubleshooting
description: What to do when the tool stops with an error, how to read its message and exit code, and what it retries on its own.
---

When something goes wrong, the tool writes a message to stderr and exits with a code that is not zero. The message says what is wrong and, almost always, what to do about it. This page collects the problems people meet first, then the messages, then the rules the tool follows when the API misbehaves.

## Before the first answer

**The command is not found.** The global install put the command in a folder your shell does not search. With pnpm, run `pnpm setup` and open a new terminal. With npm, check that the folder printed by `npm prefix --global` has a `bin` folder on your `PATH`. Until then, `npx ask-openrouter` works from anywhere.

**It says `OPENROUTER_API_KEY is not set`, but you wrote it in `.env`.** The tool reads `.env` from the directory you run it in, and from no other. Run `pwd` and check that the file is there, that its name is exactly `.env`, and that the line reads `OPENROUTER_API_KEY=your-key`. An exported variable with the same name wins over the file, so an old, wrong value in your shell can hide a right one in the file.

**It says `No model given`.** There is no default model. Set `OPENROUTER_MODEL`, or pass `--model` for this one run. [Set up](../set-up/) explains why.

**The Node version is too old.** The tool needs Node 22 or newer, as [Install](../install/) explains. Update Node and run the command again.

**The thinking does not show.** Thinking appears on stderr when you are watching stderr on a screen. If you redirect stderr, or run in a script, it stays hidden unless you pass `--thinking`. [Ask a question](../ask-a-question/#watching-the-model-think) has the table.

## Reading the message

A failure prints a message to stderr. When the API gave a reason, the message quotes its status and its words. A mistake in the arguments, or a missing question, adds the full help text after the message. It is the same text `--help` prints. The tool never prints your key in a message it writes, even when an API error echoes it. The text the model generates, its answer and its thinking, passes through as received, since the tool cannot vouch for what a model says.

Almost every message says what is wrong and what to do about it, and none shows the insides of the tool: no library names, no stack traces, no system error codes. The only words that are not the tool's own are the API's, which are quoted as the service gave them. The ones you are most likely to meet:

| The message begins                                           | What to do                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `No model given.`                                            | Set `OPENROUTER_MODEL` in the environment or in a `.env` file in the current directory, or pass `--model <model>`. A model is a slug such as `openai/gpt-4o-mini`; [the list](https://openrouter.ai/models) has them all.                                             |
| `OPENROUTER_API_KEY is not set.`                             | Set it in the environment or in `.env`. Keys are issued at [openrouter.ai/keys](https://openrouter.ai/keys).                                                                                                                                                          |
| `No question given.`                                         | Pass `-q "your question"` or pipe the question in.                                                                                                                                                                                                                    |
| `-q needs a value` or `The question given with -q is empty.` | Write the question after `-q`, or leave `-q` out and pipe the question in.                                                                                                                                                                                            |
| `--model needs a value`                                      | Give the slug: `--model openai/gpt-4o-mini`.                                                                                                                                                                                                                          |
| `Unknown option` or `Unexpected argument`                    | Check the spelling against the options listed below the message, which are the ones `--help` prints. Quote the question and pass it with `-q`.                                                                                                                        |
| `... takes no value.`                                        | The flag is a switch. Write it alone, as in `--json`, not `--json=1`.                                                                                                                                                                                                 |
| `Use either --thinking or --no-thinking`                     | Remove one of the two.                                                                                                                                                                                                                                                |
| `Cannot read .env`                                           | The file is there but cannot be read, and the message says why. Fix its permissions or remove it, and use the environment instead.                                                                                                                                    |
| `Langfuse tracing is half configured`                        | Set all three `LANGFUSE_` variables, or none.                                                                                                                                                                                                                         |
| `Cannot reach Langfuse` or `Langfuse rejected the keys`      | Check `LANGFUSE_BASE_URL` and the keys, or unset the three `LANGFUSE_` variables to run without tracing.                                                                                                                                                              |
| `API error 401` or `403`                                     | The key was refused. Check `OPENROUTER_API_KEY`.                                                                                                                                                                                                                      |
| `API error 402`                                              | The account is out of credits. Add some in the OpenRouter settings.                                                                                                                                                                                                   |
| `API error 404`                                              | Usually an unknown model. Check the slug.                                                                                                                                                                                                                             |
| `API error 429` or `5xx`                                     | OpenRouter is busy or having trouble. The tool has already retried four times. Wait and run it again.                                                                                                                                                                 |
| `Request timed out` or `The request to OpenRouter timed out` | OpenRouter did not answer in time. Run it again, or choose another model.                                                                                                                                                                                             |
| `Cannot reach OpenRouter.`                                   | Check your network connection.                                                                                                                                                                                                                                        |
| `Something went wrong inside ask-openrouter.`                | A bug. Run it again with `--verbose`, which adds a `detail:` line to stderr (unless you also pass `--json`), and report it at the [issue tracker](https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/issues). The `--json` object never carries the detail. |

## What exit code 2 covers

An exit code of 1 is a mistake you can fix in the arguments or the settings. A 3 means the model was stopped at a limit. A 2 is the broad one: the call itself failed. [Command line](../command-line/#exit-codes) lists all the codes.

Exit code 2 covers these cases:

- The API refused the request, for example because of a bad key or a rate limit.
- Langfuse rejected the keys or did not answer, or the trace could not be delivered at the end.
- The network was down.
- The model went quiet for 60 seconds.
- The response held no answer or no token count.
- The stream broke halfway.
- Something unexpected failed inside the tool itself.

## Output that has started

Before any text has appeared, a failure leaves stdout empty. After text has started, streaming changes that. If the stream breaks halfway, you keep what already arrived: the partial answer stays on stdout and the tool ends its line, then writes the error to stderr and exits with code 2. A script that needs an answer to be complete or absent should check the exit code, which is 0 only for a complete answer.

## What the tool retries

Brief trouble on the API side does not end the run at once. When OpenRouter answers 429 (too many requests) or any 5xx error, when an error arrives before any answer or thinking has, or when the connection fails or the stream drops before any output, the tool waits and tries again, up to four more times. The first wait is about 300 milliseconds, and each one doubles: roughly 0.3, 0.6, 1.2 and 2.4 seconds, each varied by a quarter either way so that many clients do not retry in step. If the last attempt fails, you get that error and exit code 2. Nothing else is retried: a bad key, a malformed request, a timeout and a response with no answer fail on the first attempt. Retrying also stops the moment a request has produced its first piece of answer or thinking, shown or not, because a second attempt could repeat words you have already read. The rule applies to each request on its own. If the request for the third round fails before it has produced any text, it is retried, even though the first two rounds wrote some. In the worst case the waiting adds a little over five and a half seconds to each request.

## How long it waits

The tool waits up to 60 seconds for the first sign of life from the model, and up to 60 seconds between one piece of the stream and the next. There is no limit on the total time, so a long answer that keeps flowing is never cut off. A silence longer than 60 seconds ends the run with exit code 2.
