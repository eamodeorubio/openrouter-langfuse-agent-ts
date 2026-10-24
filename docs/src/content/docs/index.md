---
title: openrouter-langfuse-agent-ts
description: A small CLI that helps you find the most cost-effective OpenRouter model for your use case.
---

OpenRouter puts hundreds of models behind one API. Each has its own price, context window and strengths, and the cheapest listed price is rarely the cheapest way to do your job. This project is a small command-line tool that answers your questions about OpenRouter and helps you find the model that fits your use case at the lowest cost.

The agent behind the tool is instrumented with Langfuse, so every run can be traced and inspected.

## Where things stand

The project has no release yet. The tooling, the quality checks and the release pipeline are in place, and the CLI can send a question to an OpenRouter model of your choice. Before it answers, the model is told to look models up in the live catalog instead of recalling their prices. [Ask a question](ask-a-question/) shows how. The model can also search the catalog by price, context size and capability. A calculator tool does the arithmetic of a cost estimate exactly. With Langfuse credentials set, every run also leaves a trace behind.

## Following along and helping

Every behavior change starts with a written spec and a failing test, and ships as a small, reviewed increment. [How changes are made](how-changes-are-made/) describes the path every change follows. If you want to take part, [CONTRIBUTING.md](https://github.com/eamodeorubio/openrouter-langfuse-agent-ts/blob/main/CONTRIBUTING.md) explains the flow from the first spec to the merged pull request.
