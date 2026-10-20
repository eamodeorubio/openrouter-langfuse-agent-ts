---
title: How changes are made
description: The spec-first, test-first, small-product-slice way this project ships changes and versions.
---

This project ships in small steps, and each step follows the same path. Knowing it tells you what to expect from a release, and how to help if you want to.

## The spec comes first

A change to what the tool does begins as a written spec. So does a substantial refactor, and so does a decision worth remembering. The spec says what the tool must do, in whichever form reads most clearly: a scenario, a table of cases, a rule, or a worked example. Whoever does the work reads and approves the spec locally before anyone writes the code. A small fix or a small refactor needs no spec; a refactor is substantial when it changes the package layout, an interface other code depends on, or a design decision.

The spec is not a pull request of its own. It travels with the code it describes.

## Then a failing test

Each piece of code starts with a test that fails for the right reason. The first test covers the requirements from end to end. Smaller tests follow as the pieces appear.

## Small product slices

A product slice is the smallest change that adds something a user can notice, and it lands as one commit. One pull request carries the specs and all the product slices that deliver a feature or a fix, normally one or two specs. A reviewer can read it commit by commit. The title of the pull request sets the version bump. When the work is done, the last commit archives the spec, though a merge never waits on that.

## Versions

Versions follow [SemVer](https://semver.org/). A fix raises the patch number, a new feature raises the minor number, and a breaking change raises the major number. While the project is below 1.0, a breaking change raises the minor number. A bot reads the pull request titles and opens a release pull request with the next version and the notes. Merging that pull request publishes the version. Every pull request title uses the [Conventional Commits](https://www.conventionalcommits.org/) form.
