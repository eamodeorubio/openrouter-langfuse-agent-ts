# Spec Delta

## ADDED Requirements

### Requirement: Final answer flag
Each `generation` SHALL carry the boolean `final_answer` in its metadata. It SHALL be `true` when the response held answer text and no tool calls, the text the CLI writes as the answer, and `false` in every other case. A run SHALL hold at most one generation with `true`.

#### Scenario: Tool rounds, then the answer
- **WHEN** round 1 ends in a `get_model` call, round 2 ends in a `calculate` call and round 3 answers
- **THEN** the three generations carry `false`, `false` and `true`, and the `true` one holds the text that is the output of the root

#### Scenario: Cases
| The response | `final_answer` |
| --- | --- |
| answer text, no tool call | `true` |
| text and a tool call, as in "Checking." | `false` |
| tool calls only | `false` |
| neither text nor tool call (the run fails) | `false` |
| the request failed | `false` |
| the run was interrupted while it was open | `false` |

#### Scenario: Answer written, then the run fails
- **WHEN** the model answers in full but the response holds no token usage, and the run exits 2
- **THEN** that generation carries `true`, because its text reached stdout, and the root has no output

#### Scenario: Failed run
- **WHEN** the API refuses the first request
- **THEN** the one generation carries `false` and no generation carries `true`

#### Scenario: Not elsewhere
- **WHEN** a run is answered
- **THEN** no root, tool or event observation carries `final_answer`
