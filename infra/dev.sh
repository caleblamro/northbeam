#!/usr/bin/env bash
# Single entrypoint for `pnpm dev`. Idempotent — safe to re-run.
#
#   1. Generates .env.local if MISSING (never overwrites)
#   2. Brings up docker (postgres) and waits for healthchecks
#   3. Syncs the schema via `drizzle-kit push` — instant, no migration files to
#      manage during iteration. For prod, run `pnpm db:generate` + `pnpm db:migrate`.
#   4. Hands off to `turbo run dev` (web → :3000, api → :8000, in parallel)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 1. bootstrap .env.local on first run only
if [[ ! -f .env.local ]]; then
  echo "→ no .env.local — generating with secure defaults"
  ./infra/bootstrap-env.sh
  echo
fi

# 2. bring docker up; --wait blocks until healthchecks pass
echo "→ ensuring docker services are up..."
docker compose --env-file .env.local -f infra/docker-compose.dev.yml up -d --wait

# 3. sync the schema (drizzle push diffs against the live db, no migration files)
echo "→ syncing database schema (drizzle push)..."
pnpm --filter @northbeam/db push

# 4. start long-running apps via turbo (web + api)
echo "→ starting apps (web → :3000 · api → :8000)..."
echo
exec pnpm exec turbo run dev
