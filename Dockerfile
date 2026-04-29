# ── Stage 1: system dependencies ─────────────────────────────────
FROM rocker/r-ver:4.3.2 AS base

# System libraries required by R packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    libcurl4-openssl-dev \
    libssl-dev \
    libpq-dev \
    libsodium-dev \
    libxml2-dev \
    libudunits2-dev \
    libgdal-dev \
    libproj-dev \
    libgeos-dev \
    redis-tools \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ── Stage 2: R package installation ──────────────────────────────
FROM base AS packages

# Install renv for lockfile-based reproducibility
RUN R -e "install.packages('renv', repos='https://cloud.r-project.org')"

WORKDIR /app

# Copy lockfile first — Docker cache layer only invalidates on lockfile change
COPY renv.lock renv.lock
COPY .Rprofile .Rprofile
COPY renv/activate.R renv/activate.R

# Restore exact package versions from lockfile
RUN R -e "renv::restore()"

# ── Stage 3: application ──────────────────────────────────────────
FROM packages AS app

WORKDIR /app

# Copy application code
COPY R/ R/
COPY api.R api.R

# Non-root user for security
RUN useradd -m geolift
RUN chown -R geolift:geolift /app
USER geolift

EXPOSE 8000

# Health check — Plumber exposes /__docs__/ by default
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:8000/v1/health || exit 1

CMD ["Rscript", "api.R"]
