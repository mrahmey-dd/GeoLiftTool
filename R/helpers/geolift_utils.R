# ── geolift_utils.R ──────────────────────────────────────────────
# Shared utilities available to all route and helper files.
# Sourced once in api.R before route files are mounted.

# ── Null-coalescing operator ──────────────────────────────────────
`%||%` <- function(a, b) if (!is.null(a) && length(a) > 0) a else b

# ── Safe JSON extraction ──────────────────────────────────────────
safe_from_json <- function(x, default = list()) {
  tryCatch(
    jsonlite::fromJSON(x, simplifyVector = FALSE),
    error = function(e) default
  )
}

# ── Date helpers ──────────────────────────────────────────────────
days_between <- function(start, end) {
  as.integer(as.Date(end) - as.Date(start))
}

# ── Time-index converter ──────────────────────────────────────────
# GeoLift requires integer time indices, not dates.
# This converts a date column in a data.table to 1-based integer.
add_time_index <- function(dt) {
  dates <- sort(unique(dt$date))
  dt[, time := as.integer(factor(date, levels = dates))]
  invisible(dt)
}

# Date-to-time-index lookup for a specific date
date_to_time <- function(dt, target_date) {
  d   <- as.Date(target_date)
  row <- dt[date == d, time]
  if (length(row) == 0) stop(sprintf("date_to_time: %s not found in dataset", target_date))
  as.integer(row[1])
}

# ── Numeric formatting ────────────────────────────────────────────
pct  <- function(x, digits = 2)  round(as.numeric(x) * 100, digits)
rnd  <- function(x, digits = 4)  round(as.numeric(x), digits)
rnd2 <- function(x)              round(as.numeric(x), 2)

# ── Parse comma-separated string to character vector ─────────────
parse_csv_arg <- function(x) {
  if (is.null(x) || !nchar(trimws(x))) return(character(0))
  trimws(strsplit(x, ",")[[1]])
}

# ── Structural break detection ────────────────────────────────────
# Returns TRUE if the pre-period aggregate shows suspicious outliers.
has_structural_break <- function(dt, pre_end_date, threshold_sd = 3, min_outliers = 5) {
  pre   <- dt[date <= as.Date(pre_end_date), .(Y = sum(Y, na.rm = TRUE)), by = date][order(date)]
  if (nrow(pre) < 14) return(FALSE)  # too short to detect

  roll  <- zoo::rollmean(pre$Y, k = 7, fill = NA, align = "center")
  resid <- pre$Y - roll
  sd_r  <- sd(resid, na.rm = TRUE)
  if (is.na(sd_r) || sd_r == 0) return(FALSE)

  n_outliers <- sum(abs(resid) > threshold_sd * sd_r, na.rm = TRUE)
  n_outliers >= min_outliers
}

# ── Response helpers ──────────────────────────────────────────────
http_error <- function(res, status, msg, detail = NULL) {
  res$status <- as.integer(status)
  out <- list(error = msg)
  if (!is.null(detail)) out$detail <- detail
  out
}

http_not_found <- function(res, what, id) {
  http_error(res, 404L, sprintf("%s not found: %s", what, id))
}
