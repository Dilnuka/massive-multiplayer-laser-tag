
Abut m#!/bin/sh
# Auto-commit and push when the Cursor agent finishes a session.
cat > /dev/null

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$ROOT" || exit 0

BRANCH="$(git branch --show-current 2>/dev/null)"
if [ -z "$BRANCH" ]; then
  exit 0
fi

git add -A

if git diff --cached --quiet; then
  exit 0
fi

TIMESTAMP="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"
git commit -m "Auto-save: $TIMESTAMP" --no-verify || exit 0

if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
  git push origin "$BRANCH" || exit 0
else
  git push -u origin "$BRANCH" || exit 0
fi

exit 0
