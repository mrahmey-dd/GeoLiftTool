# GeoLift — Incrementality Experiment Designer

A full-cycle web application for designing, running, and measuring geo-based incrementality experiments using Meta's open-source [GeoLift R package](https://facebookincubator.github.io/GeoLift/).

---

## What it does

| Screen | Purpose |
|--------|---------|
| **Experiment Library** | Home screen — all experiments across draft / active / complete states |
| **Experiment Wizard** | 5-step guided setup: config → data upload → market selection → power analysis → review |
| **Market Selection Map** | Interactive D3 US choropleth for assigning treatment markets and running `GeoLiftMarketSelection()` |
| **Power Analysis** | `GeoLiftPower()` simulation via async job queue — MDE, power curves, iROAS break-even |
| **Flight Monitor** | In-experiment view — directional signal, CI narrowing, data health, spend pacing |
| **Results Dashboard** | Post-campaign `GeoLift()` analysis — ATT, lift %, iROAS, p-value, counterfactual chart |

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Docker | ≥ 24 | Required for all services |
| Docker Compose | ≥ 2.20 | Bundled with Docker Desktop |
| Node.js | ≥ 20 | Only needed for local frontend dev outside Docker |
| R | 4.3.2 | Only needed to re-run `renv::snapshot()` |

You do **not** need R installed locally to run the application. Everything runs inside Docker containers.

---

## Quick Start

```bash
# 1. Clone the repository
git clone <your-repo-url>
cd geolift

# 2. Copy environment template
cp .env.example .env
# Edit .env — at minimum set a JWT_SECRET

# 3. Start all services
docker compose up --build

# 4. Open the app
open http://localhost:5173
```

The first build takes 5–10 minutes while renv restores ~20 R packages. Subsequent builds use the Docker layer cache and take ~30 seconds.

---

## Services

| Service | Port | Purpose |
|---------|------|---------|
| `frontend` | 5173 | React + Vite dev server |
| `api` | 8000 | R/Plumber REST API |
| `worker` | — | Background job processor (GeoLiftPower, etc.) |
| `postgres` | 5432 | Experiment metadata, results |
| `redis` | 6379 | Job queue + job state |
| `minio` | 9000 | S3-compatible dataset storage |
| **MinIO Console** | 9001 | Web UI for browsing uploaded datasets |

---

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Required
JWT_SECRET=your_secret_here_min_32_chars

# Database (defaults work with docker-compose)
DB_HOST=postgres
DB_PORT=5432
DB_NAME=geolift
DB_USER=geolift
DB_PASSWORD=geolift_dev

# Redis
REDIS_URL=redis://redis:6379

# Object storage (MinIO defaults)
S3_ENDPOINT=http://minio:9000
S3_BUCKET=geolift-data
MINIO_ROOT_USER=minio
MINIO_ROOT_PASSWORD=minio_dev

# Frontend
VITE_API_URL=http://localhost:8000

# App
GEOLIFT_ENV=development
LOG_LEVEL=INFO
WORKER_CONCURRENCY=2
```

---

## API Reference

Interactive Swagger docs are available at **http://localhost:8000/__docs__/** when running in development mode.

### Endpoint summary

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/v1/health` | Health check — DB + Redis status |
| `POST` | `/v1/data/upload` | Upload KPI panel CSV |
| `POST` | `/v1/data/validate` | Run 14 best-practice checks |
| `POST` | `/v1/markets/select` | Run `GeoLiftMarketSelection()` |
| `POST` | `/v1/power/simulate` | Submit `GeoLiftPower()` job (async) |
| `GET`  | `/v1/jobs/:id` | Poll async job status |
| `POST` | `/v1/measurement/run` | Run `GeoLift()` single-cell |
| `POST` | `/v1/measurement/run-multicell` | Run multi-cell analysis |
| `GET`  | `/v1/experiments` | List experiments |
| `GET`  | `/v1/experiments/:id` | Full experiment detail |
| `POST` | `/v1/experiments` | Create experiment |
| `PATCH`| `/v1/experiments/:id` | Update experiment fields |
| `POST` | `/v1/export/:id/pdf` | Generate PDF report |
| `POST` | `/v1/export/:id/csv` | Export counterfactual CSV |

---

## Project Structure

