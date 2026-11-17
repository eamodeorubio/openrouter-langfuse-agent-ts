# Spec Delta

## ADDED Requirements

### Requirement: Free models
The query `free` SHALL take `minContext`, `supportedParameters`, `inputModalities` and `outputModalities`, each optional. It SHALL return every model that meets all constraints and whose input price and output price are both 0. A model with a `null` price SHALL be left out.

#### Scenario: Worked table
- **WHEN** the query runs on this table with `minContext` 200000 and `supportedParameters` `["tools"]`
- **THEN** the result is `t/d` and `t/g`

| Slug | Context | Tools | Input | Output |
| --- | --- | --- | --- | --- |
| `t/a` | 262144 | yes | 1.0 | 4.0 |
| `t/d` | 300000 | yes | 0 | 0 |
| `t/e` | 300000 | no | 0 | 0 |
| `t/f` | 300000 | yes | `null` | `null` |
| `t/g` | 200000 | yes | 0 | 0 |
| `t/h` | 128000 | yes | 0 | 0 |

#### Scenario: No match
- **WHEN** `minContext` is 1000000 on the same table
- **THEN** the result is empty
