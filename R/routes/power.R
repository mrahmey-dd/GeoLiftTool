library(plumber)
library(GeoLift)
library(data.table)
library(uuid)
library(logger)
library(jsonlite)

# ═══════════════════════════════════════════════════════════════════
#  POST /v1/power/simulate
#
#  GeoLiftPower() with n_simulations=2000 can take 30–180 seconds.
#  This endpoint uses the ASYNC JOB PATTERN:
#
#    1. POST /v1/power/simulate  → returns { job_id, status:"queued" }
#    2. Worker picks up job from Redis queue, runs GeoLiftPower()
#    3. GET  /v1/jobs/{job_id}   → polls { status, progress, result }
#    4. When status="complete"   → result contains power matrix + MDE
#
#  The frontend polls GET /v1/jobs/{job_id} every 3 seconds.
# ═══════════════════════════════════════════════════════════════════

#* Submit a GeoLiftPower() simulation job
#* @tag power
#* @param selection_id:string    UUID from /v1/markets/select
#* @param experiment_id:string   UUID of the parent experiment
#* @param effect_sizes:string    Comma-separated lift %s to simulate (default: 0.5,1,2,3,5,7.5,10,15,20)
#* @param test_durations:string  Comma-separated test lengths in days (default: 7,10,14,21,28,35,42)
#* @param confidence:number      Target confidence level 0–1 (default: 0.80)
#* @param n_simulations:int      Simulation iterations (default: 2000, max: 5000)
#* @serializer json
#* @post /simulate
function(req, res,
         selection_id,
         experiment_id,
         effect_sizes   = "0.5,1,2,3,5,7.5,10,15,20",
         test_durations = "7,10,14,21,28,35,42",
         confidence     = 0.80,
         n_simulations  = 2000L) {

  log_info("[{req$request_id}] power/simulate | selection={selection_id}")

  # ── Validate selection exists ─────────────────────────────────────
  con <- get_db()
  on.exit(DBI::dbDisconnect(con))

  sel <- DBI::dbGetQuery(con, "SELECT * FROM market_selections WHERE id=$1", list(selection_id))
  if (nrow(sel) == 0) {
    res$status <- 404
    return(list(error = paste("Selection not found:", selection_id)))
  }

  # ── Parse effect sizes + durations ───────────────────────────────
  effects   <- as.numeric(trimws(strsplit(effect_sizes,   ",")[[1]]))
  durations <- as.integer(trimws(strsplit(test_durations, ",")[[1]]))
  n_sim     <- min(as.integer(n_simulations), 5000L)
  conf      <- min(max(as.numeric(confidence), 0.5), 0.99)

  # Estimate runtime — warn if likely > 60s
  est_seconds <- length(effects) * length(durations) * n_sim * 0.002
  if (est_seconds > 300) {
    log_warn("[{req$request_id}] Estimated runtime {round(est_seconds)}s — consider reducing n_simulations or grid size")
  }

  # ── Enqueue job to Redis ──────────────────────────────────────────
  job_id  <- uuid::UUIDgenerate()
  payload <- jsonlite::toJSON(list(
    job_id       = job_id,
    job_type     = "power_simulate",
    selection_id = selection_id,
    experiment_id= experiment_id,
    effect_sizes = effects,
    test_durations = durations,
    confidence   = conf,
    n_simulations= n_sim,
    enqueued_at  = as.character(Sys.time()),
    request_id   = req$request_id
  ), auto_unbox = TRUE)

  r <- get_redis()
  r$LPUSH("geolift:jobs:pending", payload)

  # Store initial job state so polls can find it immediately
  r$SET(
    paste0("geolift:job:", job_id),
    jsonlite::toJSON(list(
      job_id   = job_id,
      status   = "queued",
      progress = 0L,
      result   = NULL,
      error    = NULL,
      created_at = as.character(Sys.time())
    ), auto_unbox = TRUE)
  )
  r$EXPIRE(paste0("geolift:job:", job_id), 3600L)  # TTL: 1 hour

  log_info("[{req$request_id}] Job {job_id} queued | est={round(est_seconds)}s")

  res$status <- 202
  list(
    job_id           = job_id,
    status           = "queued",
    poll_url         = paste0("/v1/jobs/", job_id),
    poll_interval_ms = 3000L,
    estimated_seconds= round(est_seconds)
  )
}


# ═══════════════════════════════════════════════════════════════════
#  WORKER — R/worker.R
#  Separate process launched by docker-compose "worker" service.
#  Continuously polls Redis queue and executes GeoLiftPower() jobs.
# ═══════════════════════════════════════════════════════════════════

