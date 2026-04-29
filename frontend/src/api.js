/**
 * GeoLift API Client
 *
 * Single module for all backend communication. Every method:
 *  - reads BASE_URL from Vite env (falls back to localhost:8000)
 *  - attaches the JWT from localStorage
 *  - throws ApiError on non-2xx responses
 *  - returns parsed JSON
 *
 * Import in components:  import api from '@/api'
 */

const BASE_URL = import.meta.env?.VITE_API_URL ?? "http://localhost:8000";

// ── Auth token storage ────────────────────────────────────────────
export const auth = {
  getToken:    ()      => localStorage.getItem("geolift_token") ?? "",
  setToken:    (token) => localStorage.setItem("geolift_token", token),
  clearToken:  ()      => localStorage.removeItem("geolift_token"),
};

// ── Error class ───────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error ?? `HTTP ${status}`);
    this.status  = status;
    this.body    = body;
  }
}

// ── Core fetch wrapper ────────────────────────────────────────────
async function request(method, path, { body, params, multipart } = {}) {
  const url = new URL(`${BASE_URL}/v1${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));

  const headers = { Authorization: `Bearer ${auth.getToken()}` };

  let bodyPayload;
  if (multipart) {
    // FormData — don't set Content-Type, browser sets boundary automatically
    bodyPayload = multipart;
  } else if (body) {
    headers["Content-Type"] = "application/json";
    bodyPayload = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), { method, headers, body: bodyPayload });

  let json;
  try   { json = await res.json(); }
  catch { json = {}; }

  if (!res.ok) throw new ApiError(res.status, json);
  return json;
}

const get    = (path, opts)  => request("GET",    path, opts);
const post   = (path, opts)  => request("POST",   path, opts);
const patch  = (path, opts)  => request("PATCH",  path, opts);
const del    = (path, opts)  => request("DELETE", path, opts);

// ── Auth ──────────────────────────────────────────────────────────
export const authApi = {
  login: ({ email, password }) =>
    post("/auth/login", { body: { email, password } }),

  refresh: (refreshToken) =>
    post("/auth/refresh", { body: { refresh_token: refreshToken } }),

  logout: () =>
    post("/auth/logout"),
};

// ── Health ────────────────────────────────────────────────────────
export const health = {
  /** GET /v1/health */
  check: () => get("/health"),
};

// ── Experiments ───────────────────────────────────────────────────
export const experiments = {
  /** List experiments with optional status/type filter */
  list: ({ status, type, limit = 50, offset = 0 } = {}) =>
    get("/experiments", { params: { status, type, limit, offset } }),

  /** Full experiment detail — config + resource chain */
  get: (id) => get(`/experiments/${id}`),

  /** Create a new draft experiment */
  create: (payload) => post("/experiments", { body: payload }),

  /** Partial update — pass only fields to change */
  update: (id, delta) => patch(`/experiments/${id}`, { body: delta }),
};

// ── Data ──────────────────────────────────────────────────────────
export const data = {
  /**
   * Upload a CSV panel file.
   * @param {File}   file          - The CSV File object from an input element
   * @param {string} experimentId  - Parent experiment UUID
   * @param {object} [opts]        - Optional column name overrides
   */
  upload: (file, experimentId, { dateCol = "date", locationCol = "location", kpiCol = "Y" } = {}) => {
    const fd = new FormData();
    fd.append("file",          file);
    fd.append("experiment_id", experimentId);
    fd.append("date_col",      dateCol);
    fd.append("location_col",  locationCol);
    fd.append("kpi_col",       kpiCol);
    return post("/data/upload", { multipart: fd });
  },

  /**
   * Run all 14 best-practice checks on an uploaded dataset.
   */
  validate: ({ datasetId, testStart, testEnd, preStart, dataGranularity = "daily" }) =>
    post("/data/validate", {
      body: {
        dataset_id:       datasetId,
        test_start:       testStart,
        test_end:         testEnd,
        pre_start:        preStart,
        data_granularity: dataGranularity,
      },
    }),
};

// ── Markets ───────────────────────────────────────────────────────
export const markets = {
  /**
   * Run GeoLiftMarketSelection().
   * Returns selection_id, control_markets, fit_stats, candidates.
   */
  select: ({
    datasetId,
    experimentId,
    treatmentMarkets,   // string[] or comma-separated string
    prePeriodEnd,
    matchingVars,
    nControlMarkets,
    excludeMarkets,
    cellId,
  }) =>
    post("/markets/select", {
      body: {
        dataset_id:        datasetId,
        experiment_id:     experimentId,
        treatment_markets: Array.isArray(treatmentMarkets)
          ? treatmentMarkets.join(",") : treatmentMarkets,
        pre_period_end:    prePeriodEnd,
        matching_vars:     matchingVars,
        n_control_markets: nControlMarkets,
        exclude_markets:   Array.isArray(excludeMarkets)
          ? excludeMarkets.join(",") : excludeMarkets,
        cell_id:           cellId,
      },
    }),
};

// ── Power ─────────────────────────────────────────────────────────
export const power = {
  /**
   * Submit a GeoLiftPower() simulation job (async).
   * Returns { job_id, poll_url, estimated_seconds }
   */
  submitSimulation: ({
    selectionId,
    experimentId,
    effectSizes,        // number[]
    testDurations,      // number[]
    confidence = 0.80,
    nSimulations = 2000,
  }) =>
    post("/power/simulate", {
      body: {
        selection_id:    selectionId,
        experiment_id:   experimentId,
        effect_sizes:    Array.isArray(effectSizes)
          ? effectSizes.join(",")    : effectSizes,
        test_durations:  Array.isArray(testDurations)
          ? testDurations.join(",")  : testDurations,
        confidence,
        n_simulations:   nSimulations,
      },
    }),
};

// ── Jobs ──────────────────────────────────────────────────────────
export const jobs = {
  /** GET /v1/jobs/:id  — poll job state */
  poll: (jobId) => get(`/jobs/${jobId}`),

  /**
   * Poll a job on an interval until it reaches a terminal state.
   * Calls onProgress(state) on every tick, resolves with final state.
   *
   * @param {string}   jobId       - Job UUID
   * @param {function} onProgress  - Called on each poll response
   * @param {number}   intervalMs  - Poll interval (default 3000)
   * @param {number}   timeoutMs   - Max wait before rejecting (default 5 min)
   */
  pollUntilDone: (jobId, onProgress, intervalMs = 3000, timeoutMs = 300_000) =>
    new Promise((resolve, reject) => {
      const start = Date.now();

      const tick = async () => {
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`Job ${jobId} timed out after ${timeoutMs / 1000}s`));
        }

        let state;
        try   { state = await jobs.poll(jobId); }
        catch (e) {
          // Transient network error — keep polling
          console.warn("Poll error (will retry):", e.message);
          return setTimeout(tick, intervalMs);
        }

        onProgress(state);

        if (state.status === "complete") return resolve(state);
        if (state.status === "failed")   return reject(new Error(state.error ?? "Job failed"));

        setTimeout(tick, intervalMs);
      };

      tick();
    }),
};

// ── Measurement ───────────────────────────────────────────────────
export const measurement = {
  /** Run single-cell GeoLift() post-campaign analysis */
  run: ({
    experimentId,
    datasetId,
    selectionId,
    treatmentMarkets,
    controlMarkets,
    testStart,
    testEnd,
    spend,
    confidence = 0.90,
    model = "GeoLift",
  }) =>
    post("/measurement/run", {
      body: {
        experiment_id:     experimentId,
        dataset_id:        datasetId,
        selection_id:      selectionId,
        treatment_markets: Array.isArray(treatmentMarkets)
          ? treatmentMarkets.join(",") : treatmentMarkets,
        control_markets:   Array.isArray(controlMarkets)
          ? controlMarkets.join(",")   : controlMarkets,
        test_start:        testStart,
        test_end:          testEnd,
        spend,
        confidence,
        model,
      },
    }),

  /** Run multi-cell GeoLift() analysis */
  runMultiCell: ({
    experimentId,
    datasetId,
    cells,             // [{ cell_id, label, treatment_markets, spend }]
    controlMarkets,
    testStart,
    testEnd,
    confidence = 0.90,
  }) =>
    post("/measurement/run-multicell", {
      body: {
        experiment_id:   experimentId,
        dataset_id:      datasetId,
        cells:           JSON.stringify(cells),
        control_markets: Array.isArray(controlMarkets)
          ? controlMarkets.join(",") : controlMarkets,
        test_start:      testStart,
        test_end:        testEnd,
        confidence,
      },
    }),
};

// ── Export ────────────────────────────────────────────────────────
export const exports = {
  /**
   * Generate a PDF report for a complete experiment.
   * Returns { download_url, pdf_base64, file_size_bytes }
   */
  pdf: (experimentId) =>
    post(`/export/${experimentId}/pdf`),

  /**
   * Export counterfactual time series as CSV.
   * Returns { download_url, filename, rows, summary }
   */
  csv: (experimentId) =>
    post(`/export/${experimentId}/csv`),

  /**
   * Trigger a browser download from a presigned S3 URL.
   * Call this after .pdf() or .csv() resolves.
   */
  triggerDownload: (url, filename) => {
    const a = document.createElement("a");
    a.href     = url;
    a.download = filename || "geolift_export";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  },
};

// ── Default export ────────────────────────────────────────────────
const api = { authApi, health, experiments, data, markets, power, jobs, measurement, exports, auth };
export default api;
