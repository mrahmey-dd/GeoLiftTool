library(plumber)
library(GeoLift)
library(data.table)
library(uuid)
library(logger)
library(ggplot2)
library(base64enc)

# ═══════════════════════════════════════════════════════════════════
#  POST /v1/markets/select
#  Wraps GeoLift::GeoLiftMarketSelection(). Returns ranked control
#  market candidates, fit stats, and a base64-encoded pre-period
#  overlay chart.
#
#  This is a SYNCHRONOUS endpoint — market selection typically runs
#  in 5–30s, acceptable for a direct HTTP response. If a dataset has
#  very many geos (>100) consider switching to the async job pattern
#  (see /v1/power/simulate for that pattern).
# ═══════════════════════════════════════════════════════════════════

#* Run GeoLiftMarketSelection to optimise control market pool
#* @tag markets
#* @param dataset_id:string        UUID from /v1/data/upload
#* @param experiment_id:string     UUID of the parent experiment
#* @param treatment_markets:string Comma-separated treatment market names
#* @param pre_period_end:string    ISO date — last day of pre-period
#* @param matching_vars:string     Comma-separated covariate column names (optional)
#* @param n_control_markets:int    Target number of control markets (default: auto)
#* @param exclude_markets:string   Comma-separated markets to exclude from control pool
#* @param cell_id:string           Treatment cell UUID (multi-cell experiments only)
#* @serializer json
#* @post /select
function(req, res,
         dataset_id,
         experiment_id,
         treatment_markets,
         pre_period_end,
         matching_vars     = NULL,
         n_control_markets = NULL,
         exclude_markets   = NULL,
         cell_id           = NULL) {

  log_info("[{req$request_id}] markets/select | dataset={dataset_id} | treatment={treatment_markets}")

  # ── Parse inputs ─────────────────────────────────────────────────
  treatment <- trimws(strsplit(treatment_markets, ",")[[1]])
  exclude   <- if (!is.null(exclude_markets) && nchar(exclude_markets) > 0)
                 trimws(strsplit(exclude_markets, ",")[[1]]) else character(0)
  mv        <- if (!is.null(matching_vars) && nchar(matching_vars) > 0)
                 trimws(strsplit(matching_vars, ",")[[1]]) else NULL

  # ── Validate treatment markets exist in dataset ───────────────────
  dt  <- load_dataset(dataset_id)
  all_geos <- unique(dt$location)

  invalid <- setdiff(treatment, all_geos)
  if (length(invalid)) {
    res$status <- 422
    return(list(
      error   = "Treatment markets not found in dataset",
      invalid = invalid,
      sample  = head(all_geos, 10)
    ))
  }

  # ── Subset to pre-period only ─────────────────────────────────────
  dt_pre <- dt[date <= as.Date(pre_period_end)]

  if (nrow(dt_pre) == 0) {
    res$status <- 422
    return(list(error = paste("No data found on or before pre_period_end:", pre_period_end)))
  }

  # ── Convert dates to integer time index (GeoLift requirement) ─────
  dates    <- sort(unique(dt_pre$date))
  dt_pre[, time := as.integer(factor(date, levels = dates))]

  # ── Build GeoLift data frame ──────────────────────────────────────
  Y_cols <- c("Y")
  if (!is.null(mv)) {
    valid_mv <- intersect(mv, names(dt_pre))
    if (length(valid_mv) < length(mv)) {
      log_warn("[{req$request_id}] Covariate columns not found: {setdiff(mv, names(dt_pre))}")
    }
    Y_cols <- c(Y_cols, valid_mv)
  }

  gl_data <- as.data.frame(dt_pre[, c("location", "time", ..Y_cols), with = FALSE])
  names(gl_data)[1:2] <- c("location", "time")

  # ── Run GeoLiftMarketSelection ────────────────────────────────────
  n_top      <- if (!is.null(n_control_markets)) as.integer(n_control_markets) else 5L
  n_time     <- max(gl_data$time)

  result <- tryCatch({
    GeoLift::GeoLiftMarketSelection(
      data             = gl_data,
      treatment_period = c(n_time - 1L, n_time),  # use last 2 periods as hold-out
      GeoLiftModel     = "Y",
      Y_id             = "Y",
      location_id      = "location",
      time_id          = "time",
      include_markets  = treatment,
      exclude_markets  = exclude,
      n_top            = n_top,
      confLevel        = 0.80,
      print_top        = FALSE
    )
  }, error = function(e) {
    log_error("[{req$request_id}] GeoLiftMarketSelection failed: {e$message}")
    NULL
  })

  if (is.null(result)) {
    res$status <- 500
    return(list(error = "GeoLiftMarketSelection() failed. Check that there are sufficient geo units and pre-period observations."))
  }

  # ── Extract top control markets and candidate rankings ─────────────
  best_markets <- result$BestMarkets
  all_candidates <- result$AllCandidates  # data frame with market, RMSE, correlation, etc.

  # Normalise similarity scores to [0, 1] for the frontend
  if (!is.null(all_candidates) && nrow(all_candidates) > 0) {
    all_candidates$similarity_score <- 1 - (all_candidates$RMSE / max(all_candidates$RMSE, na.rm=TRUE))
    all_candidates <- all_candidates[order(-all_candidates$similarity_score), ]
  }

  # ── Generate pre-period fit chart ─────────────────────────────────
  chart_b64 <- tryCatch({
    # Aggregate treatment markets
    trt_agg  <- dt_pre[location %in% treatment, .(actual = sum(Y, na.rm=TRUE)), by = date]
    ctrl_agg <- dt_pre[location %in% best_markets, .(synthetic = sum(Y, na.rm=TRUE)), by = date]
    plot_dt  <- merge(trt_agg, ctrl_agg, by = "date")

    p <- ggplot(plot_dt, aes(x = date)) +
      geom_line(aes(y = actual,    colour = "Actual"),    linewidth = 1.2) +
      geom_line(aes(y = synthetic, colour = "Synthetic"), linewidth = 1, linetype = "dashed") +
      scale_colour_manual(values = c("Actual" = "#00c9a7", "Synthetic" = "#5a6a7e")) +
      labs(title = "Pre-period Fit: Treatment vs Synthetic Control",
           x = NULL, y = NULL, colour = NULL) +
      theme_minimal(base_size = 11) +
      theme(plot.background = element_rect(fill = "#0e1219", colour = NA),
            panel.background = element_rect(fill = "#080b10", colour = NA),
            text = element_text(colour = "#cfd8e3"),
            axis.text = element_text(colour = "#5a6a7e"),
            panel.grid = element_line(colour = "#1e2733"),
            legend.background = element_blank())

    tmp <- tempfile(fileext = ".png")
    ggsave(tmp, p, width = 8, height = 4, dpi = 120, bg = "#0e1219")
    base64enc::base64encode(tmp)
  }, error = function(e) {
    log_warn("[{req$request_id}] Chart generation failed: {e$message}")
    NULL
  })

  # ── Compute pre-period fit stats on the selected control pool ─────
  if (length(best_markets) > 0) {
    trt_ts  <- dt_pre[location %in% treatment,    .(Y = sum(Y, na.rm=TRUE)), by = date][order(date), Y]
    ctrl_ts <- dt_pre[location %in% best_markets, .(Y = sum(Y, na.rm=TRUE)), by = date][order(date), Y]
    rmse        <- sqrt(mean((trt_ts - ctrl_ts)^2, na.rm = TRUE))
    correlation <- cor(trt_ts, ctrl_ts, use = "complete.obs")
    mape        <- mean(abs(trt_ts - ctrl_ts) / trt_ts, na.rm = TRUE) * 100
    r2          <- 1 - sum((trt_ts - ctrl_ts)^2) / sum((trt_ts - mean(trt_ts))^2)
  } else {
    rmse <- correlation <- mape <- r2 <- NA
  }

  # ── Persist to Postgres ───────────────────────────────────────────
  selection_id <- uuid::UUIDgenerate()
  con          <- get_db()
  on.exit(DBI::dbDisconnect(con))

  DBI::dbExecute(con,
    "INSERT INTO market_selections
       (id, experiment_id, cell_id, treatment_markets, control_markets,
        rmse, correlation, candidates_json, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW())",
    list(
      selection_id, experiment_id,
      cell_id %||% NA_character_,
      paste(treatment,     collapse = ","),
      paste(best_markets,  collapse = ","),
      rmse, correlation,
      jsonlite::toJSON(all_candidates, auto_unbox = TRUE)
    )
  )

  log_info("[{req$request_id}] selection {selection_id} complete | R²={round(r2,3)} | RMSE={round(rmse,1)}")

  list(
    selection_id     = selection_id,
    control_markets  = best_markets,
    treatment_markets= treatment,
    fit_stats = list(
      rmse        = round(rmse, 4),
      correlation = round(correlation, 4),
      mape        = round(mape, 2),
      r2          = round(r2, 4)
    ),
    candidates       = if (!is.null(all_candidates)) lapply(
      split(all_candidates, seq_len(nrow(all_candidates))),
      function(r) as.list(r)
    ) else list(),
    pre_period_plot_b64 = chart_b64
  )
}
