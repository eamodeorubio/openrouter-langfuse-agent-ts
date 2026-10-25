# Spec Delta

## MODIFIED Requirements

### Requirement: Unknown arguments
The CLI SHALL reject unknown options and positional arguments with an error message and the full help text on stderr, as `cli-help` defines, and exit 1.

#### Scenario: Stray positional
- **WHEN** the CLI runs with `-q "hi" extra`
- **THEN** stderr holds the error message and the help text, the exit code is 1, and no request is sent
