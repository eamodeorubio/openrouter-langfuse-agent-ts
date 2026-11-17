# Spec Delta

## MODIFIED Requirements

### Requirement: Tool activity on stderr
With `--verbose`, and only then, the CLI SHALL write for each tool call one line to stderr, before the call runs: `tool: <name> <arguments>`, the arguments as received, on one line (a run of whitespace becomes one space), cut at 200 characters with `…`. Stdout SHALL NOT carry it. The lines do not depend on `--thinking`.

```
tool: get_model {"slug":"openai/gpt-5"}
tool: search_models {"sort":"input-price-low-to-high","limit":5}
```

#### Scenario: Two parallel calls with --verbose
- **WHEN** a round holds two calls
- **THEN** stderr holds two `tool:` lines before either call finishes, and stdout holds none of them

#### Scenario: Without --verbose
- **WHEN** a round holds two calls and `--verbose` is not given
- **THEN** stderr holds no `tool:` line