```
geolift/
├── frontend/                   # React + Vite application
│   ├── src/
│   │   ├── main.jsx            # Entry point
│   │   ├── api.js              # Typed API client
│   │   ├── GeoLiftApp.jsx      # App shell — routing + shared state
│   │   ├── GeoLiftLibrary.jsx  # Experiment library home screen
│   │   ├── GeoLiftTool.jsx     # Experiment wizard (5 steps)
│   │   ├── GeoLiftMarketMap.jsx# D3 market selection map
│   │   ├── GeoLiftMonitor.jsx  # In-flight monitoring dashboard
│   │   ├── GeoLiftResults.jsx  # Post-campaign results dashboard
│   │   └── GeoLiftBackendSpec.jsx # Interactive API reference
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
│
├── R/                          # Plumber API source
│   ├── helpers/
│   │   ├── auth.R              # JWT verification
│   │   ├── db.R                # Postgres connection + dataset loader
│   │   ├── geolift_utils.R     # Shared utilities
│   │   ├── jobs.R              # Redis job queue management
│   │   └── storage.R           # S3/MinIO object storage
│   ├── routes/
│   │   ├── data.R              # Upload + validate
│   │   ├── experiments.R       # CRUD
│   │   ├── export.R            # PDF + CSV export
│   │   ├── health.R            # Health check
│   │   ├── jobs.R              # Job polling
│   │   ├── markets.R           # GeoLiftMarketSelection()
│   │   ├── measurement.R       # GeoLift() single + multi-cell
│   │   └── power.R             # GeoLiftPower() async job
│   ├── templates/
│   │   └── experiment_report.Rmd # PDF report template
│   └── worker.R                # Redis queue consumer
│
├── sql/
│   ├── schema.sql              # All 8 PostgreSQL tables
│   └── seed.sql                # Development seed data
│
├── api.R                       # Plumber entry point + middleware
├── Dockerfile
├── docker-compose.yml
├── renv.lock                   # Pinned R package versions
├── renv/activate.R             # renv bootstrap
└── .Rprofile                   # Sources renv on startup
```

---

## Data Requirements

GeoLift requires a **balanced panel** CSV with three mandatory columns:

| Column | Type | Description |
|--------|------|-------------|
| `date` | `YYYY-MM-DD` | Daily or weekly observation date |
| `location` | string | Geographic unit identifier (DMA name, city, etc.) |
| `Y` | numeric | KPI value (revenue, conversions, etc.) |

Additional covariate columns (population, income index, etc.) are optional but improve model fit.

**Key constraints checked on upload:**
- No missing `date × location` combinations
- ≥ 20 geographic units
- ≥ 25 pre-treatment periods
- Pre-period free of structural breaks

---

## Development Workflow

### Running individual services

```bash
# API only (with hot-reload via mounted volume)
docker compose up api postgres redis minio

# Frontend only (outside Docker, faster HMR)
cd frontend && npm install && npm run dev

# Worker only
docker compose up worker

# View API logs
docker compose logs -f api

# View worker logs
docker compose logs -f worker
```

### Database access

```bash
# Connect to Postgres
docker compose exec postgres psql -U geolift -d geolift

# Reset database (drops + recreates)
docker compose down -v && docker compose up --build
```

### Finalising renv.lock hashes

The `renv.lock` ships with accurate version pins but placeholder hashes. Run this once after the container is built to generate real SHA hashes:

```bash
docker compose run --rm api Rscript -e "renv::snapshot()"
```

Copy the updated `renv.lock` out of the container:

```bash
docker compose cp api:/app/renv.lock ./renv.lock
```

### Adding R packages

```bash
# Install inside container
docker compose exec api Rscript -e "install.packages('newpackage')"

# Snapshot to update lockfile
docker compose exec api Rscript -e "renv::snapshot()"

# Copy updated lockfile
docker compose cp api:/app/renv.lock ./renv.lock
```

---

## Authentication

The API uses short-lived JWT tokens (HS256, 15-minute expiry). In development, the seed data creates a demo user:

```
Email:    analyst@acme.com
Org:      acme
Role:     admin
```

To generate a token for local testing:

```r
source("R/helpers/auth.R")
issue_jwt("00000000-0000-0000-0000-000000000002",
          "00000000-0000-0000-0000-000000000001",
          secret = Sys.getenv("JWT_SECRET"))
```

Paste the token into the frontend's `localStorage.geolift_token` key, or use the Swagger UI's Authorize button.

---

## GeoLift Best Practices (enforced in the tool)

The tool enforces all 14 GeoLift best practices with real-time pass/warn/fail feedback:

1. ✅ Daily granularity (recommended over weekly)
2. ✅ Finest available geo level (City/Zip preferred over DMA)
3. ✅ Pre-period ≥ 4–5× test duration
4. ✅ Minimum 25 pre-treatment periods
5. ✅ 20+ geographic units
6. ✅ 52 weeks of historical data recommended
7. ✅ Test covers ≥ 1 purchase cycle
8. ✅ Minimum 15 days (daily) / 4–6 weeks (weekly)
9. ✅ No missing values for any geo × date combination
10. ✅ Panel covariates (optional, improves fit)
11. ✅ Match markets on exact KPI outcome
12. ✅ Local media documented and held constant
13. ✅ National media stable during test window
14. ✅ Pre-period free of structural breaks

---

## License

MIT — see `LICENSE` file.

GeoLift R package: [Meta Open Source](https://github.com/facebookincubator/GeoLift) · MIT License.
