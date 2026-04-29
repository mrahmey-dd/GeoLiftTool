import { useState } from "react";

const C = {
  bg:        "#080b10",
  surface:   "#0e1219",
  surfaceHi: "#141923",
  border:    "#1e2733",
  borderHi:  "#2a3545",
  text:      "#cfd8e3",
  muted:     "#5a6a7e",
  cyan:      "#00c9a7",
  cyanDim:   "#00c9a718",
  amber:     "#f5a623",
  amberDim:  "#f5a62318",
  red:       "#f04a5a",
  redDim:    "#f04a5a18",
  green:     "#3dd68c",
  greenDim:  "#3dd68c18",
  blue:      "#4e9eff",
  blueDim:   "#4e9eff12",
  purple:    "#a78bfa",
};

const font = {
  heading: "'Syne', sans-serif",
  mono:    "'DM Mono', monospace",
  body:    "'Inter', system-ui, sans-serif",
};

/* ─── METHOD COLORS ─────────────────────────────────────────────── */
const METHOD = {
  POST:   { bg: C.cyanDim,   border: C.cyan,   color: C.cyan   },
  GET:    { bg: C.greenDim,  border: C.green,  color: C.green  },
  DELETE: { bg: C.redDim,    border: C.red,    color: C.red    },
};

/* ─── API SPEC DATA ──────────────────────────────────────────────── */
const SECTIONS = [
  {
    id: "overview",
    label: "Overview",
    icon: "◈",
  },
  {
    id: "architecture",
    label: "Architecture",
    icon: "⬡",
  },
  {
    id: "data",
    label: "Data & Upload",
    icon: "↑",
    endpoints: [
      {
        id: "upload-data",
        method: "POST",
        path: "/v1/data/upload",
        summary: "Upload KPI time-series data",
        description: "Accepts a balanced panel CSV (date × location × Y). Validates structure, checks for missing values, detects structural breaks, and stores the dataset for use in subsequent experiment endpoints.",
        tags: ["data"],
        request: {
          contentType: "multipart/form-data",
          fields: [
            { name: "file",            type: "file",    required: true,  desc: "CSV with columns: date (YYYY-MM-DD), location (string), Y (numeric). Additional covariate columns allowed." },
            { name: "experiment_id",   type: "string",  required: true,  desc: "UUID of the experiment this dataset belongs to." },
            { name: "date_col",        type: "string",  required: false, desc: "Name of the date column. Default: 'date'" },
            { name: "location_col",    type: "string",  required: false, desc: "Name of the location column. Default: 'location'" },
            { name: "kpi_col",         type: "string",  required: false, desc: "Name of the KPI column. Default: 'Y'" },
          ],
        },
        response: {
          fields: [
            { name: "dataset_id",       type: "string",  desc: "UUID for the uploaded dataset." },
            { name: "n_geos",           type: "integer", desc: "Number of unique geographic units detected." },
            { name: "n_periods",        type: "integer", desc: "Number of time periods." },
            { name: "date_range",       type: "object",  desc: "{ start, end } — ISO date strings." },
            { name: "missing_values",   type: "boolean", desc: "True if any geo×date combinations are missing." },
            { name: "covariate_cols",   type: "array",   desc: "List of detected covariate column names beyond date, location, Y." },
            { name: "bp_checks",        type: "object",  desc: "Best-practice validation results: n_geos_ok, n_periods_ok, granularity_detected." },
          ],
        },
        rCode: `# /R/routes/data.R
library(plumber)
library(GeoLift)
library(data.table)

#* @post /v1/data/upload
#* @param file:file CSV upload
#* @param experiment_id:string
function(req, res, experiment_id) {
  file  <- req$body$file
  dt    <- fread(file$datapath)

  # Rename to GeoLift standard columns
  setnames(dt, c("date","location","Y"), check.names = FALSE)

  # Validate balanced panel
  expected_rows <- uniqueN(dt$location) * uniqueN(dt$date)
  missing       <- nrow(dt) < expected_rows

  list(
    dataset_id     = uuid::UUIDgenerate(),
    n_geos         = uniqueN(dt$location),
    n_periods      = uniqueN(dt$date),
    date_range     = list(start = min(dt$date), end = max(dt$date)),
    missing_values = missing,
    bp_checks      = list(
      n_geos_ok    = uniqueN(dt$location) >= 20,
      n_periods_ok = uniqueN(dt$date)     >= 25,
      granularity_detected = "daily"
    )
  )
}`,
      },
      {
        id: "validate-data",
        method: "POST",
        path: "/v1/data/validate",
        summary: "Run full best-practice validation",
        description: "Runs all 14 GeoLift best-practice checks against an uploaded dataset and experiment config. Returns structured pass/warn/fail for each check with remediation guidance.",
        tags: ["data"],
        request: {
          contentType: "application/json",
          fields: [
            { name: "dataset_id",      type: "string",  required: true,  desc: "UUID from /data/upload." },
            { name: "test_start",      type: "string",  required: true,  desc: "ISO date — planned campaign start." },
            { name: "test_end",        type: "string",  required: true,  desc: "ISO date — planned campaign end." },
            { name: "pre_start",       type: "string",  required: true,  desc: "ISO date — pre-period start." },
          ],
        },
        response: {
          fields: [
            { name: "checks",          type: "array",   desc: "Array of { id, label, status ('pass'|'warn'|'fail'), detail, remediation }." },
            { name: "required_passing", type: "integer", desc: "Count of required checks with status 'pass'." },
            { name: "required_total",  type: "integer", desc: "Total required checks." },
            { name: "ready_to_proceed",type: "boolean", desc: "True if all required checks pass." },
          ],
        },
        rCode: `#* @post /v1/data/validate
function(dataset_id, test_start, test_end, pre_start) {
  dt        <- load_dataset(dataset_id)
  pre_days  <- as.numeric(as.Date(test_start) - as.Date(pre_start))
  test_days <- as.numeric(as.Date(test_end)   - as.Date(test_start))

  checks <- list(
    list(id="min_pre_periods", status=ifelse(pre_days>=25,"pass","fail"),
         detail=paste0(pre_days," pre-period days"),
         remediation="Extend pre-period to at least 25 days."),
    list(id="pre_period_ratio", status=ifelse(pre_days/test_days>=4,"pass",
                                  ifelse(pre_days/test_days>=3,"warn","fail")),
         detail=paste0("Ratio: ",round(pre_days/test_days,1),"x"),
         remediation="Pre-period should be 4-5x the test duration."),
    list(id="min_geos", status=ifelse(uniqueN(dt$location)>=20,"pass","fail"),
         detail=paste0(uniqueN(dt$location)," geo units"),
         remediation="Require at least 20 geographic units.")
    # ... all 14 checks
  )
  list(checks=checks,
       required_passing=sum(sapply(checks, function(x) x$status=="pass")),
       required_total=length(checks),
       ready_to_proceed=all(sapply(checks, function(x) x$status!="fail")))
}`,
      },
    ],
  },
  {
    id: "markets",
    label: "Market Selection",
    icon: "⊛",
    endpoints: [
      {
        id: "market-selection",
        method: "POST",
        path: "/v1/markets/select",
        summary: "Run GeoLiftMarketSelection()",
        description: "Executes Meta's GeoLiftMarketSelection() to identify the optimal control market pool for a given set of treatment markets. Returns ranked control candidates with fit scores, RMSE, and correlation metrics.",
        tags: ["markets"],
        request: {
          contentType: "application/json",
          fields: [
            { name: "dataset_id",        type: "string",  required: true,  desc: "UUID from /data/upload." },
            { name: "treatment_markets", type: "array",   required: true,  desc: "Array of location strings to assign as treatment." },
            { name: "pre_period_end",    type: "string",  required: true,  desc: "ISO date — last day of pre-period." },
            { name: "matching_vars",     type: "array",   required: false, desc: "Additional covariate columns to include in matching. Default: Y only." },
            { name: "n_control_markets", type: "integer", required: false, desc: "Target number of control markets to select. Default: auto." },
            { name: "exclude_markets",   type: "array",   required: false, desc: "Locations to exclude from control pool." },
          ],
        },
        response: {
          fields: [
            { name: "selection_id",     type: "string",  desc: "UUID for this selection run. Pass to /power/simulate." },
            { name: "control_markets",  type: "array",   desc: "Selected control market names." },
            { name: "rmse",             type: "number",  desc: "Root mean squared error of pre-period fit." },
            { name: "correlation",      type: "number",  desc: "Pearson correlation between treatment aggregate and synthetic control in pre-period." },
            { name: "candidates",       type: "array",   desc: "Ranked list of all candidate control markets with individual fit scores." },
            { name: "pre_period_plot",  type: "string",  desc: "Base64-encoded PNG of pre-period actual vs synthetic overlay chart." },
          ],
        },
        rCode: `#* @post /v1/markets/select
function(dataset_id, treatment_markets, pre_period_end,
         matching_vars=NULL, n_control_markets=NULL, exclude_markets=NULL) {
  dt <- load_dataset(dataset_id)

  market_selection <- GeoLift::GeoLiftMarketSelection(
    data             = dt,
    treatment_period = c(pre_period_end),  # end of pre-period
    GeoLiftModel     = "Y",
    Y_id             = "Y",
    location_id      = "location",
    time_id          = "date",
    include_markets  = treatment_markets,
    exclude_markets  = exclude_markets %||% character(0),
    n_top            = n_control_markets %||% 5,
    confLevel        = 0.80
  )

  list(
    selection_id    = uuid::UUIDgenerate(),
    control_markets = market_selection$BestMarkets,
    rmse            = market_selection$RMSE,
    correlation     = market_selection$Correlation,
    candidates      = market_selection$AllCandidates
  )
}`,
      },
    ],
  },
  {
    id: "power",
    label: "Power Analysis",
    icon: "⚗",
    endpoints: [
      {
        id: "power-simulate",
        method: "POST",
        path: "/v1/power/simulate",
        summary: "Run GeoLiftPower() simulation",
        description: "Executes GeoLift's power simulation across a grid of effect sizes and test durations. Returns a power matrix, the minimum detectable effect at the target confidence level, and recommended test duration.",
        tags: ["power"],
        request: {
          contentType: "application/json",
          fields: [
            { name: "selection_id",    type: "string",  required: true,  desc: "UUID from /markets/select." },
            { name: "effect_sizes",    type: "array",   required: false, desc: "Array of lift percentages to simulate. Default: [0.5,1,2,3,5,7.5,10,15,20]." },
            { name: "test_durations",  type: "array",   required: false, desc: "Array of test lengths in days. Default: [7,10,14,21,28,35,42]." },
            { name: "confidence",      type: "number",  required: false, desc: "Target confidence level (0–1). Default: 0.80." },
            { name: "n_simulations",   type: "integer", required: false, desc: "Number of simulation iterations. Default: 2000. Higher = slower but more precise." },
          ],
        },
        response: {
          fields: [
            { name: "power_id",        type: "string",  desc: "UUID for this power run." },
            { name: "power_matrix",    type: "array",   desc: "2D array [effect_size][duration] → power (0–1)." },
            { name: "mde",             type: "number",  desc: "Minimum detectable effect at target confidence and recommended duration." },
            { name: "recommended_duration", type: "integer", desc: "Shortest test duration that achieves target power at MDE." },
            { name: "power_curve_png", type: "string",  desc: "Base64-encoded power curve chart." },
          ],
        },
        rCode: `#* @post /v1/power/simulate
function(selection_id, effect_sizes=NULL, test_durations=NULL,
         confidence=0.80, n_simulations=2000) {
  sel  <- load_selection(selection_id)

  effect_sizes   <- effect_sizes   %||% c(0.5,1,2,3,5,7.5,10,15,20)
  test_durations <- test_durations %||% c(7,10,14,21,28,35,42)

  power_results <- GeoLift::GeoLiftPower(
    data             = sel$data,
    treatment_markets= sel$treatment_markets,
    control_markets  = sel$control_markets,
    effect_size      = effect_sizes,
    test_duration    = test_durations,
    Y_id             = "Y",
    location_id      = "location",
    time_id          = "date",
    confLevel        = confidence,
    nsim             = n_simulations
  )

  # Find MDE = smallest effect with power >= confidence at optimal duration
  mde <- power_results$PowerTable |>
    dplyr::filter(power >= confidence) |>
    dplyr::arrange(effect_size) |>
    dplyr::slice(1)

  list(
    power_id             = uuid::UUIDgenerate(),
    power_matrix         = power_results$PowerTable,
    mde                  = mde$effect_size,
    recommended_duration = mde$test_duration
  )
}`,
      },
    ],
  },
  {
    id: "measurement",
    label: "Measurement",
    icon: "◉",
    endpoints: [
      {
        id: "run-geolift",
        method: "POST",
        path: "/v1/measurement/run",
        summary: "Run GeoLift() post-campaign analysis",
        description: "Executes the core GeoLift() function on post-campaign data. Fits the synthetic control model on the pre-period, applies it to the test window, and returns ATT, lift %, confidence intervals, p-value, iROAS, and the counterfactual time series.",
        tags: ["measurement"],
        request: {
          contentType: "application/json",
          fields: [
            { name: "experiment_id",     type: "string",  required: true,  desc: "UUID of the experiment." },
            { name: "dataset_id",        type: "string",  required: true,  desc: "Full dataset (pre + test periods) UUID." },
            { name: "treatment_markets", type: "array",   required: true,  desc: "Treatment market names." },
            { name: "control_markets",   type: "array",   required: true,  desc: "Control market names from /markets/select." },
            { name: "test_start",        type: "string",  required: true,  desc: "ISO date — test period start." },
            { name: "test_end",          type: "string",  required: true,  desc: "ISO date — test period end." },
            { name: "spend",             type: "number",  required: false, desc: "Total campaign spend. Required for iROAS calculation." },
            { name: "confidence",        type: "number",  required: false, desc: "Confidence level for intervals. Default: 0.90." },
            { name: "model",             type: "string",  required: false, desc: "'GeoLift' (default) | 'Augmented Synthetic Control'." },
          ],
        },
        response: {
          fields: [
            { name: "result_id",         type: "string",  desc: "UUID for this result set." },
            { name: "att",               type: "number",  desc: "Average Treatment Effect on the Treated (daily average incremental KPI)." },
            { name: "att_total",         type: "number",  desc: "Total incremental KPI over the test window." },
            { name: "lift_pct",          type: "number",  desc: "Percentage lift: (actual − counterfactual) / counterfactual × 100." },
            { name: "lift_ci_low",       type: "number",  desc: "Lower bound of lift confidence interval." },
            { name: "lift_ci_high",      type: "number",  desc: "Upper bound of lift confidence interval." },
            { name: "p_value",           type: "number",  desc: "Two-sided p-value for the null hypothesis of zero lift." },
            { name: "iROAS",             type: "number",  desc: "Incremental ROAS = att_total / spend. Null if spend not provided." },
            { name: "pre_period_r2",     type: "number",  desc: "R² of synthetic control fit in pre-period." },
            { name: "pre_period_mape",   type: "number",  desc: "MAPE of synthetic control fit in pre-period." },
            { name: "pre_period_bias",   type: "number",  desc: "Mean daily bias (actual − synthetic) in pre-period." },
            { name: "counterfactual_ts", type: "array",   desc: "Daily array of { date, actual, synthetic, ci_low, ci_high, lift }." },
            { name: "market_breakdown",  type: "array",   desc: "Per-geo { location, actual, synthetic, lift_pct, lift_abs }." },
            { name: "weights",           type: "object",  desc: "Synthetic control donor weights by control market." },
          ],
        },
        rCode: `#* @post /v1/measurement/run
function(experiment_id, dataset_id, treatment_markets, control_markets,
         test_start, test_end, spend=NULL, confidence=0.90, model="GeoLift") {
  dt <- load_dataset(dataset_id)

  # Convert test period to integer indices (GeoLift uses period numbers)
  dates      <- sort(unique(dt$date))
  test_start_i <- which(dates == test_start)
  test_end_i   <- which(dates == test_end)

  result <- GeoLift::GeoLift(
    Y_id             = "Y",
    location_id      = "location",
    time_id          = "date",
    data             = dt,
    locations        = treatment_markets,
    treatment_start_time = test_start_i,
    treatment_end_time   = test_end_i,
    GeoLiftModel     = model,
    confLevel        = confidence
  )

  att_total <- result$incremental
  lift_pct  <- result$incremental / result$baseline * 100
  iroas     <- if (!is.null(spend) && spend > 0) att_total / spend else NULL

  list(
    result_id         = uuid::UUIDgenerate(),
    att               = result$ATT,
    att_total         = att_total,
    lift_pct          = lift_pct,
    lift_ci_low       = result$lower_bound * 100,
    lift_ci_high      = result$upper_bound * 100,
    p_value           = result$p_val,
    iROAS             = iroas,
    pre_period_r2     = result$R2,
    pre_period_mape   = result$MAPE,
    counterfactual_ts = build_ts(result),
    market_breakdown  = geo_breakdown(result, dt),
    weights           = result$weights
  )
}`,
      },
      {
        id: "run-multicell",
        method: "POST",
        path: "/v1/measurement/run-multicell",
        summary: "Run multi-cell GeoLift analysis",
        description: "Runs independent GeoLift() analyses for each treatment cell against the shared control pool, then aggregates results into a cross-cell comparison table with cell-level ATT, lift %, and iROAS.",
        tags: ["measurement"],
        request: {
          contentType: "application/json",
          fields: [
            { name: "experiment_id",   type: "string", required: true,  desc: "UUID of the multi-cell experiment." },
            { name: "dataset_id",      type: "string", required: true,  desc: "Full dataset UUID." },
            { name: "cells",           type: "array",  required: true,  desc: "Array of { cell_id, label, treatment_markets, spend }." },
            { name: "control_markets", type: "array",  required: true,  desc: "Shared control pool." },
            { name: "test_start",      type: "string", required: true,  desc: "ISO date — test start." },
            { name: "test_end",        type: "string", required: true,  desc: "ISO date — test end." },
            { name: "confidence",      type: "number", required: false, desc: "Confidence level. Default: 0.90." },
          ],
        },
        response: {
          fields: [
            { name: "multicell_result_id", type: "string", desc: "UUID for this multi-cell result." },
            { name: "cells",               type: "array",  desc: "Array of per-cell GeoLift results (same schema as /measurement/run)." },
            { name: "comparison_table",    type: "array",  desc: "Side-by-side: { cell_id, label, lift_pct, iROAS, att_total, p_value, r2 }." },
            { name: "optimal_cell",        type: "string", desc: "cell_id with highest iROAS." },
          ],
        },
        rCode: `#* @post /v1/measurement/run-multicell
function(experiment_id, dataset_id, cells, control_markets,
         test_start, test_end, confidence=0.90) {
  dt <- load_dataset(dataset_id)

  # Run GeoLift independently per cell
  cell_results <- lapply(cells, function(cell) {
    res <- run_geolift_single(
      data             = dt,
      treatment_markets= cell$treatment_markets,
      control_markets  = control_markets,
      test_start       = test_start,
      test_end         = test_end,
      spend            = cell$spend,
      confidence       = confidence
    )
    c(list(cell_id=cell$cell_id, label=cell$label), res)
  })

  # Build comparison table
  comparison <- lapply(cell_results, function(r)
    list(cell_id=r$cell_id, label=r$label,
         lift_pct=r$lift_pct, iROAS=r$iROAS,
         att_total=r$att_total, p_value=r$p_value, r2=r$pre_period_r2))

  optimal <- comparison[[which.max(sapply(comparison, function(x) x$iROAS %||% 0))]]$cell_id

  list(multicell_result_id=uuid::UUIDgenerate(),
       cells=cell_results, comparison_table=comparison, optimal_cell=optimal)
}`,
      },
    ],
  },
  {
    id: "experiments",
    label: "Experiments CRUD",
    icon: "≡",
    endpoints: [
      {
        id: "create-experiment",
        method: "POST",
        path: "/v1/experiments",
        summary: "Create experiment record",
        description: "Creates a new experiment with its full configuration. Acts as the canonical record linking dataset, market selection, power analysis, and measurement results.",
        tags: ["experiments"],
        request: {
          contentType: "application/json",
          fields: [
            { name: "name",           type: "string",  required: true,  desc: "Experiment display name." },
            { name: "kpi",            type: "string",  required: true,  desc: "KPI being measured." },
            { name: "test_type",      type: "string",  required: true,  desc: "'single' | 'multi'" },
            { name: "geo_level",      type: "string",  required: true,  desc: "'zip_code' | 'city' | 'dma' | 'region' | 'country'" },
            { name: "data_granularity",type: "string", required: true,  desc: "'daily' | 'weekly'" },
            { name: "test_start",     type: "string",  required: true,  desc: "ISO date." },
            { name: "test_end",       type: "string",  required: true,  desc: "ISO date." },
            { name: "pre_start",      type: "string",  required: true,  desc: "ISO date." },
            { name: "cells",          type: "array",   required: true,  desc: "Array of { label, channel, spend, objective }." },
          ],
        },
        response: {
          fields: [
            { name: "experiment_id",  type: "string",  desc: "UUID of the created experiment." },
            { name: "status",         type: "string",  desc: "'draft'" },
            { name: "created_at",     type: "string",  desc: "ISO datetime." },
          ],
        },
        rCode: `#* @post /v1/experiments
function(name, kpi, test_type, geo_level, data_granularity,
         test_start, test_end, pre_start, cells) {
  exp_id <- uuid::UUIDgenerate()

  # Persist to Postgres via DBI
  con <- get_db_connection()
  DBI::dbExecute(con,
    "INSERT INTO experiments
     (id, name, kpi, test_type, geo_level, data_granularity,
      test_start, test_end, pre_start, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',NOW())",
    list(exp_id, name, kpi, test_type, geo_level,
         data_granularity, test_start, test_end, pre_start)
  )

  lapply(cells, function(cell) {
    DBI::dbExecute(con,
      "INSERT INTO experiment_cells (experiment_id, label, channel, spend, objective)
       VALUES ($1,$2,$3,$4,$5)",
      list(exp_id, cell$label, cell$channel, cell$spend, cell$objective))
  })

  list(experiment_id=exp_id, status="draft", created_at=Sys.time())
}`,
      },
      {
        id: "get-experiment",
        method: "GET",
        path: "/v1/experiments/{id}",
        summary: "Get experiment by ID",
        description: "Returns full experiment configuration, linked dataset, market selection, power analysis, and any measurement results. This is the primary data-fetch endpoint for the Results Dashboard.",
        tags: ["experiments"],
        request: {
          contentType: null,
          fields: [
            { name: "id",  type: "path param", required: true, desc: "Experiment UUID." },
          ],
        },
        response: {
          fields: [
            { name: "experiment",       type: "object", desc: "Core experiment config." },
            { name: "dataset",          type: "object", desc: "Linked dataset metadata." },
            { name: "market_selection", type: "object", desc: "Selected control markets and fit scores." },
            { name: "power_analysis",   type: "object", desc: "Power simulation results." },
            { name: "results",          type: "object", desc: "GeoLift measurement results. Null if experiment is draft/active." },
            { name: "status",           type: "string", desc: "'draft' | 'active' | 'complete'" },
          ],
        },
        rCode: `#* @get /v1/experiments/<id>
function(id) {
  con <- get_db_connection()

  exp   <- DBI::dbGetQuery(con,
    "SELECT * FROM experiments WHERE id = $1", list(id))
  cells <- DBI::dbGetQuery(con,
    "SELECT * FROM experiment_cells WHERE experiment_id = $1", list(id))
  res   <- DBI::dbGetQuery(con,
    "SELECT * FROM experiment_results WHERE experiment_id = $1", list(id))

  list(
    experiment       = exp,
    cells            = cells,
    results          = if (nrow(res) > 0) res else NULL,
    status           = exp$status
  )
}`,
      },
    ],
  },
];

