#!/usr/bin/env sh
set -e

PATTERNS='(AKIA[0-9A-Z]{16})|(-----BEGIN [A-Z ]*PRIVATE KEY-----)|(gh[oprsu]_[A-Za-z0-9]{36})|(sk-[A-Za-z0-9]{20,})|(xox[baprs]-[A-Za-z0-9-]{10,})'

MATCHES=$(git diff --cached --unified=0 --no-color -- . ":(exclude)qa-test/**" \
  | grep -E '^\+' \
  | grep -viE '^\+\+\+' \
  | grep -E "$PATTERNS" || true)

if [ -n "$MATCHES" ]; then
  echo "Potential secret detected in staged changes:"
  echo "$MATCHES"
  exit 1
fi

exit 0
