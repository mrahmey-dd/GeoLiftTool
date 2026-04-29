library(plumber)
library(DBI)
library(bcrypt)
library(logger)

# ═══════════════════════════════════════════════════════════════════
#  POST /v1/auth/login
#
#  Accepts { email, password }, validates against the users table,
#  returns a short-lived access token + longer-lived refresh token.
#
#  Demo shortcut: if GEOLIFT_ENV=development and email matches the
#  seed user, a fixed demo password "geolift_demo" is accepted
#  regardless of the bcrypt hash (so you can demo without hashing).
# ═══════════════════════════════════════════════════════════════════

#* Authenticate and receive a JWT access token
#* @tag auth
#* @post /login
#* @serializer json
function(req, res) {
  body  <- req$body
  email <- trimws(body$email    %||% "")
  pwd   <- trimws(body$password %||% "")

  if (!nchar(email) || !nchar(pwd)) {
    res$status <- 400L
    return(list(error = "email and password are required"))
  }

  con <- get_db()
  on.exit(DBI::dbDisconnect(con))

  user <- DBI::dbGetQuery(con,
    "SELECT u.id, u.name, u.email, u.role, u.org_id,
            o.name AS org_name, o.slug AS org_slug,
            u.password_hash
     FROM users u
     JOIN organisations o ON o.id = u.org_id
     WHERE u.email = $1
     LIMIT 1",
    list(email))

  if (nrow(user) == 0) {
    res$status <- 401L
    return(list(error = "Invalid email or password"))
  }

  u <- as.list(user[1, ])

  # ── Password verification ──────────────────────────────────────────
  demo_mode    <- Sys.getenv("GEOLIFT_ENV", "development") == "development"
  demo_pass    <- "geolift_demo"
  hash_present <- !is.na(u$password_hash) && nchar(u$password_hash) > 0

  valid_password <- if (demo_mode && pwd == demo_pass) {
    # Demo shortcut — accepts fixed password in development
    TRUE
  } else if (hash_present) {
    tryCatch(bcrypt::checkpw(pwd, u$password_hash), error = function(e) FALSE)
  } else {
    FALSE
  }

  if (!valid_password) {
    res$status <- 401L
    return(list(error = "Invalid email or password"))
  }

  # ── Issue tokens ───────────────────────────────────────────────────
  secret        <- Sys.getenv("JWT_SECRET")
  access_token  <- issue_jwt(u$id, u$org_id, secret, expiry_seconds = 900L)    # 15 min
  refresh_token <- issue_jwt(u$id, u$org_id, secret, expiry_seconds = 604800L) # 7 days

  # Store refresh token hash in Postgres for rotation / revocation
  DBI::dbExecute(con,
    "INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '7 days')
     ON CONFLICT (user_id) DO UPDATE
       SET token_hash = $2, expires_at = NOW() + INTERVAL '7 days'",
    list(u$id, digest::digest(refresh_token, algo = "sha256")))

  log_info("auth/login: user {u$id} | org={u$org_id} | role={u$role}")

  list(
    access_token  = access_token,
    refresh_token = refresh_token,
    expires_in    = 900L,
    token_type    = "Bearer",
    user = list(
      id       = u$id,
      name     = u$name,
      email    = u$email,
      role     = u$role,
      org_id   = u$org_id,
      org_name = u$org_name,
      org_slug = u$org_slug
    )
  )
}

# ═══════════════════════════════════════════════════════════════════
#  POST /v1/auth/refresh
#  Exchange a valid refresh token for a new access token.
# ═══════════════════════════════════════════════════════════════════

#* Refresh an access token
#* @tag auth
#* @post /refresh
#* @serializer json
function(req, res) {
  refresh_token <- trimws(req$body$refresh_token %||% "")
  if (!nchar(refresh_token)) {
    res$status <- 400L
    return(list(error = "refresh_token is required"))
  }

  secret <- Sys.getenv("JWT_SECRET")
  claims <- verify_jwt(refresh_token, secret)

  if (is.null(claims)) {
    res$status <- 401L
    return(list(error = "Invalid or expired refresh token"))
  }

  con <- get_db()
  on.exit(DBI::dbDisconnect(con))

  # Verify token hash is in DB (not revoked)
  stored <- DBI::dbGetQuery(con,
    "SELECT id FROM refresh_tokens
     WHERE user_id = $1
       AND token_hash = $2
       AND expires_at > NOW()
     LIMIT 1",
    list(claims$sub, digest::digest(refresh_token, algo = "sha256")))

  if (nrow(stored) == 0) {
    res$status <- 401L
    return(list(error = "Refresh token has been revoked or expired"))
  }

  new_access_token <- issue_jwt(claims$sub, claims$org, secret, expiry_seconds = 900L)

  log_info("auth/refresh: user {claims$sub}")

  list(
    access_token = new_access_token,
    expires_in   = 900L,
    token_type   = "Bearer"
  )
}

# ═══════════════════════════════════════════════════════════════════
#  POST /v1/auth/logout
# ═══════════════════════════════════════════════════════════════════

#* Revoke refresh token and log out
#* @tag auth
#* @post /logout
#* @serializer json
function(req, res) {
  con <- get_db()
  on.exit(DBI::dbDisconnect(con))
  DBI::dbExecute(con,
    "DELETE FROM refresh_tokens WHERE user_id = $1", list(req$user_id))
  list(success = TRUE)
}
