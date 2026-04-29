#!/usr/bin/env Rscript
# GeoLift Worker — consumes jobs from the Redis queue and executes them.
# Launched by docker-compose as a separate container from the API.

library(logger)
library(jsonlite)

# ── Source all dependencies ───────────────────────────────────────
source("R/helpers/geolift_utils.R")
source("R/helpers/db.R")
source("R/helpers/storage.R")
source("R/helpers/jobs.R")

# Route files contain the actual job implementations
source("R/routes/power.R")
source("R/routes/markets.R")   # run_market_selection_job()
source("R/routes/measurement.R")

ENV         <- Sys.getenv("GEOLIFT_ENV", "development")
CONCURRENCY <- as.integer(Sys.getenv("WORKER_CONCURRENCY", "1"))

log_threshold(INFO)
log_info("GeoLift Worker starting | env={ENV} | concurrency={CONCURRENCY}")

# ── Verify connectivity before entering loop ──────────────────────
retry <- function(fn, n = 5, pause = 3) {
  for (i in seq_len(n)) {
    result <- tryCatch(fn(), error = function(e) e)
    if (!inherits(result, "error")) return(result)
    log_warn("Attempt {i}/{n} failed: {result$message}")
    Sys.sleep(pause)
  }
  stop("Could not establish connection after ", n, " attempts")
}

retry(function() {
  con <- get_db(); DBI::dbGetQuery(con, "SELECT 1"); DBI::dbDisconnect(con)
  log_info("Worker: Postgres connection OK")
})

retry(function() {
  r <- get_redis(); r$PING()
  log_info("Worker: Redis connection OK | queue depth={queue_depth()}")
})

# ── Job dispatcher ────────────────────────────────────────────────
dispatch_job <- function(job) {
  log_info("Worker: dispatching job {job$job_id} | type={job$job_type}")

  # Mark running in both Redis and Postgres
  update_job_progress(job$job_id, 0L, "Starting")
  update_job_in_db(job$job_id, "running")

  tryCatch({
    switch(
      job$job_type,

      "power_simulate" = {
        run_power_job(job)
      },

      "market_selection_async" = {
        # Market selection is normally synchronous, but can be
        # offloaded here for very large geo pools
        run_market_selection_job(job)
      },

      {
        stop(sprintf("Unknown job type: '%s'", job$job_type))
      }
    )
  }, error = function(e) {
    log_error("Worker: job {job$job_id} FAILED — {e$message}")
    fail_job(job$job_id, e$message)
  })
}

# ── Main loop ─────────────────────────────────────────────────────
log_info("Worker: entering main loop — polling {JOBS_QUEUE}")

active_jobs <- 0L

repeat {
  # Only pull a new job if under concurrency limit
  if (active_jobs < CONCURRENCY) {
    job <- pop_next_job(timeout = 5L)

    if (!is.null(job)) {
      # For CONCURRENCY=1 (default), run synchronously in-loop.
      # For CONCURRENCY>1, fork with parallel::mcparallel() and
      # collect with mccollect() — not implemented here for clarity.
      active_jobs <- active_jobs + 1L
      dispatch_job(job)
      active_jobs <- active_jobs - 1L
    }
  } else {
    # At concurrency limit — brief pause before checking again
    Sys.sleep(0.5)
  }

  # Periodic health log (every ~60s)
  if (as.integer(Sys.time()) %% 60 == 0) {
    log_info("Worker alive | queue depth={queue_depth()}")
  }
}
