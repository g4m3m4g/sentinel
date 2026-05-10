# Sentinel — High-Availability Uptime Monitor

A containerised uptime monitoring API that tracks availability and response times of external services. Built with Node.js, PostgreSQL, Docker, Nginx, and deployed to AWS EC2 via a fully automated GitHub Actions CI/CD pipeline.

---

## Architecture

```
Internet
   │
   ▼
[Nginx :80]  ── rate limit (10 req/s per IP)
   │
   ▼ (public network)
[Node.js API :3000]  ── ping worker (node-cron)
   │
   ▼ (internal network only)
[PostgreSQL :5432]
   │
   ▼
[Named Volume: postgres_data]
```

- PostgreSQL is **never exposed to the internet** — only reachable by the API on an isolated Docker bridge network
- The API only starts **after PostgreSQL passes a healthcheck**
- Data **persists across restarts** via named Docker volume

---

## Tech Stack

| Layer            | Technology                           |
| ---------------- | ------------------------------------ |
| Backend          | Node.js, Express                     |
| Database         | PostgreSQL 15                        |
| Proxy            | Nginx (rate limiting, reverse proxy) |
| Containerisation | Docker, Docker Compose               |
| Testing          | Jest, Supertest                      |
| CI/CD            | GitHub Actions                       |
| Cloud            | AWS EC2                              |

---

## Project Structure

```
sentinel/
├── src/
│   ├── app.js              # Express app
│   ├── index.js            # Entry point
│   ├── db/
│   │   └── index.js        # Postgres pool, schema, health logging
│   ├── routes/
│   │   ├── targets.js      # CRUD endpoints
│   │   └── stats.js        # Uptime stats
│   └── workers/
│       └── pinger.js       # Async cron-based ping engine
├── tests/
│   └── api.test.js         # Integration tests (real DB)
├── nginx/
│   └── nginx.conf          # Reverse proxy + rate limiting
├── .github/
│   └── workflows/
│       └── ci-cd.yml       # CI/CD pipeline
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) 24+
- [Node.js](https://nodejs.org/) 20+ (for local dev only)
- [Git](https://git-scm.com/)

### Run with Docker Compose (recommended)

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/sentinel.git
cd sentinel

# 2. Configure environment
cp .env.example .env
# Edit .env — set a strong POSTGRES_PASSWORD

# 3. Start all services
docker compose up -d --build

# 4. Verify
curl http://localhost/health
```

### Run locally (dev mode)

```bash
# 1. Start a local Postgres
docker run -d \
  --name sentinel_db \
  -e POSTGRES_DB=sentinel \
  -e POSTGRES_USER=sentinel \
  -e POSTGRES_PASSWORD=localpassword \
  -p 5432:5432 \
  postgres:15-alpine

# 2. Configure environment
cp .env.example .env
# Set DATABASE_URL=postgres://sentinel:localpassword@localhost:5432/sentinel

# 3. Install and run
npm install
npm run dev
```

---

## API Reference

Base URL: `http://localhost:3000` (local) or `http://YOUR_EC2_IP` (production)

### Health

```
GET /health
```

```json
{ "status": "ok", "time": "2025-01-15T10:00:00.000Z" }
```

### Targets

| Method | Endpoint           | Description                            |
| ------ | ------------------ | -------------------------------------- |
| GET    | `/api/targets`     | List all targets                       |
| POST   | `/api/targets`     | Add a new target                       |
| GET    | `/api/targets/:id` | Get target + 24h stats + last 50 pings |
| PATCH  | `/api/targets/:id` | Update name, interval, or pause        |
| DELETE | `/api/targets/:id` | Remove target and all its history      |

**Add a target:**

```bash
curl -X POST http://localhost:3000/api/targets \
  -H "Content-Type: application/json" \
  -d '{"name":"Google","url":"https://google.com","interval_seconds":60}'
```

**Response:**

```json
{
  "id": 1,
  "name": "Google",
  "url": "https://google.com",
  "interval_seconds": 60,
  "active": true,
  "created_at": "2025-01-15T10:00:00.000Z"
}
```

**Get target with stats:**

```bash
curl http://localhost:3000/api/targets/1
```

