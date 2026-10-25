# Spec Delta

## ADDED Requirements

### Requirement: Connection released
When a request to the API ends before the end of its stream, the CLI SHALL close the connection to the server, so that the server sees it close within 1 s. That holds whatever the process has done since the response began, a garbage collection included. A request ends before the end of its stream by an idle timeout or an error chunk.

#### Scenario: Silent after text
- **WHEN** the server sends `Hel`, then sends nothing and keeps the connection open
- **THEN** the CLI fails with the timeout of `Stream timeouts`, and the server sees the connection close within 1 s of that failure

#### Scenario: Silent from the start
- **WHEN** the server accepts the request, sends no response and keeps the connection open
- **THEN** the CLI fails with the timeout of `Stream timeouts`, and the server sees the connection close within 1 s of that failure

#### Scenario: Error chunk, connection left open
- **WHEN** the server sends `Hel`, then an error chunk, and keeps the connection open
- **THEN** the CLI fails with the error, and the server sees the connection close within 1 s of that failure

#### Scenario: Garbage collection in between
- **WHEN** the server sends `Hel`, a full garbage collection runs before the idle limit is reached, and the server then sends nothing and keeps the connection open
- **THEN** the CLI fails with the timeout of `Stream timeouts`, and the server sees the connection close within 1 s of that failure

#### Scenario: Lookups keep their deadline
- **WHEN** a lookup the model asked for takes longer than its own limit, after the answer request was made
- **THEN** the lookup ends at its own limit, the model is told it timed out, and no signal of the answer request is involved
