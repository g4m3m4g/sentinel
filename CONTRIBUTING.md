# Contributing to Sentinel

## Project Structure

```
sentinel/
├── src/
│   ├── app.js              # Express app setup (no server.listen — importable for tests)
│   ├── index.js            # Entry point: DB init → worker start → server start
│   ├── db/
│   │   └── index.js        # Postgres connection pool, schema init, health logging
│   ├── routes/
│   │   ├── targets.js      # CRUD endpoints for /api/targets
│   │   └── stats.js        # Aggregated stats at /api/stats/summary
│   └── workers/
│       └── pinger.js       # Cron-based ping engine
├── tests/
│   └── api.test.js         # Integration tests (real Postgres, no mocks)
├── nginx/
│   └── nginx.conf          # Rate limiting + reverse proxy config
├── .github/
│   └── workflows/
│       └── ci-cd.yml       # GitHub Actions CI/CD pipeline
├── Dockerfile              # Production image (node:20-alpine, non-root user)
├── docker-compose.yml      # Full stack: Postgres + API + Nginx
├── .env.example            # Environment variable template
└── .env.test               # Test environment config (points to test DB)
```

---

## Development Setup

### Option A — Docker Compose (recommended)

```bash
cp .env.example .env
# Set POSTGRES_PASSWORD in .env

docker compose up -d --build
curl http://localhost/health
```

### Option B — Local Node.js

```bash
# Start a local Postgres
docker run -d \
  --name sentinel_local_db \
  -e POSTGRES_DB=sentinel \
  -e POSTGRES_USER=sentinel \
  -e POSTGRES_PASSWORD=localpassword \
  -p 5432:5432 \
  postgres:15-alpine

cp .env.example .env
# Set DATABASE_URL=postgres://sentinel:localpassword@localhost:5432/sentinel

npm install
npm run dev
```

The `dev` script uses `nodemon` and restarts on file changes.

---

## Running Tests

Tests require a running Postgres instance. The `.env.test` file points to the test database.

```bash
# Start a test database
docker run -d \
  --name sentinel_test_db \
  -e POSTGRES_DB=sentinel_test \
  -e POSTGRES_USER=sentinel \
  -e POSTGRES_PASSWORD=sentinel \
  -p 5432:5432 \
  postgres:15-alpine

npm test
```

Tests use `supertest` to make real HTTP requests against the Express app and a real PostgreSQL database. There are no mocks. The test suite cleans up all data before and after each run.

---

## Key Design Decisions

**Why no mocks in tests?**  
Mocking the database hides SQL bugs, constraint violations, and query performance issues. Integration tests against a real DB catch problems that matter in production.

**Why is `app.js` separate from `index.js`?**  
`app.js` exports the Express app without calling `app.listen()`. This lets tests import the app and use `supertest` without binding to a port or starting the ping worker.

**Why node-cron instead of `setInterval`?**  
`node-cron` supports cron expressions, making it straightforward to schedule both sub-minute intervals (seconds field) and minute-based intervals with the same API.

**Why Nginx in front of Node.js?**  
Node.js is not designed to be a public-facing server. Nginx handles rate limiting, connection management, and can be extended with TLS termination without touching application code.

---

## Adding a New Route

1. Create or edit a file in `src/routes/`
2. Register it in `src/app.js` with `app.use('/api/your-route', yourRouter)`
3. Add integration tests in `tests/api.test.js`
4. Update `API.md` with the new endpoint documentation

---

## Environment Variables

| Variable            | Required | Description                                      |
|---------------------|----------|--------------------------------------------------|
| `DATABASE_URL`      | yes      | Full Postgres connection string                  |
| `POSTGRES_PASSWORD` | yes*     | Used by Docker Compose to configure Postgres     |
| `PORT`              | no       | API port (default: `3000`)                       |
| `NODE_ENV`          | no       | `development`, `test`, or `production`           |

*Only needed when running via Docker Compose.

Copy `.env.example` to `.env` and fill in values. Never commit `.env` to git — it's in `.gitignore`.

---

## Logs

All logs are structured JSON, one object per line:

```json
{ "level": "info", "msg": "Ping recorded", "target": "Google", "url": "https://google.com", "is_up": true, "status_code": 200, "response_time_ms": 142 }
{ "level": "error", "msg": "Failed to save ping", "error": "connection refused" }
```

This format is ready for ingestion by CloudWatch, Datadog, or any log aggregator that accepts JSON.
