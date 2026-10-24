# Spec Delta

## MODIFIED Requirements

### Requirement: Verbose flag
The CLI SHALL accept `--verbose`. It SHALL list the flag in the usage message. It turns on the `tool:` lines of `agent-loop` and, in a traced run, the trace id line of `tracing-setup`, and nothing else.

#### Scenario: Flag accepted
- **WHEN** the CLI runs with `-q "hi" --verbose`
- **THEN** the run proceeds as without the flag, plus the `tool:` lines
