#!/usr/bin/env bash
# Runs Stryker for a pull request, limited to what the pull request changed.
#
# Stryker's incremental mode (on in stryker.config.json) reuses the cached
# results of every mutant whose code and tests have not changed, so with a
# warm cache the run is short anyway. `--mutate` also bounds the work when
# the cache is cold or has been evicted.
#
# Usage: mutation-pr.sh <base branch>
# Set DRY_RUN=1 to print what would run instead of running it.
set -euo pipefail

base="${1:?usage: mutation-pr.sh <base branch>}"
cd "$(git rev-parse --show-toplevel)"

# What this branch changed since it diverged from the base (a three-dot diff).
changed=$(git -c core.quotepath=off diff --name-only --diff-filter=ACMR "origin/${base}...HEAD")

# The files stryker.config.json leaves out of mutation (`!path` entries), with the `!` removed.
excluded=$(node -p "require('./packages/cli/stryker.config.json').mutate.filter((p) => p.startsWith('!')).map((p) => p.slice(1)).join('\n')")

# Source files, relative to packages/cli where Stryker runs, minus the excluded
# ones: a pull request that touches only those has nothing to mutate.
sources=$(printf '%s\n' "$changed" | sed -n 's#^packages/cli/\(src/.*\.ts\)$#\1#p' | grep -vxFf <(printf '%s\n' "$excluded") || true)
# Anything else that can change what the tests prove: tests, test and mutation
# config, dependencies.
others=$(printf '%s\n' "$changed" |
  grep -E '^packages/cli/(test/|stryker|vitest\.config|package\.json)|^pnpm-lock\.yaml$' || true)

run() {
  if [[ "${DRY_RUN:-}" == "1" ]]; then
    printf 'would run: pnpm mutation'
    if (($# > 0)); then
      printf ' %q' "$@"
    fi
    printf '\n'
  else
    pnpm mutation "$@"
  fi
}

if [[ -n "$sources" ]]; then
  # `--mutate` replaces the list in stryker.config.json, exclusions included,
  # so the exclusions are repeated.
  patterns=$(printf '%s\n%s\n' "$sources" "$(printf '%s\n' "$excluded" | sed 's/^/!/')" | sed '/^$/d' | paste -sd, -)
  echo "Mutating the source files this pull request changed:"
  sed 's/^/  /' <<<"$sources"
  run --mutate "$patterns"
elif [[ -n "$others" ]]; then
  echo "No source file changed, but tests or configuration did. Incremental mode retests what they affect."
  run
else
  echo "::notice::Nothing here can change a mutation result. Skipping."
fi
