library(plumber)
library(data.table)
library(arrow)       # parquet read/write
library(uuid)
library(logger)

# ═══════════════════════════════════════════════════════════════════
#  POST /v1/data/upload
#  Accepts a balanced-panel CSV, validates structure, stores as
#  Parquet on S3, persists metadata to Postgres, returns dataset_id.
# ═══════════════════════════════════════════════════════════════════

#* Upload KPI time-series panel data
#* @tag data
#* @param file:file   CSV with columns: date, location, Y (+ optional covariates)
#* @param experiment_id:string  UUID of the parent experiment
#* @param date_col:string       Name of the date column (default: "date")
#* @param location_col:string   Name of the location column (default: "location")
#* @param kpi_col:string        Name of the KPI column (default: "Y")
#* @serializer json
#* @post /upload
function(req, res,
         experiment_id,
         date_col     = "date",
         location_col = "location",
         kpi_col      = "Y") {

  log_info("[{req$request_id}] data/upload | exp={experiment_id}")

  # ── 1. Parse file upload ─────────────────────────────────────────
  file <- req$body[[1]]
  if (is.null(file)) {
    res$status <- 400
    return(list(error = "No file provided. Send multipart/form-data with field 'file'."))
  }

  dt <- tryCatch(
    data.table::fread(file$datapath, na.strings = c("", "NA", "N/A", "null")),
    error = function(e) NULL
  )
  if (is.null(dt)) {
    res$status <- 422
    return(list(error = "Could not parse CSV. Ensure the file is UTF-8 encoded with a header row."))
  }

  # ── 2. Rename to standard column names ───────────────────────────
  required_cols <- c(date_col, location_col, kpi_col)
  missing       <- setdiff(required_cols, names(dt))
  if (length(missing)) {
    res$status <- 422
    return(list(
      error   = "Missing required columns",
      missing = missing,
      found   = names(dt)
    ))
  }

  # Standardise names internally; keep original names in metadata
  data.table::setnames(dt,
    old = c(date_col, location_col, kpi_col),
    new = c("date",   "location",   "Y")
  )

  # ── 3. Type coercions ────────────────────────────────────────────
  dt[, date     := as.Date(date)]
  dt[, location := as.character(location)]
  dt[, Y        := as.numeric(Y)]

  if (any(is.na(dt$date))) {
    res$status <- 422
    return(list(error = "date column contains unparseable values. Use YYYY-MM-DD format."))
  }

  # ── 4. Structural validation ──────────────────────────────────────
  n_geos    <- data.table::uniqueN(dt$location)
  n_periods <- data.table::uniqueN(dt$date)
  date_min  <- min(dt$date)
  date_max  <- max(dt$date)

  # Balanced panel check
  expected_rows   <- n_geos * n_periods
  actual_rows     <- nrow(dt)
  missing_combos  <- expected_rows - actual_rows
  has_missing     <- missing_combos > 0

  # Missing Y values
  missing_y       <- sum(is.na(dt$Y))

  # Covariate columns (everything beyond date/location/Y)
  covariate_cols  <- setdiff(names(dt), c("date", "location", "Y"))

  # Detected granularity
  date_diffs      <- diff(sort(unique(dt$date)))
  median_diff     <- as.integer(median(date_diffs))
  granularity_detected <- dplyr::case_when(
    median_diff == 1  ~ "daily",
    median_diff == 7  ~ "weekly",
    median_diff >= 28 ~ "monthly",
    TRUE              ~ paste0(median_diff, "-day")
  )

  # ── 5. Best-practice pre-checks ──────────────────────────────────
  bp_checks <- list(
    n_geos_ok          = n_geos    >= 20,
    n_periods_ok       = n_periods >= 25,
    granularity_daily  = granularity_detected == "daily",
    no_missing_values  = !has_missing && missing_y == 0,
    has_covariates     = length(covariate_cols) > 0
  )

  # ── 6. Persist dataset to object storage (Parquet) ───────────────
  dataset_id  <- uuid::UUIDgenerate()
  parquet_key <- paste0("datasets/", dataset_id, "/data.parquet")

  arrow::write_parquet(dt, tempfile_path <- tempfile(fileext = ".parquet"))
  upload_to_s3(tempfile_path, parquet_key)  # see R/helpers/storage.R

  # ── 7. Persist metadata to Postgres ──────────────────────────────
  con <- get_db()
  on.exit(DBI::dbDisconnect(con))

  DBI::dbExecute(con,
    "INSERT INTO experiment_datasets
       (id, experiment_id, file_path, n_geos, n_periods,
        date_start, date_end, kpi_col, covariate_cols, uploaded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())",
    list(
      dataset_id, experiment_id, parquet_key,
      n_geos, n_periods,
      as.character(date_min), as.character(date_max),
      kpi_col,
      paste(covariate_cols, collapse = ",")
    )
  )

  log_info("[{req$request_id}] dataset {dataset_id} uploaded | geos={n_geos} | periods={n_periods}")

  list(
    dataset_id          = dataset_id,
    n_geos              = n_geos,
    n_periods           = n_periods,
    date_range          = list(start = as.character(date_min), end = as.character(date_max)),
    granularity_detected= granularity_detected,
    missing_panel_combos= missing_combos,
    missing_y_values    = missing_y,
    covariate_cols      = covariate_cols,
    bp_checks           = bp_checks
  )
}


