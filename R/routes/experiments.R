library(plumber)
library(jsonlite)
library(uuid)
library(logger)

# ══════════════════════════════════════════════════════════════════
#  GET /v1/experiments
#  List all experiments for the authenticated org.
# ══════════════════════════════════════════════════════════════════

#* List experiments
#* @tag experiments
#* @param status:string   Filter by status (draft|active|complete|archived)
#* @param type:string     Filter by test_type (single|multi)
#* @param limit:int       Page size (default 50)
#* @param offset:int      Pagination offset (default 0)
#* @get /
#* @serializer json
function(req, res, status = NULL, type = NULL, limit = 50L, offset = 0L) {
  con <- get_db()
  on.exit(DBI::dbDisconnect(con))

  # Build WHERE clause dynamically
  where   <- "WHERE e.org_id = $1"
  params  <- list(req$org_id)

  if (!is.null(status) && nchar(status)) {
    params  <- c(params, list(status))
    where   <- paste(where, sprintf("AND e.status = $%d", length(params)))
  }
  if (!is.null(type) && nchar(type)) {
    params  <- c(params, list(type))
    where   <- paste(where, sprintf("AND e.test_type = $%d", length(params)))
  }

  params  <- c(params, list(as.integer(limit), as.integer(offset)))
  n       <- length(params)

  sql <- sprintf(
    "SELECT
       e.*,
       (SELECT COALESCE(json_agg(
         json_build_object(
           'id',c.id,'label',c.label,'channel',c.channel,
           'spend',c.spend,'color',c.color
         ) ORDER BY c.created_at
       ), '[]'::json)
        FROM experiment_cells c WHERE c.experiment_id = e.id) AS cells,
       (SELECT row_to_json(r.*) FROM experiment_results r
        WHERE r.experiment_id = e.id ORDER BY r.created_at DESC LIMIT 1) AS latest_result
     FROM experiments e
     %s
     ORDER BY e.updated_at DESC
     LIMIT $%d OFFSET $%d",
    where, n - 1L, n
  )

  rows <- DBI::dbGetQuery(con, sql, params)

  # Parse nested JSON columns
  rows$cells <- lapply(rows$cells, function(x) {
    if (is.na(x) || !nchar(x)) return(list())
    safe_from_json(x)
  })
  rows$latest_result <- lapply(rows$latest_result, function(x) {
    if (is.na(x) || !nchar(x)) return(NULL)
    safe_from_json(x)
  })

  list(
    experiments = lapply(split(rows, seq_len(nrow(rows))), as.list),
    total       = nrow(rows),
    limit       = as.integer(limit),
    offset      = as.integer(offset)
  )
}

# ══════════════════════════════════════════════════════════════════
#  GET /v1/experiments/:id
#  Full experiment detail — config + all resource chain records.
# ══════════════════════════════════════════════════════════════════