```json
{
  "id": 1,
  "name": "Google",
  "url": "https://google.com",
  "stats": {
    "total_checks": 1440,
    "up_count": 1438,
    "avg_response_ms": 142,
    "uptime_percent": 99.86
  },
  "recent_logs": [
    {
      "is_up": true,
      "status_code": 200,
      "response_time_ms": 138,
      "checked_at": "..."
    }
  ]
}
```

**Pause a target:**

```bash
curl -X PATCH http://localhost:3000/api/targets/1 \
  -H "Content-Type: application/json" \
  -d '{"active": false}'
```

**Delete a target:**

```bash
curl -X DELETE http://localhost:3000/api/targets/1
# Returns 204 No Content
```

### Stats

```
GET /api/stats/summary
```

```json
[
  {
    "id": 1,
    "name": "Google",
    "url": "https://google.com",
    "active": true,
    "uptime_percent_24h": 99.86,
    "avg_response_ms_24h": 142,
    "current_status": true
  }
]
```

> `current_status: true` = up, `false` = down, `null` = not yet checked

---

## Running Tests

```bash
# Start a test database
docker run -d \
  --name sentinel_test_db \
  -e POSTGRES_DB=sentinel_test \
  -e POSTGRES_USER=sentinel \
  -e POSTGRES_PASSWORD=sentinel \
  -p 5432:5432 \
  postgres:15-alpine

# Run tests
npm test
```

The test suite runs integration tests against a real PostgreSQL database — no mocks.

---

## AWS EC2 Deployment

### 1. Launch EC2 instance

- AMI: Ubuntu 22.04 LTS
- Type: t3.micro
- Security group inbound rules:
  - Port 22 (SSH) — your IP only
  - Port 80 (HTTP) — 0.0.0.0/0

### 2. Install Docker on EC2

```bash
ssh -i your-key.pem ubuntu@YOUR_EC2_IP

curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu
# Log out and back in

sudo apt-get install -y git
git clone https://github.com/YOUR_USERNAME/sentinel.git /opt/sentinel
```

### 3. Add GitHub Secrets

In your repo: Settings → Secrets and variables → Actions

| Secret              | Value                                                      |
| ------------------- | ---------------------------------------------------------- |
| `EC2_HOST`          | Your EC2 public IP                                         |
| `EC2_USER`          | `ubuntu`                                                   |
| `EC2_SSH_KEY`       | Contents of your `.pem` file                               |
| `POSTGRES_PASSWORD` | A strong password                                          |
| `DATABASE_URL`      | `postgres://sentinel:YOUR_PASSWORD@postgres:5432/sentinel` |

### 4. Deploy

Push to `main` — the pipeline will:

1. Spin up a Postgres service container
2. Run integration tests against it
3. SSH into EC2 and deploy with Docker Compose
4. Verify `/health` returns 200

### 5. Access your API

```
http://YOUR_EC2_PUBLIC_IP/health
http://YOUR_EC2_PUBLIC_IP/api/targets
http://YOUR_EC2_PUBLIC_IP/api/stats/summary
```

---

## Environment Variables

| Variable            | Description                                |
| ------------------- | ------------------------------------------ |
| `DATABASE_URL`      | Full Postgres connection string            |
| `POSTGRES_PASSWORD` | Postgres password (used by Docker Compose) |
| `PORT`              | API port (default: 3000)                   |
| `NODE_ENV`          | `development` or `production`              |

Copy `.env.example` to `.env` and fill in values. Never commit `.env` to git.

---

## DevOps Highlights

- **Service dependency ordering** — `depends_on` with Postgres healthchecks ensures correct startup order
- **Network isolation** — Postgres unreachable from public network; only the API container can connect
- **Named volumes** — database data persists across `docker compose down` and restarts
- **CI with real database** — GitHub Actions spins up a live Postgres service container for every test run
- **Zero secrets in repo** — credentials injected at deploy time via GitHub Secrets
- **Rate limiting** — Nginx limits requests to 10/s per IP with a burst allowance of 20
- **Structured JSON logs** — every layer logs in JSON format, ready for CloudWatch or Datadog ingestion
- **DB pool health monitoring** — connection pool stats and query latency logged every 5 minutes

---

## License

MIT