/* ─── DB SCHEMA ──────────────────────────────────────────────────── */
const DB_SCHEMA = `-- PostgreSQL schema

CREATE TABLE experiments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  kpi               TEXT NOT NULL,
  test_type         TEXT NOT NULL CHECK (test_type IN ('single','multi')),
  geo_level         TEXT NOT NULL,
  data_granularity  TEXT NOT NULL CHECK (data_granularity IN ('daily','weekly')),
  test_start        DATE NOT NULL,
  test_end          DATE NOT NULL,
  pre_start         DATE NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','active','complete')),
  owner             TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE experiment_cells (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id     UUID REFERENCES experiments(id) ON DELETE CASCADE,
  label             TEXT NOT NULL,
  channel           TEXT,
  spend             NUMERIC,
  objective         TEXT,
  treatment_markets TEXT[]  -- array of location strings
);

CREATE TABLE experiment_datasets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id     UUID REFERENCES experiments(id) ON DELETE CASCADE,
  file_path         TEXT NOT NULL,  -- path to parquet on object storage
  n_geos            INTEGER,
  n_periods         INTEGER,
  date_start        DATE,
  date_end          DATE,
  kpi_col           TEXT DEFAULT 'Y',
  covariate_cols    TEXT[],
  uploaded_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE market_selections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id     UUID REFERENCES experiments(id) ON DELETE CASCADE,
  cell_id           UUID REFERENCES experiment_cells(id),
  treatment_markets TEXT[] NOT NULL,
  control_markets   TEXT[] NOT NULL,
  rmse              NUMERIC,
  correlation       NUMERIC,
  candidates_json   JSONB,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE power_analyses (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id        UUID REFERENCES experiments(id) ON DELETE CASCADE,
  selection_id         UUID REFERENCES market_selections(id),
  target_confidence    NUMERIC DEFAULT 0.80,
  mde                  NUMERIC,
  recommended_duration INTEGER,
  power_matrix_json    JSONB,
  n_simulations        INTEGER DEFAULT 2000,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE experiment_results (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id        UUID REFERENCES experiments(id) ON DELETE CASCADE,
  cell_id              UUID REFERENCES experiment_cells(id),
  att                  NUMERIC,
  att_total            NUMERIC,
  lift_pct             NUMERIC,
  lift_ci_low          NUMERIC,
  lift_ci_high         NUMERIC,
  p_value              NUMERIC,
  iroas                NUMERIC,
  pre_period_r2        NUMERIC,
  pre_period_mape      NUMERIC,
  counterfactual_json  JSONB,   -- daily { date, actual, synthetic, ci_low, ci_high }
  market_breakdown_json JSONB,
  weights_json         JSONB,
  model_version        TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);`;

