# Spec Delta

## MODIFIED Requirements

### Requirement: Instructions and tools in every request
Every request SHALL start with a system message and SHALL offer the tools `get_model`, `search_models` and `calculate`, with parallel tool calls enabled. The system message SHALL tell the model its job (answer questions about OpenRouter, weigh models by cost against need), that prices are USD per million tokens, to prefer tool data over memory, to do arithmetic with `calculate` and show its formula and result when it states a cost, and to call independent tools together. It SHALL also tell the model what to assume when a question about the cheapest model gives no usage: rank by a blend of input and output price at three input tokens for every output token, say which mix it assumed, and rank by one price alone when only that price matters. It SHALL name neither `get_model` nor `search_models`.

#### Scenario: First request
- **WHEN** the CLI asks `-q "cheapest model with 1M context?"`
- **THEN** the request holds a system message, then the user message, and lists exactly the three tools

#### Scenario: Cheapest without a usage
- **WHEN** the system message is read
- **THEN** it says that a question about the cheapest model with no stated usage is ranked by a blend of input and output price, at three input tokens for every output token unless the user says otherwise, and that the answer states the mix assumed

#### Scenario: One price alone
- **WHEN** the system message is read
- **THEN** it says that when only one price matters, such as input for a long prompt, the ranking uses that price alone

#### Scenario: No catalog tool named
- **WHEN** the system message is read
- **THEN** it holds neither `get_model` nor `search_models`
