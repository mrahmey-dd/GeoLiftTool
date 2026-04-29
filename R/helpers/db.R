library(DBI)
library(RPostgres)
library(arrow)
library(data.table)
library(logger)

# ── Connection ────────────────────────────────────────────────────
# Returns a new DBI connection. Always assign to a local variable
# and use on.exit(DBI::dbDisconnect(con)) in calling functions.
# A production deployment should use a connection pool (RPostgres::Pool).

get_db <- function() {
  DBI::dbConnect(
    RPostgres::Postgres(),
    host     = Sys.getenv("DB_HOST",     "localhost"),
    port     = as.integer(Sys.getenv("DB_PORT", "5432")),
    dbname   = Sys.getenv("DB_NAME",     "geolift"),
    user     = Sys.getenv("DB_USER",     "geolift"),
    password = Sys.getenv("DB_PASSWORD", "geolift_dev"),
    # Raise statement_timeout so long GeoLift reads don't abort
    options  = "-c statement_timeout=120000"
  )
}

# ── Dataset loader ────────────────────────────────────────────────
# Fetches the Parquet file path from Postgres, downloads from S3,
# reads into a data.table, and returns it with standardised columns.

load_dataset <- function(dataset_id) {
  con <- get_db()
  on.exit(DBI::dbDisconnect(con))

  meta <- DBI::dbGetQuery(con,
    "SELECT file_path, kpi_col, covariate_cols
     FROM experiment_datasets
     WHERE id = $1
     LIMIT 1",
    list(dataset_id)
  )

  if (nrow(meta) == 0) {
    stop(sprintf("load_dataset: dataset '%s' not found in experiment_datasets", dataset_id))
  }

  tmp <- tempfile(fileext = ".parquet")
  on.exit(unlink(tmp), add = TRUE)

  download_from_s3(meta$file_path, tmp)

  dt <- as.data.table(arrow::read_parquet(tmp))

  # Ensure standard column names are present
  required <- c("date", "location", "Y")
  missing  <- setdiff(required, names(dt))
  if (length(missing)) {
    stop(sprintf("load_dataset: Parquet missing required columns: %s",
                 paste(missing, collapse = ", ")))
  }

  dt[, date     := as.Date(date)]
  dt[, location := as.character(location)]
  dt[, Y        := as.numeric(Y)]

  log_debug("load_dataset: {dataset_id} | {nrow(dt)} rows | {uniqueN(dt$location)} geos")
  dt
}

# ── Convenience wrappers ──────────────────────────────────────────

# Fetch a single experiment row; returns NULL if not found
get_experiment <- function(experiment_id, org_id = NULL) {
  con <- get_db()
  on.exit(DBI::dbDisconnect(con))

  if (!is.null(org_id)) {
    row <- DBI::dbGetQuery(con,
      "SELECT * FROM experiments WHERE id=$1 AND org_id=$2",
      list(experiment_id, org_id))
  } else {
    row <- DBI::dbGetQuery(con,
      "SELECT * FROM experiments WHERE id=$1",
      list(experiment_id))
  }

  if (nrow(row) == 0) return(NULL)
  as.list(row[1, ])
}

# Fetch market selection row for an experiment
get_selection <- function(selection_id) {
  con <- get_db()
  on.exit(DBI::dbDisconnect(con))
  row <- DBI::dbGetQuery(con,
    "SELECT * FROM market_selections WHERE id=$1", list(selection_id))
  if (nrow(row) == 0) return(NULL)
  as.list(row[1, ])
}

# Fetch most recent dataset for an experiment
get_latest_dataset <- function(experiment_id) {
  con <- get_db()
  on.exit(DBI::dbDisconnect(con))
  row <- DBI::dbGetQuery(con,
    "SELECT * FROM experiment_datasets
     WHERE experiment_id=$1
     ORDER BY uploaded_at DESC LIMIT 1",
    list(experiment_id))
  if (nrow(row) == 0) return(NULL)
  as.list(row[1, ])
}

# Patch a single experiment field
patch_experiment <- function(experiment_id, ...) {
  updates <- list(...)
  if (length(updates) == 0) return(invisible(NULL))

  allowed <- c("status","dataset_id","selection_id","power_id",
                "result_id","bp_score","notes")
  updates <- updates[names(updates) %in% allowed]
  if (length(updates) == 0) return(invisible(NULL))

  con <- get_db()
  on.exit(DBI::dbDisconnect(con))

  clauses <- paste(
    sapply(seq_along(updates), function(i) sprintf("%s=$%d", names(updates)[i], i + 1)),
    collapse = ", "
  )
  sql    <- sprintf("UPDATE experiments SET %s, updated_at=NOW() WHERE id=$1", clauses)
  params <- c(list(experiment_id), unname(updates))

  DBI::dbExecute(con, sql, params)
  invisible(TRUE)
}

# Log a job audit record to Postgres (async — non-blocking best-effort)
log_job_to_db <- function(job_id, job_type, experiment_id, payload) {
  tryCatch({
    con <- get_db()
    on.exit(DBI::dbDisconnect(con))
    DBI::dbExecute(con,
      "INSERT INTO jobs (id, job_type, experiment_id, status, payload_json, enqueued_at)
       VALUES ($1,$2,$3,'queued',$4::jsonb,NOW())",
      list(job_id, job_type, experiment_id,
           jsonlite::toJSON(payload, auto_unbox = TRUE)))
  }, error = function(e) {
    log_warn("log_job_to_db failed (non-fatal): {e$message}")
  })
}

update_job_in_db <- function(job_id, status, result = NULL, error = NULL) {
  tryCatch({
    con <- get_db()
    on.exit(DBI::dbDisconnect(con))
    DBI::dbExecute(con,
      "UPDATE jobs SET
         status       = $2,
         result_json  = $3::jsonb,
         error_message= $4,
         completed_at = CASE WHEN $2 IN ('complete','failed') THEN NOW() ELSE NULL END,
         started_at   = CASE WHEN $2='running' AND started_at IS NULL THEN NOW() ELSE started_at END
       WHERE id = $1",
      list(job_id, status,
           if (!is.null(result)) jsonlite::toJSON(result, auto_unbox=TRUE) else NA,
           error))
  }, error = function(e) {
    log_warn("update_job_in_db failed (non-fatal): {e$message}")
  })
}
