# Spec Delta

## Purpose

Lets the model do arithmetic exactly, from the prices and token counts it read, instead of in its head. Defines the `calculate` tool: its grammar, its result and its failures.

## ADDED Requirements

### Requirement: calculate grammar
`calculate` SHALL take one argument, `expression`, and SHALL evaluate only decimal numbers, `+`, `-`, `*`, `/`, parentheses, spaces, and unary `+` and `-`. Precedence is the usual one; operators of equal rank go left to right. Anything else SHALL be rejected without being evaluated.

#### Scenario: Accepted and rejected
| `expression` | Result |
| --- | --- |
| `5 * 0.018 + 1 * 0.09` | `0.18` |
| `2 + 3 * 4` | `14` |
| `(2 + 3) * 4` | `20` |
| `10 - 4 - 3` | `3` |
| `100 / 5 / 2` | `10` |
| `-5 + 2`, `(-3) * 2`, `2 - -3` | `-3`, `-6`, `5` |
| `.5`, `5.`, `1e3`, `1_000`, `1,000` | error |
| `2 ** 3`, `7 % 2`, `2 ^ 3` | error |
| `abc`, `Math.PI`, `process.exit()`, `1; 2`, `` `2` `` | error |

### Requirement: calculate result
On success `calculate` SHALL return `formula`, the expression and its result on one line as `<expression> = <result>`, and `result`, the number. The result SHALL be rounded to 12 significant digits, so that `0.1 + 0.2` gives `0.3`.

#### Scenario: Cost of a workload
- **WHEN** the model has read a model priced at 0.018 and 0.09 USD per million tokens, and calls `calculate` with `5 * 0.018 + 1 * 0.09` for 5M input and 1M output tokens
- **THEN** the result is `{"formula":"5 * 0.018 + 1 * 0.09 = 0.18","result":0.18}`

#### Scenario: Rounding
| `expression` | `result` |
| --- | --- |
| `0.1 + 0.2` | `0.3` |
| `1 / 3` | `0.333333333333` |
| `0.000003 * 1000000` | `3` |

### Requirement: calculate failures
A failing `calculate` SHALL return an error result for the model, as one line, and SHALL NOT fail the run. The message SHALL name the cause.

#### Scenario: Which failures
| Condition | Message names |
| --- | --- |
| Character or token outside the grammar | the character and its position |
| Division by zero, such as `5 / 0` or `1 / (2 - 2)` | division by zero |
| Missing operand or parenthesis, such as `1 +`, `(1 + 2`, `` | what is missing |
| Result is not finite | that the result is out of range |
| More than 200 characters | the length limit |
| More than 32 levels of parentheses | the nesting limit |

#### Scenario: Division by zero
- **WHEN** the model calls `calculate` with `10 / (5 - 5)`
- **THEN** the result sent to the model is an error saying division by zero, and the run continues

#### Scenario: Not arithmetic
- **WHEN** the model calls `calculate` with `process.exit(1)`
- **THEN** nothing is executed, the result is an error naming the first character outside the grammar, and the run continues

### Requirement: calculate never evaluates code
`calculate` SHALL parse the expression itself. It SHALL NOT pass any part of it to `eval`, `Function`, a shell or a module loader.

#### Scenario: Code-shaped input
- **WHEN** the expression is `constructor.constructor("return 1")()`
- **THEN** it is rejected at its first character outside the grammar
