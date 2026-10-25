---
title: ask-openrouter
description: A command-line tool that answers questions about OpenRouter and helps you find the model that does your job at the lowest cost.
---

OpenRouter puts hundreds of models behind one API. Each has its own price, context window and strengths, and the cheapest listed price is rarely the cheapest way to do your job. `ask-openrouter` is a small command-line tool that answers your questions about OpenRouter and helps you find the model that fits your use case at the lowest cost.

You ask in plain language. The model that answers does not rely on its memory, which goes stale; it looks models up in OpenRouter's live catalog, searches it by price and capability, and does the arithmetic of a cost estimate with a calculator. Here is a real run, with the lookups shown by `--verbose`:

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

The prices came from the catalog at the moment of the question, and the sums from the calculator. The answer streams to stdout as it arrives; the model and token lines go to stderr, so pipes stay clean.

## Where to start

1. [Install](install/) the tool, or try it first with `npx ask-openrouter --help`. It needs Node.js 22 or newer.
2. [Set up](set-up/) a key and a model. It takes a few minutes.
3. [Ask a question](ask-a-question/) and see what comes back.

## When you want more

- [Command line](command-line/) lists every flag, every setting and every exit code.
- [How the model finds answers](tools/) explains the lookups, the catalog search and the calculator.
- [Tracing with Langfuse](tracing/) records each run in a [Langfuse](https://langfuse.com) project, so you can inspect what the model was shown and what it did.
- [JSON output](json-output/) turns a run into one JSON object for scripts, with a JSON Schema.
- [Troubleshooting](troubleshooting/) reads the error messages and says what to do about them.

## Versions

From 1.0 the flags, the exit codes and the JSON output follow [SemVer](https://semver.org/). A change that would break a script raises the major number, so you can pin a major version and trust it.

## Following along and helping

Every behavior change starts with a written spec and a failing test, and ships as a small, reviewed increment. [How changes are made](how-changes-are-made/) describes the path every change follows. If you want to take part, [CONTRIBUTING.md](https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/blob/main/CONTRIBUTING.md) explains the flow from the first spec to the merged pull request. Bugs and ideas go to the [issue tracker](https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/issues).
