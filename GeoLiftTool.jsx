import { useState, useEffect } from "react";

/* ─── DESIGN TOKENS ──────────────────────────────────────────────── */
const C = {
  bg:        "#080b10",
  surface:   "#0e1219",
  surfaceHi: "#141923",
  border:    "#1e2733",
  borderHi:  "#2a3545",
  text:      "#cfd8e3",
  muted:     "#5a6a7e",
  cyan:      "#00c9a7",
  cyanDim:   "#00c9a720",
  amber:     "#f5a623",
  amberDim:  "#f5a62320",
  red:       "#f04a5a",
  redDim:    "#f04a5a20",
  green:     "#3dd68c",
  greenDim:  "#3dd68c20",
  blue:      "#4e9eff",
  blueDim:   "#4e9eff15",
};

const font = {
  heading: "'Syne', sans-serif",
  mono:    "'DM Mono', monospace",
  body:    "'Inter', system-ui, sans-serif",
};

/* ─── BEST PRACTICES DATA ────────────────────────────────────────── */
const BEST_PRACTICES = [
  {
    id: "granularity",
    category: "Data",
    label: "Daily granularity",
    detail: "Daily data is strongly recommended over weekly. Weekly data requires 4–6 week minimums vs 15 days for daily.",
    severity: "recommended",
  },
  {
    id: "geo_granularity",
    category: "Data",
    label: "Highest available geo granularity",
    detail: "Use the finest geo level targetable in the platform (Zip Codes, Cities, DMAs). Finer = better synthetic control fits.",
    severity: "recommended",
  },
  {
    id: "pre_period_ratio",
    category: "Data",
    label: "Pre-period ≥ 4–5× test duration",
    detail: "Historical pre-campaign data must be at least 4–5× the planned test length and free of structural breaks.",
    severity: "required",
  },
  {
    id: "min_pre_periods",
    category: "Data",
    label: "Minimum 25 pre-treatment periods",
    detail: "GeoLift requires at least 25 pre-period observations for reliable synthetic control estimation.",
    severity: "required",
  },
  {
    id: "min_geos",
    category: "Data",
    label: "20+ geo units available",
    detail: "A minimum of 20 geographic units provides the donor pool needed for robust synthetic control.",
    severity: "required",
  },
  {
    id: "52_weeks",
    category: "Data",
    label: "52 weeks of historical data recommended",
    detail: "Full-year history captures seasonal variation and reduces the risk of omitted variable bias in the counterfactual.",
    severity: "recommended",
  },
  {
    id: "purchase_cycle",
    category: "Data",
    label: "Test covers ≥ 1 purchase cycle",
    detail: "The test window should span at least one full purchase cycle for the product category.",
    severity: "required",
  },
  {
    id: "min_duration",
    category: "Data",
    label: "Minimum test duration (15d daily / 4–6wk weekly)",
    detail: "Too short a window leaves insufficient post-period observations for reliable ATT estimation.",
    severity: "required",
  },
  {
    id: "no_missing",
    category: "Data",
    label: "No missing values for any geo/date combo",
    detail: "Every unit × timestamp combination must have a value for the KPI. Missingness breaks the balanced panel assumption.",
    severity: "required",
  },
  {
    id: "covariates",
    category: "Data",
    label: "Panel covariates (optional, improves fit)",
    detail: "Additional covariates like population, income, or distribution data improve pre-period model fit.",
    severity: "optional",
  },
  {
    id: "market_match",
    category: "Markets",
    label: "Match markets on outcome variable + category vars",
    detail: "Test and control geos must be matched on the exact KPI of interest plus category-specific variables (distribution, seasonality).",
    severity: "required",
  },
  {
    id: "local_media",
    category: "Media",
    label: "Account for local media efforts",
    detail: "Local TV, regional offline, OOH in test/control geos must be documented and held constant. Unbalanced local media biases results.",
    severity: "required",
  },
  {
    id: "national_media",
    category: "Media",
    label: "National media held constant during test",
    detail: "Significant changes in national TV, print, or digital during the test window make Facebook attribution impossible to isolate.",
    severity: "required",
  },
  {
    id: "structural_breaks",
    category: "Data",
    label: "Pre-period data free of structural breaks",
    detail: "Promotions, distribution changes, major campaigns, or macro shocks in the pre-period will corrupt the synthetic control baseline.",
    severity: "required",
  },
];

/* ─── CELL SCHEMA ────────────────────────────────────────────────── */
const defaultCell = (id, label) => ({
  id,
  label,
  geos: [],
  budget: "",
  channel: "Meta",
  objective: "",
  notes: "",
});

/* ─── STEP CONFIG ────────────────────────────────────────────────── */
const STEPS = [
  { id: 0, label: "Setup",      icon: "⬡" },
  { id: 1, label: "Data",       icon: "⬡" },
  { id: 2, label: "Markets",    icon: "⬡" },
  { id: 3, label: "Power",      icon: "⬡" },
  { id: 4, label: "Review",     icon: "⬡" },
];

