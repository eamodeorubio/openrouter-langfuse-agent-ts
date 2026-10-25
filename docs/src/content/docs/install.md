---
title: Install
description: Run ask-openrouter with npx, or install it once with npm or pnpm, and check that it works.
---

`ask-openrouter` is a command-line tool. It needs Node.js 22 or newer and nothing else. Check what you have:

```sh
node --version
```

If the answer is `v22` or higher, you are ready. If it is lower, install a current Node first, from [nodejs.org](https://nodejs.org) or with a version manager such as `nvm` or `fnm`. The package manager warns you when the version is too old, and a tool that runs on an unsupported Node can fail in odd ways, so take the warning seriously.

## Try it without installing

`npx` downloads the package the first time and runs it. It keeps the download in its cache, so the next run starts quickly.

```sh
npx ask-openrouter --help
```

That prints everything the tool can do, and it asks nothing of you: no key, no model, no network after the download. It is the quickest way to see whether the tool suits you. To pin a version, name it: `npx ask-openrouter@1 --help` runs the newest 1.x release.

`pnpm dlx ask-openrouter --help` does the same for pnpm users.

## Install it for good

If you will use the tool often, install it once. The command then lives on your path and starts at once.

With npm:

```sh
npm install --global ask-openrouter
```

With pnpm:

```sh
pnpm add --global ask-openrouter
```

Then check it:

```sh
ask-openrouter --version
```

The tool prints its version number on a line of its own, for example `1.0.0`.

Two things sometimes get in the way:

- **The command is not found after a global install with pnpm.** pnpm keeps global commands in a folder of its own, and your shell may not know about it yet. Run `pnpm setup`, then open a new terminal.
- **pnpm reports an ignored build script for `@openrouter/sdk`.** You can leave it ignored. The tool does not need that script.

## Update and remove

To move to the newest release:

```sh
npm install --global ask-openrouter@latest
pnpm add --global ask-openrouter@latest
```

Use the line that matches the tool you installed with. To remove it:

```sh
npm uninstall --global ask-openrouter
pnpm remove --global ask-openrouter
```

Versions follow [SemVer](https://semver.org/). The [overview](../#versions) says what that promises.

## Working on the tool itself

Cloning the repository and running it from source is a different job, for people who want to change the tool. [CONTRIBUTING.md](https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/blob/main/CONTRIBUTING.md) explains how to set that up.

## Next

The tool needs a key and a model before it can answer. [Set up](../set-up/) takes a few minutes.
