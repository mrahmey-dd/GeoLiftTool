import { useState, useMemo } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, Legend,
  BarChart, Bar, Cell as RCell, ErrorBar,
} from "recharts";

/* ─── DESIGN TOKENS (same language as the wizard) ───────────────── */
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

/* ─── SEEDED PSEUDO-RANDOM ───────────────────────────────────────── */
function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
}

/* ─── GENERATE EXPERIMENT DATA ───────────────────────────────────── */
function generateData(cellConfig) {
  const rng   = seededRng(42);
  const noise = (amp = 1) => (rng() - 0.5) * 2 * amp;

  const PRE_DAYS  = 63;  // 9 weeks pre-period
  const TEST_DAYS = 21;  // 3 week test

  const startDate  = new Date("2024-09-01");
  const testStart  = new Date("2024-11-03");

  const series = [];
  for (let i = 0; i < PRE_DAYS + TEST_DAYS; i++) {
    const d    = new Date(startDate);
    d.setDate(d.getDate() + i);
    const isTest = i >= PRE_DAYS;
    const dow    = d.getDay(); // weekday effect
    const dowMult = [0.78, 1.05, 1.08, 1.10, 1.12, 1.15, 0.90][dow];
    const trend  = 1 + (i / (PRE_DAYS + TEST_DAYS)) * 0.04;
    const base   = 82000 * dowMult * trend;

    const synthetic = base + noise(4200);
    const liftPct   = isTest ? cellConfig.liftPct / 100 : 0;
    const actual    = isTest
      ? synthetic * (1 + liftPct) + noise(3800)
      : synthetic + noise(1600); // tighter fit in pre-period

    const ciHalf = base * 0.022;

    series.push({
      date:      d.toISOString().slice(0, 10),
      label:     d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      actual:    Math.round(actual),
      synthetic: Math.round(synthetic),
      ciLow:     Math.round(synthetic - ciHalf),
      ciHigh:    Math.round(synthetic + ciHalf),
      isTest,
      lift:      isTest ? Math.round(actual - synthetic) : null,
    });
  }
  return { series, testStartDate: testStart.toISOString().slice(0, 10) };
}

/* ─── EXPERIMENT FIXTURE ─────────────────────────────────────────── */
const EXPERIMENTS = {
  single: {
    name:       "Q4 Meta Paid Social — US DMA Lift Test",
    type:       "single",
    kpi:        "Revenue",
    geoLevel:   "DMA",
    channel:    "Meta",
    preRange:   "Sep 1 – Nov 2, 2024",
    testRange:  "Nov 3 – Nov 23, 2024",
    spend:      325000,
    cells: [
      { id: "t1", label: "Treatment", color: C.cyan,   liftPct: 7.4 },
    ],
  },
  multi: {
    name:       "Q4 Budget Calibration — Multi-Cell DMA Test",
    type:       "multi",
    kpi:        "Revenue",
    geoLevel:   "DMA",
    channel:    "Meta",
    preRange:   "Sep 1 – Nov 2, 2024",
    testRange:  "Nov 3 – Nov 23, 2024",
    spend:      650000,
    cells: [
      { id: "t1", label: "Cell A — $150K",  color: C.cyan,   liftPct: 6.1  },
      { id: "t2", label: "Cell B — $325K",  color: C.amber,  liftPct: 9.8  },
      { id: "t3", label: "Cell C — $500K",  color: C.purple, liftPct: 10.3 },
    ],
  },
};

/* ─── DERIVED STATS ──────────────────────────────────────────────── */
function deriveStats(cell, series) {
  const testSeries = series.filter(d => d.isTest);
  const preSeries  = series.filter(d => !d.isTest);

  const totalActual    = testSeries.reduce((s, d) => s + d.actual, 0);
  const totalSynthetic = testSeries.reduce((s, d) => s + d.synthetic, 0);
  const totalLift      = totalActual - totalSynthetic;
  const pctLift        = (totalLift / totalSynthetic) * 100;

  const preActual = preSeries.map(d => d.actual);
  const preSynth  = preSeries.map(d => d.synthetic);
  const mape      = preActual.reduce((sum, a, i) => sum + Math.abs(a - preSynth[i]) / a, 0) / preActual.length * 100;
  const bias      = preActual.reduce((sum, a, i) => sum + (a - preSynth[i]), 0) / preActual.length;

  return {
    totalLift:   Math.round(totalLift),
    pctLift:     pctLift.toFixed(1),
    pctLiftLow:  (pctLift - 2.1).toFixed(1),
    pctLiftHigh: (pctLift + 2.1).toFixed(1),
    att:         Math.round(totalLift / testSeries.length),
    mape:        mape.toFixed(2),
    bias:        Math.round(bias),
    pValue:      0.031,
    r2:          0.974,
  };
}

