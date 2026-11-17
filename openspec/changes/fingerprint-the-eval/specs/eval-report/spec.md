# Spec Delta

## ADDED Requirements

### Requirement: The report names the eval
When `eval.txt` sits beside the results file, the report SHALL write a line `eval: <fingerprint>` right after the `target:` line. When the file is missing, as in the results of an older run, the report SHALL be what it was before this requirement.

#### Scenario: A run with a fingerprint
- **WHEN** the folder holds `target.txt` with `local build (packages/cli/dist/index.js)` and `eval.txt` with `7K2M9QX4BT3D`
- **THEN** the report starts with the lines `target: local build (packages/cli/dist/index.js)` and `eval: 7K2M9QX4BT3D`

#### Scenario: An older run
- **WHEN** the folder has no `eval.txt`
- **THEN** the report holds no `eval:` line and is otherwise unchanged
