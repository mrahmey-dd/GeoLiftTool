# Getting onto GitHub and running the demo

## Step 1 — Create a GitHub repo

Go to **https://github.com/new** and create a new repository:
- Name: `geolift` (or whatever you prefer)
- Visibility: Private (recommended until you're ready to share publicly)
- **Do not** initialise with README, .gitignore, or license — we have all of these already
- Click **Create repository**

GitHub will show you a page with a remote URL. Copy it — you'll need it in Step 3.

---

## Step 2 — Organise the files locally

Create this folder structure on your machine by downloading all the output files into the right places:

```
geolift/                        ← create this folder
├── .env.example
├── .gitignore
├── README.md
├── api.R
├── Dockerfile
├── docker-compose.yml
├── renv.lock
├── .Rprofile
│
├── renv/
│   └── activate.R
│
├── R/
│   ├── helpers/
│   │   ├── auth.R
│   │   ├── db.R
│   │   ├── geolift_utils.R
│   │   ├── jobs.R
│   │   └── storage.R
│   ├── routes/
│   │   ├── auth.R
│   │   ├── data.R
│   │   ├── experiments.R
│   │   ├── export.R
│   │   ├── health.R
│   │   ├── jobs.R
│   │   ├── markets.R
│   │   ├── measurement.R
│   │   └── power.R
│   ├── templates/
│   │   └── experiment_report.Rmd
│   └── worker.R
│
├── sql/
│   ├── schema.sql
│   └── seed.sql
│
└── frontend/
    ├── index.html
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── main.jsx
        ├── api.js
        ├── GeoLiftApp.jsx
        ├── GeoLiftLibrary.jsx
        ├── GeoLiftTool.jsx
        ├── GeoLiftMarketMap.jsx
        ├── GeoLiftMonitor.jsx
        ├── GeoLiftResults.jsx
        └── GeoLiftBackendSpec.jsx
```

---

## Step 3 — Push to GitHub

Open a terminal in the `geolift/` folder:

```bash
# Initialise git
git init
git branch -M main

# Stage everything
git add .

# Verify .env is NOT included (should not appear)
git status | grep .env
# If .env appears: git rm --cached .env

# First commit
git commit -m "Initial commit — GeoLift incrementality experiment designer"

# Connect to your GitHub repo (paste your URL from Step 1)
git remote add origin https://github.com/YOUR_USERNAME/geolift.git

# Push
git push -u origin main
```

---

## Step 4 — Run the demo locally

### Prerequisites
- Docker Desktop installed and running
- That's it — no R, no Node required

```bash
# Clone (or just use the folder you already have)
git clone https://github.com/YOUR_USERNAME/geolift.git
cd geolift

# Create your .env from the template
cp .env.example .env

# Open .env and set a real JWT_SECRET (anything ≥ 32 chars works)
# The rest of the defaults work as-is for local demo

# Start everything
docker compose up --build

# First run takes ~8 minutes (renv restoring R packages)
# Subsequent runs take ~30 seconds
```

When you see:
```
api_1     | GeoLift API ready on port 8000
frontend_1| Local: http://localhost:5173
```

Open **http://localhost:5173** and sign in with:
- Email: `analyst@acme.com`
- Password: `geolift_demo`

Or click **"Skip — load demo data without backend"** to demo the UI with mock data only (no Docker required).

---

## Step 5 — Finalise renv.lock (one-time, after first build)

The `renv.lock` ships with correct version pins but placeholder hashes.
Run this after `docker compose up --build` succeeds:

```bash
# Generate real package hashes
docker compose exec api Rscript -e "renv::snapshot()"

# Copy the updated lockfile back out
docker compose cp api:/app/renv.lock ./renv.lock

# Commit it
git add renv.lock
git commit -m "fix: finalise renv.lock package hashes"
git push
```

After this, the Docker build is fully reproducible.

---

## Demo tips

**No backend?** Click "Skip — load demo data without backend" on the login screen. The full UI works with the built-in mock experiments — Library, Results dashboard with counterfactual chart, Market Map, Monitor screen, and the full 5-step wizard. Nothing requires a live API for the UI to be impressive.

**With backend?** `docker compose up` and demo the full loop: upload a CSV → validate → run `GeoLiftMarketSelection()` → run `GeoLiftPower()` simulation → launch → monitor → run `GeoLift()` measurement → export PDF report.

**Sharing a link?** For a shareable URL instead of local Docker, push to a free tier on [Railway](https://railway.app) — connect your GitHub repo, add the environment variables from `.env.example`, and Railway will detect the `docker-compose.yml` automatically. The frontend + API will both get public URLs.

---

## Key URLs once running

| URL | What |
|-----|------|
| http://localhost:5173 | React frontend |
| http://localhost:8000/__docs__/ | Swagger API docs |
| http://localhost:9001 | MinIO console (dataset files) |
| http://localhost:5432 | Postgres (user: geolift / geolift_dev) |