/* ══════════════════════════════════════════════════════════════════ */
/*  MAIN APP                                                          */
/* ══════════════════════════════════════════════════════════════════ */
export default function GeoLiftTool() {
  const [step, setStep]   = useState(0);
  const [showBP, setShowBP] = useState(true);

  /* ── experiment state ── */
  const [exp, setExp] = useState({
    name:        "",
    kpi:         "Revenue",
    kpiCustom:   "",
    testType:    "single", // "single" | "multi"
    geoLevel:    "DMA",
    geoLevelCustom: "",
    dataGranularity: "daily",
    startDate:   "",
    endDate:     "",
    preStart:    "",
    preEnd:      "",
    cells:       [defaultCell("ctrl", "Control"), defaultCell("t1", "Treatment")],
    covariates:  false,
    covarNotes:  "",
    localMedia:  "none",
    localMediaNotes: "",
    nationalMediaStable: true,
    nationalMediaNotes: "",
    structuralBreaks: false,
    structuralBreaksNotes: "",
    targetEffect: "5",
    confidence:  "80",
    spend:       "",
    notes:       "",
  });

  const upd = (field, val) => setExp(prev => ({ ...prev, [field]: val }));

  /* ── computed best-practice statuses ── */
  const bpStatus = computeBPStatus(exp);

  const reqFailing = BEST_PRACTICES
    .filter(bp => bp.severity === "required" && bpStatus[bp.id] === "fail")
    .length;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: font.body, color: C.text, display: "flex", flexDirection: "column" }}>
      <GoogleFonts />
      <Header showBP={showBP} setShowBP={setShowBP} reqFailing={reqFailing} />

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* SIDEBAR */}
        <Sidebar step={step} setStep={setStep} exp={exp} />

        {/* MAIN CONTENT */}
        <main style={{ flex: 1, overflowY: "auto", padding: "32px 40px" }}>
          {step === 0 && <StepSetup exp={exp} upd={upd} />}
          {step === 1 && <StepData exp={exp} upd={upd} />}
          {step === 2 && <StepMarkets exp={exp} upd={upd} setExp={setExp} />}
          {step === 3 && <StepPower exp={exp} upd={upd} />}
          {step === 4 && <StepReview exp={exp} bpStatus={bpStatus} />}

          <NavButtons step={step} setStep={setStep} />
        </main>

        {/* BEST PRACTICES PANEL */}
        {showBP && <BPPanel bpStatus={bpStatus} />}
      </div>
    </div>
  );
}

/* ── bp logic ── */
function computeBPStatus(exp) {
  const s = {};
  const preStart = exp.preStart ? new Date(exp.preStart) : null;
  const preEnd   = exp.preEnd   ? new Date(exp.preEnd)   : null;
  const start    = exp.startDate ? new Date(exp.startDate) : null;
  const end      = exp.endDate   ? new Date(exp.endDate)   : null;

  const preDays  = (preStart && preEnd)  ? Math.round((preEnd - preStart)   / 86400000) + 1 : 0;
  const testDays = (start && end)        ? Math.round((end - start)         / 86400000) + 1 : 0;

  s.granularity        = exp.dataGranularity === "daily" ? "pass" : "warn";
  s.geo_granularity    = ["Zip Code","City"].includes(exp.geoLevel) ? "pass" : ["DMA","Region"].includes(exp.geoLevel) ? "warn" : "unknown";
  s.pre_period_ratio   = preDays && testDays ? (preDays >= testDays * 4 ? "pass" : preDays >= testDays * 3 ? "warn" : "fail") : "unknown";
  s.min_pre_periods    = preDays ? (preDays >= 25 ? "pass" : preDays >= 20 ? "warn" : "fail") : "unknown";
  s.min_geos           = "unknown";
  s["52_weeks"]        = preDays ? (preDays >= 364 ? "pass" : preDays >= 180 ? "warn" : "fail") : "unknown";
  s.purchase_cycle     = testDays ? (testDays >= 7 ? "pass" : "warn") : "unknown";
  s.min_duration       = testDays ? (exp.dataGranularity === "daily" ? (testDays >= 15 ? "pass" : "fail") : (testDays >= 28 ? "pass" : "fail")) : "unknown";
  s.no_missing         = "unknown";
  s.covariates         = exp.covariates ? "pass" : "optional";
  s.market_match       = "unknown";
  s.local_media        = exp.localMedia === "none" ? "pass" : exp.localMedia === "documented" ? "warn" : "fail";
  s.national_media     = exp.nationalMediaStable ? "pass" : "fail";
  s.structural_breaks  = exp.structuralBreaks ? "fail" : "pass";

  return s;
}

/* ══════════════════════════════════════════════════════════════════ */
/*  COMPONENTS                                                        */
/* ══════════════════════════════════════════════════════════════════ */

