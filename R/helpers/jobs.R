library(redux)
library(jsonlite)
library(uuid)
library(logger)

# ── Constants ─────────────────────────────────────────────────────
JOBS_QUEUE  <- "geolift:jobs:pending"
JOB_KEY     <- function(id) paste0("geolift:job:", id)
JOB_TTL     <- 7200L   # Redis key TTL: 2 hours

# ── Redis client ──────────────────────────────────────────────────
# Creates a new connection per call — redux connections are not
# safely shareable across forked workers. Call get_redis() locally
# and do not cache at module scope.

get_redis <- function() {
  redux::hiredis(url = Sys.getenv("REDIS_URL", "redis://localhost:6379"))
}

# ── Enqueue ───────────────────────────────────────────────────────
# Creates a job ID, pushes payload to the left of the queue (LPUSH),
# and sets initial job state. Returns the job_id.

enqueue_job <- function(job_type, payload = list(), experiment_id = NULL) {
  job_id <- uuid::UUIDgenerate()
  r      <- get_redis()

  full_payload <- c(
    list(
      job_id        = job_id,
      job_type      = job_type,
      experiment_id = experiment_id,
      enqueued_at   = as.character(Sys.time())
    ),
    payload
  )

  # Push serialised payload onto queue
  r$LPUSH(JOBS_QUEUE, jsonlite::toJSON(full_payload, auto_unbox = TRUE))

  # Set visible job state immediately so the first poll finds it
  set_job_state(r, job_id, list(
    job_id        = job_id,
    job_type      = job_type,
    experiment_id = experiment_id,
    status        = "queued",
    progress      = 0L,
    message       = "Waiting for worker",
    result        = NULL,
    error         = NULL,
    created_at    = as.character(Sys.time())
  ))

  # Persist to Postgres for audit trail (best-effort)
  log_job_to_db(job_id, job_type, experiment_id, full_payload)

  log_info("enqueue_job: {job_id} | type={job_type}")
  job_id
}

# ── Read job state ────────────────────────────────────────────────
get_job_state <- function(job_id) {
  r   <- get_redis()
  raw <- r$GET(JOB_KEY(job_id))
  if (is.null(raw)) return(NULL)
  tryCatch(
    jsonlite::fromJSON(rawToChar(raw), simplifyVector = FALSE),
    error = function(e) NULL
  )
}

# ── Write job state ───────────────────────────────────────────────
set_job_state <- function(r = NULL, job_id, state) {
  if (is.null(r)) r <- get_redis()
  r$SET(JOB_KEY(job_id), jsonlite::toJSON(state, auto_unbox = TRUE))
  r$EXPIRE(JOB_KEY(job_id), JOB_TTL)
  invisible(state)
}

# ── Update progress (called inside worker during long computation) ─
update_job_progress <- function(job_id, progress, message = NULL) {
  r     <- get_redis()
  state <- get_job_state(job_id) %||% list(job_id = job_id, job_type = "unknown")
  state$status   <- "running"
  state$progress <- as.integer(min(99L, max(0L, progress)))
  if (!is.null(message)) state$message <- message
  state$updated_at <- as.character(Sys.time())
  set_job_state(r, job_id, state)
  log_debug("job {job_id} progress: {progress}% — {message}")
}

# ── Mark complete ─────────────────────────────────────────────────
complete_job <- function(job_id, result) {
  r <- get_redis()
  set_job_state(r, job_id, list(
    job_id       = job_id,
    status       = "complete",
    progress     = 100L,
    message      = "Done",
    result       = result,
    error        = NULL,
    completed_at = as.character(Sys.time())
  ))
  update_job_in_db(job_id, "complete", result = result)
  log_info("complete_job: {job_id}")
}

# ── Mark failed ───────────────────────────────────────────────────
fail_job <- function(job_id, error_msg) {
  r     <- get_redis()
  state <- get_job_state(job_id) %||% list(job_id = job_id)
  state$status    <- "failed"
  state$progress  <- as.integer(state$progress %||% 0L)
  state$error     <- error_msg
  state$failed_at <- as.character(Sys.time())
  set_job_state(r, job_id, state)
  update_job_in_db(job_id, "failed", error = error_msg)
  log_error("fail_job: {job_id} — {error_msg}")
}

# ── Worker: pop next job (blocking, 5s timeout) ───────────────────
# Returns a parsed job list or NULL if queue was empty.
pop_next_job <- function(timeout = 5L) {
  r   <- get_redis()
  raw <- tryCatch(
    r$BRPOP(JOBS_QUEUE, timeout = timeout),
    error = function(e) { log_warn("Redis BRPOP error: {e$message}"); NULL }
  )
  if (is.null(raw) || length(raw) < 2) return(NULL)

  tryCatch(
    jsonlite::fromJSON(rawToChar(raw[[2]]), simplifyVector = FALSE),
    error = function(e) {
      log_error("pop_next_job: could not parse payload — {e$message}")
      NULL
    }
  )
}

# ── Queue depth (for monitoring) ─────────────────────────────────
queue_depth <- function() {
  r <- get_redis()
  as.integer(r$LLEN(JOBS_QUEUE))
}
