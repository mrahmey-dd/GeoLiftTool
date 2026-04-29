local({

  # The version of renv to use when bootstrapping.
  # Update this when upgrading renv.
  version <- "1.0.3"

  # The project root — always the directory containing this file.
  project <- normalizePath(
    Sys.getenv("RENV_PROJECT", unset = dirname(sys.frame(1)$ofile %||% getwd())),
    winslash = "/",
    mustWork = FALSE
  )

  # ── Locate or install renv ────────────────────────────────────────
  lock_path  <- file.path(project, "renv.lock")
  lib_paths  <- c(
    file.path(project, "renv", "library", paste0("R-", getRversion()[, 1:2]), .Platform$r_arch),
    file.path(project, "renv", "library", paste0("R-", getRversion()[, 1:2]))
  )
  lib_path   <- lib_paths[1]

  # Check if renv is already available in the project library
  renv_available <- tryCatch({
    renv_lib <- file.path(lib_path, "renv")
    file.exists(file.path(renv_lib, "DESCRIPTION"))
  }, error = function(e) FALSE)

  if (!renv_available) {
    # Bootstrap: download and install renv into the project library
    message("renv ", version, " not found — bootstrapping...")

    dir.create(lib_path, recursive = TRUE, showWarnings = FALSE)

    url <- paste0(
      "https://cloud.r-project.org/src/contrib/renv_", version, ".tar.gz"
    )

    destfile <- tempfile(fileext = ".tar.gz")
    download.file(url, destfile = destfile, quiet = TRUE)

    install.packages(
      destfile,
      lib    = lib_path,
      repos  = NULL,
      type   = "source",
      quiet  = TRUE
    )

    unlink(destfile)
    message("renv ", version, " bootstrapped successfully.")
  }

  # ── Load renv from the project library ───────────────────────────
  .libPaths(c(lib_path, .libPaths()))
  library(renv, lib.loc = lib_path)

  # ── Activate the project ──────────────────────────────────────────
  renv::activate(project = project)
})
