import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as d3 from "d3";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";

/* ─── DESIGN TOKENS ─────────────────────────────────────────────── */
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
  blueDim:   "#4e9eff15",
  purple:    "#a78bfa",
  map: {
    state:     "#0d1520",
    stateLine: "#1a2535",
    nation:    "#1e2e42",
  },
};

const font = {
  heading: "'Syne', sans-serif",
  mono:    "'DM Mono', monospace",
  body:    "'Inter', system-ui, sans-serif",
};

/* ─── SEEDED RNG ─────────────────────────────────────────────────── */
function seededRng(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

/* ─── DMA MARKET DATA ────────────────────────────────────────────── */
const rng = seededRng(7);
const raw = [
  { id: "nyc",  name: "New York",       lat: 40.71, lon: -74.00, pop: 19.8 },
  { id: "la",   name: "Los Angeles",    lat: 34.05, lon: -118.25, pop: 13.2 },
  { id: "chi",  name: "Chicago",        lat: 41.85, lon: -87.65, pop: 9.5  },
  { id: "hou",  name: "Houston",        lat: 29.75, lon: -95.35, pop: 7.1  },
  { id: "phx",  name: "Phoenix",        lat: 33.45, lon: -112.05, pop: 5.0 },
  { id: "phi",  name: "Philadelphia",   lat: 40.00, lon: -75.15, pop: 6.2  },
  { id: "sa",   name: "San Antonio",    lat: 29.42, lon: -98.50, pop: 2.6  },
  { id: "sd",   name: "San Diego",      lat: 32.75, lon: -117.15, pop: 3.3 },
  { id: "dal",  name: "Dallas",         lat: 32.80, lon: -96.80, pop: 7.6  },
  { id: "sj",   name: "San Jose",       lat: 37.34, lon: -121.89, pop: 2.0 },
  { id: "det",  name: "Detroit",        lat: 42.35, lon: -83.05, pop: 4.4  },
  { id: "bal",  name: "Baltimore",      lat: 39.30, lon: -76.60, pop: 2.9  },
  { id: "sea",  name: "Seattle",        lat: 47.60, lon: -122.35, pop: 4.0 },
  { id: "dc",   name: "Washington DC",  lat: 38.90, lon: -77.05, pop: 6.4  },
  { id: "bos",  name: "Boston",         lat: 42.35, lon: -71.05, pop: 4.9  },
  { id: "den",  name: "Denver",         lat: 39.75, lon: -104.95, pop: 3.0 },
  { id: "nas",  name: "Nashville",      lat: 36.17, lon: -86.78, pop: 2.0  },
  { id: "atl",  name: "Atlanta",        lat: 33.75, lon: -84.40, pop: 6.1  },
  { id: "mia",  name: "Miami",          lat: 25.80, lon: -80.20, pop: 6.2  },
  { id: "min",  name: "Minneapolis",    lat: 44.98, lon: -93.27, pop: 3.7  },
  { id: "por",  name: "Portland",       lat: 45.52, lon: -122.68, pop: 2.5 },
  { id: "stl",  name: "St. Louis",      lat: 38.63, lon: -90.20, pop: 2.8  },
  { id: "tam",  name: "Tampa",          lat: 27.95, lon: -82.46, pop: 3.2  },
  { id: "sac",  name: "Sacramento",     lat: 38.58, lon: -121.49, pop: 2.4 },
  { id: "cle",  name: "Cleveland",      lat: 41.50, lon: -81.70, pop: 2.0  },
  { id: "pit",  name: "Pittsburgh",     lat: 40.44, lon: -80.00, pop: 2.4  },
  { id: "cin",  name: "Cincinnati",     lat: 39.10, lon: -84.51, pop: 2.3  },
  { id: "kc",   name: "Kansas City",    lat: 39.10, lon: -94.58, pop: 2.2  },
  { id: "col",  name: "Columbus",       lat: 39.96, lon: -82.99, pop: 2.1  },
  { id: "ind",  name: "Indianapolis",   lat: 39.77, lon: -86.16, pop: 2.1  },
  { id: "cha",  name: "Charlotte",      lat: 35.23, lon: -80.84, pop: 2.7  },
  { id: "ort",  name: "Orlando",        lat: 28.54, lon: -81.38, pop: 3.0  },
  { id: "slu",  name: "Salt Lake City", lat: 40.76, lon: -111.89, pop: 1.3 },
  { id: "ric",  name: "Richmond",       lat: 37.54, lon: -77.44, pop: 1.3  },
  { id: "lv",   name: "Las Vegas",      lat: 36.17, lon: -115.14, pop: 2.3 },
];

const DMA_MARKETS = raw.map(m => ({
  ...m,
  simScore: parseFloat((0.45 + rng() * 0.55).toFixed(3)),
  status: "available",
}));

/* ─── STATUS CONFIG ──────────────────────────────────────────────── */
function marketColor(status, simScore) {
  if (status === "treatment") return C.cyan;
  if (status === "control")   return C.green;
  if (status === "excluded")  return C.red;
  if (status === "candidate") return C.blue;
  return C.muted;
}

/* ─── FAKE PRE-PERIOD DATA ───────────────────────────────────────── */
function genPrePeriodData(markets) {
  const rng2 = seededRng(13);
  const n = 42;
  return Array.from({ length: n }, (_, i) => {
    const d = new Date("2024-09-01");
    d.setDate(d.getDate() + i);
    const base = 90000 + Math.sin(i / 7) * 8000;
    const noise = () => (rng2() - 0.5) * 6000;
    const row = {
      date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    };
    const treatment = markets.filter(m => m.status === "treatment");
    const control   = markets.filter(m => m.status === "control");
    if (treatment.length > 0) row["Treatment Aggregate"] = Math.round(base + noise());
    if (control.length > 0)   row["Synthetic Control"]   = Math.round(base + noise() * 0.6);
    control.slice(0, 3).forEach(m => {
      row[m.name] = Math.round(base * (0.15 + m.simScore * 0.25) + noise() * 0.5);
    });
    return row;
  });
}

/* ══════════════════════════════════════════════════════════════════ */
/*  MAIN APP                                                          */
/* ══════════════════════════════════════════════════════════════════ */
export default function GeoLiftMarketMap() {
  const svgRef          = useRef(null);
  const mapContainerRef = useRef(null);
  const projRef         = useRef(null);
  const handleClickRef  = useRef(null);

  const [geoData,       setGeoData]       = useState(null);
  const [mapReady,      setMapReady]      = useState(false);
  const [markets,       setMarkets]       = useState(DMA_MARKETS);
  const [mode,          setMode]          = useState("assign"); // assign | running | complete
  const [runProgress,   setRunProgress]   = useState(0);
  const [hovered,       setHovered]       = useState(null);
  const [tooltipXY,     setTooltipXY]     = useState({ x: 0, y: 0 });
  const [mapDims,       setMapDims]       = useState({ w: 800, h: 520 });
  const [rightTab,      setRightTab]      = useState("scores"); // scores | fit
  const [matchVars,     setMatchVars]     = useState("Revenue, Population");

  /* ── load topojson + us atlas ── */
  useEffect(() => {
    let cancelled = false;
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/topojson/3.0.2/topojson.min.js";
    s.onload = async () => {
      if (cancelled) return;
      try {
        const us = await fetch("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json").then(r => r.json());
        if (cancelled) return;
        setGeoData({
          states: window.topojson.feature(us, us.objects.states),
          nation: window.topojson.feature(us, us.objects.nation),
          mesh:   window.topojson.mesh(us, us.objects.states, (a, b) => a !== b),
        });
      } catch (e) { console.warn("Map data failed to load", e); }
    };
    document.head.appendChild(s);
    return () => { cancelled = true; document.head.removeChild(s); };
  }, []);

  /* ── observe map container size ── */
  useEffect(() => {
    if (!mapContainerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 50) setMapDims({ w: width, h: height });
    });
    ro.observe(mapContainerRef.current);
    return () => ro.disconnect();
  }, []);

  /* ── draw base map ── */
  useEffect(() => {
    if (!geoData || !svgRef.current) return;
    const { w, h } = mapDims;

    const projection = d3.geoAlbersUsa()
      .scale(w * 1.18)
      .translate([w / 2, h / 2]);
    projRef.current = projection;

    const path = d3.geoPath().projection(projection);
    const svg  = d3.select(svgRef.current);

    svg.selectAll(".base").remove();
    const g = svg.append("g").attr("class", "base");

    /* ocean background */
    g.append("rect").attr("width", w).attr("height", h)
      .attr("fill", C.bg);

    /* state fills */
    g.selectAll("path.st")
      .data(geoData.states.features)
      .join("path")
      .attr("class", "st")
      .attr("d", path)
      .attr("fill", C.map.state)
      .attr("stroke", "none");

    /* state borders */
    g.append("path")
      .datum(geoData.mesh)
      .attr("d", path)
      .attr("fill", "none")
      .attr("stroke", C.map.stateLine)
      .attr("stroke-width", 0.6);

    /* nation outline */
    g.append("path")
      .datum(geoData.nation)
      .attr("d", path)
      .attr("fill", "none")
      .attr("stroke", C.map.nation)
      .attr("stroke-width", 1.2);

    setMapReady(true);
  }, [geoData, mapDims]);

  /* ── draw market circles (re-runs on market change) ── */
  useEffect(() => {
    if (!mapReady || !projRef.current || !svgRef.current) return;
    const projection = projRef.current;
    const svg = d3.select(svgRef.current);
    svg.selectAll(".markets").remove();

    const g = svg.append("g").attr("class", "markets");

    markets.forEach(m => {
      const proj = projection([m.lon, m.lat]);
      if (!proj) return;
      const [x, y] = proj;
      const r     = Math.max(5, Math.min(11, Math.sqrt(m.pop) * 1.6));
      const color = marketColor(m.status, m.simScore);
      const isSet = m.status !== "available";

      const grp = g.append("g")
        .attr("class", `market-node market-${m.id}`)
        .attr("transform", `translate(${x},${y})`)
        .style("cursor", mode === "assign" || m.status === "treatment" ? "pointer" : "default");

      /* glow ring for treatment */
      if (m.status === "treatment") {
        grp.append("circle").attr("r", r + 7)
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", 1)
          .attr("opacity", 0.25);
        grp.append("circle").attr("r", r + 4)
          .attr("fill", "none")
          .attr("stroke", color)
          .attr("stroke-width", 1)
          .attr("opacity", 0.15);
      }

      /* similarity score arc for control candidates */
      if (m.status === "control" || m.status === "candidate") {
        const arc = d3.arc()
          .innerRadius(r + 2)
          .outerRadius(r + 4)
          .startAngle(0)
          .endAngle(Math.PI * 2 * m.simScore);
        grp.append("path")
          .attr("d", arc())
          .attr("fill", m.status === "control" ? C.green : C.blue)
          .attr("opacity", 0.5);
      }

      /* main circle */
      grp.append("circle")
        .attr("r", r)
        .attr("fill", color)
        .attr("fill-opacity", isSet ? 0.92 : 0.5)
        .attr("stroke", color)
        .attr("stroke-width", isSet ? 1.5 : 0.5)
        .attr("stroke-opacity", 0.7);

      /* label */
      if (isSet || m.pop > 7) {
        grp.append("text")
          .attr("y", r + 11)
          .attr("text-anchor", "middle")
          .attr("font-family", font.mono)
          .attr("font-size", isSet ? 9.5 : 8.5)
          .attr("fill", color)
          .attr("opacity", isSet ? 1 : 0.55)
          .text(m.name);
      }

      /* events */
      grp
        .on("mouseenter", (event) => {
          setHovered(m);
          setTooltipXY({ x: event.offsetX + 14, y: event.offsetY - 10 });
          d3.select(event.currentTarget).select("circle")
            .attr("fill-opacity", 1).attr("r", r + 1.5);
        })
        .on("mousemove", (event) => {
          setTooltipXY({ x: event.offsetX + 14, y: event.offsetY - 10 });
        })
        .on("mouseleave", (event) => {
          setHovered(null);
          d3.select(event.currentTarget).select("circle")
            .attr("fill-opacity", isSet ? 0.92 : 0.5).attr("r", r);
        })
        .on("click", () => handleClickRef.current?.(m.id));
    });
  }, [markets, mapReady, mode]);

  /* ── keep click handler ref current ── */
  handleClickRef.current = useCallback((id) => {
    if (mode !== "assign") return;
    setMarkets(prev => prev.map(m => {
      if (m.id !== id) return m;
      if (m.status === "available")  return { ...m, status: "treatment" };
      if (m.status === "treatment")  return { ...m, status: "available" };
      return m;
    }));
  }, [mode]);

  /* ── run GeoLiftMarketSelection ── */
  const runSelection = () => {
    const tCount = markets.filter(m => m.status === "treatment").length;
    if (tCount === 0) return;
    setMode("running");
    setRunProgress(0);

    const interval = setInterval(() => {
      setRunProgress(p => {
        if (p >= 100) {
          clearInterval(interval);
          /* assign control based on sim scores, excluding treatment */
          setMarkets(prev => {
            const sorted = [...prev]
              .filter(m => m.status === "available")
              .sort((a, b) => b.simScore - a.simScore);
            const topN = new Set(sorted.slice(0, 6).map(m => m.id));
            const candN = new Set(sorted.slice(6, 14).map(m => m.id));
            return prev.map(m => {
              if (m.status === "treatment") return m;
              if (topN.has(m.id))  return { ...m, status: "control" };
              if (candN.has(m.id)) return { ...m, status: "candidate" };
              return m;
            });
          });
          setMode("complete");
          return 100;
        }
        return p + 2.5;
      });
    }, 50);
  };

  const reset = () => {
    setMarkets(DMA_MARKETS);
    setMode("assign");
    setRunProgress(0);
  };

  const treatmentMarkets = markets.filter(m => m.status === "treatment");
  const controlMarkets   = markets.filter(m => m.status === "control");
  const candidateMarkets = markets.filter(m => m.status === "candidate");
  const canRun           = treatmentMarkets.length > 0 && mode === "assign";

  const topRMSE        = 0.042;
  const topCorrelation = 0.981;

  const prePeriodData = useMemo(() => {
    if (mode !== "complete") return [];
    return genPrePeriodData(markets);
  }, [mode, markets]);

  /* ── ranked control list ── */
  const ranked = useMemo(() => {
    return [...markets]
      .filter(m => m.status === "control" || m.status === "candidate")
      .sort((a, b) => b.simScore - a.simScore);
  }, [markets]);

  return (
    <div style={{ height: "100vh", background: C.bg, fontFamily: font.body, color: C.text, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <GoogleFonts />

      {/* ── NAV ── */}
      <nav style={{
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        padding: "0 20px", height: 52, display: "flex",
        alignItems: "center", justifyContent: "space-between", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontFamily: font.heading, fontSize: 17, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>
            <span style={{ color: C.cyan }}>Geo</span>Lift
          </div>
          <Chev />
          <span style={{ fontFamily: font.mono, fontSize: 11, color: C.muted }}>Market Selection</span>
          <Chev />
          <span style={{ fontFamily: font.mono, fontSize: 11, color: C.text }}>Q4 Meta Paid Social — US DMA</span>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <StepIndicator steps={["Assign Treatment", "Run Selection", "Review"]}
            current={mode === "assign" ? 0 : mode === "running" ? 1 : 2} />
        </div>
      </nav>

      {/* ── BODY ── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* ── LEFT SIDEBAR ── */}
        <aside style={{
          width: 240, background: C.surface, borderRight: `1px solid ${C.border}`,
          display: "flex", flexDirection: "column", flexShrink: 0, overflowY: "auto",
        }}>
          {/* Mode header */}
          <div style={{ padding: "16px 16px 12px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ fontFamily: font.heading, fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
              {mode === "assign"   ? "Click markets to assign" :
               mode === "running"  ? "Running selection..." :
               "Selection complete"}
            </div>
            <div style={{ fontFamily: font.mono, fontSize: 10, color: C.muted }}>
              {mode === "assign" ? "Select 1+ treatment markets, then run GeoLiftMarketSelection()" :
               mode === "running" ? `Simulating synthetic control fits across donor pool...` :
               `Control pool optimized · R² ${topCorrelation}`}
            </div>
            {mode === "running" && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontFamily: font.mono, fontSize: 9, color: C.muted }}>GeoLiftMarketSelection()</span>
                  <span style={{ fontFamily: font.mono, fontSize: 9, color: C.cyan }}>{Math.round(runProgress)}%</span>
                </div>
                <div style={{ height: 3, background: C.border, borderRadius: 2 }}>
                  <div style={{ width: `${runProgress}%`, height: "100%", background: C.cyan, borderRadius: 2, transition: "width 0.1s" }} />
                </div>
              </div>
            )}
          </div>

          {/* Treatment markets */}
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}` }}>
            <SideLabel>TREATMENT MARKETS <CountPill n={treatmentMarkets.length} color={C.cyan} /></SideLabel>
            {treatmentMarkets.length === 0
              ? <div style={{ fontFamily: font.mono, fontSize: 10, color: C.muted, marginTop: 6 }}>Click markets on the map</div>
              : treatmentMarkets.map(m => (
                  <MarketChip key={m.id} m={m} color={C.cyan}
                    onRemove={mode === "assign" ? () => handleClickRef.current(m.id) : null} />
                ))
            }
          </div>

          {/* Control pool */}
          {mode === "complete" && (
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}` }}>
              <SideLabel>SELECTED CONTROL POOL <CountPill n={controlMarkets.length} color={C.green} /></SideLabel>
              {controlMarkets.map(m => (
                <MarketChip key={m.id} m={m} color={C.green}
                  sub={`Score ${(m.simScore * 100).toFixed(0)}`} />
              ))}
            </div>
          )}

          {/* Config */}
          <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}`, flex: 1 }}>
            <SideLabel>MATCHING VARIABLES</SideLabel>
            <textarea
              value={matchVars}
              onChange={e => setMatchVars(e.target.value)}
              disabled={mode !== "assign"}
              rows={2}
              style={{
                width: "100%", background: C.surfaceHi, border: `1px solid ${C.border}`,
                borderRadius: 5, color: C.text, fontFamily: font.mono, fontSize: 11,
                padding: "6px 8px", resize: "none", outline: "none", marginTop: 6,
                opacity: mode !== "assign" ? 0.5 : 1,
              }}
            />
            <div style={{ marginTop: 10 }}>
              <SideLabel>GEO LEVEL</SideLabel>
              <select disabled={mode !== "assign"} style={{
                width: "100%", background: C.surfaceHi, border: `1px solid ${C.border}`,
                borderRadius: 5, color: C.text, fontFamily: font.mono, fontSize: 11,
                padding: "5px 8px", marginTop: 4, opacity: mode !== "assign" ? 0.5 : 1,
              }}>
                <option>DMA</option><option>City</option><option>State</option>
              </select>
            </div>
            {mode === "complete" && (
              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                <FitStat label="Pre-period R²"    value={topCorrelation} color={C.green} />
                <FitStat label="RMSE"             value={topRMSE}        color={C.green} />
                <FitStat label="Treatment mkts"   value={treatmentMarkets.length} color={C.cyan} />
                <FitStat label="Control mkts"     value={controlMarkets.length}   color={C.green} />
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${C.border}` }}>
            {mode === "assign" && (
              <button
                onClick={runSelection}
                disabled={!canRun}
                style={{
                  background: canRun ? C.cyan : C.border,
                  border: "none", borderRadius: 7, color: canRun ? C.bg : C.muted,
                  fontFamily: font.body, fontWeight: 700, fontSize: 12,
                  padding: "10px 0", cursor: canRun ? "pointer" : "not-allowed",
                  transition: "all 0.15s",
                }}
              >
                {treatmentMarkets.length === 0 ? "Select treatment first" : "▶ Run GeoLiftMarketSelection()"}
              </button>
            )}
            {mode === "complete" && (
              <button style={{
                background: C.green, border: "none", borderRadius: 7,
                color: C.bg, fontFamily: font.body, fontWeight: 700,
                fontSize: 12, padding: "10px 0", cursor: "pointer",
              }}>
                ✓ Confirm & Continue
              </button>
            )}
            {(mode === "assign" || mode === "complete") && (
              <button onClick={reset} style={{
                background: "transparent", border: `1px solid ${C.border}`,
                borderRadius: 7, color: C.muted, fontFamily: font.body,
                fontSize: 12, padding: "8px 0", cursor: "pointer",
              }}>Reset</button>
            )}
          </div>
        </aside>

        {/* ── MAP ── */}
        <div ref={mapContainerRef} style={{ flex: 1, position: "relative", overflow: "hidden", background: C.bg }}>
          {!mapReady && (
            <div style={{
              position: "absolute", inset: 0, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 10,
            }}>
              <div style={{ fontFamily: font.mono, fontSize: 11, color: C.muted }}>Loading US market map...</div>
              <div style={{ width: 120, height: 3, background: C.border, borderRadius: 2 }}>
                <div style={{ width: "60%", height: "100%", background: C.cyan, borderRadius: 2, animation: "shimmer 1.2s infinite" }} />
              </div>
            </div>
          )}

          <svg ref={svgRef}
            width={mapDims.w} height={mapDims.h}
            style={{ display: "block" }}
          />

          {/* ── MAP LEGEND ── */}
          <div style={{
            position: "absolute", bottom: 16, left: 16,
            background: C.surface + "ee", border: `1px solid ${C.border}`,
            borderRadius: 8, padding: "10px 14px",
          }}>
            <div style={{ fontFamily: font.mono, fontSize: 9, color: C.muted, marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.06em" }}>Market Status</div>
            {[
              { color: C.cyan,  label: "Treatment" },
              { color: C.green, label: "Control (selected)" },
              { color: C.blue,  label: "Control (candidate)" },
              { color: C.muted, label: "Available" },
            ].map(l => (
              <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                <div style={{ width: 8, height: 8, borderRadius: 99, background: l.color, opacity: 0.85 }} />
                <span style={{ fontFamily: font.mono, fontSize: 9, color: C.muted }}>{l.label}</span>
              </div>
            ))}
            {mode === "complete" && (
              <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${C.border}` }}>
                <div style={{ fontFamily: font.mono, fontSize: 9, color: C.muted }}>Arc = similarity score</div>
              </div>
            )}
          </div>

          {/* ── TOOLTIP ── */}
          {hovered && (
            <div style={{
              position: "absolute",
              left: Math.min(tooltipXY.x, mapDims.w - 190),
              top: Math.max(tooltipXY.y, 8),
              background: C.surfaceHi, border: `1px solid ${C.borderHi}`,
              borderRadius: 8, padding: "10px 14px",
              pointerEvents: "none", zIndex: 20,
              minWidth: 170,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: 99, background: marketColor(hovered.status), flexShrink: 0 }} />
                <span style={{ fontFamily: font.heading, fontSize: 13, fontWeight: 700, color: "#fff" }}>{hovered.name}</span>
              </div>
              <Row label="Status"      value={hovered.status.charAt(0).toUpperCase() + hovered.status.slice(1)} color={marketColor(hovered.status)} />
              <Row label="Population"  value={`${hovered.pop}M`} />
              {mode !== "assign" && hovered.status !== "treatment" && (
                <Row label="Similarity" value={`${(hovered.simScore * 100).toFixed(0)}%`}
                  color={hovered.simScore > 0.75 ? C.green : hovered.simScore > 0.55 ? C.blue : C.muted} />
              )}
              {mode === "assign" && (
                <div style={{ marginTop: 6, fontFamily: font.mono, fontSize: 9, color: C.muted }}>
                  {hovered.status === "available" ? "Click to add as treatment" : "Click to remove"}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT PANEL (post-selection) ── */}
        {mode === "complete" && (
          <aside style={{
            width: 300, background: C.surface, borderLeft: `1px solid ${C.border}`,
            display: "flex", flexDirection: "column", flexShrink: 0, overflow: "hidden",
          }}>
            {/* Tabs */}
            <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              {[
                { id: "scores", label: "Similarity Scores" },
                { id: "fit",    label: "Pre-period Fit" },
              ].map(t => (
                <button key={t.id} onClick={() => setRightTab(t.id)} style={{
                  flex: 1, padding: "12px 0", background: "transparent",
                  borderBottom: rightTab === t.id ? `2px solid ${C.cyan}` : "2px solid transparent",
                  border: "none", color: rightTab === t.id ? C.cyan : C.muted,
                  fontFamily: font.mono, fontSize: 11, fontWeight: rightTab === t.id ? 600 : 400,
                  cursor: "pointer",
                }}>{t.label}</button>
              ))}
            </div>

            {/* Scores tab */}
            {rightTab === "scores" && (
              <div style={{ overflowY: "auto", flex: 1, padding: "12px 0" }}>
                <div style={{ padding: "0 14px 10px", fontFamily: font.mono, fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  All candidate markets · ranked by synthetic control fit
                </div>
                {ranked.map((m, i) => {
                  const isCtrl = m.status === "control";
                  const barW   = `${(m.simScore * 100).toFixed(0)}%`;
                  return (
                    <div key={m.id} style={{
                      padding: "8px 14px",
                      background: isCtrl ? C.greenDim : "transparent",
                      borderLeft: `2px solid ${isCtrl ? C.green : "transparent"}`,
                      marginBottom: 2,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <span style={{ fontFamily: font.mono, fontSize: 9, color: C.muted, width: 14 }}>#{i + 1}</span>
                          <span style={{ fontSize: 12, fontWeight: isCtrl ? 600 : 400, color: isCtrl ? C.green : C.text }}>{m.name}</span>
                          {isCtrl && <span style={{ fontFamily: font.mono, fontSize: 8, color: C.green, background: C.greenDim, border: `1px solid ${C.green}40`, borderRadius: 3, padding: "1px 5px" }}>CTRL</span>}
                        </div>
                        <span style={{ fontFamily: font.mono, fontSize: 11, fontWeight: 600, color: isCtrl ? C.green : C.blue }}>
                          {(m.simScore * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div style={{ height: 3, background: C.border, borderRadius: 2 }}>
                        <div style={{ width: barW, height: "100%", background: isCtrl ? C.green : C.blue, borderRadius: 2, opacity: 0.7 }} />
                      </div>
                      <div style={{ fontFamily: font.mono, fontSize: 9, color: C.muted, marginTop: 3 }}>
                        Pop {m.pop}M
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Fit tab */}
            {rightTab === "fit" && (
              <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 10px" }}>
                <div style={{ fontFamily: font.mono, fontSize: 9, color: C.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Pre-period trend overlay · {treatmentMarkets[0]?.name || "Treatment"} vs control pool
                </div>
                <div style={{ background: C.surfaceHi, borderRadius: 6, padding: "8px 0 4px" }}>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={prePeriodData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke={C.border} strokeDasharray="2 3" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontFamily: font.mono, fontSize: 8, fill: C.muted }}
                        axisLine={false} tickLine={false} interval={6} />
                      <YAxis tick={{ fontFamily: font.mono, fontSize: 8, fill: C.muted }}
                        axisLine={false} tickLine={false}
                        tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
                      <Tooltip
                        contentStyle={{ background: C.surfaceHi, border: `1px solid ${C.borderHi}`, borderRadius: 6, fontFamily: font.mono, fontSize: 10 }}
                        formatter={(v, name) => [`$${(v / 1000).toFixed(0)}K`, name]}
                      />
                      <Line dataKey="Treatment Aggregate" stroke={C.cyan}  strokeWidth={1.8} dot={false} isAnimationActive={false} />
                      <Line dataKey="Synthetic Control"   stroke={C.green} strokeWidth={1.5} dot={false} strokeDasharray="4 2" isAnimationActive={false} />
                      {controlMarkets.slice(0, 2).map((m, i) => (
                        <Line key={m.id} dataKey={m.name} stroke={C.muted} strokeWidth={1}
                          dot={false} isAnimationActive={false} opacity={0.5} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                  <FitStat label="R² (pre-period fit)"   value={topCorrelation} color={C.green} />
                  <FitStat label="RMSE"                  value={topRMSE}        color={C.green} />
                  <FitStat label="MAPE"                  value="2.31%"          color={C.green} />
                  <FitStat label="Bias (avg Δ/day)"      value="$312"           color={C.cyan}  />
                </div>
                <div style={{ marginTop: 12, padding: "8px 10px", background: C.greenDim, border: `1px solid ${C.green}30`, borderRadius: 6 }}>
                  <div style={{ fontFamily: font.mono, fontSize: 10, color: C.green, fontWeight: 600 }}>✓ Excellent pre-period fit</div>
                  <div style={{ fontSize: 10, color: C.muted, marginTop: 2, lineHeight: 1.5 }}>
                    R² ≥ 0.95 indicates the synthetic control closely tracks treatment in the pre-period. Results will be reliable.
                  </div>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════*/
/*  SMALL COMPONENTS                                                  */
/* ═══════════════════════════════════════════════════════════════════*/

function GoogleFonts() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Mono:wght@400;500&family=Inter:wght@400;500;600&display=swap');
      *, *::before, *::after { box-sizing: border-box; }
      ::-webkit-scrollbar { width: 3px; background: ${C.bg}; }
      ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 2px; }
      @keyframes shimmer { 0%,100%{opacity:0.4} 50%{opacity:1} }
    `}</style>
  );
}

function Chev() {
  return <span style={{ color: C.border, fontSize: 12 }}>›</span>;
}

function StepIndicator({ steps, current }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {steps.map((s, i) => (
        <div key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{
              width: 18, height: 18, borderRadius: 4, flexShrink: 0,
              background: i < current ? C.green : i === current ? C.cyan : C.border,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: font.mono, fontSize: 9, fontWeight: 700,
              color: i <= current ? C.bg : C.muted,
            }}>
              {i < current ? "✓" : i + 1}
            </div>
            <span style={{
              fontFamily: font.mono, fontSize: 10,
              color: i === current ? C.cyan : i < current ? C.green : C.muted,
              fontWeight: i === current ? 600 : 400,
            }}>{s}</span>
          </div>
          {i < steps.length - 1 && <span style={{ color: C.border, fontSize: 10 }}>—</span>}
        </div>
      ))}
    </div>
  );
}

