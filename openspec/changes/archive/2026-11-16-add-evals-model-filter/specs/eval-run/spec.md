# Spec Delta

## ADDED Requirements

### Requirement: Choosing the models of a run
A run SHALL ask every model of `vars.model` in the config, unless `--model <id[,id...]>` is given. With it, the run SHALL ask only the listed models, each once, in the order of the config. Every id SHALL be a model of that list, matched exactly. The flag SHALL narrow the matrix and never add to it.

#### Scenario: No flag
- **WHEN** the script runs without `--model`
- **THEN** the run asks the two models of the config, as before

#### Scenario: One model
- **WHEN** the script runs with `--model anthropic/claude-haiku-5.5`
- **THEN** every case is asked of that model only, and the report holds one block, for it

#### Scenario: Several models
- **WHEN** the script runs with `--model anthropic/claude-haiku-5.5,nvidia/nemotron-3-ultra-550b-a55b:free,anthropic/claude-haiku-5.5`
- **THEN** the run asks the two models of the config once each, in the order of the config

### Requirement: Unknown models are refused
A run whose `--model` holds an id outside the config's list, or an empty id, SHALL stop before any request, including the fetch of the catalog and the start of a published version. It SHALL exit with the setup failure code 3 and a message that names the offending id and lists the models of the config.

#### Scenario: Unknown id
- **WHEN** the script runs with `--model openai/gpt-oss-20b` and the config does not list it
- **THEN** it exits 3, stderr names `openai/gpt-oss-20b` and the two models of the config, and no request is sent

#### Scenario: Near miss
- **WHEN** the id differs from a listed one by case or by a trailing space
- **THEN** the run is refused as an unknown id

#### Scenario: Empty id
- **WHEN** the value is `anthropic/claude-haiku-5.5,` or the empty string
- **THEN** the run is refused and no request is sent

### Requirement: Placeholders avoid the models of the run
The free model that a placeholder picks SHALL differ from every model that the run asks. A run narrowed to one model SHALL NOT treat the models it left out as under test.

#### Scenario: Paid model only
- **WHEN** the run asks `anthropic/claude-haiku-5.5` alone and a case holds `{free_model}`
- **THEN** the question names a free model of the snapshot other than `anthropic/claude-haiku-5.5`, and it may be `nvidia/nemotron-3-ultra-550b-a55b:free`

### Requirement: The target names the models
When `--model` is given, `target.txt` SHALL name the models of the run after the target, and so the first line of the report SHALL. A run without `--model` SHALL write the same `target.txt` as before the flag existed.

#### Scenario: Narrowed run
- **WHEN** a run of the local build asks `anthropic/claude-haiku-5.5` alone
- **THEN** the report starts with `target: local build (packages/cli/dist/index.js), models: anthropic/claude-haiku-5.5`

#### Scenario: Unnarrowed run
- **WHEN** a run has no `--model`
- **THEN** `target.txt` is byte for byte what it was before this change