/* ─── DEPLOYMENT NOTES ───────────────────────────────────────────── */
const DEPLOY_NOTES = [
  {
    title: "R Environment",
    body: "Pin to R 4.3.x. Required packages: GeoLift (≥ 0.5.0), plumber (≥ 1.2.0), data.table, DBI, RPostgres, uuid, dplyr, ggplot2. Use renv for lockfile-based reproducibility.",
    color: C.cyan,
  },
  {
    title: "Containerization",
    body: "Wrap the Plumber API in a Docker image using rocker/r-ver:4.3 as base. Expose port 8000. Use a multi-stage build: install system deps → restore renv → COPY /R → CMD [\"Rscript\", \"api.R\"].",
    color: C.blue,
  },
  {
    title: "Long-running jobs",
    body: "GeoLiftPower() with n_simulations=2000 can take 30–120 seconds. Wrap in a job queue (Redis + RQ or a Postgres-backed queue). POST /power/simulate returns a job_id; GET /jobs/{id} polls status and returns results when done.",
    color: C.amber,
  },
  {
    title: "Data storage",
    body: "Store uploaded panel CSVs as compressed Parquet on S3-compatible object storage (AWS S3 or MinIO). Store only metadata and result JSONs in Postgres. Never store raw data in the DB.",
    color: C.purple,
  },
  {
    title: "Pre-period data immutability",
    body: "Once an experiment moves to 'active', freeze the dataset_id and market_selection_id. Never allow pre-period data mutation after experiment start — this is required for reproducible post-campaign analysis.",
    color: C.red,
  },
  {
    title: "Authentication",
    body: "JWT auth via Authorization: Bearer header on all endpoints. Short-lived access tokens (15 min) + refresh tokens. Scope experiments by org_id for multi-tenant isolation.",
    color: C.green,
  },
];

