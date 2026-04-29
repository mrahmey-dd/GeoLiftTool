# ══════════════════════════════════════════════════════════════════
#  R/routes/health.R
# ══════════════════════════════════════════════════════════════════

library(plumber)
library(logger)

#* API health check — used by Docker HEALTHCHECK and load balancers
#* @tag meta
#* @get /
#* @serializer json
function(req, res) {
  db_ok <- tryCatch({
    con <- get_db()
    on.exit(DBI::dbDisconnect(con))
    DBI::dbGetQuery(con, "SELECT 1")
    TRUE
  }, error = function(e) {
    log_warn("Health: DB check failed — {e$message}")
    FALSE
  })

  redis_ok <- tryCatch({
    r    <- get_redis()
    pong <- r$PING()
    identical(pong, "PONG") || identical(pong, as.raw(0))
  }, error = function(e) {
    log_warn("Health: Redis check failed — {e$message}")
    FALSE
  })

  status     <- if (db_ok && redis_ok) "healthy" else "degraded"
  res$status <- if (status == "healthy") 200L else 503L

  list(
    status    = status,
    version   = "1.0.0",
    env       = Sys.getenv("GEOLIFT_ENV", "development"),
    timestamp = as.character(Sys.time()),
    checks    = list(
      database     = db_ok,
      redis        = redis_ok,
      queue_depth  = tryCatch(queue_depth(), error = function(e) NA)
    )
  )
}