# ═══════════════════════════════════════════════════════════════════
#  POST /v1/data/validate
#  Run all 14 GeoLift best-practice checks against a dataset +
#  experiment config. Returns structured pass/warn/fail per check.
# ═══════════════════════════════════════════════════════════════════

#* Validate dataset against all GeoLift best practices
#* @tag data
#* @param dataset_id:string     UUID from /data/upload
#* @param test_start:string     ISO date — planned campaign start
#* @param test_end:string       ISO date — planned campaign end
#* @param pre_start:string      ISO date — pre-period start
#* @param data_granularity:string "daily" or "weekly"
#* @serializer json
#* @post /validate
function(req, res,
         dataset_id,
         test_start,
         test_end,
         pre_start,
         data_granularity = "daily") {

  log_info("[{req$request_id}] data/validate | dataset={dataset_id}")

  # ── Load dataset metadata from Postgres ──────────────────────────
  con <- get_db()
  on.exit(DBI::dbDisconnect(con))

  meta <- DBI::dbGetQuery(con,
    "SELECT * FROM experiment_datasets WHERE id = $1", list(dataset_id))

  if (nrow(meta) == 0) {
    res$status <- 404
    return(list(error = paste("Dataset not found:", dataset_id)))
  }

  # ── Load actual data from Parquet for deeper checks ───────────────
  dt <- load_dataset(dataset_id)  # see R/helpers/db.R

  # ── Date arithmetic ───────────────────────────────────────────────
  d_pre_start <- as.Date(pre_start)
  d_test_start<- as.Date(test_start)
  d_test_end  <- as.Date(test_end)
  pre_days    <- as.integer(d_test_start - d_pre_start)
  test_days   <- as.integer(d_test_end   - d_test_start)
  pre_ratio   <- pre_days / max(1, test_days)
  total_weeks <- round(as.integer(d_test_start - d_pre_start) / 7)

  # ── Structural break detection (simple rolling-mean variance) ────
  pre_dt        <- dt[date < d_test_start]
  agg           <- pre_dt[, .(Y = sum(Y, na.rm=TRUE)), by = date][order(date)]
  roll_mean     <- zoo::rollmean(agg$Y, k = 7, fill = NA)
  residuals     <- agg$Y - roll_mean
  resid_sd      <- sd(residuals, na.rm = TRUE)
  outlier_days  <- sum(abs(residuals) > 3 * resid_sd, na.rm = TRUE)
  structural_break_risk <- outlier_days > 5

  # ── 14 checks ────────────────────────────────────────────────────
  pass <- function(detail, rem = NULL) list(status="pass", detail=detail, remediation=rem)
  warn <- function(detail, rem = NULL) list(status="warn", detail=detail, remediation=rem)
  fail <- function(detail, rem = NULL) list(status="fail", detail=detail, remediation=rem)

  checks <- list(

    list(id="granularity", category="Data", label="Daily granularity",
         result = if(data_granularity=="daily") pass("Daily data confirmed") else
                  warn("Weekly data detected", "Switch to daily data to reduce minimum test duration to 15 days.")),

    list(id="geo_granularity", category="Data", label="Finest available geo level",
         result = warn("Geo level not verified here — confirm DMA or finer in setup", "Use City or Zip Code if targetable.")),

    list(id="pre_period_ratio", category="Data", label="Pre-period ≥ 4–5× test duration",
         result = if(pre_ratio >= 4) pass(sprintf("Ratio: %.1fx", pre_ratio)) else
                  if(pre_ratio >= 3) warn(sprintf("Ratio: %.1fx (target ≥4x)", pre_ratio), "Extend pre-period.") else
                  fail(sprintf("Ratio: %.1fx (minimum 3x)", pre_ratio), "Pre-period too short — minimum 4x test duration required.")),

    list(id="min_pre_periods", category="Data", label="Minimum 25 pre-treatment periods",
         result = if(pre_days>=25) pass(sprintf("%d pre-period days", pre_days)) else
                  if(pre_days>=20) warn(sprintf("%d days (target ≥25)", pre_days), "Add more pre-period history.") else
                  fail(sprintf("%d days (minimum 20)", pre_days), "Insufficient pre-period. GeoLift requires at least 25 periods.")),

    list(id="min_geos", category="Data", label="20+ geo units",
         result = if(meta$n_geos>=20) pass(sprintf("%d geo units detected", meta$n_geos)) else
                  fail(sprintf("%d geo units (minimum 20)", meta$n_geos), "Aggregate to fewer, larger geos or include more markets.")),

    list(id="52_weeks", category="Data", label="52 weeks of history recommended",
         result = if(total_weeks>=52) pass(sprintf("%d weeks of pre-period", total_weeks)) else
                  if(total_weeks>=26) warn(sprintf("%d weeks (52 recommended)", total_weeks), "Full year history improves seasonal control.") else
                  fail(sprintf("%d weeks (52 recommended)", total_weeks), "Short history risks missing seasonal patterns.")),

    list(id="purchase_cycle", category="Data", label="Test covers ≥ 1 purchase cycle",
         result = if(test_days>=7) pass(sprintf("%d day test window", test_days)) else
                  warn(sprintf("%d days — verify this covers a full purchase cycle", test_days), "Extend test to cover at least one purchase cycle.")),

    list(id="min_duration", category="Data", label="Minimum test duration",
         result = {
           min_d <- if(data_granularity=="daily") 15L else 28L
           if(test_days >= min_d) pass(sprintf("%d days (minimum %d)", test_days, min_d)) else
           fail(sprintf("%d days (minimum %d for %s data)", test_days, min_d, data_granularity),
                sprintf("Extend test to at least %d days.", min_d))
         }),

    list(id="no_missing", category="Data", label="No missing values",
         result = if(meta$n_geos * meta$n_periods == nrow(dt))
                    pass("Balanced panel confirmed — no missing geo×date combinations") else
                    fail(sprintf("%d missing combinations detected",
                                 meta$n_geos*meta$n_periods - nrow(dt)),
                         "Impute or exclude geos with missing values before proceeding.")),

    list(id="covariates", category="Data", label="Panel covariates (optional)",
         result = if(nchar(meta$covariate_cols)>0)
                    pass(sprintf("Covariates found: %s", meta$covariate_cols)) else
                    list(status="optional", detail="No covariates detected", remediation="Consider adding population, income, or distribution data.")),

    list(id="market_match", category="Markets", label="Match markets on outcome + category vars",
         result = warn("Verify matching variables include exact KPI outcome", "Set matching_vars in market selection step.")),

    list(id="local_media", category="Media", label="Local media accounted for",
         result = warn("Confirm local media status in experiment config", "Document any local TV, OOH, or regional spend differences.")),

    list(id="national_media", category="Media", label="National media held constant",
         result = warn("Confirm national media stability during test window", "Flag any planned national TV, print, or digital changes.")),

    list(id="structural_breaks", category="Data", label="Pre-period free of structural breaks",
         result = if(!structural_break_risk)
                    pass(sprintf("No structural breaks detected (outlier days: %d)", outlier_days)) else
                    fail(sprintf("%d outlier days detected in pre-period aggregate", outlier_days),
                         "Investigate and trim pre-period to a stable window. Structural breaks corrupt the synthetic control baseline."))
  )

  # ── Summary ───────────────────────────────────────────────────────
  statuses       <- sapply(checks, function(c) c$result$status)
  req_checks     <- checks[sapply(checks, function(c) c$result$status != "optional")]
  req_passing    <- sum(sapply(req_checks, function(c) c$result$status == "pass"))
  req_total      <- length(req_checks)
  ready          <- req_passing == req_total

  list(
    dataset_id      = dataset_id,
    checks          = lapply(checks, function(c) c(id=c$id, category=c$category, label=c$label, c$result)),
    required_passing= req_passing,
    required_total  = req_total,
    ready_to_proceed= ready,
    summary         = list(
      pass     = sum(statuses == "pass"),
      warn     = sum(statuses == "warn"),
      fail     = sum(statuses == "fail"),
      optional = sum(statuses == "optional")
    )
  )
}
