# Arekta Ticketmaster

Full-stack monorepo for learning DevOps practices: Turborepo, Express API, React web app, PostgreSQL Primary-Secondary-Secondary replication, and a complete observability stack.

## Stack

| Layer | Technology |
|-------|------------|
| Monorepo | pnpm + Turborepo |
| API | Node.js, TypeScript, Express, Vitest |
| Web | Vite, React, TypeScript |
| Database | PostgreSQL 16 (1 primary + 2 read replicas) |
| Tracing | OpenTelemetry → Collector → Jaeger |
| Metrics | OpenTelemetry → Collector → Prometheus |
| Logs | pino JSON → Filebeat → Logstash → Elasticsearch → Kibana |

## Prerequisites

- Node.js 20+
- pnpm 9+
- Docker & Docker Compose
- **~8 GB RAM** recommended for the full stack (ELK + 3 Postgres instances)

## Quick start (full Docker stack)

```bash
cp .env.example .env
pnpm install
pnpm docker:up
```

Wait for all services to become healthy (replicas can take 1–2 minutes on first boot).

### URLs

| Service | URL |
|---------|-----|
| Web (nginx) | http://localhost:8088 |
| API | http://localhost:3000 |
| API health | http://localhost:3000/health |
| API readiness | http://localhost:3000/ready |
| Jaeger UI | http://localhost:16686 |
| Prometheus | http://localhost:9090 |
| Kibana | http://localhost:5601 |
| Elasticsearch | http://localhost:9200 |

### Dev mode (hot reload)

Runs infrastructure in Docker; API and web use volume mounts with hot reload:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

- Web dev server: http://localhost:5173
- API: http://localhost:3000

## Local development (without app containers)

Start only infrastructure:

```bash
docker compose up -d postgres-primary postgres-replica-1 postgres-replica-2 otel-collector jaeger prometheus elasticsearch logstash kibana filebeat
cp .env.example .env
pnpm install
pnpm --filter @repo/shared build
pnpm --filter api db:migrate
pnpm dev
```

## TDD workflow

```bash
pnpm --filter api test:watch    # API tests
pnpm --filter web test:watch    # Web tests
pnpm test                       # All packages
pnpm deploy:check               # lint + typecheck + test + build
```

### API test coverage

- `GET /health` → 200
- `GET /ready` → 200/503 based on DB health
- 404/400/500 error shapes
- Request ID header propagation

## Architecture

```
Browser → Web (nginx) → API → PostgreSQL Primary (writes)
                            → PostgreSQL Replicas (reads)
                            → OTel Collector → Jaeger / Prometheus
                            → JSON logs → Filebeat → Logstash → Elasticsearch → Kibana
```

## Environment variables

See [`.env.example`](.env.example). Key variables:

- `DATABASE_PRIMARY_URL` — write connection
- `DATABASE_REPLICA_1_URL` / `DATABASE_REPLICA_2_URL` — read connections
- `OTEL_EXPORTER_OTLP_ENDPOINT` — OpenTelemetry collector
- `LOG_LEVEL` — pino log level

## Kibana setup

1. Open http://localhost:5601
2. Create index pattern: `logs-*`
3. Search by `trace_id` or `requestId` to correlate logs with Jaeger traces

## Troubleshooting

### Port already in use (8080 / 8088)

Another process is using the host port. Either stop it:

```bash
ss -tlnp | grep 8080
# or set a different host port:
WEB_PORT=8090 pnpm docker:up
```

Default web port is **8088** (not 8080) to reduce conflicts with other local dev servers.

### Port already in use (6379 / Redis)

Another Redis (or service) is bound to 6379. The compose file maps Redis to host port **6380** by default:

```bash
ss -tlnp | grep 6379
# or override the host port:
REDIS_PORT=6381 pnpm docker:up
```

Set `REDIS_URL=redis://localhost:6380` in `.env` when connecting from the host (e.g. `pnpm --filter api dev`).

### Replicas not ready

Replicas run `pg_basebackup` on first start. Check logs:

```bash
docker compose logs postgres-replica-1 postgres-replica-2
```

Restart after primary is healthy:

```bash
docker compose restart postgres-replica-1 postgres-replica-2
```

### Elasticsearch yellow/red cluster

ELK is memory-heavy. Ensure Docker has ≥8 GB RAM. Restart:

```bash
docker compose restart elasticsearch logstash kibana
```

### OTel connection errors

Verify collector is running:

```bash
docker compose logs otel-collector api
```

### API `/ready` returns 503

Requires primary + at least one replica in recovery mode. Wait for replica healthchecks or inspect:

```bash
docker compose ps
```

### Reset everything

```bash
pnpm docker:down   # removes volumes
pnpm docker:up
```

## TDD implementation workflow

Movie reservation features are built **one API module at a time** using test-driven development:

1. Read the current phase plan in local `Phases/` (gitignored — personal workflow docs)
2. Write failing tests → implement → `pnpm --filter api test`
3. Verify with Postman: import [`postman/arekta-ticketmaster.postman_collection.json`](postman/arekta-ticketmaster.postman_collection.json)
4. Run `pnpm deploy:check`, then commit and push before starting the next module

Module order: Foundation → Auth → Genres → Movies → Showtimes → Seats → Reservations → Payments → Notifications → Admin → Web UI.

## Project structure

```
apps/api/          Express API
apps/web/          React frontend
packages/shared/   Shared types (Zod schemas)
docker/            Postgres, OTel, Prometheus, ELK configs
postman/           Postman collection (versioned)
Phases/            Local TDD phase plans (gitignored)
```

## Notes

- PostgreSQL PSS setup is for **local learning** — no automatic failover (Patroni not included).
- Writes go to primary; reads round-robin across replicas.
- Render deployment is a separate follow-up after MVP validation locally.
