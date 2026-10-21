# openrouter-langfuse-agent-ts

[![CI](https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Picking a model on [OpenRouter](https://openrouter.ai) means choosing among hundreds of options, each with its own price, context window and strengths. This project is a small command-line tool that answers your questions about OpenRouter and helps you find the model that does your job at the lowest cost.

Ask it what you need to do, and it helps you weigh the options. The agent behind it will be instrumented with [Langfuse](https://langfuse.com), so every run can be traced and inspected.

## Status

The project has no release yet and is still taking shape. The tooling, the quality checks and the release pipeline are in place. The CLI asks an OpenRouter model your question, and before it answers, the model is told to look up any model in OpenRouter's live catalog instead of recalling prices and context windows from memory. It can also search the catalog by price, context size and capability, and it does the arithmetic of a cost estimate with a calculator instead of in its head. Tracing every run with Langfuse is the next piece. See [Usage](#usage) to try what exists.

## Requirements

- Node.js 26 or newer (the exact version is in `.nvmrc`)
- [pnpm](https://pnpm.io), pinned in `package.json`. With Corepack enabled, `corepack enable` picks the right version for you.

## Getting started

Clone the repository and install the dependencies:

```sh
pnpm install
```

Then check that everything works:

```sh
pnpm check       # formatting and lint (Biome and Prettier)
pnpm typecheck   # TypeScript, no emit
pnpm test        # Vitest, with HTTP mocked by nock or a local fake server
```

Tests never reach the public network. Calls to OpenRouter and Langfuse are mocked with `nock` or served by a local fake server.

## Usage

Put your OpenRouter key and a model name in `packages/cli/.env` (the template is `.env.example`), then ask a question:

```sh
cp .env.example packages/cli/.env   # then fill in the key and the model
pnpm dev -q "What is a token, and why do providers charge for them?"
echo "Name one planet." | pnpm dev --model openai/gpt-4o-mini
```

The answer streams to stdout as it arrives. The model that served the request and the token usage go to stderr, so pipes stay clean.

The model has three tools. `get_model` fetches the details of one OpenRouter model by its slug. `search_models` filters and sorts the catalog by price, context size, capabilities and benchmark scores. `calculate` evaluates plain arithmetic, numbers and `+ - * / ( )` only, and shows the formula with the result. Prices come in dollars per million tokens. The system instructions tell it to check the catalog instead of trusting its memory, so a question such as "how does `openai/gpt-oss-20b` compare with `openai/gpt-oss-120b` on price?" may take several round trips to the model. You still get one answer. Add `--verbose` to see each lookup on stderr as it starts, and read the `tokens:` line as the sum of every round trip.

If the model thinks before it answers, the thinking shows on stderr whenever you are watching stderr on a screen (when it is not redirected to a file or a pipe). `--thinking` and `--no-thinking` override that. There is no default model: pass `--model` or set `OPENROUTER_MODEL`. A run exits 0 on success, 1 when the arguments or the settings are wrong, 2 when the API call fails, and 3 when the model keeps calling tools past eight rounds. A stream that breaks halfway keeps the partial answer on stdout and exits 2. The [usage guide](https://eamodeorubio.github.io/openrouter-langfuse-agent-ts/ask-a-question/) covers every case.

## Releases

Nobody tags or releases by hand. Versions follow [SemVer](https://semver.org/) and come from the commit history: a `fix:` raises the patch number, a `feat:` raises the minor number, and a breaking change raises the major number. On every push to `main`, once the checks pass, [release-please](https://github.com/googleapis/release-please) opens or updates a release pull request with the next version and the changelog. Merging that pull request creates the tag (`v0.1.0` and so on) and the GitHub release.

Nothing has shipped yet, so the version is `0.0.0`. The first release will be `v0.1.0`.

## Documentation

The user documentation is a [Starlight](https://starlight.astro.build) site in `docs/`, published to [GitHub Pages](https://eamodeorubio.github.io/openrouter-langfuse-agent-ts/) whenever `main` changes. To read or edit it locally:

```sh
pnpm docs:dev
```

## Project layout

| Path                | What lives there                             |
| ------------------- | -------------------------------------------- |
| `packages/cli/`     | The CLI: source in `src/`, tests in `test/`  |
| `docs/`             | The documentation site                       |
| `openspec/`         | Specs and change proposals                   |
| `QUALITY_RUBRIC.md` | The yardstick for writing and reviewing code |
| `AGENTS.md`         | Working rules for AI coding agents           |

## Contributing

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through [SECURITY.md](SECURITY.md), not public issues.

A change that alters what the product does, or takes a decision worth remembering, begins with a spec written with [OpenSpec](https://github.com/Fission-AI/OpenSpec); so does a substantial refactor. A small fix or refactor needs none. Every behavior change begins with a failing test. Work ships in small product slices, each one a [semantic commit](https://www.conventionalcommits.org/). One pull request carries the spec, all its product slices and any chore work, and its title sets the version bump under [SemVer](https://semver.org/). [CONTRIBUTING.md](CONTRIBUTING.md) walks through the whole flow.

## License

[MIT](LICENSE) © 2026 Enrique Javier Amodeo Rubio
