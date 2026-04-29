library(plumber)
library(GeoLift)
library(data.table)
library(uuid)
library(logger)
library(jsonlite)
library(ggplot2)
library(base64enc)

# ═══════════════════════════════════════════════════════════════════
#  POST /v1/measurement/run
#  Single-cell GeoLift post-campaign analysis.
#  Fits synthetic control on pre-period, computes ATT, lift %, CI,
#  p-value, iROAS, counterfactual time series, and geo breakdown.
# ═══════════════════════════════════════════════════════════════════

#* Run GeoLift() post-campaign incrementality analysis (single-cell)
#* @tag measurement
#* @param experiment_id:string      Parent experiment UUID
#* @param dataset_id:string         Full dataset UUID (pre + test periods)
#* @param selection_id:string       Market selection UUID
#* @param treatment_markets:string  Comma-separated treatment market names
#* @param control_markets:string    Comma-separated control market names
#* @param test_start:string         ISO date — test period start
#* @param test_end:string           ISO date — test period end
#* @param spend:number              Total campaign spend (for iROAS calculation)
#* @param confidence:number         Confidence level 0–1 (default: 0.90)
#* @param model:string              "GeoLift" or "Augmented Synthetic Control"
#* @serializer json
#* @post /run
function(req, res,
         experiment_id,
         dataset_id,
         selection_id,
         treatment_markets,
         control_markets,
         test_start,
         test_end,
         spend      = NULL,
         confidence = 0.90,
         model      = "GeoLift") {

  log_info("[{req$request_id}] measurement/run | exp={experiment_id}")

  treatment <- trimws(strsplit(treatment_markets, ",")[[1]])
  control   <- trimws(strsplit(control_markets,   ",")[[1]])
  conf      <- min(max(as.numeric(confidence), 0.5), 0.99)

  # ── Load + filter dataset ─────────────────────────────────────────
  dt      <- load_dataset(dataset_id)
  all_mkt <- c(treatment, control)
  dt      <- dt[location %in% all_mkt]

  dates        <- sort(unique(dt$date))
  d_test_start <- as.Date(test_start)
  d_test_end   <- as.Date(test_end)

  # Convert dates to integer time index
  dt[, time := as.integer(factor(date, levels = dates))]
  test_start_i <- min(dt[date == d_test_start, time])
  test_end_i   <- max(dt[date == d_test_end,   time])

  if (is.na(test_start_i) || is.na(test_end_i)) {
    res$status <- 422
    return(list(error = "test_start or test_end not found in dataset dates. Ensure post-campaign data is included."))
  }

  gl_data <- as.data.frame(dt[, .(location, time, Y)])

  # ── Run GeoLift ───────────────────────────────────────────────────
  result <- tryCatch(
    GeoLift::GeoLift(
      Y_id                 = "Y",
      location_id          = "location",
      time_id              = "time",
      data                 = gl_data,
      locations            = treatment,
      treatment_start_time = test_start_i,
      treatment_end_time   = test_end_i,
      GeoLiftModel         = model,
      confLevel            = conf,
      print                = FALSE
    ),
    error = function(e) {
      log_error("[{req$request_id}] GeoLift() failed: {e$message}")
      NULL
    }
  )

  if (is.null(result)) {
    res$status <- 500
    return(list(error = "GeoLift() failed. Common causes: insufficient pre-period, poor synthetic control fit, or data imbalance."))
  }

  # ── Extract core metrics ──────────────────────────────────────────
  att_total  <- result$incremental       # total incremental KPI over test window
  baseline   <- result$baseline          # total counterfactual KPI
  att_daily  <- result$ATT               # average daily incremental KPI
  lift_pct   <- att_total / baseline * 100
  p_value    <- result$p_val
  r2         <- result$R2
  mape       <- result$MAPE
  bias       <- result$Bias
  ci_low_pct <- result$lower_bound * 100
  ci_high_pct<- result$upper_bound * 100

  iroas <- if (!is.null(spend) && !is.na(as.numeric(spend)) && as.numeric(spend) > 0)
             att_total / as.numeric(spend) else NA

  # ── Build counterfactual time series ──────────────────────────────
  # result$data contains the fitted values; extract and label
  cf_raw <- result$data  # data frame with time, Y_actual, Y_hat, etc.

  cf_ts <- tryCatch({
    trt_ts  <- dt[location %in% treatment, .(actual = sum(Y, na.rm=TRUE)), by=.(time, date)]
    cf_df   <- merge(trt_ts, as.data.table(cf_raw)[, .(time, synthetic=Y_hat)], by="time", all.x=TRUE)
    cf_df[, `:=`(
      is_test = time >= test_start_i,
      lift    = ifelse(time >= test_start_i, actual - synthetic, NA_real_),
      ci_low  = ifelse(time >= test_start_i, synthetic * (1 + ci_low_pct/100),  NA_real_),
      ci_high = ifelse(time >= test_start_i, synthetic * (1 + ci_high_pct/100), NA_real_)
    )]
    lapply(split(cf_df, seq_len(nrow(cf_df))), function(r) list(
      date      = as.character(r$date),
      actual    = round(r$actual),
      synthetic = round(r$synthetic),
      ci_low    = round(r$ci_low),
      ci_high   = round(r$ci_high),
      lift      = round(r$lift),
      is_test   = r$is_test
    ))
  }, error = function(e) {
    log_warn("[{req$request_id}] Counterfactual TS construction failed: {e$message}")
    list()
  })

  # ── Geo-level breakdown ───────────────────────────────────────────
  geo_breakdown <- tryCatch({
    test_dt  <- dt[date >= d_test_start & date <= d_test_end]
    pre_dt   <- dt[date <  d_test_start]

    # Per-geo actual totals in test period
    geo_test <- test_dt[location %in% treatment, .(actual = sum(Y, na.rm=TRUE)), by=location]

    # Approximate synthetic per geo using donor weights
    weights  <- result$weights  # named vector: market → weight
    geo_synth <- if (!is.null(weights)) {
      lapply(treatment, function(trt_mkt) {
        ctrl_total <- sum(sapply(names(weights), function(ctrl_mkt) {
          ctrl_test <- sum(test_dt[location == ctrl_mkt, Y], na.rm=TRUE)
          ctrl_test * weights[[ctrl_mkt]]
        }))
        list(location=trt_mkt, synthetic=ctrl_total)
      })
    } else list()

    geo_test[, synthetic := sapply(location, function(loc) {
      match_row <- Filter(function(x) x$location==loc, geo_synth)
      if (length(match_row)) match_row[[1]]$synthetic else NA_real_
    })]

    geo_test[, `:=`(
      lift_abs = actual - synthetic,
      lift_pct = (actual - synthetic) / synthetic * 100
    )]

    lapply(split(geo_test, seq_len(nrow(geo_test))), function(r) list(
      location   = r$location,
      actual     = round(r$actual),
      synthetic  = round(r$synthetic),
      lift_abs   = round(r$lift_abs),
      lift_pct   = round(r$lift_pct, 2)
    ))
  }, error = function(e) list())

  # ── Persist result to Postgres ────────────────────────────────────
  result_id <- uuid::UUIDgenerate()
  con       <- get_db()
  on.exit(DBI::dbDisconnect(con))

  DBI::dbExecute(con,
    "INSERT INTO experiment_results
       (id, experiment_id, att, att_total, lift_pct, lift_ci_low, lift_ci_high,
        p_value, iroas, pre_period_r2, pre_period_mape, pre_period_bias,
        counterfactual_json, market_breakdown_json, weights_json, model_version, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16,NOW())",
    list(
      result_id, experiment_id,
      att_daily, att_total, lift_pct, ci_low_pct, ci_high_pct,
      p_value, iroas, r2, mape, bias,
      jsonlite::toJSON(cf_ts,        auto_unbox=TRUE),
      jsonlite::toJSON(geo_breakdown,auto_unbox=TRUE),
      jsonlite::toJSON(as.list(result$weights %||% list()), auto_unbox=TRUE),
      model
    )
  )

  # Update experiment status → complete
  DBI::dbExecute(con,
    "UPDATE experiments SET status='complete', updated_at=NOW() WHERE id=$1",
    list(experiment_id)
  )

  log_info("[{req$request_id}] result {result_id} | lift={round(lift_pct,2)}% | iROAS={round(iroas,2)} | p={p_value}")

  list(
    result_id           = result_id,
    att                 = round(att_daily, 2),
    att_total           = round(att_total, 0),
    lift_pct            = round(lift_pct, 2),
    lift_ci_low         = round(ci_low_pct, 2),
    lift_ci_high        = round(ci_high_pct, 2),
    p_value             = round(p_value, 4),
    iROAS               = if (!is.na(iroas)) round(iroas, 3) else NULL,
    pre_period_r2       = round(r2, 4),
    pre_period_mape     = round(mape, 2),
    pre_period_bias     = round(bias, 2),
    counterfactual_ts   = cf_ts,
    market_breakdown    = geo_breakdown,
    weights             = as.list(result$weights %||% list())
  )
}


