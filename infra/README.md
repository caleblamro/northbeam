# infra

`docker-compose.dev.yml` runs local Postgres (user/pass/db all `northbeam`, port 5432).

```sh
docker compose -f infra/docker-compose.dev.yml up -d
pnpm db:migrate
```

`dev.sh` (invoked by `pnpm dev`) does both, then starts the web + api dev servers.
