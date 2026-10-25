---
title: Command line
description: Every flag, every setting and every exit code of ask-openrouter, on one page, as the --help text prints them.
---

This page is the reference. It lists everything the tool accepts and everything it can return. It expands on `ask-openrouter --help`, which prints the same flags, settings and exit codes in shorter form. To learn by doing, start with [Ask a question](../ask-a-question/).

## Usage

```text
ask-openrouter -q <question> [options]
echo <question> | ask-openrouter [options]
```

The question comes from `-q`, or from standard input when `-q` is absent. The tool takes no positional arguments, so a question that is not quoted is an error.

## Flags

| Flag              | What it does                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `-q <question>`   | The question. Without it, the question is read from standard input.                        |
| `--model <model>` | The model that answers, a slug such as `openai/gpt-4o-mini`. Overrides `OPENROUTER_MODEL`. |
| `--thinking`      | Show the model's thinking on stderr, even when stderr is not a terminal.                   |
| `--no-thinking`   | Do not show the thinking, even on a terminal. Giving both thinking flags is an error.      |
| `--verbose`       | Show each tool call the model makes, and the trace id, on stderr.                          |
| `--json`          | Write one JSON object when the run ends: to stdout on success, to stderr on failure.       |
| `-v`, `--version` | Print the version and exit.                                                                |
| `-h`, `--help`    | Print the help and exit.                                                                   |

`-q` takes the next argument as the question, whatever it starts with, so `-q "-5 degrees in Fahrenheit"` is a question. The price is that `-q --help` asks the model the question "--help" and prints no help. `--model` is stricter: a model slug never starts with a dash, so `--model --verbose` is an error that says the model is missing.

### Help and version

`--help` prints the usage, each flag, every setting the tool reads, the exit codes and a few examples. The first line carries the version. The text goes to stdout, so `ask-openrouter --help | less` works, and it needs no key and no model.

`--version` prints the version alone, on one line, which suits a script: `$(ask-openrouter --version)`.

Each flag wins over every other argument, even over `--json` and over arguments that would otherwise be an error. Give both and you get the help. If the tool cannot read its own `package.json`, `--version` says so on stderr and exits with code 2, while `--help` still prints, with the name alone as its title.

The same help text follows the message of every mistake in the arguments, on stderr, so that the fix is on the screen when the error is.

## Settings

The tool reads these from the environment and from a `.env` file in the current directory. A value in the environment wins. See [Set up](../set-up/) for how to provide them.

| Setting                        | Meaning                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY`           | Your OpenRouter key. Required.                                                                              |
| `OPENROUTER_MODEL`             | The model that answers when `--model` is not given.                                                         |
| `LANGFUSE_PUBLIC_KEY`          | The public key of a Langfuse project. Set it with the next two to trace each run, or leave all three unset. |
| `LANGFUSE_SECRET_KEY`          | The secret key of the same project.                                                                         |
| `LANGFUSE_BASE_URL`            | Where Langfuse is, such as `https://cloud.langfuse.com`.                                                    |
| `LANGFUSE_TRACING_ENVIRONMENT` | Optional. The environment the traces are filed under. The default is `default`.                             |
| `LANGFUSE_RELEASE`             | Optional. The release the traces are attributed to. The default is the version of the tool.                 |
| `NO_COLOR`                     | Set to any non-empty value to print the thinking without dimming.                                           |

The three Langfuse settings go together. [Tracing with Langfuse](../tracing/) explains what a trace holds.

## Streams

The tool keeps the result and everything else apart, so pipes and redirects stay clean.

- **Stdout** carries the answer, as it arrives. With `--json` it carries the success object instead. `--help` and `--version` write here too.
- **Stderr** carries the rest: the model's thinking, the `tool:` lines of `--verbose`, the id of the trace, the `model:` and `tokens:` lines, one line when tracing is off, and every error. With `--json` it carries the failure object instead.

## Exit codes

| Code | Meaning                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | Success: the model answered, completely.                                                                                                                                             |
| 1    | The arguments or the settings are wrong: no question, an unknown flag, both thinking flags, no key, no model, an unreadable `.env`, or Langfuse settings that are only partly there. |
| 2    | The API call failed, timed out or returned something unusable, a trace could not be delivered, or the tool failed inside.                                                            |
| 3    | The model kept calling tools past eight rounds.                                                                                                                                      |
| 130  | You pressed Ctrl-C. The trace, if there is one, is still sent.                                                                                                                       |
| 143  | The process received `SIGTERM`. The trace, if there is one, is still sent.                                                                                                           |

A script that needs an answer to be complete or absent should check the code, which is 0 only for a complete answer. [Troubleshooting](../troubleshooting/) says what to do about each failure.