# ═══════════════════════════════════════════════════════════════════
#  POST /v1/measurement/run-multicell
#  Runs independent GeoLift() per treatment cell against shared
#  control pool, then produces a cross-cell comparison table.
# ═══════════════════════════════════════════════════════════════════

#* Run multi-cell GeoLift analysis
#* @tag measurement
#* @param experiment_id:string  Parent experiment UUID
#* @param dataset_id:string     Full dataset UUID
#* @param cells:string          JSON array of { cell_id, label, treatment_markets, spend }
#* @param control_markets:string Shared control pool (comma-separated)
#* @param test_start:string      ISO date
#* @param test_end:string        ISO date
#* @param confidence:number      Confidence level (default: 0.90)
#* @serializer json
#* @post /run-multicell
function(req, res,
         experiment_id,
         dataset_id,
         cells,
         control_markets,
         test_start,
         test_end,
         confidence = 0.90) {

  log_info("[{req$request_id}] measurement/run-multicell | exp={experiment_id}")

  cells_parsed <- tryCatch(jsonlite::fromJSON(cells), error=function(e) NULL)
  if (is.null(cells_parsed)) {
    res$status <- 400
    return(list(error = "cells must be a JSON array of { cell_id, label, treatment_markets, spend }"))
  }
  if (!is.data.frame(cells_parsed)) cells_parsed <- as.data.frame(cells_parsed)

  control <- trimws(strsplit(control_markets, ",")[[1]])

  # ── Run GeoLift per cell ──────────────────────────────────────────
  cell_results <- lapply(seq_len(nrow(cells_parsed)), function(i) {
    cell <- cells_parsed[i, ]
    log_info("[{req$request_id}] Multi-cell: running cell {cell$label}")

    tryCatch({
      # Inline call to single-cell logic (reuse the run_geolift helper)
      run_single_cell(
        dataset_id        = dataset_id,
        treatment_markets = trimws(strsplit(as.character(cell$treatment_markets), ",")[[1]]),
        control_markets   = control,
        test_start        = test_start,
        test_end          = test_end,
        spend             = cell$spend,
        confidence        = confidence
      ) |> c(list(cell_id = cell$cell_id, label = cell$label))
    }, error = function(e) {
      log_error("[{req$request_id}] Cell {cell$label} failed: {e$message}")
      list(cell_id=cell$cell_id, label=cell$label, error=e$message)
    })
  })

  # ── Build comparison table ────────────────────────────────────────
  comparison <- lapply(cell_results, function(r) {
    if (!is.null(r$error)) return(list(cell_id=r$cell_id, label=r$label, error=r$error))
    list(
      cell_id    = r$cell_id,
      label      = r$label,
      lift_pct   = r$lift_pct,
      iroas      = r$iROAS,
      att_total  = r$att_total,
      p_value    = r$p_value,
      r2         = r$pre_period_r2,
      mape       = r$pre_period_mape
    )
  })

  # Identify best-performing cell by iROAS
  iroas_vals  <- sapply(comparison, function(c) c$iroas %||% 0)
  optimal_idx <- which.max(iroas_vals)
  optimal_id  <- if (length(optimal_idx)) comparison[[optimal_idx]]$cell_id else NA

  # ── Persist multicell result ──────────────────────────────────────
  multicell_result_id <- uuid::UUIDgenerate()
  con <- get_db()
  on.exit(DBI::dbDisconnect(con))

  DBI::dbExecute(con,
    "INSERT INTO multicell_results
       (id, experiment_id, cells_json, comparison_json, optimal_cell_id, created_at)
     VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,NOW())",
    list(
      multicell_result_id, experiment_id,
      jsonlite::toJSON(cell_results, auto_unbox=TRUE),
      jsonlite::toJSON(comparison,   auto_unbox=TRUE),
      optimal_id
    )
  )

  DBI::dbExecute(con,
    "UPDATE experiments SET status='complete', updated_at=NOW() WHERE id=$1",
    list(experiment_id)
  )

  log_info("[{req$request_id}] multicell {multicell_result_id} complete | optimal={optimal_id}")

  list(
    multicell_result_id = multicell_result_id,
    cells               = cell_results,
    comparison_table    = comparison,
    optimal_cell        = optimal_id
  )
}