function GoogleFonts() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap');
      *, *::before, *::after { box-sizing: border-box; }
      ::-webkit-scrollbar { width: 4px; background: ${C.bg}; }
      ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
      input, textarea, select {
        background: ${C.surface};
        border: 1px solid ${C.border};
        border-radius: 6px;
        color: ${C.text};
        font-family: ${font.body};
        font-size: 13px;
        padding: 8px 12px;
        outline: none;
        transition: border-color 0.15s;
        width: 100%;
      }
      input:focus, textarea:focus, select:focus { border-color: ${C.cyan}; }
      select option { background: ${C.surface}; }
      label { font-size: 12px; color: ${C.muted}; display: block; margin-bottom: 5px; font-weight: 500; letter-spacing: 0.04em; }
    `}</style>
  );
}

function Header({ showBP, setShowBP, reqFailing }) {
  return (
    <header style={{
      background: C.surface, borderBottom: `1px solid ${C.border}`,
      padding: "0 32px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between",
      flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ fontFamily: font.heading, fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>
          <span style={{ color: C.cyan }}>Geo</span>Lift
        </div>
        <div style={{ width: 1, height: 20, background: C.border }} />
        <div style={{ fontFamily: font.mono, fontSize: 11, color: C.muted }}>Incrementality Experiment Designer</div>
      </div>
      <button
        onClick={() => setShowBP(v => !v)}
        style={{
          background: showBP ? C.cyanDim : "transparent",
          border: `1px solid ${showBP ? C.cyan : C.border}`,
          borderRadius: 6, color: showBP ? C.cyan : C.muted,
          fontFamily: font.mono, fontSize: 11, padding: "5px 12px", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 6,
        }}
      >
        {reqFailing > 0 && <span style={{ background: C.red, color: "#fff", borderRadius: 99, fontSize: 10, padding: "1px 6px", fontWeight: 700 }}>{reqFailing}</span>}
        Best Practices
      </button>
    </header>
  );
}

function Sidebar({ step, setStep, exp }) {
  const pct = Math.round((step / (STEPS.length - 1)) * 100);
  return (
    <aside style={{
      width: 200, background: C.surface, borderRight: `1px solid ${C.border}`,
      padding: "28px 0", flexShrink: 0, display: "flex", flexDirection: "column",
    }}>
      <div style={{ padding: "0 20px 20px", borderBottom: `1px solid ${C.border}` }}>
        {exp.name
          ? <div style={{ fontFamily: font.heading, fontSize: 13, fontWeight: 700, color: "#fff", wordBreak: "break-word" }}>{exp.name}</div>
          : <div style={{ fontFamily: font.mono, fontSize: 11, color: C.muted }}>New Experiment</div>
        }
        {exp.testType && (
          <div style={{ marginTop: 6 }}>
            <Tag color={exp.testType === "multi" ? C.amber : C.cyan}>
              {exp.testType === "multi" ? "Multi-Cell" : "Single-Cell"}
            </Tag>
          </div>
        )}
      </div>

      <nav style={{ padding: "16px 0", flex: 1 }}>
        {STEPS.map((s) => {
          const active = step === s.id;
          const done   = step > s.id;
          return (
            <button
              key={s.id}
              onClick={() => setStep(s.id)}
              style={{
                display: "flex", alignItems: "center", gap: 12,
                width: "100%", padding: "10px 20px", background: active ? C.cyanDim : "transparent",
                border: "none", borderLeft: active ? `2px solid ${C.cyan}` : "2px solid transparent",
                cursor: "pointer", textAlign: "left", transition: "all 0.15s",
              }}
            >
              <div style={{
                width: 20, height: 20, borderRadius: 4,
                background: done ? C.green : active ? C.cyan : C.border,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 10, color: done || active ? C.bg : C.muted, fontWeight: 700, flexShrink: 0,
              }}>
                {done ? "✓" : s.id + 1}
              </div>
              <span style={{ fontSize: 12, fontWeight: active ? 600 : 400, color: active ? C.cyan : done ? C.text : C.muted }}>
                {s.label}
              </span>
            </button>
          );
        })}
      </nav>

      <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={{ fontFamily: font.mono, fontSize: 10, color: C.muted }}>Progress</span>
          <span style={{ fontFamily: font.mono, fontSize: 10, color: C.cyan }}>{pct}%</span>
        </div>
        <div style={{ height: 3, background: C.border, borderRadius: 2 }}>
          <div style={{ width: `${pct}%`, height: "100%", background: C.cyan, borderRadius: 2, transition: "width 0.3s" }} />
        </div>
      </div>
    </aside>
  );
}

function NavButtons({ step, setStep }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 40, paddingTop: 24, borderTop: `1px solid ${C.border}` }}>
      <Btn secondary disabled={step === 0} onClick={() => setStep(s => s - 1)}>← Back</Btn>
      {step < STEPS.length - 1
        ? <Btn onClick={() => setStep(s => s + 1)}>Continue →</Btn>
        : <Btn style={{ background: C.green, color: C.bg }}>Launch Experiment ✓</Btn>
      }
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  STEP 0 — SETUP                                                   */
/* ══════════════════════════════════════════════════════════════════ */
function StepSetup({ exp, upd }) {
  return (
    <div>
      <StepHeader n="01" title="Experiment Setup" sub="Define the core parameters of your GeoLift study." />

      <Grid cols={2}>
        <Field label="EXPERIMENT NAME">
          <input value={exp.name} onChange={e => upd("name", e.target.value)} placeholder="e.g. Q3 Meta Paid Social — US DMA Test" />
        </Field>
        <Field label="PRIMARY KPI">
          <select value={exp.kpi} onChange={e => upd("kpi", e.target.value)}>
            {["Revenue","Conversions","App Installs","Leads","Orders","Custom"].map(k => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </Field>
        {exp.kpi === "Custom" && (
          <Field label="CUSTOM KPI NAME">
            <input value={exp.kpiCustom} onChange={e => upd("kpiCustom", e.target.value)} placeholder="e.g. In-store visits" />
          </Field>
        )}
      </Grid>

      {/* Test Type */}
      <Section title="Test Structure">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <TestTypeCard
            selected={exp.testType === "single"}
            onClick={() => upd("testType", "single")}
            title="Single-Cell"
            badge="Standard"
            badgeColor={C.cyan}
            desc="One treatment group vs one control group. Best for measuring the overall lift of a single campaign or channel."
            points={["Simpler to execute and explain", "Lower budget requirements", "One treatment × one control pool", "Ideal for first GeoLift studies"]}
          />
          <TestTypeCard
            selected={exp.testType === "multi"}
            onClick={() => upd("testType", "multi")}
            title="Multi-Cell"
            badge="Advanced"
            badgeColor={C.amber}
            desc="Multiple treatment arms each tested against the same control pool. Use to compare tactics, creatives, budget levels, or channels simultaneously."
            points={["Compare 2+ treatment variations", "Shared control pool across cells", "More efficient than sequential tests", "Requires larger geo footprint"]}
          />
        </div>
        {exp.testType === "multi" && (
          <Callout color={C.amber}>
            Multi-cell design: each treatment cell will be assigned non-overlapping geo markets. The control pool serves all treatment cells simultaneously. Ensure you have sufficient geo units to support multiple treatment markets.
          </Callout>
        )}
      </Section>

      <Grid cols={2}>
        <Field label="DATA GRANULARITY">
          <select value={exp.dataGranularity} onChange={e => upd("dataGranularity", e.target.value)}>
            <option value="daily">Daily ✓ Recommended</option>
            <option value="weekly">Weekly (requires longer test)</option>
          </select>
        </Field>
        <Field label="GEO LEVEL">
          <select value={exp.geoLevel} onChange={e => upd("geoLevel", e.target.value)}>
            <option value="Zip Code">Zip Code ✓ Most granular</option>
            <option value="City">City ✓ Recommended</option>
            <option value="DMA">DMA</option>
            <option value="Region">Region/State</option>
            <option value="Country">Country</option>
            <option value="Custom">Custom</option>
          </select>
        </Field>
      </Grid>

      <Section title="Campaign Window">
        <Grid cols={2}>
          <Field label="CAMPAIGN START DATE">
            <input type="date" value={exp.startDate} onChange={e => upd("startDate", e.target.value)} />
          </Field>
          <Field label="CAMPAIGN END DATE">
            <input type="date" value={exp.endDate} onChange={e => upd("endDate", e.target.value)} />
          </Field>
          <Field label="PRE-PERIOD START DATE">
            <input type="date" value={exp.preStart} onChange={e => upd("preStart", e.target.value)} />
          </Field>
          <Field label="PRE-PERIOD END DATE">
            <input type="date" value={exp.preEnd} onChange={e => upd("preEnd", e.target.value)} />
          </Field>
        </Grid>
        <DurationBadges exp={exp} />
      </Section>
    </div>
  );
}

function DurationBadges({ exp }) {
  const preStart = exp.preStart ? new Date(exp.preStart) : null;
  const preEnd   = exp.preEnd   ? new Date(exp.preEnd)   : null;
  const start    = exp.startDate ? new Date(exp.startDate) : null;
  const end      = exp.endDate   ? new Date(exp.endDate)   : null;
  const preDays  = (preStart && preEnd)  ? Math.round((preEnd - preStart) / 86400000) + 1 : null;
  const testDays = (start && end)        ? Math.round((end - start) / 86400000) + 1 : null;
  const ratio    = preDays && testDays ? (preDays / testDays).toFixed(1) : null;

  if (!preDays && !testDays) return null;

  const minDaily = 15;
  const minPre   = 25;

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
      {testDays && (
        <StatBadge label="Test Duration" value={`${testDays}d`} status={testDays >= (exp.dataGranularity === "daily" ? minDaily : 28) ? "pass" : "fail"} />
      )}
      {preDays && (
        <StatBadge label="Pre-Period" value={`${preDays}d`} status={preDays >= minPre ? "pass" : "fail"} />
      )}
      {ratio && (
        <StatBadge label="Pre:Test Ratio" value={`${ratio}×`} status={parseFloat(ratio) >= 4 ? "pass" : parseFloat(ratio) >= 3 ? "warn" : "fail"} />
      )}
      {preDays && (
        <StatBadge label="52-Week Coverage" value={preDays >= 364 ? "Yes" : preDays >= 180 ? "Partial" : "No"} status={preDays >= 364 ? "pass" : preDays >= 180 ? "warn" : "fail"} />
      )}
    </div>
  );
}

function TestTypeCard({ selected, onClick, title, badge, badgeColor, desc, points }) {
  return (
    <div
      onClick={onClick}
      style={{
        border: `2px solid ${selected ? badgeColor : C.border}`,
        borderRadius: 10, padding: 20, cursor: "pointer",
        background: selected ? (badgeColor === C.cyan ? C.cyanDim : C.amberDim) : C.surface,
        transition: "all 0.15s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ fontFamily: font.heading, fontSize: 15, fontWeight: 700, color: "#fff" }}>{title}</div>
        <Tag color={badgeColor}>{badge}</Tag>
      </div>
      <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, marginBottom: 12 }}>{desc}</p>
      <ul style={{ paddingLeft: 0, listStyle: "none", margin: 0 }}>
        {points.map((p, i) => (
          <li key={i} style={{ fontSize: 11, color: selected ? C.text : C.muted, marginBottom: 4, display: "flex", gap: 6 }}>
            <span style={{ color: badgeColor }}>›</span> {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  STEP 1 — DATA REQUIREMENTS                                       */
/* ══════════════════════════════════════════════════════════════════ */
function StepData({ exp, upd }) {
  return (
    <div>
      <StepHeader n="02" title="Data Requirements" sub="Validate your dataset against GeoLift's best practices before proceeding." />

      <Section title="Data Quality Declaration">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <CheckRow
            label="My dataset has no missing values for any geo × date combination"
            checked={!exp.missingValues}
            onChange={v => upd("missingValues", !v)}
            help="Every unit × timestamp must have a KPI value. Missing values violate the balanced panel assumption."
          />
          <CheckRow
            label="The pre-period data is free of structural breaks (major promotions, distribution changes, macro shocks)"
            checked={!exp.structuralBreaks}
            onChange={v => upd("structuralBreaks", !v)}
            help="Structural breaks in pre-period data corrupt the synthetic control baseline and invalidate counterfactual estimates."
          />
          <CheckRow
            label="I have 20 or more geo units in my dataset"
            checked={exp.hasMinGeos}
            onChange={v => upd("hasMinGeos", v)}
            help="Minimum 20 geos are needed to construct a reliable synthetic control donor pool."
          />
          <CheckRow
            label="I have panel covariate data to improve model fit (optional)"
            checked={exp.covariates}
            onChange={v => upd("covariates", v)}
            help="Covariates such as population, income index, product distribution scores, or demographic variables can significantly improve pre-period fit."
          />
        </div>
        {exp.covariates && (
          <Field label="COVARIATE NOTES" style={{ marginTop: 12 }}>
            <textarea rows={2} value={exp.covarNotes} onChange={e => upd("covarNotes", e.target.value)}
              placeholder="e.g. Population (Census 2020), HH income index, product ACV distribution by DMA" />
          </Field>
        )}
        {exp.structuralBreaks && (
          <Callout color={C.red} style={{ marginTop: 12 }}>
            <strong>⚠ Structural breaks detected.</strong> Pre-period data with structural changes will produce unreliable synthetic control fits. Trim your pre-period to a stable window before proceeding.
            <Field label="DESCRIBE THE STRUCTURAL BREAKS" style={{ marginTop: 8 }}>
              <input value={exp.structuralBreaksNotes} onChange={e => upd("structuralBreaksNotes", e.target.value)}
                placeholder="e.g. Major price promotion in Jan 2024, new market distribution in Q2 2023" />
            </Field>
          </Callout>
        )}
      </Section>

      <Section title="Media Environment">
        <Field label="LOCAL MEDIA ACTIVITY IN TEST / CONTROL MARKETS">
          <select value={exp.localMedia} onChange={e => upd("localMedia", e.target.value)}>
            <option value="none">None — no local media running in any test or control market</option>
            <option value="documented">Present but documented and held constant across all markets</option>
            <option value="unbalanced">Present and varies across markets (⚠ may bias results)</option>
          </select>
        </Field>
        {exp.localMedia !== "none" && (
          <Field label="LOCAL MEDIA NOTES" style={{ marginTop: 10 }}>
            <textarea rows={2} value={exp.localMediaNotes} onChange={e => upd("localMediaNotes", e.target.value)}
              placeholder="Describe local TV, regional OOH, or other local media and how it is controlled" />
          </Field>
        )}

        <div style={{ marginTop: 16 }}>
          <CheckRow
            label="National media (TV, print, national digital) will be held constant throughout the test period"
            checked={exp.nationalMediaStable}
            onChange={v => upd("nationalMediaStable", v)}
            help="Any significant national media variation during the test window makes it impossible to isolate the Facebook geo-lift signal."
          />
          {!exp.nationalMediaStable && (
            <Callout color={C.red} style={{ marginTop: 8 }}>
              <strong>⚠ National media instability</strong> — results will be confounded. Resolve before running this experiment.
              <Field label="DETAILS" style={{ marginTop: 8 }}>
                <input value={exp.nationalMediaNotes} onChange={e => upd("nationalMediaNotes", e.target.value)}
                  placeholder="Describe planned national media changes" />
              </Field>
            </Callout>
          )}
        </div>
      </Section>

      <Section title="Data Upload">
        <div style={{
          border: `2px dashed ${C.border}`, borderRadius: 8, padding: 32,
          textAlign: "center", color: C.muted,
        }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⬆</div>
          <div style={{ fontFamily: font.mono, fontSize: 12 }}>Drop CSV / connect data source</div>
          <div style={{ fontSize: 11, marginTop: 6 }}>Required columns: <code style={{ color: C.cyan, background: C.cyanDim, padding: "1px 5px", borderRadius: 3 }}>date</code> · <code style={{ color: C.cyan, background: C.cyanDim, padding: "1px 5px", borderRadius: 3 }}>location</code> · <code style={{ color: C.cyan, background: C.cyanDim, padding: "1px 5px", borderRadius: 3 }}>Y (KPI)</code></div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
            {["BigQuery", "Snowflake", "Redshift", "Meta Ads API", "GA4", "CSV Upload"].map(src => (
              <button key={src} style={{
                background: C.surfaceHi, border: `1px solid ${C.border}`, borderRadius: 5,
                color: C.muted, fontSize: 11, padding: "5px 10px", cursor: "pointer",
              }}>{src}</button>
            ))}
          </div>
        </div>
      </Section>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  STEP 2 — MARKETS                                                 */
/* ══════════════════════════════════════════════════════════════════ */
function StepMarkets({ exp, upd, setExp }) {
  const isMulti = exp.testType === "multi";
  const cells   = exp.cells;

  const addCell = () => {
    const id = `t${cells.filter(c => c.id !== "ctrl").length + 1}`;
    setExp(prev => ({ ...prev, cells: [...prev.cells, defaultCell(id, `Treatment ${cells.filter(c => c.id !== "ctrl").length + 1}`)] }));
  };

  const removeCell = (id) => setExp(prev => ({ ...prev, cells: prev.cells.filter(c => c.id !== id) }));
  const updateCell = (id, field, val) => setExp(prev => ({
    ...prev, cells: prev.cells.map(c => c.id === id ? { ...c, [field]: val } : c)
  }));

  return (
    <div>
      <StepHeader n="03" title={isMulti ? "Multi-Cell Market Configuration" : "Market Configuration"} sub="Define treatment and control markets. GeoLiftMarketSelection will optimize the control pool." />

      {isMulti && (
        <Callout color={C.amber}>
          <strong>Multi-cell experiment:</strong> Each treatment cell receives non-overlapping geo markets. The same control pool services all treatment cells. Cells should differ in only one dimension (budget level, creative, channel) to isolate the variable being tested.
        </Callout>
      )}

      {/* CONTROL CELL */}
      <Section title="Control Market Pool">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="CONTROL MARKET SELECTION METHOD">
            <select>
              <option>Auto — GeoLiftMarketSelection() optimization</option>
              <option>Manual — specify control markets</option>
              <option>Randomized holdout</option>
            </select>
          </Field>
          <Field label="MARKET MATCHING VARIABLES">
            <input placeholder="e.g. Revenue, Population, Distribution ACV, Seasonality Index" />
          </Field>
        </div>
        <Callout color={C.cyan} style={{ marginTop: 12 }}>
          <strong>Best practice:</strong> Match control markets on the exact same KPI outcome (revenue, conversions) plus any category-specific variables such as product distribution, seasonal variation profiles, and competitor presence. This eliminates cross-market bias.
        </Callout>
      </Section>

      {/* TREATMENT CELLS */}
      <Section title={isMulti ? "Treatment Cells" : "Treatment Markets"}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {cells.filter(c => c.id !== "ctrl").map((cell, idx) => (
            <CellCard
              key={cell.id}
              cell={cell}
              idx={idx}
              isMulti={isMulti}
              total={cells.filter(c => c.id !== "ctrl").length}
              onUpdate={(field, val) => updateCell(cell.id, field, val)}
              onRemove={isMulti && cells.filter(c => c.id !== "ctrl").length > 1 ? () => removeCell(cell.id) : null}
            />
          ))}
        </div>
        {isMulti && (
          <button onClick={addCell} style={{
            marginTop: 12, width: "100%", padding: "10px 0", background: "transparent",
            border: `1px dashed ${C.border}`, borderRadius: 8, color: C.muted,
            fontFamily: font.mono, fontSize: 12, cursor: "pointer", transition: "all 0.15s",
          }}
            onMouseEnter={e => { e.target.style.borderColor = C.cyan; e.target.style.color = C.cyan; }}
            onMouseLeave={e => { e.target.style.borderColor = C.border; e.target.style.color = C.muted; }}
          >
            + Add Treatment Cell
          </button>
        )}
      </Section>
    </div>
  );
}

function CellCard({ cell, idx, isMulti, total, onUpdate, onRemove }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, background: C.surface }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 24, height: 24, borderRadius: 4, background: C.cyanDim, border: `1px solid ${C.cyan}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font.mono, fontSize: 10, color: C.cyan }}>T{idx + 1}</div>
          {isMulti
            ? <input value={cell.label} onChange={e => onUpdate("label", e.target.value)} style={{ width: 180, fontWeight: 600 }} placeholder="Cell label" />
            : <span style={{ fontFamily: font.heading, fontSize: 13, fontWeight: 700, color: "#fff" }}>Treatment Markets</span>
          }
        </div>
        {onRemove && <button onClick={onRemove} style={{ background: C.redDim, border: `1px solid ${C.red}`, color: C.red, borderRadius: 4, fontSize: 11, padding: "3px 8px", cursor: "pointer" }}>Remove</button>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <Field label="CHANNEL">
          <select value={cell.channel} onChange={e => onUpdate("channel", e.target.value)}>
            {["Meta","TikTok","Google","Pinterest","Snapchat","TV","OOH","Multi-Channel"].map(ch => (
              <option key={ch}>{ch}</option>
            ))}
          </select>
        </Field>
        <Field label="PLANNED SPEND ($)">
          <input type="number" value={cell.budget} onChange={e => onUpdate("budget", e.target.value)} placeholder="0" />
        </Field>
        <Field label="CAMPAIGN OBJECTIVE">
          <select value={cell.objective} onChange={e => onUpdate("objective", e.target.value)}>
            <option value="">Select...</option>
            {["Conversions","Traffic","Awareness","App Installs","Lead Gen","ROAS"].map(o => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </Field>
      </div>
      {isMulti && (
        <Field label="WHAT VARIES IN THIS CELL (vs other cells)" style={{ marginTop: 10 }}>
          <input value={cell.notes} onChange={e => onUpdate("notes", e.target.value)} placeholder="e.g. $50K budget (vs $100K in T2), same creative and targeting" />
        </Field>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  STEP 3 — POWER ANALYSIS                                         */
/* ══════════════════════════════════════════════════════════════════ */
function StepPower({ exp, upd }) {
  const mde = parseFloat(exp.targetEffect) || 5;
  const conf = parseInt(exp.confidence) || 80;

  const powerColors = [C.red, C.red, C.amber, C.amber, C.cyan, C.green, C.green];
  const powerIdx = Math.min(6, Math.max(0, Math.round((conf - 50) / 10)));
  const pColor = powerColors[powerIdx];

  return (
    <div>
      <StepHeader n="04" title="Power Analysis & Design Validation" sub="Run GeoLift power simulations to confirm your experiment can detect meaningful lift." />

      <Section title="Effect Size & Confidence Targets">
        <Grid cols={3}>
          <Field label="TARGET MDE (MINIMUM DETECTABLE EFFECT %)">
            <input type="number" value={exp.targetEffect} onChange={e => upd("targetEffect", e.target.value)} placeholder="5" min="1" max="100" />
          </Field>
          <Field label="TARGET CONFIDENCE LEVEL (%)">
            <select value={exp.confidence} onChange={e => upd("confidence", e.target.value)}>
              <option value="70">70% — Exploratory</option>
              <option value="80">80% — Standard ✓</option>
              <option value="90">90% — Conservative</option>
              <option value="95">95% — High confidence</option>
            </select>
          </Field>
          <Field label="TOTAL PLANNED SPEND ($)">
            <input type="number" value={exp.spend} onChange={e => upd("spend", e.target.value)} placeholder="0" />
          </Field>
        </Grid>
      </Section>

      {/* Power summary card */}
      <Section title="Design Summary">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {[
            { label: "Confidence Target", value: `${conf}%`, color: pColor },
            { label: "Target MDE", value: `${mde}%`, color: C.text },
            { label: "Test Duration", value: exp.startDate && exp.endDate ? `${Math.round((new Date(exp.endDate) - new Date(exp.startDate)) / 86400000) + 1}d` : "—", color: C.text },
            { label: "Cells", value: exp.testType === "multi" ? exp.cells.filter(c => c.id !== "ctrl").length : 1, color: C.text },
          ].map(m => (
            <div key={m.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, textAlign: "center" }}>
              <div style={{ fontFamily: font.mono, fontSize: 22, fontWeight: 700, color: m.color }}>{m.value}</div>
              <div style={{ fontFamily: font.mono, fontSize: 10, color: C.muted, marginTop: 4 }}>{m.label}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Power Simulation (GeoLiftPower)">
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20 }}>
          <div style={{ fontFamily: font.mono, fontSize: 11, color: C.muted, marginBottom: 16 }}>
            Simulated power curve — % of simulations detecting lift at target MDE across treatment durations
          </div>
          <PowerChart mde={mde} confidence={conf} />
          <div style={{ marginTop: 16, fontSize: 11, color: C.muted, lineHeight: 1.6 }}>
            Power simulation is run by <code style={{ color: C.cyan, background: C.cyanDim, padding: "1px 5px", borderRadius: 3 }}>GeoLiftPower()</code> using your actual geo-level pre-period data. The chart above is illustrative. Connect your data to run live power curves.
          </div>
        </div>
      </Section>

      <Section title="iROAS Break-Even Analysis">
        <IROASCalc spend={exp.spend} mde={mde} />
      </Section>
    </div>
  );
}

function PowerChart({ mde, confidence }) {
  const durations = [7, 10, 14, 21, 28, 35, 42];
  const basepower = d => Math.min(100, 20 + (d / 42) * 85 * (1 - (mde - 5) * 0.02) * (confidence / 90));

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 80 }}>
      {durations.map((d) => {
        const pw = Math.max(5, Math.min(100, basepower(d)));
        const col = pw >= confidence ? C.green : pw >= confidence * 0.85 ? C.amber : C.red;
        return (
          <div key={d} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{ fontFamily: font.mono, fontSize: 9, color: col }}>{Math.round(pw)}%</div>
            <div style={{ width: "100%", height: `${pw * 0.7}px`, background: col, borderRadius: "3px 3px 0 0", opacity: 0.8 }} />
            <div style={{ fontFamily: font.mono, fontSize: 9, color: C.muted }}>{d}d</div>
          </div>
        );
      })}
    </div>
  );
}

function IROASCalc({ spend, mde }) {
  const s = parseFloat(spend) || 0;
  const pct = parseFloat(mde) / 100;
  if (!s) return (
    <Callout color={C.muted}>Enter planned spend above to see iROAS break-even estimates.</Callout>
  );
  const revNeeded = s > 0 ? (s / 0.3).toFixed(0) : "—";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
      {[
        { label: "Planned Spend", value: `$${Number(s).toLocaleString()}`, color: C.text },
        { label: "Break-even iROAS", value: "3.3×", color: C.cyan },
        { label: "Revenue needed at MDE", value: `$${Number(revNeeded).toLocaleString()}`, color: C.amber },
      ].map(m => (
        <div key={m.label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, textAlign: "center" }}>
          <div style={{ fontFamily: font.mono, fontSize: 18, fontWeight: 600, color: m.color }}>{m.value}</div>
          <div style={{ fontFamily: font.mono, fontSize: 10, color: C.muted, marginTop: 4 }}>{m.label}</div>
        </div>
      ))}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  STEP 4 — REVIEW                                                  */
/* ══════════════════════════════════════════════════════════════════ */
function StepReview({ exp, bpStatus }) {
  const reqPass  = BEST_PRACTICES.filter(bp => bp.severity === "required" && bpStatus[bp.id] === "pass").length;
  const reqTotal = BEST_PRACTICES.filter(bp => bp.severity === "required").length;
  const allReqPassing = reqPass === reqTotal;

  const preStart = exp.preStart ? new Date(exp.preStart) : null;
  const preEnd   = exp.preEnd   ? new Date(exp.preEnd)   : null;
  const start    = exp.startDate ? new Date(exp.startDate) : null;
  const end      = exp.endDate   ? new Date(exp.endDate)   : null;
  const preDays  = (preStart && preEnd) ? Math.round((preEnd - preStart) / 86400000) + 1 : null;
  const testDays = (start && end)       ? Math.round((end - start) / 86400000) + 1 : null;

  return (
    <div>
      <StepHeader n="05" title="Review & Launch" sub="Final checklist before locking your experiment configuration." />

      {/* Readiness indicator */}
      <div style={{
        border: `2px solid ${allReqPassing ? C.green : C.amber}`,
        borderRadius: 10, padding: 20, marginBottom: 24,
        background: allReqPassing ? C.greenDim : C.amberDim,
        display: "flex", alignItems: "center", gap: 16,
      }}>
        <div style={{ fontSize: 32 }}>{allReqPassing ? "✓" : "⚠"}</div>
        <div>
          <div style={{ fontFamily: font.heading, fontSize: 14, fontWeight: 700, color: "#fff" }}>
            {allReqPassing ? "Experiment ready to launch" : `${reqTotal - reqPass} required check${reqTotal - reqPass !== 1 ? "s" : ""} not yet passed`}
          </div>
          <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
            {reqPass} / {reqTotal} required best practices satisfied
          </div>
        </div>
      </div>

      {/* Config summary */}
      <Section title="Configuration Summary">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[
            ["Experiment Name", exp.name || "—"],
            ["Test Type", exp.testType === "multi" ? `Multi-Cell (${exp.cells.filter(c => c.id !== "ctrl").length} treatment cells)` : "Single-Cell"],
            ["Primary KPI", exp.kpi === "Custom" ? exp.kpiCustom : exp.kpi],
            ["Data Granularity", exp.dataGranularity],
            ["Geo Level", exp.geoLevel],
            ["Pre-Period Duration", preDays ? `${preDays} days` : "—"],
            ["Test Duration", testDays ? `${testDays} days` : "—"],
            ["Pre:Test Ratio", preDays && testDays ? `${(preDays / testDays).toFixed(1)}×` : "—"],
            ["Target MDE", `${exp.targetEffect}%`],
            ["Confidence Level", `${exp.confidence}%`],
            ["Planned Spend", exp.spend ? `$${Number(exp.spend).toLocaleString()}` : "—"],
            ["Covariates", exp.covariates ? "Yes" : "No"],
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: C.surface, borderRadius: 5, border: `1px solid ${C.border}` }}>
              <span style={{ fontFamily: font.mono, fontSize: 11, color: C.muted }}>{k}</span>
              <span style={{ fontFamily: font.mono, fontSize: 11, color: C.text }}>{v}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Treatment cells */}
      {exp.testType === "multi" && (
        <Section title="Treatment Cells">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {exp.cells.filter(c => c.id !== "ctrl").map((cell, i) => (
              <div key={cell.id} style={{ padding: "10px 14px", background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, display: "flex", gap: 16, alignItems: "center" }}>
                <Tag color={C.cyan}>T{i + 1}</Tag>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{cell.label}</span>
                <span style={{ fontFamily: font.mono, fontSize: 11, color: C.muted }}>{cell.channel}</span>
                {cell.budget && <span style={{ fontFamily: font.mono, fontSize: 11, color: C.text }}>${Number(cell.budget).toLocaleString()}</span>}
                {cell.notes && <span style={{ fontSize: 11, color: C.muted, flex: 1 }}>{cell.notes}</span>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* BP failures */}
      {!allReqPassing && (
        <Section title="⚠ Issues to Resolve Before Launch">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {BEST_PRACTICES.filter(bp => bp.severity === "required" && bpStatus[bp.id] !== "pass" && bpStatus[bp.id] !== "unknown").map(bp => (
              <div key={bp.id} style={{ padding: "10px 14px", background: C.redDim, borderRadius: 6, border: `1px solid ${C.red}`, fontSize: 12 }}>
                <div style={{ fontWeight: 600, color: "#fff", marginBottom: 2 }}>{bp.label}</div>
                <div style={{ color: C.muted }}>{bp.detail}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Notes">
        <textarea rows={3} value={exp.notes} onChange={() => {}} placeholder="Add any final notes, context, or documentation for stakeholders..." />
      </Section>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  BEST PRACTICES PANEL                                             */
/* ══════════════════════════════════════════════════════════════════ */
function BPPanel({ bpStatus }) {
  const [cat, setCat] = useState("All");
  const cats = ["All", "Data", "Markets", "Media"];

  const filtered = BEST_PRACTICES.filter(bp => cat === "All" || bp.category === cat);

  const statusIcon = (s) => {
    if (s === "pass")    return { icon: "✓", color: C.green };
    if (s === "warn")    return { icon: "⚠", color: C.amber };
    if (s === "fail")    return { icon: "✕", color: C.red };
    if (s === "optional") return { icon: "○", color: C.muted };
    return                      { icon: "·", color: C.muted };
  };

  const counts = {
    pass: BEST_PRACTICES.filter(bp => bpStatus[bp.id] === "pass").length,
    warn: BEST_PRACTICES.filter(bp => bpStatus[bp.id] === "warn").length,
    fail: BEST_PRACTICES.filter(bp => bpStatus[bp.id] === "fail").length,
  };

  return (
    <aside style={{
      width: 260, background: C.surface, borderLeft: `1px solid ${C.border}`,
      display: "flex", flexDirection: "column", flexShrink: 0, overflow: "hidden",
    }}>
      <div style={{ padding: "16px 16px 12px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontFamily: font.heading, fontSize: 12, fontWeight: 700, color: "#fff", marginBottom: 8 }}>Best Practices</div>
        <div style={{ display: "flex", gap: 6 }}>
          <span style={{ fontFamily: font.mono, fontSize: 10, color: C.green }}>✓ {counts.pass}</span>
          <span style={{ fontFamily: font.mono, fontSize: 10, color: C.amber }}>⚠ {counts.warn}</span>
          <span style={{ fontFamily: font.mono, fontSize: 10, color: C.red }}>✕ {counts.fail}</span>
        </div>
        <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
          {cats.map(c => (
            <button key={c} onClick={() => setCat(c)} style={{
              background: cat === c ? C.cyanDim : "transparent",
              border: `1px solid ${cat === c ? C.cyan : C.border}`,
              borderRadius: 4, color: cat === c ? C.cyan : C.muted,
              fontFamily: font.mono, fontSize: 9, padding: "3px 7px", cursor: "pointer",
            }}>{c}</button>
          ))}
        </div>
      </div>

      <div style={{ overflowY: "auto", flex: 1, padding: 8 }}>
        {filtered.map(bp => {
          const { icon, color } = statusIcon(bpStatus[bp.id]);
          return (
            <div key={bp.id} style={{
              padding: "8px 10px", borderRadius: 6, marginBottom: 4,
              background: bpStatus[bp.id] === "fail" ? C.redDim : bpStatus[bp.id] === "warn" ? C.amberDim : "transparent",
              border: `1px solid ${bpStatus[bp.id] === "fail" ? C.red + "40" : bpStatus[bp.id] === "warn" ? C.amber + "40" : "transparent"}`,
            }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontFamily: font.mono, fontSize: 11, color, flexShrink: 0, marginTop: 1 }}>{icon}</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#fff", lineHeight: 1.4 }}>{bp.label}</div>
                  <div style={{ fontFamily: font.mono, fontSize: 9, color: C.muted, marginTop: 2 }}>{bp.category} · {bp.severity}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  SHARED UI PRIMITIVES                                             */
/* ══════════════════════════════════════════════════════════════════ */
function StepHeader({ n, title, sub }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ fontFamily: font.mono, fontSize: 11, color: C.cyan, marginBottom: 6, letterSpacing: "0.1em" }}>STEP {n}</div>
      <h1 style={{ fontFamily: font.heading, fontSize: 26, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: "-0.02em" }}>{title}</h1>
      <p style={{ fontFamily: font.body, fontSize: 13, color: C.muted, marginTop: 6 }}>{sub}</p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontFamily: font.mono, fontSize: 10, color: C.muted, letterSpacing: "0.1em", marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${C.border}`, textTransform: "uppercase" }}>{title}</div>
      {children}
    </div>
  );
}

function Grid({ cols = 2, children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 16, marginBottom: 24 }}>
      {children}
    </div>
  );
}

function Field({ label, children, style }) {
  return (
    <div style={style}>
      {label && <label>{label}</label>}
      {children}
    </div>
  );
}

function Callout({ color, children, style }) {
  return (
    <div style={{
      background: color + "15", border: `1px solid ${color}40`,
      borderLeft: `3px solid ${color}`, borderRadius: 6,
      padding: "10px 14px", fontSize: 12, color: C.text, lineHeight: 1.6, ...style
    }}>
      {children}
    </div>
  );
}

function Tag({ color, children }) {
  return (
    <span style={{ background: color + "20", border: `1px solid ${color}50`, color, borderRadius: 4, fontSize: 10, fontWeight: 700, padding: "2px 7px", fontFamily: font.mono }}>
      {children}
    </span>
  );
}

function StatBadge({ label, value, status }) {
  const colors = { pass: C.green, warn: C.amber, fail: C.red, unknown: C.muted };
  const c = colors[status] || C.muted;
  return (
    <div style={{ background: c + "15", border: `1px solid ${c}40`, borderRadius: 5, padding: "5px 10px", display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ fontFamily: font.mono, fontSize: 12, fontWeight: 600, color: c }}>{value}</span>
      <span style={{ fontFamily: font.mono, fontSize: 10, color: C.muted }}>{label}</span>
    </div>
  );
}

function Btn({ children, onClick, secondary, disabled, style = {} }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      style={{
        background: secondary ? "transparent" : C.cyan,
        color: secondary ? C.muted : C.bg,
        border: `1px solid ${secondary ? C.border : C.cyan}`,
        borderRadius: 7, fontFamily: font.body, fontSize: 13, fontWeight: 600,
        padding: "10px 24px", cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1, transition: "all 0.15s",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function CheckRow({ label, checked, onChange, help }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div
        onClick={() => onChange(!checked)}
        style={{
          width: 18, height: 18, borderRadius: 4, flexShrink: 0, marginTop: 1,
          border: `2px solid ${checked ? C.cyan : C.border}`,
          background: checked ? C.cyan : "transparent",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 10, color: C.bg, fontWeight: 900, transition: "all 0.15s",
        }}
      >{checked ? "✓" : ""}</div>
      <div>
        <div style={{ fontSize: 13, fontWeight: checked ? 500 : 400, color: checked ? C.text : C.muted, lineHeight: 1.4 }}>{label}</div>
        {help && <div style={{ fontSize: 11, color: C.muted, marginTop: 3, lineHeight: 1.5 }}>{help}</div>}
      </div>
    </div>
  );
}
