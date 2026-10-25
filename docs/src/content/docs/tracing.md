---
title: Tracing with Langfuse
description: Switch on a Langfuse trace for every question, and learn what the trace holds, which generation is the answer, how tokens and cost are counted, and what leaves your machine.
---

A run can leave a record. Give the tool the credentials of a [Langfuse](https://langfuse.com) project and it sends one trace for every question: what you asked, each request to the model with the messages it carried, what the model sent back, each tool call and what it returned, and the answer. Open the trace in Langfuse and you can see what the model was shown, why it reached for a tool, and where the time went.

Three settings switch it on:

| Setting               | Meaning                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `LANGFUSE_PUBLIC_KEY` | The public key of the project, from its settings under API keys. It starts with `pk-lf-`.                                           |
| `LANGFUSE_SECRET_KEY` | The secret key of the same pair. It starts with `sk-lf-`.                                                                           |
| `LANGFUSE_BASE_URL`   | Where Langfuse lives: `https://cloud.langfuse.com` (EU), `https://us.cloud.langfuse.com` (US) or your own server. An `http(s)` URL. |

They live in the same two places as the other settings, the environment and `.env`, and the environment wins. The tool works with Langfuse Cloud and with a self-hosted Langfuse server from version 4.59.0.

Two more settings are optional. Both only take effect when tracing is on:

| Setting                        | Meaning                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `LANGFUSE_TRACING_ENVIRONMENT` | Where the traces are filed in Langfuse, such as `staging`, so test runs stay out of the dashboards of real ones. The default is `default`. |
| `LANGFUSE_RELEASE`             | What the traces are attributed to, such as a git commit. The default is the version of this tool.                                          |

An environment is 1 to 40 characters of lower case letters, digits, hyphens and underscores, and it must not start with `langfuse`. One that breaks those rules is refused up front, with exit code 1 and the name of the setting. A blank value of either setting counts as unset.

Set all three or none. With none, the tool runs untraced and writes one line to stderr to say so. That line is a reminder, not an error: stdout and the exit code stay as they were. With one or two, the tool stops before it reads your question, exits with code 1 and names the settings that are missing. A half-configured setup is almost always a typo, and a trace that quietly never arrives is worse than a refusal.

With all three, the tool checks the keys before it asks the model anything. It asks Langfuse for the project the keys belong to. If Langfuse rejects the keys, or does not answer within ten seconds, the tool prints one line, sends nothing to OpenRouter and exits with code 2. You find out in the first second, and no tokens were spent.

## What the trace holds

The root of the trace is an `agent` observation named `answer-question`. Its input is your question and its output is the final answer. Under it, in the order they happened:

- One `generation` named `generate-response` for each request to the model. It holds the model you asked for and the model that served the request, the messages that went out as a conversation (system, user, assistant and tool messages, with each tool result matched to its call), the reply with its text, its tool calls and its thinking, the reason the model stopped, the tokens it used and what the request cost. A request that was retried after a failure is still one generation, with the number of retries in its metadata.
- One `tool` for each tool call, named after the tool: `get_model`, `search_models` or `calculate`. It holds the arguments the model sent and the result that went back. A call that failed is marked as an error, with the reason as its status message. A tool sits beside the generation that asked for it, never inside it, so the tree reads like the run did.

When a run fails, the error marks the root and the request that failed. The trace of a failed run is delivered like any other.

Every observation carries the version of the tool that made it, and every trace carries its environment and release. The traces name their service `openrouter-langfuse-agent-ts` and carry nothing taken from your machine: no path, no home directory, no host name.

## Which generation is the answer

A run that uses tools has several generations, and only one of them wrote the text you got. That one carries `final_answer` set to `true` in its metadata. The flag marks a response that finished with answer text and no tool call.

Every other generation carries `false`. These are a round that ended in tool calls, even when the model said something first; a request that failed, so the partial answer of a stream that broke halfway is `false` too; a round that Ctrl-C cut short; and a response with neither text nor tool call, which fails the run. A run that ends before the model answers has no `true`.

To list only the answers, filter the observations on the metadata key `final_answer` with the value `true`, in the tracing table or with the `filter` parameter of the Langfuse API. Langfuse shows the value as text, so type `true` or `false` into the filter as they are. The flag sits on the generation and nowhere else. On a run that succeeds, the root holds the same text as its output.

When the model answers in full but its response has no token counts, the tool writes the answer and exits with code 2. That generation is still flagged `true`, because its text reached your screen. The root has no output in that run, so the flagged generation is the only place the answer is in the trace.

## Tokens and cost

Langfuse keeps every kind of token in a bucket of its own, so that a token is counted once. A generation reports `input` and `output`, and when the provider says so, `input_cached_tokens` for the part of the prompt served from its cache and `output_reasoning_tokens` for the part of the completion the model spent thinking. Those two are taken out of `input` and `output`. `total` is the sum of the buckets. The cost is the one OpenRouter reports for the request, in US dollars, so it does not depend on Langfuse knowing the price of the model.

Providers do not always count consistently. One recorded run reports 25 prompt tokens, 122 completion tokens and 128 reasoning tokens, more reasoning than completion, so the reasoning cannot be part of the completion. When a cached or reasoning count is larger than the count it should sit in, the tool leaves that bucket whole and puts the odd count in the metadata of the generation, as `cached_tokens` or `reasoning_tokens`. The buckets never go below zero and always add up.

## The stream, as it happened

A generation holds at most two events. `receive-first-token` marks the moment the first piece of text or thinking arrived, which tells you how long the model took to start. `fail-stream` marks a stream that broke, went idle or carried an error, and ended the request. A stream that failed and was tried again leaves no event, only the retry count. The first token also sets the completion start time of the generation, so Langfuse can show the time to first token of each request. The tool never records an event per chunk.

## Finding the trace

With tracing on and `--verbose`, the tool writes the id of the trace to stderr before anything else:

```text
trace: 4bf92f3577b34da6a3ce929d0e0e4736
```

Paste it into the search of the Langfuse project to open the run. The tool also sends the id to OpenRouter, in a `traceparent` header on every request, each naming the generation or the tool call that made it. As far as we know OpenRouter ignores the header. It is there for anything between you and OpenRouter, such as a proxy that records its own spans, so that it can join the same trace.

## What leaves your machine

The question, the answer, the thinking, and the arguments and results of every tool call go to Langfuse in full. That is the point of a trace, and it is also a decision to make with open eyes. The tool replaces your OpenRouter key and the two Langfuse keys with `[REDACTED]` wherever they appear in what it sends. It also replaces, by their shape, bearer tokens (the word `Bearer` followed by a token of 16 or more characters, in any case), anything that looks like an OpenRouter or Langfuse key (`sk-or-`, `sk-lf-`, `pk-lf-`) and email addresses. The patterns are few and tight on purpose, because a broad one would also eat the tool results that a trace exists to keep. A shorter bearer token slips through. So does everything else: a name, a street address, a phone number, or any number that you type into a question, or that a model repeats, is stored as it is.

The model still gets your question exactly as you wrote it; only the copy sent to Langfuse is masked. The trace carries no request headers and no environment variables. Do not ask a traced run what you would not want written on that server.

## When the run ends

The tool sends the trace before it exits and waits at most ten seconds for Langfuse to take it. If it cannot, it writes one line saying the trace may be incomplete. A run that would have exited with 0 then exits with 2, so a script notices that the record is missing. A run that had already failed keeps its own exit code.

Press Ctrl-C, or stop the process with `SIGTERM`, and the tool does not walk away from the trace. The observations still open are closed and marked as interrupted, the trace is sent, and the exit code is 130 for Ctrl-C and 143 for `SIGTERM`, the codes a shell shows for a process a signal killed.
