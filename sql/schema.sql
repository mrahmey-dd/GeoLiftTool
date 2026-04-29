-- GeoLift PostgreSQL Schema
-- Run on container start via docker-entrypoint-initdb.d

-- ── Extensions ───────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- fuzzy search on names

-- ── Organisations (multi-tenant root) ────────────────────────────
CREATE TABLE organisations (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  slug        TEXT        NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Users ─────────────────────────────────────────────────────────
CREATE TABLE users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  email         TEXT        NOT NULL UNIQUE,
  name          TEXT,
  role          TEXT        NOT NULL DEFAULT 'analyst'
                            CHECK (role IN ('admin','analyst','viewer')),
  password_hash TEXT,       -- bcrypt hash; NULL = demo/SSO users only
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_org ON users(org_id);

-- ── Experiments ───────────────────────────────────────────────────
CREATE TABLE experiments (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name              TEXT        NOT NULL,
  kpi               TEXT        NOT NULL,
  test_type         TEXT        NOT NULL CHECK (test_type IN ('single','multi')),
  geo_level         TEXT        NOT NULL,
  data_granularity  TEXT        NOT NULL CHECK (data_granularity IN ('daily','weekly')),
  channel           TEXT,
  test_start        DATE,
  test_end          DATE,
  pre_start         DATE,
  -- Resource chain IDs — set as each step completes
  dataset_id        UUID,
  selection_id      UUID,
  power_id          UUID,
  result_id         UUID,
  -- Metadata
  status            TEXT        NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft','active','complete','archived')),
  owner             TEXT,
  notes             TEXT,
  spend             NUMERIC,
  target_effect     NUMERIC,
  confidence        NUMERIC,
  bp_score          INTEGER     DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_experiments_org    ON experiments(org_id);
CREATE INDEX idx_experiments_status ON experiments(org_id, status);
CREATE INDEX idx_experiments_name   ON experiments USING gin(name gin_trgm_ops);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER experiments_updated_at
  BEFORE UPDATE ON experiments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Experiment cells (single or multi) ───────────────────────────
CREATE TABLE experiment_cells (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id     UUID        NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  label             TEXT        NOT NULL,
  channel           TEXT,
  spend             NUMERIC,
  objective         TEXT,
  color             TEXT,
  treatment_markets TEXT[],     -- array of location strings assigned after market selection
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cells_experiment ON experiment_cells(experiment_id);

-- ── Uploaded datasets ─────────────────────────────────────────────
CREATE TABLE experiment_datasets (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id   UUID        NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  -- Object storage path (e.g. "datasets/{id}/data.parquet")
  file_path       TEXT        NOT NULL,
  n_geos          INTEGER,
  n_periods       INTEGER,
  date_start      DATE,
  date_end        DATE,
  kpi_col         TEXT        NOT NULL DEFAULT 'Y',
  covariate_cols  TEXT,       -- comma-separated
  -- Validation results stored as JSONB for easy UI consumption
  bp_checks_json  JSONB,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_datasets_experiment ON experiment_datasets(experiment_id);

-- ── Market selections (GeoLiftMarketSelection output) ─────────────
CREATE TABLE market_selections (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id     UUID        NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  cell_id           UUID        REFERENCES experiment_cells(id),
  -- Comma-separated market lists
  treatment_markets TEXT        NOT NULL,
  control_markets   TEXT        NOT NULL,
  -- Fit stats
  rmse              NUMERIC,
  correlation       NUMERIC,
  mape              NUMERIC,
  r2                NUMERIC,
  -- Full candidate rankings for the UI similarity panel
  candidates_json   JSONB,
  -- Base64 pre-period chart PNG
  chart_b64         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_selections_experiment ON market_selections(experiment_id);

-- ── Power analyses (GeoLiftPower output) ─────────────────────────
CREATE TABLE power_analyses (
  id                    UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id         UUID    NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  selection_id          UUID    REFERENCES market_selections(id),
  target_confidence     NUMERIC NOT NULL DEFAULT 0.80,
  mde                   NUMERIC,          -- minimum detectable effect at target confidence
  recommended_duration  INTEGER,          -- days
  power_matrix_json     JSONB,            -- 2-D array: effect_size × duration → power
  n_simulations         INTEGER NOT NULL DEFAULT 2000,
  effect_sizes          NUMERIC[],
  test_durations        INTEGER[],
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_power_experiment ON power_analyses(experiment_id);

-- ── Experiment results (GeoLift output) ──────────────────────────
CREATE TABLE experiment_results (
  id                      UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id           UUID    NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  cell_id                 UUID    REFERENCES experiment_cells(id),
  -- Core metrics
  att                     NUMERIC,    -- average daily incremental KPI
  att_total               NUMERIC,    -- total incremental KPI over test window
  lift_pct                NUMERIC,
  lift_ci_low             NUMERIC,    -- % lower bound
  lift_ci_high            NUMERIC,    -- % upper bound
  p_value                 NUMERIC,
  iroas                   NUMERIC,
  -- Model diagnostics
  pre_period_r2           NUMERIC,
  pre_period_mape         NUMERIC,
  pre_period_bias         NUMERIC,
  -- Full time series and breakdowns stored as JSONB
  counterfactual_json     JSONB,      -- daily { date, actual, synthetic, ci_low, ci_high, lift }
  market_breakdown_json   JSONB,      -- per-geo { location, actual, synthetic, lift_pct, lift_abs }
  weights_json            JSONB,      -- synthetic control donor weights
  model_version           TEXT        NOT NULL DEFAULT 'GeoLift',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_results_experiment ON experiment_results(experiment_id);

-- ── Multi-cell result aggregates ─────────────────────────────────
CREATE TABLE multicell_results (
  id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id       UUID    NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  cells_json          JSONB,  -- array of per-cell GeoLift results
  comparison_json     JSONB,  -- side-by-side comparison table
  optimal_cell_id     UUID    REFERENCES experiment_cells(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Refresh tokens ───────────────────────────────────────────────
CREATE TABLE refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  token_hash  TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type        TEXT        NOT NULL,
  experiment_id   UUID        REFERENCES experiments(id),
  status          TEXT        NOT NULL DEFAULT 'queued'
                              CHECK (status IN ('queued','running','complete','failed')),
  progress        INTEGER     NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  payload_json    JSONB,
  result_json     JSONB,
  error_message   TEXT,
  enqueued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ
);

CREATE INDEX idx_jobs_experiment ON jobs(experiment_id);
CREATE INDEX idx_jobs_status     ON jobs(status);
