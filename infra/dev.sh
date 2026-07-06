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

# macOS ships a 256 file-descriptor soft limit; Turbopack's compile bursts
# blow past it once the repo is big enough, and failed stat()s get cached as
# phantom "Module not found" errors for files that plainly exist. Raise it
# for everything this script spawns (no-op where already higher).
ulimit -n 65536 2>/dev/null || ulimit -n 10240 2>/dev/null || true

# 1. bootstrap .env.local on first run only
if [[ ! -f .env.local ]]; then
  echo "→ no .env.local — generating with secure defaults"
  ./infra/bootstrap-env.sh
  echo
fi

# 1b. upgrade pre-role-split env files: runtime now connects as the
# RLS-restricted app role; drizzle tooling keeps the owner connection.
if ! grep -q '^DATABASE_ADMIN_URL=' .env.local; then
  OLD_ADMIN_URL="postgresql://northbeam:northbeam@localhost:5432/northbeam"
  if grep -q "^DATABASE_URL=${OLD_ADMIN_URL}$" .env.local; then
    echo "→ upgrading .env.local for the RLS app role (northbeam_app)"
    sed -i.bak "s|^DATABASE_URL=${OLD_ADMIN_URL}$|DATABASE_URL=postgresql://northbeam_app:northbeam_app@localhost:5432/northbeam|" .env.local
    rm -f .env.local.bak
    {
      echo ""
      echo "# Owner connection for drizzle push/migrate + scripts/setup-app-role.ts"
      echo "DATABASE_ADMIN_URL=${OLD_ADMIN_URL}"
      echo "POSTGRES_APP_USER=northbeam_app"
      echo "POSTGRES_APP_PASSWORD=northbeam_app"
    } >> .env.local
  else
    echo "✗ .env.local has a customized DATABASE_URL and no DATABASE_ADMIN_URL."
    echo "  RLS enforcement needs a role split. Add to .env.local:"
    echo "    DATABASE_ADMIN_URL=<owner connection, your current DATABASE_URL>"
    echo "    DATABASE_URL=<same, but user northbeam_app / POSTGRES_APP_PASSWORD>"
    echo "    POSTGRES_APP_PASSWORD=<password for northbeam_app>"
    echo "  then re-run pnpm dev."
    exit 1
  fi
fi

# 2. bring docker up; --wait blocks until healthchecks pass
echo "→ ensuring docker services are up..."
docker compose --env-file .env.local -f infra/docker-compose.dev.yml up -d --wait

# 3. sync the schema (drizzle push diffs against the live db, no migration files)
echo "→ syncing database schema (drizzle push)..."
pnpm --filter @northbeam/db push

# 3b. provision the RLS-enforced runtime role + grants (idempotent). Runs after
# push so FORCE ROW LEVEL SECURITY and grants cover freshly created tables.
echo "→ provisioning app role + RLS enforcement..."
pnpm --filter @northbeam/db setup:rls

# 4. start long-running apps via turbo (web + api)
echo "→ starting apps (web → :3000 · api → :8000)..."
echo
exec pnpm exec turbo run dev
