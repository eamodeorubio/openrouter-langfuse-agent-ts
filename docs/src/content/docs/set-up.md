---
title: Set up
description: Get an OpenRouter key, choose a model, tell the tool where to find them, and ask a first question.
---

The tool needs two things before it can answer: a key that proves who you are to OpenRouter, and the name of the model that should answer. Both are quick to arrange. Tracing with Langfuse is a third thing, optional, and has [a page of its own](../tracing/).

## 1. Get an OpenRouter key

Sign in at [openrouter.ai](https://openrouter.ai), open [openrouter.ai/keys](https://openrouter.ai/keys) and create a key. It starts with `sk-or-`. Copy it somewhere safe; OpenRouter shows it once.

The key is a secret. It pays for your requests, so anyone who has it can spend your credit. The tool never prints it, never sends it anywhere but OpenRouter, and masks it in anything it writes. Keep it out of Git, out of screenshots and out of chat messages.

A few requests cost cents, but a paid model answers only when the account has credit. Add some at [openrouter.ai/settings/credits](https://openrouter.ai/settings/credits) before your first question, or choose a free model, as described in the next step.

## 2. Choose a model

A model has a slug, written `author/name`. Some slugs end in a variant, such as `:free`.

```text
openai/gpt-4o-mini
anthropic/claude-haiku-4.5
```

[openrouter.ai/models](https://openrouter.ai/models) lists them all, with prices. Models whose slug ends in `:free` cost nothing to run, though they usually come with tighter rate limits.

There is no default model. A default would hide a spending decision inside a constant, and choosing models carefully is what this tool is for. If you give no model, the tool says so and stops before it sends anything.

This model answers your questions. It is not the model you are asking about. You can ask a cheap model which expensive model suits your job, and it will look the answer up in the live catalog.

## 3. Tell the tool

The tool reads its settings from the environment, and from a file named `.env` in the directory you run it from. Two settings are enough to ask a question:

| Setting              | Meaning                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `OPENROUTER_API_KEY` | Your key. Required.                                                                         |
| `OPENROUTER_MODEL`   | The model that answers your question, such as `openai/gpt-4o-mini`. `--model` overrides it. |

The quickest way to try them is to export them in your shell. These examples assume a POSIX shell, as on macOS, Linux and Windows Subsystem for Linux. In PowerShell, write `$env:OPENROUTER_API_KEY = "..."`, or use a `.env` file, which works the same everywhere.

```sh
export OPENROUTER_API_KEY=sk-or-v1-your-key-here
export OPENROUTER_MODEL=openai/gpt-4o-mini
```

They last until you close the terminal. To keep them, put the same two lines in your shell profile, or use a `.env` file.

### A `.env` file

Create a file named `.env` with one setting per line:

```text
OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPENROUTER_MODEL=openai/gpt-4o-mini
```

The tool looks for it in the **current directory**, the folder you are in when you run the command. It does not look in the folder where the tool is installed, and it does not search the folders above. So a global install reads the `.env` of whichever project you are standing in, and a different folder can hold a different key or a different model.

Lines that start with `#` are comments. A value already present in the environment wins over the file, which lets you override one setting for one run without touching the file:

```sh
OPENROUTER_MODEL=openai/gpt-4o ask-openrouter -q "..."
```

If you work in a Git repository, add `.env` to its `.gitignore`. A key committed to a public repository is found by scanners within minutes.

## 4. Ask something small

```sh
ask-openrouter -q "In one sentence, what is a token?"
```

You should see an answer, then two lines about the model and the tokens used. The wording and the numbers will differ from run to run; the shape will not. Before the answer, stderr also carries one line saying that tracing is off. That line is a reminder that no Langfuse settings are present. It is not an error, and [Tracing with Langfuse](../tracing/) explains how to switch tracing on, which makes the line disappear:

```text
Langfuse tracing is off: LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY and LANGFUSE_BASE_URL are not set.
```

Then the answer itself:

```text
A token is a small chunk of text, often a word or part of a word, that a language model reads and writes.
model: openai/gpt-4o-mini
tokens: 25 prompt, 22 completion, 47 total
```

If you see an error instead, it says what is missing and how to fix it. [Troubleshooting](../troubleshooting/) lists the messages you are most likely to meet.

## Next

[Ask a question](../ask-a-question/) shows what the tool does with a question, and what to ask it. [Command line](../command-line/) lists every flag and setting on one page.
