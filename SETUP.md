# Sentinel: Setup Guide

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20+ | https://nodejs.org |
| Docker | 24+ | https://docs.docker.com/get-docker |
| Docker Compose | v2 | Included with Docker Desktop |
| Git | any | https://git-scm.com |

---

## Local Development (no Docker)

### 1. Clone & install

```bash
git clone https://github.com/YOUR_USERNAME/sentinel.git
cd sentinel
npm install
```

### 2. Start a local Postgres

```bash
docker run -d \
  --name sentinel_local_db \
  -e POSTGRES_DB=sentinel \
  -e POSTGRES_USER=sentinel \
  -e POSTGRES_PASSWORD=localpassword \
  -p 5432:5432 \
  postgres:15-alpine
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env:
# POSTGRES_PASSWORD=localpassword
# DATABASE_URL=postgres://sentinel:localpassword@localhost:5432/sentinel
```

### 4. Run

```bash
npm run dev
# API available at http://localhost:3000
```

---

## Docker Compose (recommended)

### 1. Configure environment

```bash
cp .env.example .env
# Set a strong POSTGRES_PASSWORD in .env
```

### 2. Start all services

```bash
docker compose up -d --build
```

This starts:
- **PostgreSQL** on internal network (not exposed publicly)
- **Node.js API** on internal + public network
- **Nginx** on port 80, proxying to the API with rate limiting

### 3. Verify

```bash
curl http://localhost/health
# {"status":"ok","time":"..."}
```

### 4. Stop

```bash
docker compose down          # keep DB data
docker compose down -v       # also delete DB data
```

---

## API Reference

### Targets

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/targets` | List all targets |
| POST | `/api/targets` | Add a target |
| GET | `/api/targets/:id` | Get target + stats + logs |
| PATCH | `/api/targets/:id` | Update target |
| DELETE | `/api/targets/:id` | Remove target |

**POST /api/targets body:**
```json
{
  "name": "My API",
  "url": "https://example.com",
  "interval_seconds": 60
}
```

### Stats

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stats/summary` | 24h uptime summary for all targets |

### Health

```
GET /health  →  {"status":"ok","time":"..."}
```

---

## Run Tests

```bash
# Start test database
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

---

## AWS EC2 Deployment

### 1. Launch EC2 instance

- **AMI**: Ubuntu 22.04 LTS
- **Type**: t3.micro (free tier)
- **Security Group inbound rules**:
  - Port 22 (SSH) — your IP only
  - Port 80 (HTTP) — 0.0.0.0/0

### 2. Install dependencies on EC2

```bash
# SSH into instance
ssh -i your-key.pem ubuntu@YOUR_EC2_IP

# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker ubuntu
# Log out and back in

# Install Git
sudo apt-get install -y git

# Clone repo
sudo mkdir -p /opt/sentinel
sudo chown ubuntu:ubuntu /opt/sentinel
git clone https://github.com/YOUR_USERNAME/sentinel.git /opt/sentinel
```

### 3. Add GitHub Secrets

In your GitHub repo → Settings → Secrets and variables → Actions, add:

| Secret | Value |
|--------|-------|
| `EC2_HOST` | Your EC2 public IP |
| `EC2_USER` | `ubuntu` |
| `EC2_SSH_KEY` | Contents of your `.pem` file |
| `POSTGRES_PASSWORD` | A strong password |
| `DATABASE_URL` | `postgres://sentinel:YOUR_PASSWORD@postgres:5432/sentinel` |

### 4. Deploy

Push to `main` branch — the GitHub Actions pipeline will:
1. Spin up a Postgres service container
2. Run integration tests against a real DB
3. SSH into EC2 and deploy with Docker Compose
4. Verify `/health` returns 200

---

## Project Structure

```
sentinel/
├── src/
│   ├── app.js              # Express app (no listen, for testing)
│   ├── index.js            # Entry point (starts server + worker)
│   ├── db/
│   │   └── index.js        # Postgres pool, schema init, health check
│   ├── routes/
│   │   ├── targets.js      # CRUD endpoints
│   │   └── stats.js        # Uptime stats
│   └── workers/
│       └── pinger.js       # Async ping worker with cron scheduling
├── tests/
│   └── api.test.js         # Supertest integration tests
├── nginx/
│   └── nginx.conf          # Reverse proxy + rate limiting
├── .github/workflows/
│   └── ci-cd.yml           # CI/CD pipeline
├── Dockerfile
├── docker-compose.yml
├── .env.example
└── SETUP.md
```

---

## Architecture Overview

```
Internet
   │
   ▼
[Nginx :80]  ── rate limit (10 req/s/IP)
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

- **Postgres is never exposed to the internet** — only reachable by the API container on the internal bridge network.
- **DB credentials** are injected at deploy time via GitHub Secrets, never committed.
- **Data persists** across container restarts via named Docker volume.
