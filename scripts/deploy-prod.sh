#!/usr/bin/env bash
# Promotes the current origin/main to the `production` branch and deploys it.
# Coolify builds from `production`, but GitHub doesn't notify it of pushes on
# this server (docs/DEPLOY.md), so the script starts each deploy through the
# Coolify API and waits until the apps serve the new commit. It refuses to
# promote anything that isn't green.
#
#   pnpm deploy:prod             promote and deploy
#   pnpm deploy:prod --dry-run   run every check and print the plan, without pushing
set -euo pipefail

BASE_URL="https://rumbo.arturoocampo.com"
# An app is redeployed only when its files changed since the commit it serves.
# Keep these in sync with each app's "Watch Paths" in Coolify (docs/DEPLOY.md).
API_PATHS='^(apps/api/|packages/|data/|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|\.dockerignore$)'
WEB_PATHS='^(apps/web/|packages/|data/|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|\.dockerignore$)'

# Local settings, never in the repo: the Coolify token as a curl header file,
# and deploy.env with COOLIFY_SSH_HOST, COOLIFY_API_APP and COOLIFY_WEB_APP.
CONFIG_DIR="${RUMBO_CONFIG_DIR:-$HOME/.config/rumbo}"
AUTH_HEADER="$CONFIG_DIR/coolify-auth.header"
# shellcheck source=/dev/null
[[ -f "$CONFIG_DIR/deploy.env" ]] && source "$CONFIG_DIR/deploy.env"
COOLIFY_PORT="${COOLIFY_PORT:-18000}"

DRY_RUN=0
case "${1:-}" in
  "") ;;
  --dry-run) DRY_RUN=1 ;;
  *) echo "Usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

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
if [[ -n "$OLD" ]]; then
  git merge-base --is-ancestor "$OLD" "$SHA" || fail "origin/production is not an ancestor of main; resolve it by hand."
fi

# Each app reports the commit it serves. It needs a deploy when its files
# changed since then, or when it doesn't answer.
served_commit() { # $1 = URL returning {"commit": "..."}
  curl -fsS --max-time 5 "$1" 2>/dev/null | sed -nE 's/.*"commit":"([0-9a-f]+)".*/\1/p' || true
}
outdated() { # $1 = served commit, $2 = watch paths
  [[ "$1" != "$SHA" ]] || return 1
  git cat-file -e "$1^{commit}" 2>/dev/null || return 0
  local changed
  changed=$(git diff --name-only "$1" "$SHA")
  grep -qE "$2" <<<"$changed"
}
API_SERVES=$(served_commit "$BASE_URL/api/v1/health")
WEB_SERVES=$(served_commit "$BASE_URL/version.json")
DEPLOY_API=0 DEPLOY_WEB=0
outdated "$API_SERVES" "$API_PATHS" && DEPLOY_API=1
outdated "$WEB_SERVES" "$WEB_PATHS" && DEPLOY_WEB=1

if [[ "$OLD" == "$SHA" ]] && (( !DEPLOY_API && !DEPLOY_WEB )); then
  echo "✓ production is already at ${SHA:0:7} and the apps are up to date"
  exit 0
fi
plan() { # $1 = label, $2 = served commit, $3 = 1 when it will be deployed
  local what="up to date" served="${2:0:7}"
  (( $3 )) && what="deploy"
  echo "→ $1: $what (serves ${served:-nothing})"
}
FROM="${OLD:0:7}"
[[ "$OLD" == "$SHA" ]] || echo "→ production: ${FROM:-new branch} → ${SHA:0:7}"
plan "API" "$API_SERVES" "$DEPLOY_API"
plan "Web" "$WEB_SERVES" "$DEPLOY_WEB"

