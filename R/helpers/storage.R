library(paws.storage)
library(logger)

# ── S3 client factory ─────────────────────────────────────────────
# Uses paws.storage (AWS SDK for R). Works with MinIO via endpoint override.

.s3_client <- NULL

get_s3 <- function() {
  if (!is.null(.s3_client)) return(.s3_client)

  client <- paws.storage::s3(
    config = list(
      credentials = list(
        creds = list(
          access_key_id     = Sys.getenv("AWS_ACCESS_KEY_ID",     "minio"),
          secret_access_key = Sys.getenv("AWS_SECRET_ACCESS_KEY", "minio_dev")
        )
      ),
      endpoint = Sys.getenv("S3_ENDPOINT", "http://minio:9000"),
      region   = Sys.getenv("AWS_REGION",  "us-east-1"),
      # Path-style required for MinIO
      s3_force_path_style = TRUE
    )
  )

  # Cache for the process lifetime — S3 clients are thread-safe
  .s3_client <<- client
  client
}

BUCKET <- function() Sys.getenv("S3_BUCKET", "geolift-data")

# ── Ensure bucket exists (idempotent; call on startup) ────────────
ensure_bucket <- function() {
  s3 <- get_s3()
  tryCatch({
    s3$head_bucket(Bucket = BUCKET())
    log_debug("S3 bucket '{BUCKET()}' exists")
  }, error = function(e) {
    log_info("Creating S3 bucket '{BUCKET()}'")
    s3$create_bucket(Bucket = BUCKET())
  })
}

# ── Upload ────────────────────────────────────────────────────────
upload_to_s3 <- function(local_path, s3_key) {
  s3  <- get_s3()
  bkt <- BUCKET()

  raw_bytes <- readBin(local_path, what = "raw", n = file.info(local_path)$size)

  s3$put_object(
    Bucket      = bkt,
    Key         = s3_key,
    Body        = raw_bytes,
    ContentType = mime_type(local_path)
  )

  log_info("upload_to_s3: {local_path} → s3://{bkt}/{s3_key}")
  invisible(s3_key)
}

# ── Download ──────────────────────────────────────────────────────
download_from_s3 <- function(s3_key, local_path) {
  s3  <- get_s3()
  bkt <- BUCKET()

  obj <- s3$get_object(Bucket = bkt, Key = s3_key)
  writeBin(obj$Body, local_path)

  log_debug("download_from_s3: s3://{bkt}/{s3_key} → {local_path}")
  invisible(local_path)
}

# ── Delete ────────────────────────────────────────────────────────
delete_from_s3 <- function(s3_key) {
  s3  <- get_s3()
  s3$delete_object(Bucket = BUCKET(), Key = s3_key)
  log_info("delete_from_s3: {s3_key}")
  invisible(TRUE)
}

# ── Generate presigned download URL (for export links) ───────────
presign_url <- function(s3_key, expires_in = 3600L) {
  s3 <- get_s3()
  s3$generate_presigned_url(
    "get_object",
    Params  = list(Bucket = BUCKET(), Key = s3_key),
    ExpiresIn = expires_in
  )
}

# ── Helpers ───────────────────────────────────────────────────────
mime_type <- function(path) {
  ext <- tolower(tools::file_ext(path))
  switch(ext,
    parquet = "application/octet-stream",
    csv     = "text/csv",
    png     = "image/png",
    pdf     = "application/pdf",
    "application/octet-stream"
  )
}

# ── Dataset key convention ────────────────────────────────────────
dataset_key    <- function(id) paste0("datasets/",   id, "/data.parquet")
chart_key      <- function(id) paste0("charts/",     id, "/preperiod.png")
report_key     <- function(id) paste0("reports/",    id, "/report.pdf")
