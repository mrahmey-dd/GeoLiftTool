import { useState, useMemo } from "react";

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
  cyanDim:   "#00c9a718",
  amber:     "#f5a623",
  amberDim:  "#f5a62318",
  red:       "#f04a5a",
  redDim:    "#f04a5a18",
  green:     "#3dd68c",
  greenDim:  "#3dd68c18",
  blue:      "#4e9eff",
  blueDim:   "#4e9eff12",
  purple:    "#a78bfa",
  purpleDim: "#a78bfa12",
};

const font = {
  heading: "'Syne', sans-serif",
  mono:    "'DM Mono', monospace",
  body:    "'Inter', system-ui, sans-serif",
};

/* ─── EXPERIMENT DATA ────────────────────────────────────────────── */
const EXPERIMENTS = [
  {
    id: "exp-001",
    name: "Q4 Meta Paid Social — US DMA Lift Test",
    status: "complete",
    type: "single",
    kpi: "Revenue",
    channel: "Meta",
    geoLevel: "DMA",
    granularity: "daily",
    preRange: "Sep 1 – Nov 2, 2024",
    testRange: "Nov 3 – Nov 23, 2024",
    testDays: 21,
    markets: 8,
    spend: 325000,
    result: { lift: 7.4, liftLow: 5.3, liftHigh: 9.5, iROAS: 2.31, incRevenue: 748200, pValue: 0.031, r2: 0.974 },
    owner: "Media Analytics",
    updatedAt: "Nov 24, 2024",
    bpScore: 13,
    bpTotal: 14,
    cells: [{ label: "Treatment", color: C.cyan }],
    notes: "Q4 holiday push. Clean results, high confidence.",
  },
  {
    id: "exp-002",
    name: "Q4 Budget Calibration — Multi-Cell DMA",
    status: "complete",
    type: "multi",
    kpi: "Revenue",
    channel: "Meta",
    geoLevel: "DMA",
    granularity: "daily",
    preRange: "Sep 1 – Nov 2, 2024",
    testRange: "Nov 3 – Nov 23, 2024",
    testDays: 21,
    markets: 24,
    spend: 650000,
    result: { lift: 9.8, liftLow: 7.1, liftHigh: 12.5, iROAS: 2.87, incRevenue: 1864000, pValue: 0.018, r2: 0.981 },
    owner: "Growth Team",
    updatedAt: "Nov 25, 2024",
    bpScore: 14,
    bpTotal: 14,
    cells: [
      { label: "Cell A — $150K", color: C.cyan },
      { label: "Cell B — $325K", color: C.amber },
      { label: "Cell C — $500K", color: C.purple },
    ],
    notes: "Optimal budget identified at Cell B. Diminishing returns at Cell C.",
  },
  {
    id: "exp-003",
    name: "Q1 Brand Awareness — Social Upper Funnel",
    status: "active",
    type: "single",
    kpi: "Reach",
    channel: "Meta",
    geoLevel: "City",
    granularity: "daily",
    preRange: "Nov 1 – Dec 31, 2024",
    testRange: "Jan 6 – Feb 2, 2025",
    testDays: 28,
    daysElapsed: 17,
    markets: 12,
    spend: 210000,
    owner: "Brand Team",
    updatedAt: "Jan 23, 2025",
    bpScore: 12,
    bpTotal: 14,
    cells: [{ label: "Treatment", color: C.cyan }],
    notes: "Awareness study. Results in ~11 days.",
  },
  {
    id: "exp-004",
    name: "TikTok vs Meta Incrementality — Apparel",
    status: "active",
    type: "multi",
    kpi: "Conversions",
    channel: "Multi-Channel",
    geoLevel: "DMA",
    granularity: "daily",
    preRange: "Oct 15 – Dec 14, 2024",
    testRange: "Jan 13 – Feb 9, 2025",
    testDays: 28,
    daysElapsed: 10,
    markets: 20,
    spend: 480000,
    owner: "Performance Team",
    updatedAt: "Jan 23, 2025",
    bpScore: 13,
    bpTotal: 14,
    cells: [
      { label: "Meta Only",     color: C.blue },
      { label: "TikTok Only",   color: C.purple },
      { label: "Meta + TikTok", color: C.amber },
    ],
    notes: "Channel mix study. Early signal looks promising for T3.",
  },
  {
    id: "exp-005",
    name: "Q2 Spring Campaign — City-Level Test",
    status: "draft",
    type: "single",
    kpi: "Orders",
    channel: "Meta",
    geoLevel: "City",
    granularity: "daily",
    preRange: "Jan 1 – Mar 14, 2025",
    testRange: "Mar 17 – Apr 13, 2025",
    testDays: 28,
    markets: 0,
    spend: 175000,
    owner: "Media Analytics",
    updatedAt: "Jan 20, 2025",
    bpScore: 8,
    bpTotal: 14,
    cells: [{ label: "Treatment", color: C.cyan }],
    wizardStep: 2,
    notes: "Markets not yet finalized. Data upload pending.",
  },
  {
    id: "exp-006",
    name: "EU Expansion — Germany & France Markets",
    status: "draft",
    type: "multi",
    kpi: "Revenue",
    channel: "Meta",
    geoLevel: "Region",
    granularity: "daily",
    preRange: "Dec 1, 2024 – Feb 28, 2025",
    testRange: "Mar 3 – Mar 30, 2025",
    testDays: 28,
    markets: 0,
    spend: 290000,
    owner: "International",
    updatedAt: "Jan 18, 2025",
    bpScore: 5,
    bpTotal: 14,
    cells: [
      { label: "Germany", color: C.cyan },
      { label: "France",  color: C.amber },
    ],
    wizardStep: 1,
    notes: "Early stage. Need to confirm data availability for both markets.",
  },
];

