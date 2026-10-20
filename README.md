# openrouter-langfuse-agent-ts

[![CI](https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Picking a model on [OpenRouter](https://openrouter.ai) means choosing among hundreds of options, each with its own price, context window and strengths. This project is a small command-line tool that answers your questions about OpenRouter and helps you find the model that does your job at the lowest cost.

Ask it what you need to do, and it helps you weigh the options. The agent behind it will be instrumented with [Langfuse](https://langfuse.com), so every run can be traced and inspected.

## Status

The project has no release yet and is still taking shape. The tooling, the quality checks and the release pipeline are in place. The CLI has not shipped, so there is nothing to install or run yet. When the first feature lands, this page gains a usage section.

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
pnpm test        # Vitest, with HTTP mocked by nock
```

Tests never reach the network. Any call to OpenRouter or Langfuse is mocked.

## Releases

Nobody tags or releases by hand. Versions follow [SemVer](https://semver.org/) and come from the commit history: a `fix:` raises the patch number, a `feat:` raises the minor number, and a breaking change raises the major number. On every push to `main`, once the checks pass, [release-please](https://github.com/googleapis/release-please) opens or updates a release pull request with the next version and the changelog. Merging that pull request creates the tag (`v0.1.0` and so on) and the GitHub release.

Nothing has shipped yet, so the version is `0.0.0`. The first `feat:` that lands will become `v0.1.0`.

## Documentation

The user documentation is a [Starlight](https://starlight.astro.build) site in `docs/`, published to [GitHub Pages](https://eamodeorubio.github.io/openrouter-langfuse-agent-ts/) whenever `main` changes. To read or edit it locally:

```sh
pnpm docs:dev
```

## Project layout

| Path                | What lives there                                        |
| ------------------- | ------------------------------------------------------- |
| `packages/cli/`     | The CLI: source in `src/`, tests in `test/`             |
| `docs/`             | The documentation site                                  |
| `openspec/`         | Specs and change proposals                              |
| `QUALITY_RUBRIC.md` | The yardstick for writing and reviewing code            |
| `AGENTS.md`         | Working rules for AI coding agents and for contributors |

## Contributing

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through [SECURITY.md](SECURITY.md), not public issues.

A change that alters what the product does, or takes a decision worth remembering, begins with a spec written with [OpenSpec](https://github.com/Fission-AI/OpenSpec); so does a substantial refactor. A small fix or refactor needs none. Every behavior change begins with a failing test. Work ships in small product slices, each one a [semantic commit](https://www.conventionalcommits.org/). One pull request carries the spec, all its product slices and any chore work, and its title sets the version bump under [SemVer](https://semver.org/). [CONTRIBUTING.md](CONTRIBUTING.md) walks through the whole flow.

## License

[MIT](LICENSE) © 2026 Enrique Javier Amodeo Rubio