function SideLabel({ children }) {
  return (
    <div style={{ fontFamily: font.mono, fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
      {children}
    </div>
  );
}

function CountPill({ n, color }) {
  return (
    <span style={{ background: color + "20", border: `1px solid ${color}50`, color, borderRadius: 99, fontSize: 9, fontWeight: 700, padding: "1px 6px", fontFamily: font.mono }}>
      {n}
    </span>
  );
}

function MarketChip({ m, color, sub, onRemove }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "5px 8px", background: color + "12", border: `1px solid ${color}30`,
      borderRadius: 5, marginBottom: 4,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ width: 6, height: 6, borderRadius: 99, background: color, flexShrink: 0 }} />
        <span style={{ fontFamily: font.mono, fontSize: 11, color: C.text }}>{m.name}</span>
        {sub && <span style={{ fontFamily: font.mono, fontSize: 9, color: C.muted }}>{sub}</span>}
      </div>
      {onRemove && (
        <button onClick={onRemove} style={{
          background: "none", border: "none", color: C.muted, cursor: "pointer",
          fontFamily: font.mono, fontSize: 11, padding: "0 2px",
        }}>×</button>
      )}
    </div>
  );
}

function FitStat({ label, value, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
      <span style={{ fontFamily: font.mono, fontSize: 10, color: C.muted }}>{label}</span>
      <span style={{ fontFamily: font.mono, fontSize: 11, fontWeight: 600, color }}>{value}</span>
    </div>
  );
}

function Row({ label, value, color }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
      <span style={{ fontFamily: font.mono, fontSize: 10, color: C.muted }}>{label}</span>
      <span style={{ fontFamily: font.mono, fontSize: 10, color: color || C.text }}>{value}</span>
    </div>
  );
}