const STATUS_META = {
  complete: { label: "Complete",  color: C.green,  bg: C.greenDim  },
  active:   { label: "Active",    color: C.cyan,   bg: C.cyanDim   },
  draft:    { label: "Draft",     color: C.muted,  bg: C.surfaceHi },
};

/* ══════════════════════════════════════════════════════════════════ */
/*  MAIN APP                                                          */
/* ══════════════════════════════════════════════════════════════════ */
export default function GeoLiftLibrary() {
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType,   setFilterType]   = useState("all");
  const [search,       setSearch]       = useState("");
  const [viewMode,     setViewMode]     = useState("grid"); // "grid" | "table"
  const [selected,     setSelected]     = useState(null);

  const filtered = useMemo(() => EXPERIMENTS.filter(e => {
    if (filterStatus !== "all" && e.status !== filterStatus) return false;
    if (filterType   !== "all" && e.type   !== filterType)   return false;
    if (search && !e.name.toLowerCase().includes(search.toLowerCase()) &&
        !e.owner.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [filterStatus, filterType, search]);

  const counts = {
    all:      EXPERIMENTS.length,
    complete: EXPERIMENTS.filter(e => e.status === "complete").length,
    active:   EXPERIMENTS.filter(e => e.status === "active").length,
    draft:    EXPERIMENTS.filter(e => e.status === "draft").length,
  };

  const avgLift = EXPERIMENTS
    .filter(e => e.result)
    .reduce((s, e) => s + e.result.lift, 0) /
    EXPERIMENTS.filter(e => e.result).length;

  const totalIncRev = EXPERIMENTS
    .filter(e => e.result)
    .reduce((s, e) => s + e.result.incRevenue, 0);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: font.body, color: C.text }}>
      <GoogleFonts />

      {/* ── TOP NAV ── */}
      <nav style={{
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        padding: "0 28px", height: 52, display: "flex",
        alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ fontFamily: font.heading, fontSize: 17, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>
            <span style={{ color: C.cyan }}>Geo</span>Lift
          </div>
          <div style={{ display: "flex", gap: 0 }}>
            {[
              { id: "library",  label: "Library",  active: true  },
              { id: "templates",label: "Templates", active: false },
              { id: "settings", label: "Settings",  active: false },
            ].map(tab => (
              <button key={tab.id} style={{
                background: "transparent", border: "none",
                borderBottom: tab.active ? `2px solid ${C.cyan}` : "2px solid transparent",
                color: tab.active ? C.cyan : C.muted,
                fontFamily: font.body, fontSize: 13, fontWeight: tab.active ? 600 : 400,
                padding: "0 14px", height: 52, cursor: "pointer",
              }}>{tab.label}</button>
            ))}
          </div>
        </div>
        <button style={{
          background: C.cyan, border: "none", borderRadius: 7,
          color: C.bg, fontFamily: font.body, fontWeight: 700,
          fontSize: 13, padding: "8px 18px", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          + New Experiment
        </button>
      </nav>

      <div style={{ padding: "28px 28px 60px", maxWidth: 1280, margin: "0 auto" }}>

        {/* ── PAGE TITLE ── */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontFamily: font.heading, fontSize: 28, fontWeight: 800, color: "#fff", margin: "0 0 4px", letterSpacing: "-0.02em" }}>
            Experiment Library
          </h1>
          <p style={{ fontFamily: font.mono, fontSize: 12, color: C.muted, margin: 0 }}>
            Design, monitor, and measure all your GeoLift incrementality experiments
          </p>
        </div>

        {/* ── SUMMARY STRIP ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 28 }}>
          <SummaryCard label="Total Experiments" value={counts.all}              color={C.text}  />
          <SummaryCard label="Complete"           value={counts.complete}         color={C.green} icon="✓" />
          <SummaryCard label="Active"             value={counts.active}           color={C.cyan}  pulse />
          <SummaryCard label="Draft"              value={counts.draft}            color={C.muted} />
          <SummaryCard label="Avg Measured Lift"  value={`${avgLift.toFixed(1)}%`} color={C.green} sub={`$${(totalIncRev / 1e6).toFixed(1)}M total inc. revenue`} />
        </div>

        {/* ── FILTERS ── */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 16, flexWrap: "wrap", gap: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {/* Status filter */}
            <div style={{ display: "flex", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 7, padding: 3, gap: 2 }}>
              {[
                { id: "all",      label: `All (${counts.all})`             },
                { id: "active",   label: `Active (${counts.active})`       },
                { id: "complete", label: `Complete (${counts.complete})`   },
                { id: "draft",    label: `Draft (${counts.draft})`         },
              ].map(f => (
                <button key={f.id} onClick={() => setFilterStatus(f.id)} style={{
                  background: filterStatus === f.id ? C.cyanDim : "transparent",
                  border: `1px solid ${filterStatus === f.id ? C.cyan : "transparent"}`,
                  borderRadius: 5, color: filterStatus === f.id ? C.cyan : C.muted,
                  fontFamily: font.mono, fontSize: 11, padding: "4px 12px", cursor: "pointer",
                  transition: "all 0.12s",
                }}>{f.label}</button>
              ))}
            </div>

            {/* Type filter */}
            <div style={{ display: "flex", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 7, padding: 3, gap: 2 }}>
              {[
                { id: "all",    label: "All types"   },
                { id: "single", label: "Single-Cell" },
                { id: "multi",  label: "Multi-Cell"  },
              ].map(f => (
                <button key={f.id} onClick={() => setFilterType(f.id)} style={{
                  background: filterType === f.id ? C.amberDim : "transparent",
                  border: `1px solid ${filterType === f.id ? C.amber : "transparent"}`,
                  borderRadius: 5, color: filterType === f.id ? C.amber : C.muted,
                  fontFamily: font.mono, fontSize: 11, padding: "4px 12px", cursor: "pointer",
                  transition: "all 0.12s",
                }}>{f.label}</button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Search */}
            <div style={{ position: "relative" }}>
              <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: C.muted, fontSize: 12 }}>⌕</span>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search experiments..."
                style={{
                  background: C.surface, border: `1px solid ${C.border}`,
                  borderRadius: 6, color: C.text, fontFamily: font.body,
                  fontSize: 12, padding: "7px 12px 7px 28px", outline: "none",
                  width: 200,
                }}
              />
            </div>
            {/* View toggle */}
            <div style={{ display: "flex", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: 2, gap: 2 }}>
              {["grid", "table"].map(v => (
                <button key={v} onClick={() => setViewMode(v)} style={{
                  background: viewMode === v ? C.surfaceHi : "transparent",
                  border: `1px solid ${viewMode === v ? C.border : "transparent"}`,
                  borderRadius: 4, color: viewMode === v ? C.text : C.muted,
                  fontFamily: font.mono, fontSize: 11, padding: "4px 10px", cursor: "pointer",
                }}>{v === "grid" ? "⊞" : "≡"}</button>
              ))}
            </div>
          </div>
        </div>

        {/* ── EXPERIMENT GRID ── */}
        {viewMode === "grid" && (
          filtered.length === 0
            ? <EmptyState search={search} />
            : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 16 }}>
                {filtered.map(exp => (
                  <ExperimentCard key={exp.id} exp={exp} selected={selected === exp.id} onSelect={() => setSelected(exp.id === selected ? null : exp.id)} />
                ))}
              </div>
        )}

        {/* ── EXPERIMENT TABLE ── */}
        {viewMode === "table" && (
          <ExperimentTable experiments={filtered} />
        )}

      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  EXPERIMENT CARD                                                   */
/* ══════════════════════════════════════════════════════════════════ */
function ExperimentCard({ exp, selected, onSelect }) {
  const sm = STATUS_META[exp.status];
  const isActive   = exp.status === "active";
  const isComplete = exp.status === "complete";
  const isDraft    = exp.status === "draft";

  const progressPct = isActive
    ? Math.round((exp.daysElapsed / exp.testDays) * 100)
    : isDraft
      ? Math.round((exp.bpScore / exp.bpTotal) * 100)
      : 100;

  const daysLeft = isActive ? exp.testDays - exp.daysElapsed : null;

  return (
    <div
      onClick={onSelect}
      style={{
        background: C.surface,
        border: `1px solid ${selected ? C.cyan : C.border}`,
        borderRadius: 12, padding: "18px 20px",
        cursor: "pointer", transition: "all 0.15s",
        boxShadow: selected ? `0 0 0 1px ${C.cyan}` : "none",
        position: "relative", overflow: "hidden",
      }}
    >
      {/* Accent strip at top for status */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 2,
        background: sm.color, opacity: isActive ? 1 : 0.4,
      }} />

      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <StatusBadge status={exp.status} />
          <Tag color={exp.type === "multi" ? C.amber : C.cyan}>
            {exp.type === "multi" ? "Multi-Cell" : "Single-Cell"}
          </Tag>
        </div>
        <span style={{ fontFamily: font.mono, fontSize: 10, color: C.muted }}>{exp.updatedAt}</span>
      </div>

      {/* Name */}
      <div style={{ fontFamily: font.heading, fontSize: 14, fontWeight: 700, color: "#fff", lineHeight: 1.3, marginBottom: 8 }}>
        {exp.name}
      </div>

      {/* Meta row */}
      <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <MetaChip icon="◈" label={exp.kpi} />
        <MetaChip icon="⊛" label={exp.channel} />
        <MetaChip icon="◉" label={exp.geoLevel} />
        <MetaChip icon="◷" label={exp.granularity} />
      </div>

      {/* Date ranges */}
      <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
        <DateItem label="Pre-period"  value={exp.preRange}  />
        <DateItem label="Test window" value={exp.testRange} />
      </div>

      {/* Result metrics — complete */}
      {isComplete && exp.result && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
          <ResultMetric
            label="Lift"
            value={`+${exp.result.lift}%`}
            sub={`[${exp.result.liftLow}%, ${exp.result.liftHigh}%]`}
            color={C.green}
          />
          <ResultMetric
            label="iROAS"
            value={`${exp.result.iROAS}×`}
            color={exp.result.iROAS >= 2 ? C.green : C.amber}
          />
          <ResultMetric
            label="Inc. Revenue"
            value={`$${(exp.result.incRevenue / 1000).toFixed(0)}K`}
            color={C.cyan}
          />
        </div>
      )}

      {/* Progress — active */}
      {isActive && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
            <span style={{ fontFamily: font.mono, fontSize: 10, color: C.muted }}>Flight progress</span>
            <span style={{ fontFamily: font.mono, fontSize: 10, color: C.cyan }}>
              Day {exp.daysElapsed} of {exp.testDays} · <span style={{ color: C.amber }}>{daysLeft}d left</span>
            </span>
          </div>
          <ProgressBar pct={progressPct} color={C.cyan} />
        </div>
      )}

      {/* BP readiness — draft */}
      {isDraft && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
            <span style={{ fontFamily: font.mono, fontSize: 10, color: C.muted }}>Setup progress</span>
            <span style={{ fontFamily: font.mono, fontSize: 10, color: C.muted }}>
              {exp.bpScore}/{exp.bpTotal} checks · Step {exp.wizardStep + 1}/5
            </span>
          </div>
          <ProgressBar pct={progressPct} color={progressPct >= 80 ? C.green : progressPct >= 50 ? C.amber : C.red} />
        </div>
      )}

      {/* Cells row */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {exp.cells.map((cell, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 5,
            background: cell.color + "15", border: `1px solid ${cell.color}40`,
            borderRadius: 4, padding: "2px 8px",
          }}>
            <div style={{ width: 5, height: 5, borderRadius: 99, background: cell.color }} />
            <span style={{ fontFamily: font.mono, fontSize: 10, color: cell.color }}>{cell.label}</span>
          </div>
        ))}
        <div style={{
          background: C.surfaceHi, border: `1px solid ${C.border}`,
          borderRadius: 4, padding: "2px 8px",
          fontFamily: font.mono, fontSize: 10, color: C.muted,
        }}>
          Control pool
        </div>
      </div>

      {/* Footer */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        paddingTop: 12, borderTop: `1px solid ${C.border}`,
      }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontFamily: font.mono, fontSize: 10, color: C.muted }}>{exp.owner}</span>
          {exp.markets > 0 && (
            <span style={{ fontFamily: font.mono, fontSize: 10, color: C.muted }}>· {exp.markets} markets</span>
          )}
          <span style={{ fontFamily: font.mono, fontSize: 10, color: C.muted }}>
            · ${(exp.spend / 1000).toFixed(0)}K spend
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {isComplete && (
            <ActionBtn color={C.green}>View Results</ActionBtn>
          )}
          {isActive && (
            <ActionBtn color={C.cyan}>Monitor</ActionBtn>
          )}
          {isDraft && (
            <ActionBtn color={C.amber}>Continue Setup</ActionBtn>
          )}
          <ActionBtn color={C.muted} minimal>···</ActionBtn>
        </div>
      </div>

      {/* Notes tooltip on hover */}
      {exp.notes && selected && (
        <div style={{
          marginTop: 12, padding: "8px 12px",
          background: C.surfaceHi, border: `1px solid ${C.border}`,
          borderRadius: 6, fontSize: 11, color: C.muted, lineHeight: 1.5,
          fontStyle: "italic",
        }}>
          {exp.notes}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  EXPERIMENT TABLE                                                  */
/* ══════════════════════════════════════════════════════════════════ */
function ExperimentTable({ experiments }) {
  const cols = ["Name", "Status", "Type", "KPI", "Channel", "Test Window", "Markets", "Spend", "Lift %", "iROAS", "Updated", ""];

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: C.surfaceHi }}>
            {cols.map(h => (
              <th key={h} style={{
                fontFamily: font.mono, fontSize: 10, color: C.muted,
                padding: "10px 14px", textAlign: "left", fontWeight: 500,
                borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {experiments.map((exp, i) => {
            const sm = STATUS_META[exp.status];
            return (
              <tr key={exp.id} style={{ borderBottom: `1px solid ${C.border}`, transition: "background 0.1s" }}
                onMouseEnter={e => e.currentTarget.style.background = C.surfaceHi}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <td style={{ padding: "10px 14px", maxWidth: 260 }}>
                  <div style={{ fontWeight: 600, fontSize: 12, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{exp.name}</div>
                  <div style={{ fontFamily: font.mono, fontSize: 10, color: C.muted, marginTop: 2 }}>{exp.owner}</div>
                </td>
                <td style={{ padding: "10px 14px" }}><StatusBadge status={exp.status} /></td>
                <td style={{ padding: "10px 14px" }}>
                  <Tag color={exp.type === "multi" ? C.amber : C.cyan} small>
                    {exp.type === "multi" ? "Multi" : "Single"}
                  </Tag>
                </td>
                <td style={{ fontFamily: font.mono, fontSize: 11, padding: "10px 14px", color: C.muted }}>{exp.kpi}</td>
                <td style={{ fontFamily: font.mono, fontSize: 11, padding: "10px 14px", color: C.muted }}>{exp.channel}</td>
                <td style={{ fontFamily: font.mono, fontSize: 11, padding: "10px 14px", color: C.muted, whiteSpace: "nowrap" }}>{exp.testRange}</td>
                <td style={{ fontFamily: font.mono, fontSize: 11, padding: "10px 14px", color: C.muted, textAlign: "center" }}>{exp.markets || "—"}</td>
                <td style={{ fontFamily: font.mono, fontSize: 11, padding: "10px 14px", color: C.muted }}>${(exp.spend / 1000).toFixed(0)}K</td>
                <td style={{ fontFamily: font.mono, fontSize: 12, padding: "10px 14px", fontWeight: 600, color: exp.result ? C.green : C.muted }}>
                  {exp.result ? `+${exp.result.lift}%` : "—"}
                </td>
                <td style={{ fontFamily: font.mono, fontSize: 12, padding: "10px 14px", color: exp.result ? (exp.result.iROAS >= 2 ? C.green : C.amber) : C.muted }}>
                  {exp.result ? `${exp.result.iROAS}×` : "—"}
                </td>
                <td style={{ fontFamily: font.mono, fontSize: 10, padding: "10px 14px", color: C.muted, whiteSpace: "nowrap" }}>{exp.updatedAt}</td>
                <td style={{ padding: "10px 14px" }}>
                  {exp.status === "complete" && <ActionBtn color={C.green} small>Results</ActionBtn>}
                  {exp.status === "active"   && <ActionBtn color={C.cyan}  small>Monitor</ActionBtn>}
                  {exp.status === "draft"    && <ActionBtn color={C.amber} small>Edit</ActionBtn>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  PRIMITIVES                                                        */
/* ══════════════════════════════════════════════════════════════════ */
function GoogleFonts() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap');
      *, *::before, *::after { box-sizing: border-box; }
      ::-webkit-scrollbar { width: 4px; background: ${C.bg}; }
      ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
      @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
    `}</style>
  );
}

function SummaryCard({ label, value, color, sub, pulse, icon }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        {pulse && <div style={{ width: 6, height: 6, borderRadius: 99, background: C.cyan, animation: "pulse 1.8s infinite" }} />}
        {icon && <span style={{ color, fontSize: 11 }}>{icon}</span>}
        <span style={{ fontFamily: font.mono, fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      </div>
      <div style={{ fontFamily: font.heading, fontSize: 24, fontWeight: 800, color, letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontFamily: font.mono, fontSize: 10, color: C.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }) {
  const sm = STATUS_META[status];
  return (
    <span style={{
      background: sm.bg, border: `1px solid ${sm.color}40`,
      color: sm.color, borderRadius: 99, fontSize: 10, fontWeight: 700,
      padding: "2px 9px", fontFamily: font.mono,
      display: "inline-flex", alignItems: "center", gap: 5,
    }}>
      {status === "active" && <span style={{ width: 5, height: 5, borderRadius: 99, background: sm.color, animation: "pulse 1.8s infinite" }} />}
      {sm.label}
    </span>
  );
}

function Tag({ color, children, small }) {
  return (
    <span style={{
      background: color + "20", border: `1px solid ${color}50`, color,
      borderRadius: 4, fontSize: small ? 10 : 10, fontWeight: 700,
      padding: "2px 7px", fontFamily: font.mono,
    }}>{children}</span>
  );
}

function MetaChip({ icon, label }) {
  return (
    <span style={{ fontFamily: font.mono, fontSize: 10, color: C.muted, display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontSize: 9 }}>{icon}</span>{label}
    </span>
  );
}

function DateItem({ label, value }) {
  return (
    <div>
      <div style={{ fontFamily: font.mono, fontSize: 9, color: C.muted, marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontFamily: font.mono, fontSize: 10, color: C.text }}>{value}</div>
    </div>
  );
}

function ResultMetric({ label, value, sub, color }) {
  return (
    <div style={{ background: C.surfaceHi, borderRadius: 7, padding: "10px 12px" }}>
      <div style={{ fontFamily: font.mono, fontSize: 9, color: C.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontFamily: font.heading, fontSize: 16, fontWeight: 800, color, letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div style={{ fontFamily: font.mono, fontSize: 9, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function ProgressBar({ pct, color }) {
  return (
    <div style={{ height: 4, background: C.border, borderRadius: 2 }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2, transition: "width 0.3s" }} />
    </div>
  );
}

function ActionBtn({ color, children, minimal, small }) {
  return (
    <button style={{
      background: minimal ? "transparent" : color + "18",
      border: `1px solid ${minimal ? C.border : color + "50"}`,
      borderRadius: 5, color: minimal ? C.muted : color,
      fontFamily: font.mono, fontSize: small ? 10 : 11,
      fontWeight: 600, padding: small ? "3px 8px" : "4px 10px",
      cursor: "pointer", whiteSpace: "nowrap",
    }}>{children}</button>
  );
}

function EmptyState({ search }) {
  return (
    <div style={{ textAlign: "center", padding: "80px 0", color: C.muted }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>◈</div>
      <div style={{ fontFamily: font.heading, fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 6 }}>
        {search ? `No experiments matching "${search}"` : "No experiments yet"}
      </div>
      <div style={{ fontFamily: font.mono, fontSize: 12 }}>
        {search ? "Try a different search term" : "Click + New Experiment to get started"}
      </div>
    </div>
  );
}
