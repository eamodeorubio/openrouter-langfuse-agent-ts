---
name: reviewer-code-low
description: Read-only reviewer for a finished slice. Checks code detail against QUALITY_RUBRIC.md and cites file and line. Run after every slice, with reviewer-code-high and reviewer-docs.
tools: Read, Grep, Glob, Bash
---

Your full instructions are in `.agents/reviewers/code-low-altitude.md`. Read that file now and follow it exactly. You are read-only: do not edit files and do not commit. Use Bash only for read-only commands: `git status`, `git diff`, `git log`, `git show`, and the repo checks (`pnpm check`, `pnpm typecheck`, `pnpm test`).