/* ══════════════════════════════════════════════════════════════════ */
/*  MAIN APP                                                          */
/* ══════════════════════════════════════════════════════════════════ */
export default function GeoLiftResults() {
  const [expType,      setExpType]      = useState("single");
  const [activeCell,   setActiveCell]   = useState(0);
  const [showCI,       setShowCI]       = useState(true);
  const [showLiftGap,  setShowLiftGap]  = useState(true);
  const [activeTab,    setActiveTab]    = useState("overview");

  const exp = EXPERIMENTS[expType];

  const cellData = useMemo(() =>
    exp.cells.map(cell => {
      const { series, testStartDate } = generateData(cell);
      return { cell, series, testStartDate, stats: deriveStats(cell, series) };
    }),
  [expType]);

  const primary  = cellData[activeCell];
  const spend    = exp.spend / exp.cells.length;
  const iROAS    = (primary.stats.totalLift / spend).toFixed(2);
  const costPerInc = Math.round(spend / (primary.stats.totalLift / 85000 * 1000)); // illustrative

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: font.body, color: C.text }}>
      <GoogleFonts />

      {/* ── TOP NAV ── */}
      <nav style={{
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        padding: "0 28px", height: 52, display: "flex", alignItems: "center",
        justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontFamily: font.heading, fontSize: 17, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>
            <span style={{ color: C.cyan }}>Geo</span>Lift
          </div>
          <ChevRight />
          <span style={{ fontFamily: font.mono, fontSize: 11, color: C.muted }}>Results</span>
          <ChevRight />
          <span style={{ fontFamily: font.mono, fontSize: 11, color: C.text, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{exp.name}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* demo toggle */}
          <div style={{ display: "flex", background: C.surfaceHi, border: `1px solid ${C.border}`, borderRadius: 6, padding: 3, gap: 3 }}>
            {["single", "multi"].map(t => (
              <button key={t} onClick={() => { setExpType(t); setActiveCell(0); }} style={{
                background: expType === t ? C.cyanDim : "transparent",
                border: `1px solid ${expType === t ? C.cyan : "transparent"}`,
                borderRadius: 4, color: expType === t ? C.cyan : C.muted,
                fontFamily: font.mono, fontSize: 10, padding: "4px 10px", cursor: "pointer",
              }}>{t === "single" ? "Single-Cell" : "Multi-Cell"}</button>
            ))}
          </div>
          <ExportBtn />
        </div>
      </nav>

      {/* ── EXPERIMENT HEADER ── */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "20px 28px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <StatusPill>Complete</StatusPill>
              <Tag color={exp.type === "multi" ? C.amber : C.cyan}>{exp.type === "multi" ? "Multi-Cell" : "Single-Cell"}</Tag>
              <Tag color={C.blue}>{exp.channel}</Tag>
              <Tag color={C.muted}>{exp.geoLevel}</Tag>
            </div>
            <h1 style={{ fontFamily: font.heading, fontSize: 22, fontWeight: 800, color: "#fff", margin: 0, letterSpacing: "-0.02em" }}>
              {exp.name}
            </h1>
            <div style={{ display: "flex", gap: 20, marginTop: 6 }}>
              <MetaItem label="Pre-period"  value={exp.preRange} />
              <MetaItem label="Test window" value={exp.testRange} />
              <MetaItem label="KPI"         value={exp.kpi} />
              <MetaItem label="Total spend" value={`$${exp.spend.toLocaleString()}`} />
            </div>
          </div>
        </div>
      </div>

      {/* ── CELL TABS (multi only) ── */}
      {exp.type === "multi" && (
        <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "0 28px", display: "flex", gap: 0 }}>
          {cellData.map(({ cell }, i) => (
            <button key={cell.id} onClick={() => setActiveCell(i)} style={{
              padding: "12px 20px", background: "transparent",
              borderBottom: activeCell === i ? `2px solid ${cell.color}` : "2px solid transparent",
              border: "none", color: activeCell === i ? cell.color : C.muted,
              fontFamily: font.mono, fontSize: 12, fontWeight: activeCell === i ? 600 : 400,
              cursor: "pointer", transition: "all 0.15s",
            }}>
              {cell.label}
            </button>
          ))}
          <button onClick={() => setActiveCell(-1)} style={{
            padding: "12px 20px", background: "transparent",
            borderBottom: activeCell === -1 ? `2px solid ${C.text}` : "2px solid transparent",
            border: "none", color: activeCell === -1 ? C.text : C.muted,
            fontFamily: font.mono, fontSize: 12, cursor: "pointer", transition: "all 0.15s",
          }}>
            All Cells
          </button>
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      <div style={{ padding: "28px 28px 60px" }}>

        {/* ── HERO METRICS ── */}
        {activeCell >= 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12, marginBottom: 24 }}>
            <HeroMetric
              label="Incremental Revenue"
              value={`$${(primary.stats.totalLift / 1000).toFixed(0)}K`}
              sub={`$${primary.stats.att.toLocaleString()}/day avg`}
              color={C.green}
              large
            />
            <HeroMetric
              label="Lift %"
              value={`+${primary.stats.pctLift}%`}
              sub={`90% CI [${primary.stats.pctLiftLow}%, ${primary.stats.pctLiftHigh}%]`}
              color={C.cyan}
              large
            />
            <HeroMetric
              label="iROAS"
              value={`${iROAS}×`}
              sub={`$${spend.toLocaleString()} spend`}
              color={parseFloat(iROAS) >= 2 ? C.green : C.amber}
            />
            <HeroMetric
              label="p-value"
              value={primary.stats.pValue}
              sub={primary.stats.pValue <= 0.05 ? "Statistically significant" : "Not significant"}
              color={primary.stats.pValue <= 0.05 ? C.green : C.red}
            />
            <HeroMetric
              label="Pre-period Fit (R²)"
              value={primary.stats.r2}
              sub={`MAPE ${primary.stats.mape}%`}
              color={parseFloat(primary.stats.r2) >= 0.95 ? C.green : C.amber}
            />
          </div>
        )}

        {/* ── ALL-CELLS COMPARE (multi, activeCell === -1) ── */}
        {activeCell === -1 && <AllCellsCompare cellData={cellData} exp={exp} />}

        {/* ── COUNTERFACTUAL CHART ── */}
        {activeCell >= 0 && (
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 20px 12px", marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: font.heading, fontSize: 15, fontWeight: 700, color: "#fff" }}>
                  Actual vs Synthetic Control
                </div>
                <div style={{ fontFamily: font.mono, fontSize: 11, color: C.muted, marginTop: 3 }}>
                  Daily {exp.kpi} — treatment geos vs estimated counterfactual
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <ToggleChip active={showCI} onClick={() => setShowCI(v => !v)} color={C.blue}>95% CI band</ToggleChip>
                <ToggleChip active={showLiftGap} onClick={() => setShowLiftGap(v => !v)} color={C.green}>Lift gap</ToggleChip>
              </div>
            </div>

            <CounterfactualChart
              series={primary.series}
              testStartDate={primary.testStartDate}
              cellColor={primary.cell.color}
              showCI={showCI}
              showLiftGap={showLiftGap}
              kpi={exp.kpi}
            />

            <div style={{ display: "flex", gap: 20, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
              <LegendItem color={primary.cell.color} label="Actual (treatment geos)" solid />
              <LegendItem color={C.muted} label="Synthetic control" dashed />
              {showCI && <LegendItem color={C.blue} label="95% confidence interval" area />}
              {showLiftGap && <LegendItem color={C.green} label="Incremental lift" area />}
              <div style={{ marginLeft: "auto", fontFamily: font.mono, fontSize: 10, color: C.muted }}>
                Pre-period fit R² = {primary.stats.r2} · MAPE = {primary.stats.mape}%
              </div>
            </div>
          </div>
        )}

        {/* ── LOWER ROW ── */}
        {activeCell >= 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
            <StatisticalValidityPanel stats={primary.stats} />
            <DailyLiftPanel series={primary.series} color={primary.cell.color} />
          </div>
        )}

        {/* ── GEO TABLE ── */}
        {activeCell >= 0 && (
          <div style={{ marginTop: 20 }}>
            <GeoTable color={primary.cell.color} />
          </div>
        )}

      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  COUNTERFACTUAL CHART                                             */
/* ══════════════════════════════════════════════════════════════════ */
function CounterfactualChart({ series, testStartDate, cellColor, showCI, showLiftGap, kpi }) {
  // Build chart data: add liftLow/liftHigh for gap shading
  const data = series.map(d => ({
    ...d,
    liftArea: d.isTest ? [d.synthetic, d.actual] : null,
    liftLow:  d.isTest ? d.synthetic : null,
    liftHigh: d.isTest ? d.actual    : null,
  }));

  const fmt = v => `$${(v / 1000).toFixed(0)}K`;

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    return (
      <div style={{
        background: C.surfaceHi, border: `1px solid ${C.borderHi}`,
        borderRadius: 8, padding: "10px 14px", fontFamily: font.mono, fontSize: 11,
      }}>
        <div style={{ color: C.muted, marginBottom: 6 }}>{d.date}</div>
        <div style={{ color: cellColor, marginBottom: 3 }}>Actual: {fmt(d.actual)}</div>
        <div style={{ color: C.muted, marginBottom: d.isTest ? 3 : 0 }}>Synthetic: {fmt(d.synthetic)}</div>
        {d.isTest && d.lift !== null && (
          <div style={{ color: C.green, marginTop: 3, paddingTop: 3, borderTop: `1px solid ${C.border}` }}>
            Lift: +{fmt(d.lift)} (+{((d.lift / d.synthetic) * 100).toFixed(1)}%)
          </div>
        )}
      </div>
    );
  };

  // Tick every ~10 points
  const ticks = series.filter((_, i) => i % 10 === 0).map(d => d.date);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
        <defs>
          <linearGradient id="liftGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.green} stopOpacity={0.35} />
            <stop offset="100%" stopColor={C.green} stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="ciGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.blue} stopOpacity={0.15} />
            <stop offset="100%" stopColor={C.blue} stopOpacity={0.04} />
          </linearGradient>
        </defs>

        <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />

        <XAxis
          dataKey="date"
          ticks={ticks}
          tick={{ fontFamily: font.mono, fontSize: 10, fill: C.muted }}
          axisLine={false} tickLine={false}
          tickFormatter={v => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        />
        <YAxis
          tick={{ fontFamily: font.mono, fontSize: 10, fill: C.muted }}
          axisLine={false} tickLine={false}
          tickFormatter={fmt}
          width={52}
        />

        {/* Test window background */}
        <ReferenceLine
          x={testStartDate}
          stroke={C.amber}
          strokeDasharray="4 3"
          strokeWidth={1.5}
          label={{ value: "Test start", position: "top", fill: C.amber, fontSize: 10, fontFamily: font.mono }}
        />

        {/* CI band */}
        {showCI && (
          <>
            <Area dataKey="ciHigh" stroke="none" fill="url(#ciGrad)" isAnimationActive={false} legendType="none" />
            <Area dataKey="ciLow"  stroke="none" fill={C.bg}         isAnimationActive={false} legendType="none" />
          </>
        )}

        {/* Lift gap */}
        {showLiftGap && (
          <>
            <Area dataKey="liftHigh" stroke="none" fill="url(#liftGrad)" isAnimationActive={false} legendType="none" activeDot={false} />
            <Area dataKey="liftLow"  stroke="none" fill={C.bg}           isAnimationActive={false} legendType="none" activeDot={false} />
          </>
        )}

        {/* Synthetic control */}
        <Line
          dataKey="synthetic"
          stroke={C.muted}
          strokeWidth={1.5}
          strokeDasharray="5 3"
          dot={false}
          isAnimationActive={false}
          legendType="none"
        />

        {/* Actual */}
        <Line
          dataKey="actual"
          stroke={cellColor}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          legendType="none"
        />

        <Tooltip content={<CustomTooltip />} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  ALL-CELLS COMPARE                                                */
/* ══════════════════════════════════════════════════════════════════ */
function AllCellsCompare({ cellData, exp }) {
  const barData = cellData.map(({ cell, stats }) => ({
    name:      cell.label,
    lift:      parseFloat(stats.pctLift),
    liftLow:   parseFloat(stats.pctLiftLow),
    liftHigh:  parseFloat(stats.pctLiftHigh),
    color:     cell.color,
    iROAS:     (stats.totalLift / (exp.spend / exp.cells.length)).toFixed(2),
    incRev:    stats.totalLift,
  }));

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Summary table */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 16 }}>
        <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, fontFamily: font.heading, fontSize: 13, fontWeight: 700, color: "#fff" }}>
          Cell Comparison
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: C.surfaceHi }}>
              {["Cell", "Spend", "Inc. Revenue", "Lift %", "90% CI", "iROAS", "p-value", "MAPE"].map(h => (
                <th key={h} style={{ fontFamily: font.mono, fontSize: 10, color: C.muted, padding: "8px 16px", textAlign: "left", fontWeight: 500, borderBottom: `1px solid ${C.border}` }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cellData.map(({ cell, stats }, i) => {
              const spend = exp.spend / exp.cells.length;
              const iroas = (stats.totalLift / spend).toFixed(2);
              return (
                <tr key={cell.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: "10px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: cell.color }} />
                      <span style={{ fontWeight: 600, fontSize: 12 }}>{cell.label}</span>
                    </div>
                  </td>
                  <td style={{ fontFamily: font.mono, fontSize: 12, padding: "10px 16px", color: C.muted }}>${spend.toLocaleString()}</td>
                  <td style={{ fontFamily: font.mono, fontSize: 12, padding: "10px 16px", color: C.green }}>+${(stats.totalLift / 1000).toFixed(0)}K</td>
                  <td style={{ fontFamily: font.mono, fontSize: 12, padding: "10px 16px", color: cell.color }}>+{stats.pctLift}%</td>
                  <td style={{ fontFamily: font.mono, fontSize: 11, padding: "10px 16px", color: C.muted }}>[{stats.pctLiftLow}%, {stats.pctLiftHigh}%]</td>
                  <td style={{ fontFamily: font.mono, fontSize: 12, padding: "10px 16px", color: parseFloat(iroas) >= 2 ? C.green : C.amber }}>{iroas}×</td>
                  <td style={{ fontFamily: font.mono, fontSize: 12, padding: "10px 16px", color: C.green }}>0.031</td>
                  <td style={{ fontFamily: font.mono, fontSize: 12, padding: "10px 16px", color: C.muted }}>{stats.mape}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Lift bar chart */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 20px 12px" }}>
        <div style={{ fontFamily: font.heading, fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 16 }}>Lift % by Cell</div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={barData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={C.border} strokeDasharray="3 3" horizontal vertical={false} />
            <XAxis dataKey="name" tick={{ fontFamily: font.mono, fontSize: 10, fill: C.muted }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontFamily: font.mono, fontSize: 10, fill: C.muted }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
            <Tooltip
              formatter={(v) => [`${v}%`, "Lift"]}
              contentStyle={{ background: C.surfaceHi, border: `1px solid ${C.borderHi}`, borderRadius: 6, fontFamily: font.mono, fontSize: 11 }}
            />
            <Bar dataKey="lift" radius={[4, 4, 0, 0]}>
              {barData.map((d, i) => <RCell key={i} fill={d.color} fillOpacity={0.85} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  STAT PANELS                                                       */
/* ══════════════════════════════════════════════════════════════════ */
function StatisticalValidityPanel({ stats }) {
  const checks = [
    { label: "Pre-period model fit (R²)",      value: stats.r2,              threshold: 0.95, format: v => v,      good: v => v >= 0.95 },
    { label: "MAPE (pre-period)",               value: `${stats.mape}%`,      threshold: null, format: v => v,      good: v => parseFloat(v) <= 3 },
    { label: "Bias (pre-period avg Δ/day)",     value: `$${Math.abs(stats.bias).toLocaleString()}`, threshold: null, format: v => v, good: () => Math.abs(stats.bias) < 1000 },
    { label: "ATT (avg daily lift)",            value: `$${stats.att.toLocaleString()}`, threshold: null, format: v => v, good: () => stats.att > 0 },
    { label: "p-value",                         value: stats.pValue,          threshold: 0.05, format: v => v,      good: v => v <= 0.05 },
    { label: "90% CI lower bound",              value: `${stats.pctLiftLow}%`, threshold: null, format: v => v,     good: v => parseFloat(v) > 0 },
  ];

  return (
    <Panel title="Statistical Validity">
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {checks.map(({ label, value, good }) => {
          const passing = good(value);
          return (
            <div key={label} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "9px 0", borderBottom: `1px solid ${C.border}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 6, height: 6, borderRadius: 99, background: passing ? C.green : C.amber, flexShrink: 0 }} />
                <span style={{ fontFamily: font.mono, fontSize: 11, color: C.muted }}>{label}</span>
              </div>
              <span style={{ fontFamily: font.mono, fontSize: 12, fontWeight: 600, color: passing ? C.green : C.amber }}>{value}</span>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 14, padding: "10px 12px", background: C.greenDim, border: `1px solid ${C.green}30`, borderRadius: 6 }}>
        <div style={{ fontFamily: font.mono, fontSize: 11, color: C.green, fontWeight: 600 }}>✓ Experiment is valid</div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>All validity checks passed. Results can be used with high confidence.</div>
      </div>
    </Panel>
  );
}

function DailyLiftPanel({ series, color }) {
  const testData = series.filter(d => d.isTest).map(d => ({
    ...d,
    liftPct: d.lift !== null ? ((d.lift / d.synthetic) * 100).toFixed(1) : 0,
  }));

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    return (
      <div style={{ background: C.surfaceHi, border: `1px solid ${C.borderHi}`, borderRadius: 6, padding: "8px 12px", fontFamily: font.mono, fontSize: 11 }}>
        <div style={{ color: C.muted }}>{d.date}</div>
        <div style={{ color: C.green, marginTop: 4 }}>+${d.lift?.toLocaleString()} (+{d.liftPct}%)</div>
      </div>
    );
  };

  return (
    <Panel title="Daily Incremental Lift (Test Period)">
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={testData} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fontFamily: font.mono, fontSize: 9, fill: C.muted }}
            axisLine={false} tickLine={false}
            tickFormatter={v => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            interval={3}
          />
          <YAxis
            tick={{ fontFamily: font.mono, fontSize: 9, fill: C.muted }}
            axisLine={false} tickLine={false}
            tickFormatter={v => `$${(v / 1000).toFixed(0)}K`}
            width={44}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="lift" fill={C.green} fillOpacity={0.7} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <StatChip label="Total lift" value={`$${(testData.reduce((s, d) => s + (d.lift || 0), 0) / 1000).toFixed(0)}K`} color={C.green} />
        <StatChip label="Peak day" value={`$${Math.max(...testData.map(d => d.lift || 0)).toLocaleString()}`} color={color} />
        <StatChip label="Avg / day" value={`$${Math.round(testData.reduce((s, d) => s + (d.lift || 0), 0) / testData.length).toLocaleString()}`} color={C.muted} />
      </div>
    </Panel>
  );
}

/* ══════════════════════════════════════════════════════════════════ */
/*  GEO TABLE                                                         */
/* ══════════════════════════════════════════════════════════════════ */
function GeoTable({ color }) {
  const rng = seededRng(99);
  const geos = [
    "New York, NY", "Los Angeles, CA", "Chicago, IL", "Houston, TX",
    "Phoenix, AZ", "Philadelphia, PA", "San Antonio, TX", "San Diego, CA",
  ].map(name => {
    const base = 40000 + rng() * 60000;
    const lift = (rng() * 0.14 + 0.02);
    return {
      name,
      actual:    Math.round(base * (1 + lift)),
      synthetic: Math.round(base),
      liftPct:   (lift * 100).toFixed(1),
      liftAbs:   Math.round(base * lift),
      status:    lift > 0.07 ? "high" : lift > 0.04 ? "mid" : "low",
    };
  });

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: font.heading, fontSize: 13, fontWeight: 700, color: "#fff" }}>Geo-Level Breakdown</div>
        <div style={{ fontFamily: font.mono, fontSize: 10, color: C.muted }}>Treatment markets · sorted by lift</div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: C.surfaceHi }}>
            {["Market", "Actual", "Synthetic", "Inc. Revenue", "Lift %", "Contribution"].map(h => (
              <th key={h} style={{ fontFamily: font.mono, fontSize: 10, color: C.muted, padding: "8px 16px", textAlign: "left", fontWeight: 500, borderBottom: `1px solid ${C.border}` }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {geos.sort((a, b) => parseFloat(b.liftPct) - parseFloat(a.liftPct)).map((g, i) => {
            const totalLift = geos.reduce((s, g) => s + g.liftAbs, 0);
            const contribPct = ((g.liftAbs / totalLift) * 100).toFixed(0);
            const liftColor = g.status === "high" ? C.green : g.status === "mid" ? C.cyan : C.muted;
            return (
              <tr key={g.name} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: "9px 16px", fontSize: 12, fontWeight: 500 }}>{g.name}</td>
                <td style={{ fontFamily: font.mono, fontSize: 12, padding: "9px 16px", color: C.text }}>${(g.actual / 1000).toFixed(0)}K</td>
                <td style={{ fontFamily: font.mono, fontSize: 12, padding: "9px 16px", color: C.muted }}>${(g.synthetic / 1000).toFixed(0)}K</td>
                <td style={{ fontFamily: font.mono, fontSize: 12, padding: "9px 16px", color: C.green }}>+${(g.liftAbs / 1000).toFixed(0)}K</td>
                <td style={{ padding: "9px 16px" }}>
                  <span style={{ fontFamily: font.mono, fontSize: 12, color: liftColor, fontWeight: 600 }}>+{g.liftPct}%</span>
                </td>
                <td style={{ padding: "9px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, height: 4, background: C.border, borderRadius: 2 }}>
                      <div style={{ width: `${contribPct}%`, height: "100%", background: color, borderRadius: 2, opacity: 0.7 }} />
                    </div>
                    <span style={{ fontFamily: font.mono, fontSize: 10, color: C.muted, width: 28 }}>{contribPct}%</span>
                  </div>
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
    `}</style>
  );
}

function HeroMetric({ label, value, sub, color, large }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px" }}>
      <div style={{ fontFamily: font.mono, fontSize: 10, color: C.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontFamily: font.heading, fontSize: large ? 26 : 22, fontWeight: 800, color, letterSpacing: "-0.02em", lineHeight: 1 }}>{value}</div>
      <div style={{ fontFamily: font.mono, fontSize: 10, color: C.muted, marginTop: 6 }}>{sub}</div>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 20px" }}>
      <div style={{ fontFamily: font.heading, fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 14 }}>{title}</div>
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

function StatusPill({ children }) {
  return (
    <span style={{ background: C.greenDim, border: `1px solid ${C.green}50`, color: C.green, borderRadius: 99, fontSize: 10, fontWeight: 700, padding: "2px 10px", fontFamily: font.mono, display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 5, height: 5, borderRadius: 99, background: C.green }} />
      {children}
    </span>
  );
}

function MetaItem({ label, value }) {
  return (
    <div>
      <span style={{ fontFamily: font.mono, fontSize: 10, color: C.muted }}>{label}: </span>
      <span style={{ fontFamily: font.mono, fontSize: 10, color: C.text }}>{value}</span>
    </div>
  );
}

function ToggleChip({ active, onClick, color, children }) {
  return (
    <button onClick={onClick} style={{
      background: active ? color + "18" : "transparent",
      border: `1px solid ${active ? color + "60" : C.border}`,
      borderRadius: 5, color: active ? color : C.muted,
      fontFamily: font.mono, fontSize: 10, padding: "4px 10px", cursor: "pointer", transition: "all 0.15s",
    }}>{children}</button>
  );
}

function StatChip({ label, value, color }) {
  return (
    <div style={{ background: C.surfaceHi, border: `1px solid ${C.border}`, borderRadius: 5, padding: "5px 10px", display: "flex", gap: 6, alignItems: "center" }}>
      <span style={{ fontFamily: font.mono, fontSize: 11, fontWeight: 600, color }}>{value}</span>
      <span style={{ fontFamily: font.mono, fontSize: 10, color: C.muted }}>{label}</span>
    </div>
  );
}

function LegendItem({ color, label, solid, dashed, area }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {dashed
        ? <svg width={20} height={10}><line x1="0" y1="5" x2="20" y2="5" stroke={color} strokeWidth={1.5} strokeDasharray="4 3" /></svg>
        : area
          ? <div style={{ width: 12, height: 8, background: color, borderRadius: 2, opacity: 0.5 }} />
          : <div style={{ width: 16, height: 2, background: color, borderRadius: 1 }} />
      }
      <span style={{ fontFamily: font.mono, fontSize: 10, color: C.muted }}>{label}</span>
    </div>
  );
}

function ChevRight() {
  return <span style={{ color: C.border, fontSize: 12 }}>›</span>;
}

function ExportBtn() {
  return (
    <button style={{
      background: C.cyanDim, border: `1px solid ${C.cyan}50`, borderRadius: 6,
      color: C.cyan, fontFamily: font.mono, fontSize: 11, padding: "6px 14px", cursor: "pointer",
      display: "flex", alignItems: "center", gap: 6,
    }}>
      ↓ Export report
    </button>
  );
}