# The Coolify API is reached through an SSH tunnel to the server: one already
# listening is reused, and one opened here is closed on exit.
coolify() { # $1 = path under /api/v1
  curl -fsS --max-time 30 -H @"$AUTH_HEADER" "http://127.0.0.1:$COOLIFY_PORT/api/v1$1"
}
TUNNEL=""
close_tunnel() {
  [[ -n "$TUNNEL" ]] || return 0
  ssh -q -S "$TUNNEL" -O exit "$COOLIFY_SSH_HOST" 2>/dev/null || true
  rm -rf "${TUNNEL%/*}"
}
trap close_tunnel EXIT
if (( DEPLOY_API || DEPLOY_WEB )); then
  [[ -r "$AUTH_HEADER" && -n "${COOLIFY_SSH_HOST:-}" && -n "${COOLIFY_API_APP:-}" && -n "${COOLIFY_WEB_APP:-}" ]] ||
    fail "Missing Coolify settings in $CONFIG_DIR (see docs/DEPLOY.md)."
  if ! nc -z 127.0.0.1 "$COOLIFY_PORT" 2>/dev/null; then
    TUNNEL="$(mktemp -d)/coolify"
    ssh -f -N -M -S "$TUNNEL" -o ExitOnForwardFailure=yes -L "$COOLIFY_PORT:127.0.0.1:8000" "$COOLIFY_SSH_HOST" ||
      fail "Couldn't open the SSH tunnel to $COOLIFY_SSH_HOST."
  fi
  VERSION=$(coolify /version) || fail "The Coolify API doesn't answer: check the tunnel and the token."
  echo "✓ Coolify $VERSION reachable"
fi

if (( DRY_RUN )); then
  echo "Dry run: nothing pushed or deployed."
  exit 0
fi

if [[ "$OLD" != "$SHA" ]]; then
  git push origin "$SHA:refs/heads/production"
  echo "→ production = ${SHA:0:7}"
fi
if (( !DEPLOY_API && !DEPLOY_WEB )); then
  echo "✓ No app files changed: nothing to redeploy."
  exit 0
fi

# Coolify builds the head of `production`, which is now $SHA.
deploy() { # $1 = label, $2 = Coolify app uuid; prints the deployment uuid
  local id
  id=$(coolify "/deploy?uuid=$2" | sed -nE 's/.*"deployment_uuid":"([a-z0-9]+)".*/\1/p') || true
  [[ -n "$id" ]] || fail "Coolify didn't queue the $1 deploy."
  echo "$id"
}
wait_for() { # $1 = label, $2 = URL returning {"commit": "..."}, $3 = deployment uuid
  local served="" status=""
  for _ in $(seq 1 60); do
    served=$(served_commit "$2")
    if [[ "$served" == "$SHA" ]]; then echo "✓ $1 serves ${SHA:0:7}"; return 0; fi
    status=$(coolify "/deployments/$3" 2>/dev/null | sed -nE 's/.*"status":"([a-z_-]+)".*/\1/p' | head -1 || true)
    if [[ "$status" == failed || "$status" == cancelled* ]]; then
      echo "✗ $1: deployment $3 $status; see its log in Coolify." >&2
      return 1
    fi
    sleep 10
  done
  echo "✗ $1 still serves '${served:-unknown}' after 10 min (deployment $3: ${status:-unknown})." >&2
  return 1
}

API_DEPLOY="" WEB_DEPLOY=""
if (( DEPLOY_API )); then API_DEPLOY=$(deploy "API" "$COOLIFY_API_APP"); echo "→ API deployment $API_DEPLOY"; fi
if (( DEPLOY_WEB )); then WEB_DEPLOY=$(deploy "Web" "$COOLIFY_WEB_APP"); echo "→ Web deployment $WEB_DEPLOY"; fi

STATUS=0
if (( DEPLOY_API )); then wait_for "API" "$BASE_URL/api/v1/health" "$API_DEPLOY" || STATUS=1; fi
if (( DEPLOY_WEB )); then wait_for "Web" "$BASE_URL/version.json" "$WEB_DEPLOY" || STATUS=1; fi
exit "$STATUS"
