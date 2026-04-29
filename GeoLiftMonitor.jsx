import { useState, useMemo, useEffect } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
  BarChart, Bar, Cell as RCell,
} from "recharts";

/* ─── DESIGN TOKENS ─────────────────────────────────────────────── */
const C = {
  bg:"#080b10", surface:"#0e1219", surfaceHi:"#141923",
  border:"#1e2733", borderHi:"#2a3545", text:"#cfd8e3", muted:"#5a6a7e",
  cyan:"#00c9a7",   cyanDim:"#00c9a718",
  amber:"#f5a623",  amberDim:"#f5a62318",
  red:"#f04a5a",    redDim:"#f04a5a18",
  green:"#3dd68c",  greenDim:"#3dd68c18",
  blue:"#4e9eff",   blueDim:"#4e9eff12",
  purple:"#a78bfa",
};
const font = {
  heading:"'Syne',sans-serif",
  mono:"'DM Mono',monospace",
  body:"'Inter',system-ui,sans-serif",
};

/* ─── SEEDED RNG ─────────────────────────────────────────────────── */
function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

/* ─── EXPERIMENT FIXTURE (active test, day 17 of 28) ─────────────── */
const EXP = {
  id:             "exp-00000000-0000-0000-0000-000000000003",
  name:           "Q1 Brand Awareness — Social Upper Funnel",
  kpi:            "Reach",
  type:           "single",
  channel:        "Meta",
  geoLevel:       "City",
  testStart:      new Date("2025-01-06"),
  testEnd:        new Date("2025-02-02"),
  preStart:       new Date("2024-11-01"),
  daysElapsed:    17,
  testDays:       28,
  spend:          210000,
  spendToDate:    127500,
  plannedDailySpend: 7500,
  treatmentGeos:  ["New York", "Chicago", "Philadelphia", "Boston", "Washington DC",
                   "Atlanta", "Miami", "Dallas"],
  controlGeos:    ["Los Angeles", "San Francisco", "Seattle", "Denver",
                   "Minneapolis", "Portland", "Salt Lake City", "Kansas City"],
};

/* ─── GENERATE LIVE DATA ─────────────────────────────────────────── */
function genData(daysElapsed) {
  const rng = seededRng(42);
  const noise = (a=1) => (rng() - 0.5) * 2 * a;

  const PRE_DAYS  = 63;
  const startDate = new Date("2024-11-01");

  return Array.from({ length: PRE_DAYS + daysElapsed }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    const isTest  = i >= PRE_DAYS;
    const dowMult = [0.78,1.05,1.08,1.10,1.12,1.15,0.90][d.getDay()];
    const base    = 1_250_000 * dowMult * (1 + i * 0.0005);
    const syn     = base + noise(48000);
    const act     = isTest
      ? syn * 1.052 + noise(42000)   // ~5.2% lift signal (noisy)
      : syn + noise(22000);

    // Confidence interval — narrows as test progresses
    const testDay   = isTest ? i - PRE_DAYS + 1 : 0;
    const ciHalfPct = isTest ? Math.max(0.08, 0.22 - testDay * 0.005) : 0.022;
    const ciHalf    = syn * ciHalfPct;

    return {
      date:      d.toLocaleDateString("en-US", { month:"short", day:"numeric" }),
      fullDate:  d.toISOString().slice(0, 10),
      actual:    Math.round(act),
      synthetic: Math.round(syn),
      ciHigh:    Math.round(syn + ciHalf),
      ciLow:     Math.round(syn - ciHalf),
      liftHigh:  isTest ? Math.round(act) : null,
      liftLow:   isTest ? Math.round(syn) : null,
      lift:      isTest ? Math.round(act - syn) : null,
      liftPct:   isTest ? ((act - syn) / syn * 100) : null,
      isTest,
      testDay,
    };
  });
}