# ── Internal helper: run a single GeoLift analysis and return list ─
run_single_cell <- function(dataset_id, treatment_markets, control_markets,
                             test_start, test_end, spend=NULL, confidence=0.90) {
  dt       <- load_dataset(dataset_id)
  all_mkt  <- c(treatment_markets, control_markets)
  dt       <- dt[location %in% all_mkt]
  dates    <- sort(unique(dt$date))
  dt[, time := as.integer(factor(date, levels=dates))]

  test_start_i <- min(dt[date == as.Date(test_start), time])
  test_end_i   <- max(dt[date == as.Date(test_end),   time])

  gl_data <- as.data.frame(dt[, .(location, time, Y)])

  result <- GeoLift::GeoLift(
    Y_id="Y", location_id="location", time_id="time",
    data=gl_data, locations=treatment_markets,
    treatment_start_time=test_start_i, treatment_end_time=test_end_i,
    GeoLiftModel="GeoLift", confLevel=confidence, print=FALSE
  )

  att_total <- result$incremental
  lift_pct  <- att_total / result$baseline * 100
  iroas     <- if (!is.null(spend) && as.numeric(spend)>0) att_total/as.numeric(spend) else NA

  list(
    att         = round(result$ATT, 2),
    att_total   = round(att_total, 0),
    lift_pct    = round(lift_pct, 2),
    lift_ci_low = round(result$lower_bound*100, 2),
    lift_ci_high= round(result$upper_bound*100, 2),
    p_value     = round(result$p_val, 4),
    iROAS       = if (!is.na(iroas)) round(iroas, 3) else NULL,
    pre_period_r2   = round(result$R2,   4),
    pre_period_mape = round(result$MAPE, 2),
    weights     = as.list(result$weights %||% list())
  )
}
