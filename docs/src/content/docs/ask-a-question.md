---
title: Ask a question
description: Send one question to an OpenRouter model, from an argument or a pipe, and read the answer, the thinking and the cost of the run.
---

The tool sends one question to one OpenRouter model and prints the answer as it arrives, word by word, without waiting for the end. If the model thinks before it answers, the tool shows that too. Before it answers, the model may also check OpenRouter's live catalog for the facts it needs and work out the arithmetic with a calculator, and you still see one question and one answer. On the side, the tool tells you which model answered and how many tokens the exchange used.

You need a key and a model first. [Set up](../set-up/) covers both.

## Ask

Give the question with `-q`:

```sh
ask-openrouter -q "What is a token, and why do providers charge for them?"
```

Or pipe it in:

```sh
echo "What is a token, and why do providers charge for them?" | ask-openrouter
cat long-prompt.txt | ask-openrouter --model openai/gpt-4o-mini
```

When both are present, `-q` wins and the pipe is left unread. Surrounding whitespace is trimmed. If you give neither, and the input is a terminal, the tool prints its usage message and exits instead of waiting for you to type.

`-q` takes the next argument as the question, whatever it starts with, so `-q "-5 degrees in Fahrenheit"` works. The price is that `-q --model` reads `--model` as the question.

## What to ask

The tool is built for one job: helping you find the model that does your work at the lowest cost. It answers any question about OpenRouter, but it is at its best with questions that need current facts and a little arithmetic.

- Compare two models you already know: "How do `openai/gpt-oss-20b` and `openai/gpt-oss-120b` compare on price and context window?"
- Put a number on a workload: "What would 5 million input tokens and 1 million output tokens a month cost on `openai/gpt-oss-120b`?"
- Search the catalog: "Find me the 3 cheapest models that support tool calling and have at least a 200k context window."
- Describe the job and let it propose: "I summarise 2,000 support tickets a day, about 800 tokens each. Which model is the cheapest one that does it well?"

Behind the scenes the model looks things up, searches and calculates before it answers. [How the model finds answers](../tools/) shows how, and how to watch it.

## What you see

The tool writes to two channels (with `--json` it writes one object instead; see [For scripts](#for-scripts)). Stdout carries the result: the answer, as it arrives. Stderr carries everything else that is about the run rather than the result, which means the model's thinking (when there is some and when it is shown), the lookup lines (when you ask for them with `--verbose`), one line saying tracing is off when no Langfuse settings are present, the id of the trace (with `--verbose` and tracing on), and two status lines once the answer is complete:

```text
$ ask-openrouter -q "Name three primary colors, one per line."
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
ask-openrouter -q "Name three primary colors, one per line." > answer.txt
```

The answer lands in the file, and the thinking and the status lines stay on your screen.

How early the first words appear depends on the model. Some models send their answer a piece at a time and the text flows. Others hold the whole answer back and deliver it in one burst; some free models behave this way. The tool prints each piece the moment it arrives, so a burst shows up as one block.

Some servers do not stream at all. A proxy in front of OpenRouter may answer with the whole response at once. The tool treats that as a stream of one piece: the thinking, if it is shown, and the answer arrive together, and the status lines follow as usual. You see no error, only a single block. If that whole response holds no answer or no token count, it fails the way a stream does, with exit code 2.

## Watching the model think

Some models think before they answer, and OpenRouter passes that thinking along as plain text. The tool writes it to stderr, never to stdout, so the answer in a pipe or a file stays the answer and nothing else.

By default the thinking shows when you are watching stderr on your screen. The tool's own words for that are "stderr is a terminal", and the idea is simple. A terminal is the live window where you type commands. When you run the tool and redirect nothing, stdout and stderr both print in that window, so stderr is a terminal. When you send stderr somewhere else, with `2> log.txt` to a file or through a pipe to another program, nothing is printed in the window for it, and stderr is no longer a terminal. The default follows that: a person watching a screen sees the thinking, and a log or a pipeline does not fill with reasoning nobody asked for.

To read the table, ask where stderr went. You can try it yourself: add `2> /dev/null` to any command, and the thinking, which lived on stderr, disappears from the window.

| You run                                       | Thinking shows? | Why                          |
| --------------------------------------------- | --------------- | ---------------------------- |
| `ask-openrouter -q "..."`                     | yes             | stderr is your screen        |
| `ask-openrouter -q "..." > answer.txt`        | yes             | only stdout went to the file |
| `ask-openrouter -q "..." 2> log.txt`          | no              | stderr went to a file        |
| `ask-openrouter -q "..." 2>&1 \| tee run.log` | no              | stderr joined the pipe       |
| the same command in a CI job                  | no              | there is no terminal         |
| any of these with `--thinking`                | yes             | you asked for it             |
| any of these with `--no-thinking`             | no              | you asked for silence        |

Two flags override the default. `--thinking` shows the thinking even when stderr is not a terminal, and `--no-thinking` hides it even when it is. Giving both is a mistake, and the tool says so and stops.

The dimming is a terminal feature. It applies only when stderr is a terminal, and it switches off when the `NO_COLOR` environment variable is set to anything other than an empty value. Thinking written to a file or a pipe is plain text.

Only readable thinking is shown. Some providers return their reasoning encrypted, or only as a short summary. The tool writes nothing for those, and the wait stays quiet. The reasoning count on the `tokens:` line still tells you the model thought.

## For scripts

Add `--json` and the tool writes a single JSON object when the run ends: to stdout on success, to stderr on failure, with a stable error code. Exit codes do not change. [JSON output](../json-output/) has the details and the JSON Schema.

## If something goes wrong

The tool says what is wrong and how to fix it, and exits with a code that is not zero. [Troubleshooting](../troubleshooting/) lists the messages and the fixes.

## What is not here yet

The status lines show model and tokens only. The cost in dollars is in the `--json` object and in the trace, not on your screen, and the tool prints the id of the trace but not a link to it.
