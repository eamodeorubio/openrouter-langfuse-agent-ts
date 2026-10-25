# ask-openrouter

[![npm](https://img.shields.io/npm/v/ask-openrouter.svg)](https://www.npmjs.com/package/ask-openrouter) [![CI](https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/blob/main/LICENSE)

Picking a model on [OpenRouter](https://openrouter.ai) means choosing among hundreds of options, each with its own price, context window and strengths. The cheapest listed price is rarely the cheapest way to do your job. `ask-openrouter` is a small command-line tool that answers your questions about OpenRouter and helps you find the model that does your job at the lowest cost.

You ask in plain language. The model that answers does not rely on its memory, which goes stale; it looks models up in OpenRouter's live catalog, searches it by price and capability, and does the arithmetic of a cost estimate with a calculator.

```sh
ask-openrouter -q "What would 5 million input tokens and 1 million output tokens cost on openai/gpt-oss-120b, and on openai/gpt-oss-20b?"
```

The answer streams to your terminal as it arrives. The model that served the request and the tokens it used follow on stderr.

## Install

You need [Node.js](https://nodejs.org) 22 or newer. Run the tool without installing it:

```sh
npx ask-openrouter --help
```

Or install it once, with npm or pnpm:

```sh
npm install --global ask-openrouter
pnpm add --global ask-openrouter
```

Check it with `ask-openrouter --version`.

## Set up

The tool needs an OpenRouter key and the name of a model. Create a key at [openrouter.ai/keys](https://openrouter.ai/keys), choose a model from [openrouter.ai/models](https://openrouter.ai/models), and put both in the environment, or in a file named `.env` in the directory you run the tool from:

```text
OPENROUTER_API_KEY=sk-or-v1-your-key-here
OPENROUTER_MODEL=openai/gpt-4o-mini
```

There is no default model, because choosing models carefully is what the tool is for. A value in the environment wins over the file. Keep `.env` out of Git.

## Ask

Give the question with `-q`, or pipe it in:

```sh
ask-openrouter -q "What is a token, and why do providers charge for them?"
echo "Name one planet." | ask-openrouter --model openai/gpt-4o-mini
```

If the model thinks before it answers, the thinking shows on stderr when you are watching a terminal. Add `--verbose` to see each lookup the model makes. Add `--json` for a script: the tool then stays silent until the run ends and writes one JSON object, with a JSON Schema to validate it.

A run exits 0 on success, 1 when the arguments or the settings are wrong, 2 when the API call fails or a trace cannot be delivered, and 3 when the model keeps calling tools past eight rounds. When something is wrong, the message says what to do about it. `ask-openrouter --help` prints every flag, every setting and every exit code.

To record each run in [Langfuse](https://langfuse.com), set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL` next to the OpenRouter settings. Set all three or none. The trace carries your question, the model's messages and thinking, every tool call, the answer, and the tokens and cost of each request. The tool masks your keys, bearer tokens and email addresses, and nothing else, so names and addresses typed into a question travel as they are.

## Documentation

The full guide is at [eamodeorubio.github.io/openrouter-langfuse-agent-ts](https://eamodeorubio.github.io/openrouter-langfuse-agent-ts/):

- [Install](https://eamodeorubio.github.io/openrouter-langfuse-agent-ts/install/) and [set up](https://eamodeorubio.github.io/openrouter-langfuse-agent-ts/set-up/) in detail
- [Ask a question](https://eamodeorubio.github.io/openrouter-langfuse-agent-ts/ask-a-question/), and what to ask
- [Command line](https://eamodeorubio.github.io/openrouter-langfuse-agent-ts/command-line/): every flag, setting and exit code
- [How the model finds answers](https://eamodeorubio.github.io/openrouter-langfuse-agent-ts/tools/)
- [Tracing with Langfuse](https://eamodeorubio.github.io/openrouter-langfuse-agent-ts/tracing/)
- [JSON output](https://eamodeorubio.github.io/openrouter-langfuse-agent-ts/json-output/) and its JSON Schema
- [Troubleshooting](https://eamodeorubio.github.io/openrouter-langfuse-agent-ts/troubleshooting/)

From 1.0 the flags, the exit codes and the JSON output follow [SemVer](https://semver.org/). A change that would break a script raises the major number, so you can pin a major version and trust it.

## Contributing

Everyone taking part follows the [Code of Conduct](https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/blob/main/CODE_OF_CONDUCT.md). Security problems go through [SECURITY.md](https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/blob/main/SECURITY.md), not public issues. Bugs and ideas go to the [issue tracker](https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/issues).

A change that alters what the product does begins with a written spec and a failing test, and ships as a small, reviewed increment. [CONTRIBUTING.md](https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/blob/main/CONTRIBUTING.md) walks through the whole flow, from setting up a clone to a merged pull request.

## License

[MIT](https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/blob/main/LICENSE) © 2026 Enrique Javier Amodeo Rubio
