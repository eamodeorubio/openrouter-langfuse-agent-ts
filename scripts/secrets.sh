#!/bin/sh
# Looks for secrets with gitleaks, the same tool the Security workflow runs.
#
#   scripts/secrets.sh              scan every commit reachable from HEAD (CI scans only the commits of a pull request)
#   scripts/secrets.sh --staged     scan only what is staged (the pre-commit hook)
#   scripts/secrets.sh --optional   with --staged: skip, with a hint, when gitleaks is not installed
#
# gitleaks is a Go program, not an npm package, so it is not a dependency of
# the project. CI is the gate; this script catches a finding before it gets there.
# A fingerprint in .gitleaksignore silences only the finding in the commit it names.

staged=false
optional=false
for argument in "$@"; do
  case "$argument" in
    --staged) staged=true ;;
    --optional) optional=true ;;
    *)
      echo "Unknown option: $argument" >&2
      exit 2
      ;;
  esac
done

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks is not installed, so no secret scan ran. Install it (brew install gitleaks, or see https://github.com/gitleaks/gitleaks#installing) to scan before you push." >&2
  if [ "$optional" = true ]; then
    exit 0
  fi
  exit 1
fi

# gitleaks 8.19 replaced `protect` and `detect` with `git`; CI pins a newer one.
if gitleaks git --help >/dev/null 2>&1; then
  if [ "$staged" = true ]; then
    exec gitleaks git --staged --redact --no-banner
  fi
  exec gitleaks git --redact --no-banner
fi
if [ "$staged" = true ]; then
  exec gitleaks protect --staged --redact --no-banner
fi
exec gitleaks detect --redact --no-banner