#* Get experiment by ID
#* @tag experiments
#* @param id:string  Experiment UUID
#* @get /<id>
#* @serializer json
function(req, res, id) {
  con <- get_db()
  on.exit(DBI::dbDisconnect(con))

  exp <- DBI::dbGetQuery(con,
    "SELECT * FROM experiments WHERE id=$1 AND org_id=$2",
    list(id, req$org_id))

  if (nrow(exp) == 0) return(http_not_found(res, "Experiment", id))

  cells <- DBI::dbGetQuery(con,
    "SELECT * FROM experiment_cells WHERE experiment_id=$1 ORDER BY created_at", list(id))

  dataset <- DBI::dbGetQuery(con,
    "SELECT id, n_geos, n_periods, date_start, date_end, kpi_col,
            covariate_cols, bp_checks_json, uploaded_at
     FROM experiment_datasets WHERE experiment_id=$1
     ORDER BY uploaded_at DESC LIMIT 1", list(id))

  selection <- DBI::dbGetQuery(con,
    "SELECT id, treatment_markets, control_markets,
            rmse, correlation, mape, r2, candidates_json, created_at
     FROM market_selections WHERE experiment_id=$1
     ORDER BY created_at DESC LIMIT 1", list(id))

  power <- DBI::dbGetQuery(con,
    "SELECT id, target_confidence, mde, recommended_duration,
            power_matrix_json, n_simulations, created_at
     FROM power_analyses WHERE experiment_id=$1
     ORDER BY created_at DESC LIMIT 1", list(id))

  result <- DBI::dbGetQuery(con,
    "SELECT id, att, att_total, lift_pct, lift_ci_low, lift_ci_high,
            p_value, iroas, pre_period_r2, pre_period_mape,
            counterfactual_json, market_breakdown_json, created_at
     FROM experiment_results WHERE experiment_id=$1
     ORDER BY created_at DESC LIMIT 1", list(id))

  list(
    experiment = as.list(exp[1, ]),
    cells      = lapply(split(cells, seq_len(nrow(cells))), as.list),
    dataset    = if (nrow(dataset)   > 0) as.list(dataset[1, ])   else NULL,
    selection  = if (nrow(selection) > 0) as.list(selection[1, ]) else NULL,
    power      = if (nrow(power)     > 0) as.list(power[1, ])     else NULL,
    results    = if (nrow(result)    > 0) as.list(result[1, ])    else NULL,
    status     = exp$status[1]
  )
}

# ══════════════════════════════════════════════════════════════════
#  POST /v1/experiments  — create
# ══════════════════════════════════════════════════════════════════

#* Create a new experiment
#* @tag experiments
#* @post /
#* @serializer json
function(req, res) {
  b <- req$body
  required <- c("name","kpi","test_type","geo_level","data_granularity","pre_start","test_start","test_end")
  missing  <- setdiff(required, names(b))
  if (length(missing)) {
    res$status <- 400L
    return(list(error="Missing required fields", missing=missing))
  }

  con   <- get_db()
  on.exit(DBI::dbDisconnect(con))
  exp_id <- uuid::UUIDgenerate()

  DBI::dbExecute(con,
    "INSERT INTO experiments
       (id, org_id, name, kpi, test_type, geo_level, data_granularity,
        pre_start, test_start, test_end, channel, spend,
        target_effect, confidence, notes, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'draft',NOW(),NOW())",
    list(exp_id, req$org_id,
         b$name, b$kpi, b$test_type, b$geo_level, b$data_granularity,
         b$pre_start, b$test_start, b$test_end,
         b$channel   %||% NA_character_,
         b$spend     %||% NA_real_,
         b$target_effect %||% 5,
         b$confidence    %||% 0.80,
         b$notes     %||% NA_character_))

  # Insert cells
  cells <- b$cells %||% list(list(label="Treatment", channel=b$channel%||%"Meta", spend=b$spend, color="#00c9a7"))
  if (!is.data.frame(cells)) cells <- as.data.frame(do.call(rbind, lapply(cells, as.data.frame)))

  for (i in seq_len(nrow(cells))) {
    cell <- cells[i, ]
    DBI::dbExecute(con,
      "INSERT INTO experiment_cells (experiment_id, label, channel, spend, objective, color)
       VALUES ($1,$2,$3,$4,$5,$6)",
      list(exp_id,
           as.character(cell$label   %||% paste0("Cell ", i)),
           as.character(cell$channel %||% "Meta"),
           as.numeric(cell$spend     %||% NA),
           as.character(cell$objective %||% NA),
           as.character(cell$color   %||% "#00c9a7")))
  }

  log_info("Created experiment {exp_id} | org={req$org_id} | name={b$name}")
  res$status <- 201L
  list(experiment_id = exp_id, status = "draft")
}

# ══════════════════════════════════════════════════════════════════
#  PATCH /v1/experiments/:id  — partial update
# ══════════════════════════════════════════════════════════════════

#* Update experiment fields
#* @tag experiments
#* @param id:string  Experiment UUID
#* @patch /<id>
#* @serializer json
function(req, res, id) {
  con <- get_db()
  on.exit(DBI::dbDisconnect(con))

  # Verify ownership
  exists <- DBI::dbGetQuery(con,
    "SELECT id FROM experiments WHERE id=$1 AND org_id=$2", list(id, req$org_id))
  if (nrow(exists) == 0) return(http_not_found(res, "Experiment", id))

  allowed <- c("name","kpi","status","notes","dataset_id","selection_id",
                "power_id","result_id","bp_score","spend","target_effect","confidence")
  updates <- req$body[names(req$body) %in% allowed]

  if (length(updates) == 0) {
    res$status <- 400L
    return(list(error="No updatable fields provided", allowed=allowed))
  }

  params  <- c(list(id), unname(updates))
  clauses <- paste(
    sapply(seq_along(updates), function(i)
      sprintf("%s = $%d", names(updates)[i], i + 1L)),
    collapse = ", "
  )
  DBI::dbExecute(con,
    sprintf("UPDATE experiments SET %s, updated_at=NOW() WHERE id=$1", clauses),
    params)

  list(success = TRUE, experiment_id = id, updated = names(updates))
}