/* ══════════════════════════════════════════════════════════════════ */
/*  MAIN APP                                                          */
/* ══════════════════════════════════════════════════════════════════ */
export default function GeoLiftBackendSpec() {
  const [activeSection, setActiveSection] = useState("overview");
  const [openEndpoint,  setOpenEndpoint]  = useState(null);
  const [codeTab,       setCodeTab]       = useState("r");

  const currentSection = SECTIONS.find(s => s.id === activeSection);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: font.body, color: C.text, display: "flex", flexDirection: "column" }}>
      <GoogleFonts />

      {/* NAV */}
      <nav style={{
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        padding: "0 28px", height: 52, display: "flex",
        alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 10, flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontFamily: font.heading, fontSize: 17, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>
            <span style={{ color: C.cyan }}>Geo</span>Lift
          </div>
          <div style={{ width: 1, height: 20, background: C.border }} />
          <span style={{ fontFamily: font.mono, fontSize: 11, color: C.muted }}>Backend API Spec</span>
          <span style={{ fontFamily: font.mono, fontSize: 10, background: C.cyanDim, border: `1px solid ${C.cyan}40`, color: C.cyan, borderRadius: 4, padding: "2px 7px" }}>v1.0</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Tag color={C.purple}>R + Plumber</Tag>
          <Tag color={C.blue}>PostgreSQL</Tag>
          <Tag color={C.amber}>Redis Queue</Tag>
        </div>
      </nav>

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* SIDEBAR */}
        <aside style={{
          width: 200, background: C.surface, borderRight: `1px solid ${C.border}`,
          padding: "20px 0", flexShrink: 0, overflowY: "auto",
        }}>
          {SECTIONS.map(section => (
            <div key={section.id}>
              <button onClick={() => setActiveSection(section.id)} style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: "9px 18px", background: activeSection === section.id ? C.cyanDim : "transparent",
                border: "none", borderLeft: activeSection === section.id ? `2px solid ${C.cyan}` : "2px solid transparent",
                cursor: "pointer", color: activeSection === section.id ? C.cyan : C.muted,
                fontFamily: font.body, fontSize: 12, fontWeight: activeSection === section.id ? 600 : 400,
                textAlign: "left",
              }}>
                <span style={{ fontFamily: font.mono, fontSize: 11 }}>{section.icon}</span>
                {section.label}
                {section.endpoints && (
                  <span style={{ marginLeft: "auto", fontFamily: font.mono, fontSize: 10, color: C.muted }}>
                    {section.endpoints.length}
                  </span>
                )}
              </button>
              {section.endpoints && activeSection === section.id && section.endpoints.map(ep => (
                <button key={ep.id} onClick={() => setOpenEndpoint(openEndpoint === ep.id ? null : ep.id)} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  width: "100%", padding: "6px 18px 6px 32px", background: "transparent",
                  border: "none", cursor: "pointer", color: C.muted,
                  fontFamily: font.mono, fontSize: 10, textAlign: "left",
                }}>
                  <span style={{ ...METHOD[ep.method], border: "none", background: "transparent", fontSize: 9, fontWeight: 700 }}>{ep.method}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ep.path.replace("/v1", "")}</span>
                </button>
              ))}
            </div>
          ))}
          <div style={{ margin: "8px 0" }}>
            {[
              { id: "database", label: "DB Schema",    icon: "⬡" },
              { id: "deploy",   label: "Deployment",   icon: "◈" },
            ].map(s => (
              <button key={s.id} onClick={() => setActiveSection(s.id)} style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: "9px 18px", background: activeSection === s.id ? C.cyanDim : "transparent",
                border: "none", borderLeft: activeSection === s.id ? `2px solid ${C.cyan}` : "2px solid transparent",
                cursor: "pointer", color: activeSection === s.id ? C.cyan : C.muted,
                fontFamily: font.body, fontSize: 12, fontWeight: activeSection === s.id ? 600 : 400,
                textAlign: "left",
              }}>
                <span style={{ fontFamily: font.mono, fontSize: 11 }}>{s.icon}</span>
                {s.label}
              </button>
            ))}
          </div>
        </aside>

        {/* MAIN */}
        <main style={{ flex: 1, overflowY: "auto", padding: "32px 40px" }}>

          {/* OVERVIEW */}
          {activeSection === "overview" && <OverviewSection />}

          {/* ARCHITECTURE */}
          {activeSection === "architecture" && <ArchitectureSection />}

          {/* ENDPOINT SECTIONS */}
          {currentSection?.endpoints && (
            <div>
              <SectionHeader section={currentSection} />
              {currentSection.endpoints.map(ep => (
                <EndpointCard
                  key={ep.id}
                  ep={ep}
                  open={openEndpoint === ep.id}
                  onToggle={() => setOpenEndpoint(openEndpoint === ep.id ? null : ep.id)}
                  codeTab={codeTab}
                  setCodeTab={setCodeTab}
                />
              ))}
            </div>
          )}

          {/* DB SCHEMA */}
          {activeSection === "database" && (
            <div>
              <PageTitle title="Database Schema" sub="PostgreSQL — all tables, types, and relationships" />
              <CodeBlock lang="sql" code={DB_SCHEMA} />
            </div>
          )}

          {/* DEPLOYMENT */}
          {activeSection === "deploy" && (
            <div>
              <PageTitle title="Deployment Notes" sub="Key architectural decisions and operational guidance" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {DEPLOY_NOTES.map(note => (
                  <div key={note.title} style={{
                    background: C.surface, border: `1px solid ${C.border}`,
                    borderLeft: `3px solid ${note.color}`,
                    borderRadius: 8, padding: "14px 16px",
                  }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#fff", marginBottom: 6 }}>{note.title}</div>
                    <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>{note.body}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </main>
      </div>
    </div>
  );
}

/* ── SECTION COMPONENTS ─────────────────────────────────────────── */

function OverviewSection() {
  const endpoints = SECTIONS.flatMap(s => s.endpoints || []);
  return (
    <div>
      <PageTitle title="GeoLift API" sub="R/Plumber REST API wrapping Meta's GeoLift package" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 28 }}>
        {[
          { label: "Total Endpoints", value: endpoints.length,                             color: C.text  },
          { label: "POST",            value: endpoints.filter(e => e.method==="POST").length, color: C.cyan  },
          { label: "GET",             value: endpoints.filter(e => e.method==="GET").length,  color: C.green },
          { label: "Core GeoLift Fns", value: 3,                                           color: C.amber },
        ].map(m => (
          <div key={m.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "14px 16px" }}>
            <div style={{ fontFamily: font.heading, fontSize: 24, fontWeight: 800, color: m.color }}>{m.value}</div>
            <div style={{ fontFamily: font.mono, fontSize: 10, color: C.muted, marginTop: 4 }}>{m.label}</div>
          </div>
        ))}
      </div>

      <Callout color={C.cyan}>
        <strong>Design principle:</strong> Every statistically intensive operation (market selection, power simulation, post-campaign analysis) is a thin wrapper around GeoLift's own functions. The API's job is data plumbing, validation, storage, and async job management — not reimplementing the math.
      </Callout>

      <div style={{ marginTop: 24 }}>
        <SectionDivider label="Endpoint Summary" />
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: C.surfaceHi }}>
              {["Method", "Path", "GeoLift Function", "Summary"].map(h => (
                <th key={h} style={{ fontFamily: font.mono, fontSize: 10, color: C.muted, padding: "8px 14px", textAlign: "left", fontWeight: 500, borderBottom: `1px solid ${C.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[
              ["POST", "/v1/data/upload",                   "—",                          "Upload KPI panel data"],
              ["POST", "/v1/data/validate",                 "—",                          "Run 14 best-practice checks"],
              ["POST", "/v1/markets/select",                "GeoLiftMarketSelection()",   "Optimize control market pool"],
              ["POST", "/v1/power/simulate",                "GeoLiftPower()",             "Run power simulation grid"],
              ["POST", "/v1/measurement/run",               "GeoLift()",                  "Post-campaign lift analysis"],
              ["POST", "/v1/measurement/run-multicell",     "GeoLift() × n cells",        "Multi-cell analysis"],
              ["POST", "/v1/experiments",                   "—",                          "Create experiment record"],
              ["GET",  "/v1/experiments/{id}",              "—",                          "Fetch experiment + results"],
            ].map(([method, path, fn, summary]) => (
              <tr key={path} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: "8px 14px" }}><MethodBadge method={method} /></td>
                <td style={{ fontFamily: font.mono, fontSize: 12, padding: "8px 14px", color: C.text }}>{path}</td>
                <td style={{ fontFamily: font.mono, fontSize: 11, padding: "8px 14px", color: C.amber }}>{fn}</td>
                <td style={{ fontSize: 12, padding: "8px 14px", color: C.muted }}>{summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ArchitectureSection() {
  const layers = [
    { label: "React Frontend",      items: ["GeoLiftLibrary.jsx", "GeoLiftTool.jsx (wizard)", "GeoLiftResults.jsx"],                     color: C.purple },
    { label: "REST API (Plumber)",  items: ["/v1/data/*", "/v1/markets/*", "/v1/power/*", "/v1/measurement/*", "/v1/experiments/*"],      color: C.cyan   },
    { label: "Job Queue",           items: ["Redis", "GeoLiftPower() jobs (async)", "GeoLiftMarketSelection() jobs"],                     color: C.amber  },
    { label: "R / GeoLift Engine",  items: ["GeoLiftMarketSelection()", "GeoLiftPower()", "GeoLift()", "renv-locked environment"],        color: C.green  },
    { label: "Storage",             items: ["PostgreSQL — experiment metadata", "S3/MinIO — panel data (Parquet)", "Redis — job state"],   color: C.blue   },
  ];

  return (
    <div>
      <PageTitle title="Architecture" sub="System design and data flow" />
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {layers.map((layer, i) => (
          <div key={layer.label}>
            <div style={{
              background: C.surface, border: `1px solid ${C.border}`,
              borderLeft: `3px solid ${layer.color}`,
              borderRadius: 8, padding: "14px 18px",
              display: "flex", alignItems: "center", gap: 20,
            }}>
              <div style={{ width: 180, flexShrink: 0 }}>
                <div style={{ fontFamily: font.heading, fontSize: 12, fontWeight: 700, color: layer.color }}>{layer.label}</div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {layer.items.map(item => (
                  <span key={item} style={{ fontFamily: font.mono, fontSize: 11, color: C.muted, background: C.surfaceHi, border: `1px solid ${C.border}`, borderRadius: 4, padding: "2px 8px" }}>{item}</span>
                ))}
              </div>
            </div>
            {i < layers.length - 1 && (
              <div style={{ display: "flex", justifyContent: "center", padding: "3px 0", color: C.muted, fontSize: 12 }}>↕</div>
            )}
          </div>
        ))}
      </div>
      <Callout color={C.amber} style={{ marginTop: 20 }}>
        <strong>Async pattern:</strong> Power simulation and market selection are submitted as background jobs. The frontend POSTs to get a <code style={{ color: C.amber }}>job_id</code>, then polls <code style={{ color: C.amber }}>GET /v1/jobs/{"{job_id}"}</code> every 3 seconds until status is <code>complete</code>. This prevents HTTP timeout on long-running R computations.
      </Callout>
    </div>
  );
}

function SectionHeader({ section }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontFamily: font.mono, fontSize: 11, color: C.cyan, marginBottom: 4, letterSpacing: "0.08em" }}>
        {section.icon} {section.label.toUpperCase()}
      </div>
      <h1 style={{ fontFamily: font.heading, fontSize: 24, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: "-0.02em" }}>
        {section.label}
      </h1>
    </div>
  );
}

function EndpointCard({ ep, open, onToggle, codeTab, setCodeTab }) {
  const m = METHOD[ep.method];
  return (
    <div style={{ background: C.surface, border: `1px solid ${open ? C.borderHi : C.border}`, borderRadius: 10, marginBottom: 12, overflow: "hidden" }}>
      {/* Header */}
      <div onClick={onToggle} style={{
        padding: "14px 20px", cursor: "pointer",
        display: "flex", alignItems: "center", gap: 14,
        background: open ? C.surfaceHi : "transparent",
        transition: "background 0.15s",
      }}>
        <MethodBadge method={ep.method} />
        <code style={{ fontFamily: font.mono, fontSize: 13, color: C.text, flex: 1 }}>{ep.path}</code>
        <span style={{ fontSize: 12, color: C.muted }}>{ep.summary}</span>
        <span style={{ color: C.muted, fontSize: 12, marginLeft: 8 }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{ padding: "0 20px 20px", borderTop: `1px solid ${C.border}` }}>
          <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, marginTop: 14 }}>{ep.description}</p>

          {/* Request */}
          <ParamTable title="Request Parameters" fields={ep.request.fields} contentType={ep.request.contentType} />

          {/* Response */}
          <ParamTable title="Response Fields" fields={ep.response.fields} isResponse />

          {/* Code */}
          <div style={{ marginTop: 20 }}>
            <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
              <SectionDivider label="Implementation" />
            </div>
            <CodeBlock lang="r" code={ep.rCode} />
          </div>
        </div>
      )}
    </div>
  );
}

function ParamTable({ title, fields, contentType, isResponse }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontFamily: font.mono, fontSize: 11, color: C.muted, fontWeight: 600 }}>{title}</span>
        {contentType && <span style={{ fontFamily: font.mono, fontSize: 10, color: C.blue, background: C.blueDim, border: `1px solid ${C.blue}30`, borderRadius: 4, padding: "1px 7px" }}>{contentType}</span>}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: C.surfaceHi }}>
            {["Name", "Type", !isResponse && "Required", "Description"].filter(Boolean).map(h => (
              <th key={h} style={{ fontFamily: font.mono, fontSize: 10, color: C.muted, padding: "6px 12px", textAlign: "left", fontWeight: 500, borderBottom: `1px solid ${C.border}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fields.map(f => (
            <tr key={f.name} style={{ borderBottom: `1px solid ${C.border}` }}>
              <td style={{ fontFamily: font.mono, fontSize: 12, padding: "7px 12px", color: C.cyan }}>{f.name}</td>
              <td style={{ fontFamily: font.mono, fontSize: 11, padding: "7px 12px", color: C.purple }}>{f.type}</td>
              {!isResponse && (
                <td style={{ padding: "7px 12px" }}>
                  {f.required
                    ? <span style={{ fontFamily: font.mono, fontSize: 10, color: C.red, background: C.redDim, borderRadius: 3, padding: "1px 6px" }}>required</span>
                    : <span style={{ fontFamily: font.mono, fontSize: 10, color: C.muted }}>optional</span>
                  }
                </td>
              )}
              <td style={{ fontSize: 12, padding: "7px 12px", color: C.muted }}>{f.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CodeBlock({ lang, code }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div style={{ position: "relative", background: "#060810", border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", borderBottom: `1px solid ${C.border}`, background: C.surfaceHi }}>
        <span style={{ fontFamily: font.mono, fontSize: 10, color: C.muted }}>{lang.toUpperCase()}</span>
        <button onClick={copy} style={{ background: "transparent", border: "none", color: copied ? C.green : C.muted, fontFamily: font.mono, fontSize: 10, cursor: "pointer" }}>
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <pre style={{ fontFamily: font.mono, fontSize: 11, color: C.text, padding: "16px 16px", margin: 0, overflowX: "auto", lineHeight: 1.7 }}>
        {code.split("\n").map((line, i) => {
          const isComment = line.trim().startsWith("#");
          const isKey     = /^(function|library|list|DBI::|lapply|if|else|return|NULL)/.test(line.trim());
          return (
            <div key={i} style={{ color: isComment ? C.muted : C.text }}>{line || " "}</div>
          );
        })}
      </pre>
    </div>
  );
}

/* ─── SMALL PRIMITIVES ───────────────────────────────────────────── */
function GoogleFonts() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap');
      * { box-sizing: border-box; }
      ::-webkit-scrollbar { width: 4px; background: ${C.bg}; }
      ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
    `}</style>
  );
}

function PageTitle({ title, sub }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <h1 style={{ fontFamily: font.heading, fontSize: 26, fontWeight: 800, color: "#fff", margin: "0 0 6px", letterSpacing: "-0.02em" }}>{title}</h1>
      <p style={{ fontFamily: font.mono, fontSize: 12, color: C.muted, margin: 0 }}>{sub}</p>
    </div>
  );
}

function MethodBadge({ method }) {
  const m = METHOD[method] || METHOD.GET;
  return (
    <span style={{
      background: m.bg, border: `1px solid ${m.border}40`,
      color: m.color, borderRadius: 4, fontFamily: font.mono,
      fontSize: 10, fontWeight: 700, padding: "2px 8px", flexShrink: 0,
    }}>{method}</span>
  );
}

function Tag({ color, children }) {
  return (
    <span style={{ background: color + "20", border: `1px solid ${color}50`, color, borderRadius: 4, fontSize: 10, fontWeight: 700, padding: "2px 7px", fontFamily: font.mono }}>
      {children}
    </span>
  );
}

function Callout({ color, children, style }) {
  return (
    <div style={{
      background: color + "10", border: `1px solid ${color}30`,
      borderLeft: `3px solid ${color}`, borderRadius: 6,
      padding: "12px 16px", fontSize: 12, color: C.text, lineHeight: 1.7, ...style
    }}>
      {children}
    </div>
  );
}

function SectionDivider({ label }) {
  return (
    <div style={{ fontFamily: font.mono, fontSize: 10, color: C.muted, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
      {label}
    </div>
  );
}
