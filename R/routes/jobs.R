library(plumber)
library(logger)

# ══════════════════════════════════════════════════════════════════
#  GET /v1/jobs/:id
#  Poll a background job's status, progress, and result.
#  Frontend polls this every 3 seconds after submitting an async job.
#
#  Response shape:
#   { job_id, status, progress (0-100), message, result, error }
#
#  status values:
#   "queued"   — in Redis queue, not yet picked up
#   "running"  — worker is executing
#   "complete" — done; result contains the payload
#   "failed"   — error contains the failure reason
# ══════════════════════════════════════════════════════════════════

#* Poll background job state
#* @tag jobs
#* @param id:string  Job UUID
#* @get /<id>
#* @serializer json
function(req, res, id) {
  state <- get_job_state(id)

  if (is.null(state)) {
    # Fall back to Postgres audit log (Redis TTL may have expired)
    con <- get_db()
    on.exit(DBI::dbDisconnect(con))
    db_row <- DBI::dbGetQuery(con,
      "SELECT id AS job_id, status, 100 AS progress,
              result_json AS result, error_message AS error
       FROM jobs WHERE id = $1",
      list(id))

    if (nrow(db_row) == 0) return(http_not_found(res, "Job", id))

    row       <- as.list(db_row[1, ])
    row$result <- if (!is.na(row$result)) safe_from_json(row$result) else NULL
    return(row)
  }

  state
}

# ══════════════════════════════════════════════════════════════════
#  GET /v1/jobs  (admin / debugging)
# ══════════════════════════════════════════════════════════════════

#* List recent jobs for the authenticated org
#* @tag jobs
#* @param limit:int  Max results (default 20)
#* @get /
#* @serializer json
function(req, res, limit = 20L) {
  con <- get_db()
  on.exit(DBI::dbDisconnect(con))

  rows <- DBI::dbGetQuery(con,
    "SELECT j.id, j.job_type, j.status, j.progress,
            j.error_message, j.enqueued_at, j.completed_at,
            e.name AS experiment_name
     FROM jobs j
     LEFT JOIN experiments e ON e.id = j.experiment_id
     WHERE e.org_id = $1
     ORDER BY j.enqueued_at DESC
     LIMIT $2",
    list(req$org_id, as.integer(limit)))

  list(
    jobs         = lapply(split(rows, seq_len(nrow(rows))), as.list),
    queue_depth  = queue_depth()
  )
}
