# Dev environment troubleshooting

If `pnpm dev` fails, work through this list before digging into individual services.

## Docker won't start / Postgres unreachable

```bash
docker compose -f infra/docker-compose.dev.yml ps
docker compose -f infra/docker-compose.dev.yml logs postgres | tail -40
```

If the container is exited or unhealthy, restart it:

```bash
docker compose -f infra/docker-compose.dev.yml down
docker compose -f infra/docker-compose.dev.yml up -d
```

If you've changed the Postgres volume contents and it now refuses to come up, the cleanest reset (DESTROYS local data):

```bash
docker compose -f infra/docker-compose.dev.yml down -v
docker compose -f infra/docker-compose.dev.yml up -d
```

## Schema push fails

```bash
pnpm --filter @northbeam/db push --verbose
```

Most failures are one of:
- Postgres not running (see above).
- `.env.local` missing or `DATABASE_URL` wrong. Run `./infra/bootstrap-env.sh` to (re-)generate.
- A column rename/type change Drizzle can't infer. Drop the column manually via `pnpm --filter @northbeam/db studio` and re-push.

## Magic link not arriving

In local dev, magic links are printed to the **API server console** (the `pnpm dev` terminal, look at the `@northbeam/api` lane). Search for `Magic link:`:

```
[api] Magic link: http://localhost:14300/verify?token=...
```

If you don't see it, check that the email mutation actually fired (look for a recent `auth.requestMagicLink` log line). If `RESEND_API_KEY` is set, the link goes to email instead — clear that variable to fall back to console printing.

## "node_modules missing" after a destructive operation

`rm -rf apps/web` (or any app dir) wipes its `node_modules`. Restore from git first (`git restore apps/web`), then:

```bash
pnpm install
```

The lockfile is canonical; `pnpm install` is idempotent and fast.

## tRPC procedure types out of sync between web and api

The web client picks up types from `apps/api/src/trpc/index.ts`'s `AppRouter` export via the package alias `@northbeam/api/trpc`. If you added a procedure but the web TS shows it as missing:

```bash
pnpm --filter @northbeam/api typecheck   # ensure API compiles
pnpm --filter @northbeam/web typecheck   # then web
```

The package alias works without a build step (workspace source resolution), so a clean API typecheck is the only prerequisite.

## Port in use

Web is :14300, API is :14301. To find what's holding a port:

```bash
lsof -nP -iTCP:14300 -sTCP:LISTEN
```

Kill the offending process, then re-run `pnpm dev`.