# NOTE: This function is defined here for documentation co-location.
# The actual worker entry point is R/worker.R which sources this file.

run_power_job <- function(job) {
  log_info("Worker: starting power job {job$job_id}")

  r   <- get_redis()
  con <- get_db()
  on.exit(DBI::dbDisconnect(con))

  set_progress <- function(pct, msg = NULL) {
    state <- list(job_id=job$job_id, status="running", progress=pct, message=msg, result=NULL, error=NULL)
    r$SET(paste0("geolift:job:", job$job_id), jsonlite::toJSON(state, auto_unbox=TRUE))
    r$EXPIRE(paste0("geolift:job:", job$job_id), 3600L)
  }

  # ── Load selection + dataset ──────────────────────────────────────
  set_progress(5L, "Loading market selection and dataset")
  sel <- DBI::dbGetQuery(con, "SELECT * FROM market_selections WHERE id=$1", list(job$selection_id))
  if (nrow(sel) == 0) stop(paste("Selection not found:", job$selection_id))

  ds  <- DBI::dbGetQuery(con, "SELECT * FROM experiment_datasets WHERE experiment_id=$1",
                         list(sel$experiment_id))

  dt       <- load_dataset(ds$id[1])
  treatment <- trimws(strsplit(sel$treatment_markets, ",")[[1]])
  control   <- trimws(strsplit(sel$control_markets,   ",")[[1]])
  all_mkts  <- c(treatment, control)

  dt_filtered <- dt[location %in% all_mkts]
  dates       <- sort(unique(dt_filtered$date))
  dt_filtered[, time := as.integer(factor(date, levels = dates))]

  gl_data <- as.data.frame(dt_filtered[, .(location, time, Y)])

  set_progress(15L, "Running GeoLiftPower() simulations")

  # ── Run GeoLiftPower ──────────────────────────────────────────────
  power_result <- tryCatch(
    GeoLift::GeoLiftPower(
      data              = gl_data,
      treatment_markets = treatment,
      Y_id              = "Y",
      location_id       = "location",
      time_id           = "time",
      effect_size       = job$effect_sizes,
      test_duration     = job$test_durations,
      confLevel         = job$confidence,
      nsim              = job$n_simulations,
      print_progress    = FALSE
    ),
    error = function(e) stop(paste("GeoLiftPower() failed:", e$message))
  )

  set_progress(85L, "Processing results")

  power_tbl <- power_result$PowerTable  # cols: effect_size, test_duration, power

  # ── Find MDE at target confidence ────────────────────────────────
  above_threshold <- power_tbl[power_tbl$power >= job$confidence, ]
  if (nrow(above_threshold) > 0) {
    above_threshold <- above_threshold[order(above_threshold$effect_size, above_threshold$test_duration), ]
    mde_row         <- above_threshold[1, ]
    mde             <- mde_row$effect_size
    rec_duration    <- mde_row$test_duration
  } else {
    mde          <- NA
    rec_duration <- NA
  }

  # ── Persist to Postgres ───────────────────────────────────────────
  set_progress(90L, "Persisting results")
  power_id <- uuid::UUIDgenerate()

  DBI::dbExecute(con,
    "INSERT INTO power_analyses
       (id, experiment_id, selection_id, target_confidence, mde,
        recommended_duration, power_matrix_json, n_simulations, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,NOW())",
    list(
      power_id, sel$experiment_id, job$selection_id,
      job$confidence, mde, rec_duration,
      jsonlite::toJSON(power_tbl, auto_unbox=TRUE),
      job$n_simulations
    )
  )

  # ── Final job state ───────────────────────────────────────────────
  result_payload <- list(
    power_id             = power_id,
    mde                  = mde,
    recommended_duration = rec_duration,
    confidence_target    = job$confidence,
    power_matrix         = lapply(split(power_tbl, seq_len(nrow(power_tbl))), as.list),
    effect_sizes         = job$effect_sizes,
    test_durations       = job$test_durations
  )

  final_state <- list(
    job_id     = job$job_id,
    status     = "complete",
    progress   = 100L,
    result     = result_payload,
    error      = NULL,
    completed_at = as.character(Sys.time())
  )

  r$SET(paste0("geolift:job:", job$job_id), jsonlite::toJSON(final_state, auto_unbox=TRUE))
  r$EXPIRE(paste0("geolift:job:", job$job_id), 3600L)

  log_info("Worker: power job {job$job_id} complete | MDE={mde}% | power_id={power_id}")
}
