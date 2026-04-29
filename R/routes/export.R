library(plumber)
library(rmarkdown)
library(ggplot2)
library(data.table)
library(jsonlite)
library(base64enc)
library(logger)

# ═══════════════════════════════════════════════════════════════════
#  POST /v1/experiments/:id/export/pdf
#
#  Generates a PDF summary report for a complete experiment using
#  rmarkdown::render() with a parameterised Rmd template.
#  Returns the PDF as a base64-encoded string and an S3 presigned URL.
# ═══════════════════════════════════════════════════════════════════

#* Generate PDF report for a complete experiment
#* @tag export
#* @param id:string  Experiment UUID
#* @post /<id>/pdf
#* @serializer json
function(req, res, id) {
  log_info("[{req$request_id}] export/pdf | exp={id}")

  con <- get_db()
  on.exit(DBI::dbDisconnect(con))

  # ── Load experiment + results ──────────────────────────────────────
  exp <- DBI::dbGetQuery(con,
    "SELECT e.*, row_to_json(r.*) AS result_json
     FROM experiments e
     LEFT JOIN experiment_results r ON r.experiment_id = e.id
     WHERE e.id = $1 AND e.org_id = $2",
    list(id, req$org_id))

  if (nrow(exp) == 0) return(http_not_found(res, "Experiment", id))

  if (exp$status != "complete") {
    res$status <- 422L
    return(list(error = "PDF export is only available for complete experiments."))
  }

  result <- if (!is.na(exp$result_json)) safe_from_json(exp$result_json) else NULL
  if (is.null(result)) {
    res$status <- 422L
    return(list(error = "No results found for this experiment. Run measurement first."))
  }

  cells <- DBI::dbGetQuery(con,
    "SELECT * FROM experiment_cells WHERE experiment_id = $1 ORDER BY created_at", list(id))

  # ── Build report parameters ────────────────────────────────────────
  report_params <- list(
    experiment_name   = exp$name,
    kpi               = exp$kpi,
    test_type         = exp$test_type,
    geo_level         = exp$geo_level,
    channel           = exp$channel %||% "Meta",
    test_start        = as.character(exp$test_start),
    test_end          = as.character(exp$test_end),
    spend             = exp$spend %||% 0,
    lift_pct          = result$lift_pct,
    lift_ci_low       = result$lift_ci_low,
    lift_ci_high      = result$lift_ci_high,
    att_total         = result$att_total,
    p_value           = result$p_value,
    iroas             = result$iroas,
    pre_period_r2     = result$pre_period_r2,
    pre_period_mape   = result$pre_period_mape,
    n_cells           = nrow(cells),
    generated_at      = format(Sys.time(), "%B %d, %Y at %H:%M UTC")
  )

  # ── Render Rmd template ────────────────────────────────────────────
  template_path <- "R/templates/experiment_report.Rmd"
  output_path   <- tempfile(fileext = ".pdf")

  pdf_path <- tryCatch(
    rmarkdown::render(
      input       = template_path,
      output_file = output_path,
      params      = report_params,
      envir       = new.env(parent = globalenv()),
      quiet       = TRUE
    ),
    error = function(e) {
      log_error("[{req$request_id}] rmarkdown::render failed: {e$message}")
      NULL
    }
  )

  if (is.null(pdf_path) || !file.exists(output_path)) {
    res$status <- 500L
    return(list(error = "PDF generation failed. Check that pandoc and LaTeX are installed in the container."))
  }

  # ── Upload to S3, generate presigned URL ──────────────────────────
  s3_key  <- report_key(id)
  upload_to_s3(output_path, s3_key)
  dl_url  <- presign_url(s3_key, expires_in = 3600L)

  # Inline base64 for small reports (< 5MB); link only for larger ones
  file_size <- file.info(output_path)$size
  pdf_b64   <- if (file_size < 5e6) base64enc::base64encode(output_path) else NULL

  unlink(output_path)
  log_info("[{req$request_id}] PDF exported | size={file_size}B | s3={s3_key}")

  list(
    experiment_id  = id,
    download_url   = dl_url,
    expires_in     = 3600L,
    file_size_bytes= file_size,
    pdf_base64     = pdf_b64    # NULL if > 5MB — use download_url instead
  )
}


# ═══════════════════════════════════════════════════════════════════
#  POST /v1/experiments/:id/export/csv
#
#  Returns the full counterfactual time series as a CSV download.
#  Includes: date, actual, synthetic, ci_low, ci_high, lift, lift_pct
# ═══════════════════════════════════════════════════════════════════

#* Export counterfactual time series as CSV
#* @tag export
#* @param id:string  Experiment UUID
#* @post /<id>/csv
#* @serializer json
function(req, res, id) {
  log_info("[{req$request_id}] export/csv | exp={id}")

  con <- get_db()
  on.exit(DBI::dbDisconnect(con))

  row <- DBI::dbGetQuery(con,
    "SELECT e.name, e.kpi, r.counterfactual_json, r.att_total,
            r.lift_pct, r.iroas, r.p_value
     FROM experiments e
     JOIN experiment_results r ON r.experiment_id = e.id
     WHERE e.id = $1 AND e.org_id = $2
     ORDER BY r.created_at DESC LIMIT 1",
    list(id, req$org_id))

  if (nrow(row) == 0) return(http_not_found(res, "Experiment or results", id))

  # Parse counterfactual JSONB
  cf_raw <- safe_from_json(row$counterfactual_json, list())
  if (length(cf_raw) == 0) {
    res$status <- 422L
    return(list(error = "No counterfactual time series found. Run measurement first."))
  }

  # Convert list-of-lists to data.table
  cf_dt <- rbindlist(lapply(cf_raw, function(r) {
    data.table(
      date      = r$date      %||% NA_character_,
      actual    = r$actual    %||% NA_real_,
      synthetic = r$synthetic %||% NA_real_,
      ci_low    = r$ci_low    %||% NA_real_,
      ci_high   = r$ci_high   %||% NA_real_,
      lift      = r$lift      %||% NA_real_,
      lift_pct  = if (!is.null(r$lift) && !is.null(r$synthetic) && r$synthetic > 0)
                    round(r$lift / r$synthetic * 100, 4) else NA_real_,
      is_test   = r$is_test   %||% FALSE
    )
  }), fill = TRUE)

  # Write to temp CSV
  tmp_csv <- tempfile(fileext = ".csv")
  on.exit(unlink(tmp_csv), add = TRUE)
  data.table::fwrite(cf_dt, tmp_csv)

  # Upload to S3
  csv_key <- paste0("exports/", id, "/counterfactual.csv")
  upload_to_s3(tmp_csv, csv_key)
  dl_url  <- presign_url(csv_key, expires_in = 3600L)

  log_info("[{req$request_id}] CSV exported | rows={nrow(cf_dt)} | s3={csv_key}")

  list(
    experiment_id  = id,
    filename       = paste0(gsub("[^a-zA-Z0-9_-]", "_", row$name), "_counterfactual.csv"),
    rows           = nrow(cf_dt),
    columns        = names(cf_dt),
    download_url   = dl_url,
    expires_in     = 3600L,
    summary        = list(
      experiment_name = row$name,
      kpi             = row$kpi,
      att_total       = row$att_total,
      lift_pct        = row$lift_pct,
      iroas           = row$iroas,
      p_value         = row$p_value
    )
  )
}
