library(plumber)
library(logger)
library(DBI)
library(RPostgres)
library(redux)      # Redis client
library(uuid)
library(jsonlite)

# ── Environment ───────────────────────────────────────────────────
ENV        <- Sys.getenv("GEOLIFT_ENV", "development")
LOG_LEVEL  <- Sys.getenv("LOG_LEVEL", "INFO")
PORT       <- as.integer(Sys.getenv("PORT", "8000"))
JWT_SECRET <- Sys.getenv("JWT_SECRET")

log_threshold(switch(LOG_LEVEL, DEBUG=DEBUG, INFO=INFO, WARN=WARN, ERROR=ERROR, INFO))
log_info("Starting GeoLift API | env={ENV} | port={PORT}")

# ── Database connection pool ──────────────────────────────────────
get_db <- function() {
  DBI::dbConnect(
    RPostgres::Postgres(),
    host     = Sys.getenv("DB_HOST",     "localhost"),
    port     = as.integer(Sys.getenv("DB_PORT", "5432")),
    dbname   = Sys.getenv("DB_NAME",     "geolift"),
    user     = Sys.getenv("DB_USER",     "geolift"),
    password = Sys.getenv("DB_PASSWORD", "geolift_dev")
  )
}

# ── Redis connection ──────────────────────────────────────────────
get_redis <- function() {
  redux::hiredis(url = Sys.getenv("REDIS_URL", "redis://localhost:6379"))
}

# ── Shared helpers (available to all route files) ─────────────────
source("R/helpers/db.R")
source("R/helpers/storage.R")
source("R/helpers/jobs.R")
source("R/helpers/auth.R")
source("R/helpers/geolift_utils.R")

# ── Build Plumber router ──────────────────────────────────────────
pr <- plumber::pr()

# ── CORS middleware ───────────────────────────────────────────────
pr$filter("cors", function(req, res) {
  res$setHeader("Access-Control-Allow-Origin",  Sys.getenv("CORS_ORIGIN", "*"))
  res$setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
  res$setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Request-ID")

  if (req$REQUEST_METHOD == "OPTIONS") {
    res$status <- 200
    return(list())
  }
  plumber::forward()
})

# ── Request ID + logging middleware ──────────────────────────────
pr$filter("request_log", function(req, res) {
  req$request_id <- req$HTTP_X_REQUEST_ID %||% uuid::UUIDgenerate()
  res$setHeader("X-Request-ID", req$request_id)
  log_info("[{req$request_id}] {req$REQUEST_METHOD} {req$PATH_INFO}")
  plumber::forward()
})

# ── JWT auth middleware (all routes except /v1/health) ────────────
pr$filter("auth", function(req, res) {
  public_paths <- c("/v1/health", "/v1/auth/login", "/v1/auth/refresh",
                    "/__docs__/", "/__swagger__/", "/openapi.json")
  if (any(startsWith(req$PATH_INFO, public_paths))) return(plumber::forward())

  token <- sub("^Bearer ", "", req$HTTP_AUTHORIZATION %||% "")
  if (!nchar(token)) {
    res$status <- 401
    return(list(error = "Missing Authorization header"))
  }

  claims <- verify_jwt(token, JWT_SECRET)
  if (is.null(claims)) {
    res$status <- 401
    return(list(error = "Invalid or expired token"))
  }

  req$user_id  <- claims$sub
  req$org_id   <- claims$org
  plumber::forward()
})

# ── Error handler ─────────────────────────────────────────────────
pr$setErrorHandler(function(req, res, err) {
  log_error("[{req$request_id}] Unhandled error: {conditionMessage(err)}")
  res$status <- 500
  list(
    error      = "Internal server error",
    request_id = req$request_id,
    detail     = if (ENV == "development") conditionMessage(err) else NULL
  )
})

# ── Mount route files ─────────────────────────────────────────────
pr$mount("/v1/health",       plumber::pr("R/routes/health.R"))
pr$mount("/v1/auth",         plumber::pr("R/routes/auth.R"))
pr$mount("/v1/data",         plumber::pr("R/routes/data.R"))
pr$mount("/v1/markets",      plumber::pr("R/routes/markets.R"))
pr$mount("/v1/power",        plumber::pr("R/routes/power.R"))
pr$mount("/v1/measurement",  plumber::pr("R/routes/measurement.R"))
pr$mount("/v1/experiments",  plumber::pr("R/routes/experiments.R"))
pr$mount("/v1/jobs",         plumber::pr("R/routes/jobs.R"))
pr$mount("/v1/export",       plumber::pr("R/routes/export.R"))

# ── Swagger docs (development only) ──────────────────────────────
if (ENV == "development") {
  pr$setDocs(TRUE)
  log_info("Swagger UI available at http://localhost:{PORT}/__docs__/")
}

# ── Run ───────────────────────────────────────────────────────────
log_info("GeoLift API ready on port {PORT}")
pr$run(
  host   = "0.0.0.0",
  port   = PORT,
  debug  = (ENV == "development"),
  quiet  = FALSE
)
