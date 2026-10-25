# npm-distribution Specification

## Purpose
Defines how the CLI reaches users as an npm package, and how a release publishes it and versions the files that name their release.

## Requirements

### Requirement: Installable package
The `packages/cli` package SHALL be public on npm as `ask-openrouter`, with one executable of the same name. It SHALL run with `npx`, and after `npm i -g` or `pnpm add -g`.

#### Scenario: Run without installing
- **WHEN** a user runs `npx ask-openrouter --help` with Node 22 or newer
- **THEN** the help text is printed and the exit code is 0

#### Scenario: Global install
- **WHEN** a user installs the package globally and runs `ask-openrouter -q "hi"` in a directory
- **THEN** the CLI runs there, reads `.env` from that directory, and behaves as in `ask-question`

#### Scenario: Oldest Node
- **WHEN** the manifest is compared with the production dependencies
- **THEN** `engines.node` is `>=N`, where N is the highest `>=` floor any direct dependency declares, and the CI workflow runs the tests on Node N

#### Scenario: Old Node
- **WHEN** the package is installed with a Node older than the `engines` range
- **THEN** the package manager warns or refuses, and does not install silently

### Requirement: Package contents
The packed archive SHALL hold the compiled code, `package.json`, the README and the licence. It SHALL NOT hold sources, tests, specs, docs sources, `.env` files, or mutation reports. The manifest SHALL declare the licence, repository, bugs address, homepage, keywords, `engines`, public access and provenance.

#### Scenario: Archive paths

| Path | In the archive |
| --- | --- |
| `dist/**` | yes |
| `README.md`, `LICENSE`, `package.json` | yes |
| `src/**`, `test/**`, `scripts/**` | no |
| `.env`, `.stryker/**`, `*.tsbuildinfo` | no |

#### Scenario: Pack list
- **WHEN** `pnpm pack` runs in `packages/cli` after a build
- **THEN** the archive lists exactly the paths marked yes, and no path marked no

#### Scenario: Executable entry
- **WHEN** the archive's `bin` file is read
- **THEN** its first line is `#!/usr/bin/env node`

### Requirement: Publish on release
The release job SHALL publish the package to npm, with provenance, only in a run where Release Please created a release. A run that created none SHALL NOT publish. A failed publish SHALL fail the job.

#### Scenario: Release created
- **WHEN** Release Please reports a created release for `packages/cli`
- **THEN** the workflow builds, checks the pack list, and publishes that version

#### Scenario: No release
- **WHEN** Release Please only opens or updates a release pull request
- **THEN** the job publishes nothing

### Requirement: First release is 1.0.0
The first release after this change SHALL be 1.0.0, regardless of the bump the commits since v0.5.0 imply. Afterwards the version SHALL follow the commits again.

#### Scenario: Release pull request
- **WHEN** Release Please opens the release pull request with the override set
- **THEN** it proposes 1.0.0

#### Scenario: Override removed
- **WHEN** the override is removed after 1.0.0 is released and a `fix:` lands
- **THEN** the next proposal is 1.0.1

### Requirement: Schema id follows the release
Each release SHALL rewrite the `$id` of the published JSON Schema to the raw GitHub URL at the new release tag, so that the file at a tag names that tag.

#### Scenario: Version rewritten
- **WHEN** the release updater runs on the committed schema file for version `1.0.0`
- **THEN** the `$id` ends `/v1.0.0/docs/public/schemas/json-output.schema.json` and no other line changes
