# ── auth.R ────────────────────────────────────────────────────────
library(jose)
library(logger)

#' Verify a HS256 JWT and return claims, or NULL on failure.
verify_jwt <- function(token, secret) {
  tryCatch({
    # jose::jwt_decode_hmac returns a list of claims
    claims <- jose::jwt_decode_hmac(
      jwt    = token,
      secret = chartr("", "", as.character(secret))
    )

    # Manual expiry check (jose also checks, but be explicit)
    now <- as.integer(Sys.time())
    if (!is.null(claims$exp) && now > as.integer(claims$exp)) {
      log_warn("JWT expired at {as.POSIXct(claims$exp)}")
      return(NULL)
    }

    claims
  }, error = function(e) {
    log_warn("JWT verification failed: {conditionMessage(e)}")
    NULL
  })
}

#' Issue a short-lived access token (15 min by default).
issue_jwt <- function(user_id, org_id,
                      secret         = Sys.getenv("JWT_SECRET"),
                      expiry_seconds = 900L) {
  payload <- jose::jwt_claim(
    sub  = as.character(user_id),
    org  = as.character(org_id),
    iat  = as.integer(Sys.time()),
    exp  = as.integer(Sys.time()) + as.integer(expiry_seconds)
  )
  jose::jwt_encode_hmac(payload, secret = secret)
}
