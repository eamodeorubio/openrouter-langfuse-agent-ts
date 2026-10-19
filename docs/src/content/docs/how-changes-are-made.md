---
title: How changes are made
description: The spec-first, test-first, small-slice way this project ships changes and versions.
---

This project ships in small steps, and each step follows the same path. Knowing it tells you what to expect from a release, and how to help if you want to.

## The spec comes first

Any change to what the tool does begins as a written spec. The spec says what the tool must do, in whichever form reads most clearly: a scenario, a table of cases, a rule, or a worked example. People read and approve the spec before anyone writes code.

## Then a failing test

Each piece of code starts with a test that fails for the right reason. The first test covers the requirements from end to end. Smaller tests follow as the pieces appear.

## Small slices

A slice is the smallest change that adds something a user can notice, and it lands as one commit. A pull request carries the slices that deliver one change, so a reviewer can read it commit by commit. The title of the pull request sets the version bump.

## Versions

Versions follow [SemVer](https://semver.org/). A fix raises the patch number, a new feature raises the minor number, and a breaking change raises the major number. While the project is below 1.0, a breaking change raises the minor number. A bot reads the pull request titles and opens a release pull request with the next version and the notes. Merging that pull request publishes the version. Every pull request title uses the [Conventional Commits](https://www.conventionalcommits.org/) form.
