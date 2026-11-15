#!/usr/bin/env bash
# Runs Stryker for a pull request, once for each package that has a mutation
# run, limited to what the pull request changed.
#
# Stryker's incremental mode (on in each stryker.config.json) reuses the cached
# results of every mutant whose code and tests have not changed, so with a
# warm cache the run is short anyway. `--mutate` also bounds the work when
# the cache is cold or has been evicted.
#
# Usage: mutation-pr.sh <base branch>
# Set DRY_RUN=1 to print what would run instead of running it.
set -uo pipefail

base="${1:?usage: mutation-pr.sh <base branch>}"
cd "$(git rev-parse --show-toplevel)" || exit 1

# What this branch changed since it diverged from the base (a three-dot diff).
changed=$(git -c core.quotepath=off diff --name-only --diff-filter=ACMR "origin/${base}...HEAD") || exit 1

# The packages with a mutation run, the root script that runs each, and what
# besides its tests and its mutation config can change what its tests prove.
packages=(cli evals)
script_of() {
  case "$1" in
    cli) echo mutation ;;
    evals) echo mutation:evals ;;
    *) echo "unknown package $1" >&2; return 1 ;;
  esac
}
extra_inputs_of() {
  case "$1" in
    cli) echo '' ;;
    # The cases, the rubrics and the config are read by the tests of the evals package.
    evals) echo 'cases/|rubrics/|promptfooconfig' ;;
    *) echo "unknown package $1" >&2; return 1 ;;
  esac
}

# Runs the root script of a package with the arguments, or prints it when DRY_RUN is 1.
run() {
  local script="$1"
  shift
  if [[ "${DRY_RUN:-}" == "1" ]]; then
    printf 'would run: pnpm %s' "$script"
    if (($# > 0)); then
      printf ' %q' "$@"
    fi
    printf '\n'
  else
    pnpm "$script" "$@"
  fi
}

mutate_package() {
  local package="$1"
  local script extra
  script=$(script_of "$package") || return 1
  extra=$(extra_inputs_of "$package") || return 1

  # The files the stryker.config.json of the package leaves out of mutation (`!path` entries), with the `!` removed.
  local excluded
  excluded=$(node -p "require('./packages/${package}/stryker.config.json').mutate.filter((p) => p.startsWith('!')).map((p) => p.slice(1)).join('\n')") || return 1

  # Source files, relative to the package where Stryker runs, minus the excluded
  # ones: a pull request that touches only those has nothing to mutate.
  local sources
  sources=$(printf '%s\n' "$changed" | sed -n "s#^packages/${package}/\(src/.*\.ts\)\$#\1#p" | grep -vxFf <(printf '%s\n' "$excluded") || true)
  # Anything else that can change what the tests prove: tests, test and mutation
  # config, dependencies.
  local inputs="test/|stryker|vitest\.config|package\.json"
  if [[ -n "$extra" ]]; then inputs="${inputs}|${extra}"; fi
  local others
  others=$(printf '%s\n' "$changed" |
    grep -E "^packages/${package}/(${inputs})|^pnpm-lock\.yaml\$" || true)

  echo "== ${package}"
  if [[ -n "$sources" ]]; then
    # `--mutate` replaces the list in stryker.config.json, exclusions included,
    # so the exclusions are repeated.
    local patterns
    patterns=$(printf '%s\n%s\n' "$sources" "$(printf '%s\n' "$excluded" | sed 's/^/!/')" | sed '/^$/d' | paste -sd, -)
    echo "Mutating the source files this pull request changed:"
    sed 's/^/  /' <<<"$sources"
    run "$script" --mutate "$patterns"
  elif [[ -n "$others" ]]; then
    echo "No source file changed, but tests or configuration did. Incremental mode retests what they affect."
    run "$script"
  else
    echo "::notice::Nothing in ${package} can change a mutation result. Skipping."
  fi
}

# Every package gets its run, even when an earlier one fails, and the script
# fails if any did.
failed=0
for package in "${packages[@]}"; do
  mutate_package "$package" || failed=1
done
exit "$failed"
