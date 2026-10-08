#!/usr/bin/env bash
# Promotes the current origin/main to the `production` branch.
# Coolify watches `production` and deploys every push to it, so this script
# IS the production deploy. It refuses to promote anything that isn't green.
set -euo pipefail

BASE_URL="https://rumbo.arturoocampo.com"
# Coolify only redeploys an app when a push touches its watch paths.
# Keep these in sync with each app's "Watch Paths" in Coolify (docs/DEPLOY.md).
API_PATHS='^(apps/api/|packages/|data/|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|\.dockerignore$)'
WEB_PATHS='^(apps/web/|packages/|data/|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|\.dockerignore$)'

cd "$(git rev-parse --show-toplevel)"
fail() { echo "✗ $*" >&2; exit 1; }

[[ -z "$(git status --porcelain)" ]] || fail "Working tree is not clean."
git fetch origin --quiet
SHA=$(git rev-parse origin/main)
[[ "$(git rev-parse HEAD)" == "$SHA" ]] || fail "HEAD is not origin/main (${SHA:0:7}). Push or pull first."

# CI must have passed for this exact commit.
RUN=$(gh run list --workflow CI --commit "$SHA" --limit 1 --json status,conclusion \
  --jq '.[0] | "\(.status):\(.conclusion)"')
[[ "$RUN" == "completed:success" ]] || fail "CI for ${SHA:0:7} is '${RUN:-missing}', not completed:success."

# Fast-forward only: production must never hold commits that main doesn't have.
OLD=$(git rev-parse --quiet --verify origin/production || true)
[[ -n "$OLD" ]] || fail "No production branch yet. The first deploy is done from Coolify (see docs/DEPLOY.md)."
[[ "$OLD" != "$SHA" ]] || { echo "✓ production is already at ${SHA:0:7}"; exit 0; }
git merge-base --is-ancestor "$OLD" "$SHA" || fail "origin/production is not an ancestor of main; resolve it by hand."

CHANGED=$(git diff --name-only "$OLD" "$SHA")
git push origin "$SHA:refs/heads/production"
echo "→ production = ${SHA:0:7}"

# Each app reports the commit it serves; wait until it matches.
wait_for() { # $1 = label, $2 = URL returning {"commit": "..."}
  local served=""
  for _ in $(seq 1 60); do
    served=$(curl -fsS --max-time 5 "$2" 2>/dev/null | sed -nE 's/.*"commit":"([0-9a-f]+)".*/\1/p' || true)
    if [[ "$served" == "$SHA" ]]; then echo "✓ $1 serves ${SHA:0:7}"; return 0; fi
    sleep 10
  done
  echo "✗ $1 still serves '${served:-unknown}' after 10 min; check its deployment in Coolify." >&2
  return 1
}

STATUS=0 WAITED=0
if grep -qE "$API_PATHS" <<<"$CHANGED"; then WAITED=1; wait_for "API" "$BASE_URL/api/v1/health" || STATUS=1; fi
if grep -qE "$WEB_PATHS" <<<"$CHANGED"; then WAITED=1; wait_for "Web" "$BASE_URL/version.json" || STATUS=1; fi
(( WAITED )) || echo "✓ No app files changed: nothing to redeploy."
exit "$STATUS"
