# Design

## Context

Observed on the public API on 2026-11-27, with no documentation either way:

| Request | Reply |
| --- | --- |
| `category` alone, each of the 12 values | 200, 11 to 20 models, no next page |
| with `limit` or `offset` | 400 |
| with `supported_parameters` | 400 |
| with each of the other filters and sorts tried, one at a time on `programming` | 200 |

Not every sort the tool offers was tried, nor the coding and agentic floors. The SDK adds `limit=500` and `offset=0` when the caller gives none.

## Goals / Non-Goals

**Goals:**

- The agent uses `category` as it uses any other filter.

**Non-Goals:**

- A richer JSON schema or new argument rules.
- A way past the short list.

## Decisions

**The tool absorbs the quirk.** A rule in the schema would cost tokens and invite failed calls.

**Strip the page in the HTTP layer.** The SDK cannot omit `limit`, so the client removes `limit` and `offset` from a models request that has `category`. Alternative: a hand-written request, which would duplicate authentication, parsing and error handling.

**Omit `supported_parameters` in the tool and filter its reply.** Every model carries the list. A model must list all of them: on the whole catalog that matched the API's filter except for 24 entries, routers among them, that the API drops.

**Refuse a continued list.** The API rejects `offset`, so a second page cannot be fetched. None was seen.

**Say that the list is short.** For cost advice the difference matters.

## Risks / Trade-offs

- [The API changes the rule] → Without it, the tool's requests stay valid.
- [A router passes the local filter that the API would drop] → Accepted: it lists the parameter.
- [A new refused combination] → It reaches the agent as an API error, as today.
- [The tests mock the API and cannot see its rules] → The scenarios pin the exact query.
