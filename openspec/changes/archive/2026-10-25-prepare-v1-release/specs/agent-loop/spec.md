# Spec Delta

## MODIFIED Requirements

### Requirement: Malformed tool call
A tool call that arrives without an id SHALL fail the run as an API failure: one line on stderr, exit 2. No tool SHALL run and no further request SHALL be sent, since the API would refuse a result it cannot match to a call.

#### Scenario: Call without an id
- **WHEN** a response ends with a tool call whose id is empty
- **THEN** stderr holds one line saying the model asked to use a tool in a way this tool cannot follow, no tool ran, and the exit code is 2
