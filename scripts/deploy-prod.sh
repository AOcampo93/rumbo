#!/usr/bin/env bash
# Promotes the current origin/main to the `production` branch.
# Coolify watches `production` and deploys every push to it, so this script
# IS the production deploy. It refuses to promote anything that isn't green.
set -euo pipefail

HEALTH_URL="https://rumbo.arturoocampo.com/api/v1/health"

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
if git rev-parse --quiet --verify origin/production >/dev/null; then
  git merge-base --is-ancestor origin/production "$SHA" \
    || fail "origin/production is not an ancestor of main; resolve it by hand."
  [[ "$(git rev-parse origin/production)" != "$SHA" ]] || { echo "✓ production is already at ${SHA:0:7}"; exit 0; }
fi

git push origin "$SHA:refs/heads/production"
echo "→ production = ${SHA:0:7}. Coolify is building; waiting for $HEALTH_URL …"

# The API reports the commit it serves (SOURCE_COMMIT); wait until it matches.
for _ in $(seq 1 60); do
  sleep 10
  SERVED=$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null | sed -nE 's/.*"commit":"([0-9a-f]+)".*/\1/p' || true)
  if [[ "$SERVED" == "$SHA" ]]; then
    echo "✓ Deployed: the API now serves ${SHA:0:7}."
    exit 0
  fi
done
fail "Timed out after 10 min (API serves '${SERVED:-unknown}'). Check the deployment logs in Coolify."