/* ─── GEO HEALTH DATA ────────────────────────────────────────────── */
function genGeoHealth() {
  const rng = seededRng(77);
  return EXP.treatmentGeos.map(geo => {
    const base   = 0.92 + rng() * 0.14;
    const pacing = 0.85 + rng() * 0.30;
    const status = base < 0.93 ? "warn" : "ok";
    return {
      geo, base, pacing,
      status,
      liftPct: (rng() * 9 + 1).toFixed(1),
      spendPct: (pacing * 100).toFixed(0),
    };
  });
}

/* ════════════════════════════════════════════════════════════════════
   MAIN APP
════════════════════════════════════════════════════════════════════ */
export default function GeoLiftMonitor() {
  const [daysElapsed, setDaysElapsed] = useState(EXP.daysElapsed);
  const [tab,         setTab]         = useState("signal");  // signal | health | pacing
  const [showCI,      setShowCI]      = useState(true);
  const [showLift,    setShowLift]    = useState(true);
  const [simDay,      setSimDay]      = useState(17); // demo slider

  const series   = useMemo(() => genData(simDay), [simDay]);
  const testSeries = series.filter(d => d.isTest);
  const geoHealth  = useMemo(genGeoHealth, []);

  const daysLeft   = EXP.testDays - simDay;
  const pctDone    = Math.round(simDay / EXP.testDays * 100);
  const testStart  = EXP.testStart.toISOString().slice(0, 10);

  // Directional signal — mean lift over test days so far (noisy)
  const meanLiftPct = testSeries.length
    ? testSeries.reduce((s, d) => s + (d.liftPct || 0), 0) / testSeries.length
    : 0;

  // CI width narrows over time
  const lastCIHalf = testSeries.length
    ? (testSeries.at(-1).ciHigh - testSeries.at(-1).ciLow) /
      testSeries.at(-1).synthetic * 50
    : 20;

  const isReadyForDecision = simDay >= EXP.testDays;
  const alertGeos          = geoHealth.filter(g => g.status === "warn");

  return (
    <div style={{ minHeight:"100vh", background:C.bg, fontFamily:font.body, color:C.text, display:"flex", flexDirection:"column" }}>
      <GoogleFonts />

      {/* ── NAV ── */}
      <nav style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, height:52, padding:"0 24px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0, position:"sticky", top:0, zIndex:10 }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ fontFamily:font.heading, fontSize:17, fontWeight:800, color:"#fff", letterSpacing:"-0.02em" }}>
            <span style={{ color:C.cyan }}>Geo</span>Lift
          </div>
          <Chev /><span style={{ fontFamily:font.mono, fontSize:11, color:C.muted }}>Library</span>
          <Chev /><span style={{ fontFamily:font.mono, fontSize:11, color:C.text, maxWidth:280, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{EXP.name}</span>
          <Chev /><span style={{ fontFamily:font.mono, fontSize:11, color:C.cyan }}>Monitor</span>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <ActivePill />
          <span style={{ fontFamily:font.mono, fontSize:11, color:C.muted }}>
            Day {simDay} of {EXP.testDays}
          </span>
        </div>
      </nav>

      <div style={{ padding:"24px 28px 60px" }}>

        {/* ── DEMO SLIDER ── */}
        <div style={{ background:C.surfaceHi, border:`1px solid ${C.border}`, borderRadius:8, padding:"10px 16px", marginBottom:20, display:"flex", alignItems:"center", gap:16 }}>
          <span style={{ fontFamily:font.mono, fontSize:10, color:C.muted, flexShrink:0 }}>DEMO: Simulate day</span>
          <input type="range" min={1} max={EXP.testDays} value={simDay}
            onChange={e => setSimDay(parseInt(e.target.value))}
            style={{ flex:1, accentColor:C.cyan }} />
          <span style={{ fontFamily:font.mono, fontSize:11, color:C.cyan, width:60, flexShrink:0 }}>Day {simDay}/{EXP.testDays}</span>
        </div>

        {/* ── GUARDRAIL BANNER ── */}
        {!isReadyForDecision && (
          <div style={{
            background:"#0d1020", border:`1px solid ${C.amber}60`,
            borderLeft:`4px solid ${C.amber}`, borderRadius:8,
            padding:"14px 18px", marginBottom:20,
            display:"flex", alignItems:"center", gap:16,
          }}>
            <span style={{ fontSize:22, flexShrink:0 }}>⏳</span>
            <div style={{ flex:1 }}>
              <div style={{ fontFamily:font.heading, fontSize:14, fontWeight:700, color:C.amber }}>
                Do not make decisions based on in-flight data
              </div>
              <div style={{ fontSize:12, color:C.muted, marginTop:3, lineHeight:1.6 }}>
                The confidence interval is still wide on Day {simDay}. Early signal is directional only and should not be used to pause, scale, or modify the campaign.
                Results will be statistically valid on <strong style={{ color:C.text }}>{EXP.testEnd.toLocaleDateString("en-US", { month:"long", day:"numeric" })}</strong> — {daysLeft} day{daysLeft !== 1 ? "s" : ""} from now.
              </div>
            </div>
            <div style={{ textAlign:"center", flexShrink:0 }}>
              <div style={{ fontFamily:font.heading, fontSize:28, fontWeight:800, color:C.amber }}>{daysLeft}d</div>
              <div style={{ fontFamily:font.mono, fontSize:9, color:C.muted }}>remaining</div>
            </div>
          </div>
        )}

        {isReadyForDecision && (
          <div style={{ background:C.greenDim, border:`1px solid ${C.green}60`, borderLeft:`4px solid ${C.green}`, borderRadius:8, padding:"14px 18px", marginBottom:20, display:"flex", alignItems:"center", gap:16 }}>
            <span style={{ fontSize:22 }}>✓</span>
            <div>
              <div style={{ fontFamily:font.heading, fontSize:14, fontWeight:700, color:C.green }}>Test window complete — run final analysis</div>
              <div style={{ fontSize:12, color:C.muted, marginTop:3 }}>All {EXP.testDays} test days have elapsed. Trigger GeoLift() measurement to produce statistically valid results.</div>
            </div>
            <button style={{ marginLeft:"auto", background:C.green, border:"none", borderRadius:7, color:C.bg, fontFamily:font.body, fontWeight:700, fontSize:13, padding:"9px 18px", cursor:"pointer", flexShrink:0 }}>
              Run Measurement →
            </button>
          </div>
        )}

        {/* ── HEADER METRICS ── */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:10, marginBottom:20 }}>
          <MetricTile label="Test Day"         value={`${simDay} / ${EXP.testDays}`} color={C.cyan} />
          <MetricTile label="% Complete"       value={`${pctDone}%`}                 color={C.cyan} sub={<ProgressMini pct={pctDone} color={C.cyan} />} />
          <MetricTile label="Days Left"        value={daysLeft}                       color={daysLeft <= 5 ? C.green : C.text} />
          <MetricTile label="Directional Lift" value={`+${meanLiftPct.toFixed(1)}%`} color={meanLiftPct > 0 ? C.cyan : C.red}
            sub={<span style={{ fontFamily:font.mono, fontSize:9, color:C.amber }}>noisy — do not act</span>} />
          <MetricTile label="Spend to Date"    value={`$${(EXP.spendToDate/1000).toFixed(0)}K`} color={C.text}
            sub={<span style={{ fontFamily:font.mono, fontSize:9, color:C.muted }}>${(EXP.spend/1000).toFixed(0)}K total</span>} />
          <MetricTile label="CI Width (±)"     value={`±${lastCIHalf.toFixed(1)}%`} color={lastCIHalf < 5 ? C.green : lastCIHalf < 10 ? C.amber : C.red}
            sub={<span style={{ fontFamily:font.mono, fontSize:9, color:C.muted }}>narrows daily</span>} />
        </div>

        {/* ── TABS ── */}
        <div style={{ display:"flex", borderBottom:`1px solid ${C.border}`, marginBottom:20 }}>
          {[
            { id:"signal",  label:"Directional Signal" },
            { id:"health",  label:`Data Health ${alertGeos.length > 0 ? `⚠ ${alertGeos.length}` : "✓"}` },
            { id:"pacing",  label:"Spend Pacing" },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding:"10px 20px", background:"transparent", border:"none",
              borderBottom:`2px solid ${tab===t.id?C.cyan:"transparent"}`,
              color:tab===t.id?C.cyan:C.muted, fontFamily:font.mono, fontSize:12,
              fontWeight:tab===t.id?600:400, cursor:"pointer",
            }}>{t.label}</button>
          ))}
        </div>

        {/* ══ SIGNAL TAB ══ */}
        {tab === "signal" && (
          <>
            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"18px 20px 10px", marginBottom:16 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
                <div>
                  <div style={{ fontFamily:font.heading, fontSize:15, fontWeight:700, color:"#fff" }}>
                    Actual vs Frozen Counterfactual
                  </div>
                  <div style={{ fontFamily:font.mono, fontSize:11, color:C.muted, marginTop:3 }}>
                    Pre-period fit + {simDay} live test days · {EXP.kpi} · treatment aggregate
                  </div>
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <ToggleChip active={showCI}   onClick={() => setShowCI(v=>!v)}   color={C.blue}>95% CI</ToggleChip>
                  <ToggleChip active={showLift} onClick={() => setShowLift(v=>!v)} color={C.green}>Lift gap</ToggleChip>
                </div>
              </div>

              <SignalChart series={series} testStart={testStart} showCI={showCI} showLift={showLift} kpi={EXP.kpi} />

              <div style={{ display:"flex", gap:16, marginTop:12, paddingTop:10, borderTop:`1px solid ${C.border}`, flexWrap:"wrap" }}>
                <LegItem color={C.cyan}  label="Actual (treatment)"    solid />
                <LegItem color={C.muted} label="Frozen counterfactual" dashed />
                {showCI   && <LegItem color={C.blue}  label="95% CI band"  area />}
                {showLift && <LegItem color={C.green} label="Directional lift gap" area />}
                <div style={{ marginLeft:"auto", fontFamily:font.mono, fontSize:9, color:C.amber }}>
                  ⚠ CI is wide — treat as directional only until day {EXP.testDays}
                </div>
              </div>
            </div>

            {/* CI narrowing chart */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
              <Panel title="Confidence Interval Narrowing">
                <CINarrowingChart series={series} testDays={EXP.testDays} />
                <div style={{ fontFamily:font.mono, fontSize:10, color:C.muted, marginTop:8, lineHeight:1.6 }}>
                  The CI must be ±{(2.5).toFixed(1)}% or below before results are actionable. Currently ±{lastCIHalf.toFixed(1)}% on day {simDay}.
                </div>
              </Panel>
              <Panel title="Daily Directional Lift (noisy)">
                <DailyLiftChart testSeries={testSeries} />
                <div style={{ fontFamily:font.mono, fontSize:10, color:C.amber, marginTop:8 }}>
                  ⚠ Day-level variance is high. Do not interpret individual day spikes.
                </div>
              </Panel>
            </div>
          </>
        )}

        {/* ══ HEALTH TAB ══ */}
        {tab === "health" && (
          <>
            {alertGeos.length > 0 && (
              <div style={{ background:C.amberDim, border:`1px solid ${C.amber}40`, borderLeft:`3px solid ${C.amber}`, borderRadius:8, padding:"12px 16px", marginBottom:16 }}>
                <div style={{ fontFamily:font.heading, fontSize:13, fontWeight:700, color:C.amber, marginBottom:4 }}>
                  {alertGeos.length} treatment geo{alertGeos.length>1?"s":""} flagged for low KPI volume
                </div>
                <div style={{ fontSize:12, color:C.muted }}>
                  {alertGeos.map(g=>g.geo).join(", ")} — check for data ingestion issues or local media interference before the test window closes.
                </div>
              </div>
            )}

            <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, overflow:"hidden", marginBottom:16 }}>
              <div style={{ padding:"12px 18px", borderBottom:`1px solid ${C.border}`, fontFamily:font.heading, fontSize:13, fontWeight:700, color:"#fff" }}>
                Treatment Market Data Health
              </div>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead><tr style={{ background:C.surfaceHi }}>
                  {["Market","Status","Data Volume","Daily Spend Pacing","Directional Lift"].map(h=>(
                    <th key={h} style={{ fontFamily:font.mono, fontSize:10, color:C.muted, padding:"8px 16px", textAlign:"left", fontWeight:500, borderBottom:`1px solid ${C.border}` }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {geoHealth.map(g => (
                    <tr key={g.geo} style={{ borderBottom:`1px solid ${C.border}` }}>
                      <td style={{ padding:"9px 16px", fontWeight:600, fontSize:12 }}>{g.geo}</td>
                      <td style={{ padding:"9px 16px" }}>
                        <span style={{
                          fontFamily:font.mono, fontSize:10, fontWeight:700,
                          color:g.status==="ok"?C.green:C.amber,
                          background:(g.status==="ok"?C.green:C.amber)+"18",
                          border:`1px solid ${(g.status==="ok"?C.green:C.amber)}40`,
                          borderRadius:99, padding:"2px 8px",
                        }}>{g.status==="ok"?"✓ Healthy":"⚠ Check"}</span>
                      </td>
                      <td style={{ padding:"9px 16px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <div style={{ width:60, height:4, background:C.border, borderRadius:2 }}>
                            <div style={{ width:`${Math.min(100,g.base*100)}%`, height:"100%", background:g.base>0.93?C.green:C.amber, borderRadius:2 }} />
                          </div>
                          <span style={{ fontFamily:font.mono, fontSize:10, color:C.muted }}>{(g.base*100).toFixed(0)}%</span>
                        </div>
                      </td>
                      <td style={{ padding:"9px 16px" }}>
                        <span style={{ fontFamily:font.mono, fontSize:11, color:parseFloat(g.spendPct)>=80?C.text:C.amber }}>{g.spendPct}% of plan</span>
                      </td>
                      <td style={{ padding:"9px 16px" }}>
                        <span style={{ fontFamily:font.mono, fontSize:11, color:C.cyan }}>+{g.liftPct}%</span>
                        <span style={{ fontFamily:font.mono, fontSize:9, color:C.muted }}> (noisy)</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
              {[
                { label:"Control pool contamination", status:"pass", detail:"No external media changes detected in control geos. Control pool integrity is maintained." },
                { label:"National media stability", status:"pass", detail:"No significant national TV, print, or digital changes flagged during test window." },
                { label:"Local media interference", status:"warn", detail:"Unverified local OOH activity in Philadelphia. Confirm this is held constant vs control." },
                { label:"Structural break detection", status:"pass", detail:"No structural breaks detected in treatment or control aggregate time series." },
              ].map(c => (
                <div key={c.label} style={{ background:C.surface, border:`1px solid ${c.status==="warn"?C.amber+"40":C.border}`, borderRadius:8, padding:"14px 16px" }}>
                  <div style={{ display:"flex", gap:8, marginBottom:6 }}>
                    <span style={{ fontFamily:font.mono, fontSize:11, color:c.status==="pass"?C.green:C.amber, fontWeight:700 }}>
                      {c.status==="pass"?"✓":"⚠"}
                    </span>
                    <span style={{ fontSize:12, fontWeight:600, color:"#fff" }}>{c.label}</span>
                  </div>
                  <p style={{ fontSize:11, color:C.muted, lineHeight:1.6, margin:0 }}>{c.detail}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ══ PACING TAB ══ */}
        {tab === "pacing" && (
          <>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:16 }}>
              {[
                { label:"Spend to Date",   value:`$${(EXP.spendToDate/1000).toFixed(0)}K`,  color:C.text },
                { label:"Remaining Budget",value:`$${((EXP.spend-EXP.spendToDate)/1000).toFixed(0)}K`, color:C.muted },
                { label:"Pacing vs Plan",  value:`${(EXP.spendToDate / (EXP.spend * simDay / EXP.testDays) * 100).toFixed(0)}%`, color:C.cyan },
              ].map(m=>(
                <div key={m.label} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"14px 16px" }}>
                  <div style={{ fontFamily:font.mono, fontSize:9, color:C.muted, marginBottom:4, textTransform:"uppercase", letterSpacing:"0.06em" }}>{m.label}</div>
                  <div style={{ fontFamily:font.heading, fontSize:22, fontWeight:800, color:m.color }}>{m.value}</div>
                </div>
              ))}
            </div>

            <Panel title="Daily Spend vs Planned Budget">
              <SpendPacingChart daysElapsed={simDay} totalDays={EXP.testDays} plannedDaily={EXP.plannedDailySpend} />
            </Panel>

            <div style={{ marginTop:16, padding:"12px 16px", background:C.redDim, border:`1px solid ${C.red}30`, borderLeft:`3px solid ${C.red}`, borderRadius:8 }}>
              <div style={{ fontFamily:font.heading, fontSize:13, fontWeight:700, color:C.red, marginBottom:4 }}>
                ⚠ Do not adjust campaign spend during the test window
              </div>
              <div style={{ fontSize:12, color:C.muted, lineHeight:1.6 }}>
                Modifying budget, targeting, or bidding strategy mid-test will invalidate the synthetic control model. Any spend changes must wait until after the test window closes and results have been measured.
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   CHART COMPONENTS
═══════════════════════════════════════════════════════════════════ */

function SignalChart({ series, testStart, showCI, showLift, kpi }) {
  const fmt = v => `${(v/1e6).toFixed(2)}M`;
  const ticks = series.filter((_,i) => i % 10 === 0).map(d => d.date);

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    return (
      <div style={{ background:C.surfaceHi, border:`1px solid ${C.borderHi}`, borderRadius:8, padding:"10px 14px", fontFamily:font.mono, fontSize:11 }}>
        <div style={{ color:C.muted, marginBottom:5 }}>{d.date}</div>
        <div style={{ color:C.cyan,  marginBottom:3 }}>Actual: {fmt(d.actual)}</div>
        <div style={{ color:C.muted, marginBottom: d.isTest?3:0 }}>Synthetic: {fmt(d.synthetic)}</div>
        {d.isTest && d.lift !== null && (
          <>
            <div style={{ color:d.liftPct>0?C.cyan:C.red, marginTop:3, paddingTop:3, borderTop:`1px solid ${C.border}` }}>
              Lift: {d.lift>0?"+":""}{fmt(d.lift)} ({d.liftPct?.toFixed(1)}%)
            </div>
            <div style={{ color:C.amber, fontSize:9, marginTop:2 }}>CI: {fmt(d.ciLow)} – {fmt(d.ciHigh)}</div>
          </>
        )}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={series} margin={{top:4,right:10,left:0,bottom:0}}>
        <defs>
          <linearGradient id="liftGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.cyan} stopOpacity={0.2}/>
            <stop offset="100%" stopColor={C.cyan} stopOpacity={0.02}/>
          </linearGradient>
          <linearGradient id="ciGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.blue} stopOpacity={0.12}/>
            <stop offset="100%" stopColor={C.blue} stopOpacity={0.02}/>
          </linearGradient>
        </defs>
        <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false}/>
        <XAxis dataKey="date" ticks={ticks} tick={{fontFamily:font.mono,fontSize:9,fill:C.muted}} axisLine={false} tickLine={false}
          tickFormatter={v=>v}/>
        <YAxis tick={{fontFamily:font.mono,fontSize:9,fill:C.muted}} axisLine={false} tickLine={false} tickFormatter={fmt} width={52}/>
        <ReferenceLine x={testStart} stroke={C.amber} strokeDasharray="4 3" strokeWidth={1.5}
          label={{value:"Test start",position:"top",fill:C.amber,fontSize:9,fontFamily:font.mono}}/>
        {showCI && <>
          <Area dataKey="ciHigh" stroke="none" fill="url(#ciGrad)" isAnimationActive={false} legendType="none"/>
          <Area dataKey="ciLow"  stroke="none" fill={C.bg}         isAnimationActive={false} legendType="none"/>
        </>}
        {showLift && <>
          <Area dataKey="liftHigh" stroke="none" fill="url(#liftGrad)" isAnimationActive={false} legendType="none"/>
          <Area dataKey="liftLow"  stroke="none" fill={C.bg}           isAnimationActive={false} legendType="none"/>
        </>}
        <Line dataKey="synthetic" stroke={C.muted} strokeWidth={1.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} legendType="none"/>
        <Line dataKey="actual"    stroke={C.cyan}  strokeWidth={2}   dot={false}            isAnimationActive={false} legendType="none"/>
        <Tooltip content={<CustomTooltip />}/>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function CINarrowingChart({ series, testDays }) {
  const rng2 = seededRng(55);
  const data = series.filter(d => d.isTest).map((d, i) => ({
    day: i + 1,
    ci: Math.max(1.5, 22 - i * (20.5 / testDays) + (rng2() - 0.5) * 1.5),
    threshold: 2.5,
  }));

  return (
    <ResponsiveContainer width="100%" height={140}>
      <ComposedChart data={data} margin={{top:4,right:8,left:-10,bottom:0}}>
        <CartesianGrid stroke={C.border} strokeDasharray="2 3" vertical={false}/>
        <XAxis dataKey="day" tick={{fontFamily:font.mono,fontSize:8,fill:C.muted}} axisLine={false} tickLine={false}
          tickFormatter={v=>`d${v}`} interval={3}/>
        <YAxis tick={{fontFamily:font.mono,fontSize:8,fill:C.muted}} axisLine={false} tickLine={false} tickFormatter={v=>`±${v}%`} width={36}/>
        <ReferenceLine y={2.5} stroke={C.green} strokeDasharray="4 3"
          label={{value:"Decision threshold",position:"right",fill:C.green,fontSize:8,fontFamily:font.mono}}/>
        <Line dataKey="ci" stroke={C.amber} strokeWidth={2} dot={false} isAnimationActive={false}/>
        <Tooltip contentStyle={{background:C.surfaceHi,border:`1px solid ${C.borderHi}`,borderRadius:6,fontFamily:font.mono,fontSize:10}}
          formatter={v=>[`±${v.toFixed(1)}%`,"CI half-width"]}/>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function DailyLiftChart({ testSeries }) {
  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={testSeries} margin={{top:4,right:0,left:-10,bottom:0}}>
        <CartesianGrid stroke={C.border} strokeDasharray="2 3" vertical={false}/>
        <XAxis dataKey="date" tick={{fontFamily:font.mono,fontSize:8,fill:C.muted}} axisLine={false} tickLine={false} interval={2}/>
        <YAxis tick={{fontFamily:font.mono,fontSize:8,fill:C.muted}} axisLine={false} tickLine={false} tickFormatter={v=>`${v.toFixed(1)}%`} width={36}/>
        <ReferenceLine y={0} stroke={C.border}/>
        <Tooltip contentStyle={{background:C.surfaceHi,border:`1px solid ${C.borderHi}`,borderRadius:6,fontFamily:font.mono,fontSize:10}}
          formatter={v=>[`${v?.toFixed(1)}%`,"Daily lift"]}/>
        <Bar dataKey="liftPct" radius={[2,2,0,0]}>
          {testSeries.map((d,i) => (
            <RCell key={i} fill={(d.liftPct||0)>0?C.cyan:C.red} fillOpacity={0.7}/>
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function SpendPacingChart({ daysElapsed, totalDays, plannedDaily }) {
  const rng = seededRng(88);
  const data = Array.from({length:daysElapsed},(_,i)=>({
    day: i+1,
    actual:  Math.round(plannedDaily * (0.85 + rng()*0.3)),
    planned: plannedDaily,
  }));
  return (
    <ResponsiveContainer width="100%" height={180}>
      <ComposedChart data={data} margin={{top:4,right:8,left:0,bottom:0}}>
        <CartesianGrid stroke={C.border} strokeDasharray="2 3" vertical={false}/>
        <XAxis dataKey="day" tick={{fontFamily:font.mono,fontSize:8,fill:C.muted}} axisLine={false} tickLine={false} tickFormatter={v=>`d${v}`} interval={2}/>
        <YAxis tick={{fontFamily:font.mono,fontSize:8,fill:C.muted}} axisLine={false} tickLine={false} tickFormatter={v=>`$${(v/1000).toFixed(0)}K`} width={44}/>
        <Line dataKey="planned" stroke={C.border} strokeWidth={1} strokeDasharray="4 2" dot={false} isAnimationActive={false}/>
        <Bar  dataKey="actual"  fill={C.blue} fillOpacity={0.7} radius={[2,2,0,0]}/>
        <Tooltip contentStyle={{background:C.surfaceHi,border:`1px solid ${C.borderHi}`,borderRadius:6,fontFamily:font.mono,fontSize:10}}
          formatter={(v,n)=>[`$${(v/1000).toFixed(1)}K`,n]}/>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   PRIMITIVES
═══════════════════════════════════════════════════════════════════ */
function GoogleFonts() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap');
      *,*::before,*::after{box-sizing:border-box;}
      ::-webkit-scrollbar{width:4px;background:${C.bg};}
      ::-webkit-scrollbar-thumb{background:${C.border};border-radius:2px;}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
    `}</style>
  );
}

function Chev() { return <span style={{color:C.border,fontSize:12}}>›</span>; }

function ActivePill() {
  return (
    <span style={{ background:C.cyanDim, border:`1px solid ${C.cyan}50`, color:C.cyan, borderRadius:99, fontSize:10, fontWeight:700, padding:"2px 10px", fontFamily:font.mono, display:"inline-flex", alignItems:"center", gap:5 }}>
      <span style={{ width:5, height:5, borderRadius:99, background:C.cyan, animation:"pulse 1.8s infinite" }}/>
      Active
    </span>
  );
}

function MetricTile({ label, value, color, sub }) {
  return (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" }}>
      <div style={{ fontFamily:font.mono, fontSize:9, color:C.muted, marginBottom:5, textTransform:"uppercase", letterSpacing:"0.06em" }}>{label}</div>
      <div style={{ fontFamily:font.heading, fontSize:20, fontWeight:800, color, letterSpacing:"-0.02em" }}>{value}</div>
      {sub && <div style={{ marginTop:4 }}>{sub}</div>}
    </div>
  );
}

function ProgressMini({ pct, color }) {
  return (
    <div style={{ height:3, background:C.border, borderRadius:2, marginTop:4 }}>
      <div style={{ width:`${pct}%`, height:"100%", background:color, borderRadius:2 }}/>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:"16px 18px" }}>
      <div style={{ fontFamily:font.heading, fontSize:13, fontWeight:700, color:"#fff", marginBottom:12 }}>{title}</div>
      {children}
    </div>
  );
}

function ToggleChip({ active, onClick, color, children }) {
  return (
    <button onClick={onClick} style={{ background:active?color+"18":"transparent", border:`1px solid ${active?color+"60":C.border}`, borderRadius:5, color:active?color:C.muted, fontFamily:font.mono, fontSize:10, padding:"4px 10px", cursor:"pointer" }}>
      {children}
    </button>
  );
}

function LegItem({ color, label, solid, dashed, area }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:5 }}>
      {dashed ? <svg width={18} height={8}><line x1="0" y1="4" x2="18" y2="4" stroke={color} strokeWidth={1.5} strokeDasharray="4 3"/></svg>
              : area ? <div style={{ width:10,height:7,background:color,borderRadius:2,opacity:0.5 }}/>
              : <div style={{ width:14,height:2,background:color,borderRadius:1 }}/>}
      <span style={{ fontFamily:font.mono, fontSize:9, color:C.muted }}>{label}</span>
    </div>
  );
}
