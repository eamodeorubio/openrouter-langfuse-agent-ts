# Design

## Context

`search_models` passes sorts and floors to the catalog API and copies three Artificial Analysis scores into each entry. `get_model` copies every benchmark field the SDK parses. The SDK marks the two retired fields as deprecated and says it will remove them.

## Goals / Non-Goals

**Goals:**

- No argument, sort or output field rests on a retired index.
- The code stops reading the deprecated SDK fields, so their removal cannot break the build.

**Non-Goals:**

- New indexes. The change `expose-benchmark-indexes` covers them.

## Decisions

**Remove, with no alias.** A retired sort could map to `intelligence-high-to-low`. That would answer a coding question with a different ranking and hide the swap. A validation error lets the model choose, and the error for an unknown sort already lists the accepted values.

**Filter `get_model` in the tool.** The SDK still parses both fields as null. The tool drops them by name before it converts the keys.

The change `expose-benchmark-indexes` later replaced that filter: `get_model` now keeps only the listed indexes that have a score, so a retired one is dropped for not being listed.

**No special error text.** The model only sees the sorts the schema offers, so a retired name should be rare.

## Risks / Trade-offs

- [A coding question loses its dedicated score] → The intelligence index, the Design Arena sort and `category: "programming"` remain. The scores removed carried no data.
- [Artificial Analysis could restore an index] → Adding it back is a small change.
- [No case of the eval gate asks a benchmark question] → The gate shows only that the core cases do not regress. The one benchmark case, `search/best-legal`, asks about an index this change leaves alone. The tests of the CLI cover the removal.
