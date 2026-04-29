import { createContext, useContext, useReducer, useState, useMemo, useEffect, useRef } from "react";
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, BarChart, Bar, Cell as RCell,
} from "recharts";

/* ── API config ──────────────────────────────────────────────────── */
const API_BASE  = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) || "http://localhost:8000";
const getToken  = () => (typeof localStorage !== "undefined" ? localStorage.getItem("geolift_token") : "") || "";

/* ═══════════════════════════════════════════════════════════════════
   DESIGN TOKENS
═══════════════════════════════════════════════════════════════════ */
const C = {
  bg:"#080b10", surface:"#0e1219", surfaceHi:"#141923",
  border:"#1e2733", borderHi:"#2a3545", text:"#cfd8e3", muted:"#5a6a7e",
  cyan:"#00c9a7",   cyanDim:"#00c9a718",
  amber:"#f5a623",  amberDim:"#f5a62318",
  red:"#f04a5a",    redDim:"#f04a5a18",
  green:"#3dd68c",  greenDim:"#3dd68c18",
  blue:"#4e9eff",   blueDim:"#4e9eff12",
  purple:"#a78bfa", purpleDim:"#a78bfa12",
};
const font = { heading:"'Syne',sans-serif", mono:"'DM Mono',monospace", body:"'Inter',system-ui,sans-serif" };

/* ═══════════════════════════════════════════════════════════════════
   APP STATE — useReducer + Context
═══════════════════════════════════════════════════════════════════ */
const AppCtx = createContext(null);
const useApp = () => useContext(AppCtx);

const MOCK_EXPS = [
  { id:"exp-001", name:"Q4 Meta Paid Social — US DMA", status:"complete", type:"single", kpi:"Revenue", channel:"Meta", geoLevel:"DMA", testRange:"Nov 3–23, 2024", spend:325000, wizardStep:4, datasetId:"ds-aaa1", selectionId:"sel-bbb2", powerId:"pow-ccc3", resultId:"res-ddd4", result:{ lift:7.4, iROAS:2.31, incRevenue:748200, pValue:0.031, r2:0.974 }, cells:[{label:"Treatment",color:C.cyan}], bpScore:13 },
  { id:"exp-002", name:"Q4 Budget Calibration — Multi-Cell", status:"complete", type:"multi", kpi:"Revenue", channel:"Meta", geoLevel:"DMA", testRange:"Nov 3–23, 2024", spend:650000, wizardStep:4, datasetId:"ds-aaa2", selectionId:"sel-bbb3", powerId:"pow-ccc4", resultId:"res-ddd5", result:{ lift:9.8, iROAS:2.87, incRevenue:1864000, pValue:0.018, r2:0.981 }, cells:[{label:"Cell A",color:C.cyan},{label:"Cell B",color:C.amber},{label:"Cell C",color:C.purple}], bpScore:14 },
  { id:"exp-003", name:"Q1 Brand Awareness — Social Upper Funnel", status:"active", type:"single", kpi:"Reach", channel:"Meta", geoLevel:"City", testRange:"Jan 6–Feb 2, 2025", spend:210000, wizardStep:4, datasetId:"ds-aaa3", selectionId:"sel-bbb4", powerId:"pow-ccc5", resultId:null, daysElapsed:17, testDays:28, cells:[{label:"Treatment",color:C.cyan}], bpScore:12 },
  { id:"exp-004", name:"TikTok vs Meta Incrementality", status:"active", type:"multi", kpi:"Conversions", channel:"Multi-Channel", geoLevel:"DMA", testRange:"Jan 13–Feb 9, 2025", spend:480000, wizardStep:4, datasetId:"ds-aaa4", selectionId:"sel-bbb5", powerId:"pow-ccc6", resultId:null, daysElapsed:10, testDays:28, cells:[{label:"Meta Only",color:C.blue},{label:"TikTok Only",color:C.purple},{label:"Combined",color:C.amber}], bpScore:13 },
  { id:"exp-005", name:"Q2 Spring Campaign — City Level", status:"draft", type:"single", kpi:"Orders", channel:"Meta", geoLevel:"City", testRange:"Mar 17–Apr 13, 2025", spend:175000, wizardStep:2, datasetId:"ds-aaa5", selectionId:null, powerId:null, resultId:null, cells:[{label:"Treatment",color:C.cyan}], bpScore:8 },
  { id:"exp-006", name:"EU Expansion — Germany & France", status:"draft", type:"multi", kpi:"Revenue", channel:"Meta", geoLevel:"Region", testRange:"Mar 3–30, 2025", spend:290000, wizardStep:1, datasetId:null, selectionId:null, powerId:null, resultId:null, cells:[{label:"Germany",color:C.cyan},{label:"France",color:C.amber}], bpScore:5 },
];

const newExp = () => ({
  id: `exp-${Date.now()}`, name:"", status:"draft", type:"single", kpi:"Revenue",
  channel:"Meta", geoLevel:"DMA", granularity:"daily", testRange:"",
  startDate:"", endDate:"", preStart:"", preEnd:"",
  spend:"", targetEffect:"5", confidence:"80",
  wizardStep:0, datasetId:null, selectionId:null, powerId:null, resultId:null,
  cells:[{id:"t1",label:"Treatment",color:C.cyan,budget:"",channel:"Meta"}],
  localMedia:"none", nationalMediaStable:true, structuralBreaks:false,
  covariates:false, hasMinGeos:false, missingValues:false,
  bpScore:0, notes:"", owner:"Me",
});

function reducer(state, action) {
  switch (action.type) {
    case "NAV":        return { ...state, view:action.view, params:action.params||{} };
    case "SET_EXP":    return { ...state, activeExp:action.exp };
    case "UPD_EXP":    return {
      ...state,
      activeExp: state.activeExp ? { ...state.activeExp, ...action.delta } : state.activeExp,
      experiments: state.experiments.map(e => e.id===state.activeExp?.id ? {...e,...action.delta} : e),
    };
    case "SAVE_EXP": {
      const exists = state.experiments.find(e => e.id === state.activeExp?.id);
      return {
        ...state,
        experiments: exists
          ? state.experiments.map(e => e.id===state.activeExp.id ? state.activeExp : e)
          : [state.activeExp, ...state.experiments],
      };
    }
    case "NOTIFY":   return { ...state, toasts:[{msg:action.msg,color:action.color||C.cyan,id:Date.now()},...state.toasts].slice(0,3) };
    case "DISMISS":  return { ...state, toasts:state.toasts.filter(t=>t.id!==action.id) };
    case "LOGIN":
      try { localStorage.setItem("geolift_user",  JSON.stringify(action.user));
            localStorage.setItem("geolift_token", action.token); } catch {}
      return { ...state, user: action.user, view: "library" };
    case "LOGOUT":
      try { localStorage.removeItem("geolift_user"); localStorage.removeItem("geolift_token"); } catch {}
      return { ...state, user: null, view: "login" };
    case "API_SET":  return { ...state, apiStatus:action.status };
    case "SET_EXPERIMENTS": return { ...state, experiments: action.experiments };
    default:         return state;
  }
}

const init = { view:"library", params:{}, experiments:MOCK_EXPS, activeExp:null, toasts:[], apiStatus:"idle",
  user: (() => { try { const u = localStorage.getItem("geolift_user"); return u ? JSON.parse(u) : null; } catch { return null; } })(),
};

/* ═══════════════════════════════════════════════════════════════════
   ROOT
═══════════════════════════════════════════════════════════════════ */
export default function GeoLiftApp() {
  const [state, dispatch] = useReducer(reducer, init);
  const nav   = (view, params={}) => dispatch({ type:"NAV", view, params });
  const upd   = (delta) => dispatch({ type:"UPD_EXP", delta });
  const notify= (msg, color) => dispatch({ type:"NOTIFY", msg, color });

  const openExp = (exp, targetView) => {
    dispatch({ type:"SET_EXP", exp });
    if (targetView) { nav(targetView); return; }
    if (exp.status === "complete") nav("results");
    else if (exp.status === "active") nav("monitor");
    else nav("wizard");
  };

  const openNew = () => {
    const exp = newExp();
    dispatch({ type:"SET_EXP", exp });
    nav("wizard");
  };

  return (
    <AppCtx.Provider value={{ state, dispatch, nav, upd, notify, openExp, openNew }}>
      <div style={{ minHeight:"100vh", background:C.bg, fontFamily:font.body, color:C.text, display:"flex", flexDirection:"column" }}>
        <GoogleFonts />
        {!state.user ? (
          <LoginScreen />
        ) : (
          <>
            <Topbar />
            <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
              {state.view === "library" && <LibraryScreen />}
              {state.view === "wizard"  && <WizardScreen />}
              {state.view === "results" && <ResultsScreen />}
              {state.view === "monitor" && <MonitorScreen />}
              {state.view === "map"     && <MapScreen />}
            </div>
            <ToastStack />
          </>
        )}
      </div>
    </AppCtx.Provider>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TOPBAR
═══════════════════════════════════════════════════════════════════ */
function Topbar() {
  const { state, dispatch, nav, openNew } = useApp();
  const exp = state.activeExp;

  return (
    <nav style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, height:52, padding:"0 24px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0, zIndex:20 }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <button onClick={() => nav("library")} style={{ background:"none", border:"none", cursor:"pointer", fontFamily:font.heading, fontSize:17, fontWeight:800, color:"#fff", letterSpacing:"-0.02em", padding:0 }}>
          <span style={{ color:C.cyan }}>Geo</span>Lift
        </button>
        {state.view !== "library" && exp && (
          <>
            <span style={{ color:C.border }}>›</span>
            <span style={{ fontFamily:font.mono, fontSize:11, color:C.muted, cursor:"pointer" }} onClick={() => nav("library")}>Library</span>
            <span style={{ color:C.border }}>›</span>
            <span style={{ fontFamily:font.mono, fontSize:11, color:C.text, maxWidth:260, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {exp.name || "New Experiment"}
            </span>
            {state.view === "results" && <><span style={{ color:C.border }}>›</span><span style={{ fontFamily:font.mono, fontSize:11, color:C.green }}>Results</span></>}
            {state.view === "monitor" && <><span style={{ color:C.border }}>›</span><span style={{ fontFamily:font.mono, fontSize:11, color:C.cyan }}>Monitor</span></>}
            {state.view === "map"     && <><span style={{ color:C.border }}>›</span><span style={{ fontFamily:font.mono, fontSize:11, color:C.amber }}>Market Map</span></>}
          </>
        )}
      </div>
      <div style={{ display:"flex", gap:10, alignItems:"center" }}>
        <BackendStatus />
        {state.view === "library" && (
          <button onClick={openNew} style={{ background:C.cyan, border:"none", borderRadius:7, color:C.bg, fontFamily:font.body, fontWeight:700, fontSize:13, padding:"7px 16px", cursor:"pointer" }}>
            + New Experiment
          </button>
        )}
        {state.view === "wizard" && exp && (
          <button onClick={() => { dispatch({ type:"SAVE_EXP" }); nav("library"); }}
            style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:6, color:C.muted, fontFamily:font.mono, fontSize:11, padding:"5px 12px", cursor:"pointer" }}>
            Save & Exit
          </button>
        )}
        {/* User menu */}
        {state.user && (
          <div style={{ display:"flex", alignItems:"center", gap:8, paddingLeft:8, borderLeft:`1px solid ${C.border}` }}>
            <div style={{ width:26, height:26, borderRadius:99, background:C.cyanDim, border:`1px solid ${C.cyan}40`, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:font.mono, fontSize:11, color:C.cyan, fontWeight:700 }}>
              {(state.user.name||state.user.email||"?")[0].toUpperCase()}
            </div>
            <span style={{ fontFamily:font.mono, fontSize:10, color:C.muted }}>{state.user.org_name || state.user.email}</span>
            <button onClick={() => dispatch({ type:"LOGOUT" })}
              style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:5, color:C.muted, fontFamily:font.mono, fontSize:10, padding:"3px 8px", cursor:"pointer" }}>
              Sign out
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}

function SaveExitBtn() {
  const { dispatch, nav } = useApp();
  return (
    <button onClick={() => { dispatch({ type:"SAVE_EXP" }); nav("library"); }}
      style={{ background:"transparent", border:`1px solid ${C.border}`, borderRadius:6, color:C.muted, fontFamily:font.mono, fontSize:11, padding:"5px 12px", cursor:"pointer" }}>
      Save & Exit
    </button>
  );
}

function BackendStatus() {
  const [status, setStatus] = useState("connecting");
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/health`, { signal: AbortSignal.timeout(4000) }).then(r => r.json());
        setStatus(res.status === "healthy" ? "online" : "degraded");
      } catch {
        setStatus("offline");
      }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);
  const col = status === "online" ? C.green : status === "degraded" ? C.amber : C.red;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:5, fontFamily:font.mono, fontSize:10, color:C.muted }}>
      <div style={{ width:6, height:6, borderRadius:99, background:col, animation: status === "connecting" ? "pulse 1.2s infinite" : "none" }} />
      {status === "online" ? "R API online" : status === "degraded" ? "API degraded" : status === "connecting" ? "Connecting…" : "API offline"}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   LOGIN SCREEN
═══════════════════════════════════════════════════════════════════ */
function LoginScreen() {
  const { dispatch, notify } = useApp();
  const [email,    setEmail]    = useState("analyst@acme.com");
  const [password, setPassword] = useState("geolift_demo");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  const handleLogin = async (e) => {
    if (e?.preventDefault) e.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      }).then(r => r.json());

      if (res.error) throw new Error(res.error);

      dispatch({ type: "LOGIN", user: res.user, token: res.access_token });
      notify(`Welcome back, ${res.user.name || res.user.email}`, C.cyan);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Demo shortcut — skip auth if backend isn't reachable
  const demoLogin = () => {
    dispatch({
      type: "LOGIN",
      user: { id:"demo", name:"Demo Analyst", email:"analyst@acme.com", org_name:"Acme Brand Co.", role:"admin" },
      token: "demo_token",
    });
  };

  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:C.bg, padding:24 }}>
      <div style={{ width:"100%", maxWidth:400 }}>
        {/* Logo */}
        <div style={{ textAlign:"center", marginBottom:40 }}>
          <div style={{ fontFamily:font.heading, fontSize:32, fontWeight:800, color:"#fff", letterSpacing:"-0.03em", marginBottom:8 }}>
            <span style={{ color:C.cyan }}>Geo</span>Lift
          </div>
          <div style={{ fontFamily:font.mono, fontSize:12, color:C.muted }}>Incrementality Experiment Designer</div>
        </div>

        {/* Card */}
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:32 }}>
          <div style={{ fontFamily:font.heading, fontSize:18, fontWeight:700, color:"#fff", marginBottom:4 }}>Sign in</div>
          <div style={{ fontFamily:font.mono, fontSize:11, color:C.muted, marginBottom:24 }}>
            Demo credentials are pre-filled below
          </div>

          {error && (
            <div style={{ background:C.redDim, border:`1px solid ${C.red}40`, borderRadius:6, padding:"10px 12px", marginBottom:16, fontFamily:font.mono, fontSize:11, color:C.red }}>
              {error}
            </div>
          )}

          <div style={{ marginBottom:16 }}>
            <label style={{ fontFamily:font.mono, fontSize:10, color:C.muted, display:"block", marginBottom:5, letterSpacing:"0.06em" }}>EMAIL</label>
            <input value={email} onChange={e=>setEmail(e.target.value)}
              placeholder="analyst@acme.com"
              style={{ background:C.surfaceHi, border:`1px solid ${C.border}`, borderRadius:6, color:C.text, fontFamily:font.body, fontSize:13, padding:"9px 12px", outline:"none", width:"100%", transition:"border-color 0.15s" }}
              onFocus={e=>e.target.style.borderColor=C.cyan}
              onBlur={e=>e.target.style.borderColor=C.border}
            />
          </div>

          <div style={{ marginBottom:24 }}>
            <label style={{ fontFamily:font.mono, fontSize:10, color:C.muted, display:"block", marginBottom:5, letterSpacing:"0.06em" }}>PASSWORD</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
              placeholder="••••••••"
              style={{ background:C.surfaceHi, border:`1px solid ${C.border}`, borderRadius:6, color:C.text, fontFamily:font.body, fontSize:13, padding:"9px 12px", outline:"none", width:"100%", transition:"border-color 0.15s" }}
              onFocus={e=>e.target.style.borderColor=C.cyan}
              onBlur={e=>e.target.style.borderColor=C.border}
              onKeyDown={e=>e.key==="Enter"&&handleLogin()}
            />
          </div>

          <button onClick={handleLogin} disabled={loading} style={{
            width:"100%", background:C.cyan, border:"none", borderRadius:8,
            color:C.bg, fontFamily:font.body, fontWeight:700, fontSize:14,
            padding:"11px 0", cursor:loading?"not-allowed":"pointer",
            opacity:loading?0.7:1, marginBottom:12, transition:"opacity 0.15s",
          }}>
            {loading ? "Signing in…" : "Sign in →"}
          </button>

          <button onClick={demoLogin} style={{
            width:"100%", background:"transparent",
            border:`1px solid ${C.border}`, borderRadius:8,
            color:C.muted, fontFamily:font.mono, fontSize:12,
            padding:"9px 0", cursor:"pointer",
          }}>
            Skip — load demo data without backend
          </button>
        </div>

        <div style={{ textAlign:"center", marginTop:20, fontFamily:font.mono, fontSize:10, color:C.muted }}>
          Demo: <span style={{ color:C.text }}>analyst@acme.com</span> / <span style={{ color:C.text }}>geolift_demo</span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   LIBRARY SCREEN
═══════════════════════════════════════════════════════════════════ */
function LibraryScreen() {
  const { state, openExp, openNew, dispatch } = useApp();
  const [filter, setFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [view, setView] = useState("grid");
  const [loading, setLoading] = useState(false);

  // Load experiments from API on mount
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE}/v1/experiments`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        }).then(r => r.json());
        if (res.experiments) {
          // Map API response to local shape, falling back to mock data if API unavailable
          dispatch({ type: "SET_EXPERIMENTS", experiments: res.experiments });
        }
      } catch {
        // API not reachable — fall back to mock data already in state
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const exps = state.experiments;
  const counts = { all:exps.length, complete:exps.filter(e=>e.status==="complete").length, active:exps.filter(e=>e.status==="active").length, draft:exps.filter(e=>e.status==="draft").length };
  const avgLift = exps.filter(e=>e.result).reduce((s,e)=>s+e.result.lift,0)/Math.max(1,exps.filter(e=>e.result).length);

  const filtered = exps.filter(e => {
    if (filter!=="all" && e.status!==filter) return false;
    if (typeFilter!=="all" && e.type!==typeFilter) return false;
    if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div style={{ flex:1, overflowY:"auto", padding:"28px 28px 60px" }}>
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontFamily:font.heading, fontSize:28, fontWeight:800, color:"#fff", margin:"0 0 4px", letterSpacing:"-0.02em" }}>Experiment Library</h1>
        <p style={{ fontFamily:font.mono, fontSize:12, color:C.muted, margin:0 }}>Design, monitor, and measure all your GeoLift incrementality experiments</p>
      </div>

      {/* Summary strip */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:12, marginBottom:24 }}>
        {[
          { label:"Total", value:counts.all, color:C.text },
          { label:"Complete", value:counts.complete, color:C.green },
          { label:"Active", value:counts.active, color:C.cyan, pulse:true },
          { label:"Draft", value:counts.draft, color:C.muted },
          { label:"Avg Measured Lift", value:`${avgLift.toFixed(1)}%`, color:C.green },
        ].map(m => (
          <div key={m.label} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:"14px 16px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:6 }}>
              {m.pulse && <div style={{ width:6, height:6, borderRadius:99, background:C.cyan, animation:"pulse 1.8s infinite" }} />}
              <span style={{ fontFamily:font.mono, fontSize:9, color:C.muted, textTransform:"uppercase", letterSpacing:"0.06em" }}>{m.label}</span>
            </div>
            <div style={{ fontFamily:font.heading, fontSize:22, fontWeight:800, color:m.color, letterSpacing:"-0.02em" }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, flexWrap:"wrap", gap:8 }}>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <FilterGroup
            options={[{id:"all",label:`All (${counts.all})`},{id:"active",label:`Active (${counts.active})`},{id:"complete",label:`Complete (${counts.complete})`},{id:"draft",label:`Draft (${counts.draft})`}]}
            value={filter} onChange={setFilter} activeColor={C.cyan}
          />
          <FilterGroup
            options={[{id:"all",label:"All types"},{id:"single",label:"Single-Cell"},{id:"multi",label:"Multi-Cell"}]}
            value={typeFilter} onChange={setTypeFilter} activeColor={C.amber}
          />
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <div style={{ position:"relative" }}>
            <span style={{ position:"absolute", left:9, top:"50%", transform:"translateY(-50%)", color:C.muted, fontSize:12 }}>⌕</span>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..."
              style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:6, color:C.text, fontFamily:font.body, fontSize:12, padding:"6px 10px 6px 26px", outline:"none", width:180 }} />
          </div>
          <div style={{ display:"flex", background:C.surface, border:`1px solid ${C.border}`, borderRadius:6, padding:2, gap:2 }}>
            {["grid","table"].map(v=>(
              <button key={v} onClick={()=>setView(v)} style={{ background:view===v?C.surfaceHi:"transparent", border:`1px solid ${view===v?C.border:"transparent"}`, borderRadius:4, color:view===v?C.text:C.muted, fontFamily:font.mono, fontSize:11, padding:"3px 8px", cursor:"pointer" }}>
                {v==="grid"?"⊞":"≡"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "grid" ? (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(340px,1fr))", gap:14 }}>
          {filtered.map(exp => <ExpCard key={exp.id} exp={exp} onOpen={(target)=>openExp(exp, target)} />)}
          <NewExpCard onOpen={openNew} />
        </div>
      ) : (
        <ExpTable experiments={filtered} onOpen={openExp} />
      )}
    </div>
  );
}

function ExpCard({ exp, onOpen }) {
  // onOpen(targetView?) — routes to target or auto-routes by status
  const handleOpen = (target) => onOpen(target);
  const statusColor = { complete:C.green, active:C.cyan, draft:C.muted }[exp.status];
  const isComplete  = exp.status === "complete";
  const isActive    = exp.status === "active";
  const isDraft     = exp.status === "draft";
  const progressPct = isActive ? Math.round((exp.daysElapsed||0)/exp.testDays*100) : isDraft ? Math.round((exp.bpScore||0)/14*100) : 100;

  return (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"16px 18px", cursor:"pointer", transition:"border-color 0.15s", position:"relative", overflow:"hidden" }}
      onClick={onOpen}
      onMouseEnter={e=>e.currentTarget.style.borderColor=C.borderHi}
      onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
      <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:statusColor, opacity:0.5 }} />
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
        <div style={{ display:"flex", gap:5 }}>
          <MiniPill status={exp.status} />
          <Tag color={exp.type==="multi"?C.amber:C.cyan}>{exp.type==="multi"?"Multi-Cell":"Single-Cell"}</Tag>
        </div>
        <span style={{ fontFamily:font.mono, fontSize:9, color:C.muted }}>{exp.channel}</span>
      </div>
      <div style={{ fontFamily:font.heading, fontSize:14, fontWeight:700, color:"#fff", lineHeight:1.3, marginBottom:8 }}>{exp.name}</div>
      <div style={{ display:"flex", gap:12, marginBottom:10, flexWrap:"wrap" }}>
        <MiniMeta label={exp.kpi} /><MiniMeta label={exp.geoLevel} /><MiniMeta label={exp.testRange} />
      </div>
      {isComplete && exp.result && (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:6, marginBottom:10 }}>
          <ResultMini label="Lift" value={`+${exp.result.lift}%`} color={C.green} />
          <ResultMini label="iROAS" value={`${exp.result.iROAS}×`} color={exp.result.iROAS>=2?C.green:C.amber} />
          <ResultMini label="Inc. Rev" value={`$${(exp.result.incRevenue/1000).toFixed(0)}K`} color={C.cyan} />
        </div>
      )}
      {isActive && (
        <div style={{ marginBottom:10 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
            <span style={{ fontFamily:font.mono, fontSize:9, color:C.muted }}>Flight</span>
            <span style={{ fontFamily:font.mono, fontSize:9, color:C.cyan }}>Day {exp.daysElapsed}/{exp.testDays}</span>
          </div>
          <ProgressBar pct={progressPct} color={C.cyan} />
        </div>
      )}
      {isDraft && (
        <div style={{ marginBottom:10 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
            <span style={{ fontFamily:font.mono, fontSize:9, color:C.muted }}>Setup ({exp.bpScore}/14 checks)</span>
            <span style={{ fontFamily:font.mono, fontSize:9, color:C.muted }}>Step {exp.wizardStep+1}/5</span>
          </div>
          <ProgressBar pct={progressPct} color={progressPct>=80?C.green:progressPct>=50?C.amber:C.red} />
        </div>
      )}
      <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginBottom:10 }}>
        {exp.cells.map((c,i)=>(
          <div key={i} style={{ background:c.color+"15", border:`1px solid ${c.color}40`, borderRadius:4, padding:"2px 7px", fontFamily:font.mono, fontSize:9, color:c.color }}>{c.label}</div>
        ))}
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:10, borderTop:`1px solid ${C.border}` }}>
        <span style={{ fontFamily:font.mono, fontSize:10, color:C.muted }}>${(exp.spend/1000).toFixed(0)}K spend</span>
        <div style={{ display:"flex", gap:5 }}>
          {isComplete && <SmBtn color={C.green} onClick={e=>{e.stopPropagation();onOpen("results");}}>View Results →</SmBtn>}
          {isActive   && <SmBtn color={C.cyan}  onClick={e=>{e.stopPropagation();onOpen("monitor");}}>Monitor →</SmBtn>}
          {isDraft    && <SmBtn color={C.amber} onClick={e=>{e.stopPropagation();onOpen("wizard");}}>Continue Setup →</SmBtn>}
        </div>
      </div>
    </div>
  );
}

function NewExpCard({ onOpen }) {
  return (
    <div onClick={onOpen}
      style={{ background:"transparent", border:`2px dashed ${C.border}`, borderRadius:12, padding:"40px 20px", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8, transition:"all 0.15s", minHeight:200 }}
      onMouseEnter={e=>{e.currentTarget.style.borderColor=C.cyan;e.currentTarget.style.background=C.cyanDim;}}
      onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.background="transparent";}}>
      <div style={{ fontSize:24, color:C.muted }}>+</div>
      <div style={{ fontFamily:font.heading, fontSize:14, fontWeight:700, color:C.muted }}>New Experiment</div>
      <div style={{ fontFamily:font.mono, fontSize:11, color:C.muted }}>Design a new GeoLift study</div>
    </div>
  );
}

function ExpTable({ experiments, onOpen }) {
  return (
    <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, overflow:"hidden" }}>
      <table style={{ width:"100%", borderCollapse:"collapse" }}>
        <thead><tr style={{ background:C.surfaceHi }}>
          {["Name","Status","Type","KPI","Test Window","Lift","iROAS",""].map(h=>(
            <th key={h} style={{ fontFamily:font.mono, fontSize:10, color:C.muted, padding:"8px 14px", textAlign:"left", fontWeight:500, borderBottom:`1px solid ${C.border}` }}>{h}</th>
          ))}
        </tr></thead>
        <tbody>{experiments.map(e=>(
          <tr key={e.id} style={{ borderBottom:`1px solid ${C.border}`, cursor:"pointer" }}
            onClick={()=>onOpen(e)}
            onMouseEnter={ev=>ev.currentTarget.style.background=C.surfaceHi}
            onMouseLeave={ev=>ev.currentTarget.style.background="transparent"}>
            <td style={{ padding:"9px 14px", fontWeight:600, fontSize:12, maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{e.name}</td>
            <td style={{ padding:"9px 14px" }}><MiniPill status={e.status} /></td>
            <td style={{ padding:"9px 14px" }}><Tag color={e.type==="multi"?C.amber:C.cyan} small>{e.type==="multi"?"Multi":"Single"}</Tag></td>
            <td style={{ fontFamily:font.mono, fontSize:11, padding:"9px 14px", color:C.muted }}>{e.kpi}</td>
            <td style={{ fontFamily:font.mono, fontSize:11, padding:"9px 14px", color:C.muted }}>{e.testRange}</td>
            <td style={{ fontFamily:font.mono, fontSize:12, padding:"9px 14px", color:e.result?C.green:C.muted }}>{e.result?`+${e.result.lift}%`:"—"}</td>
            <td style={{ fontFamily:font.mono, fontSize:12, padding:"9px 14px", color:e.result?(e.result.iROAS>=2?C.green:C.amber):C.muted }}>{e.result?`${e.result.iROAS}×`:"—"}</td>
            <td style={{ padding:"9px 14px" }}>
              {e.status==="complete"&&<SmBtn color={C.green} small>Results</SmBtn>}
              {e.status==="active"&&<SmBtn color={C.cyan} small>Monitor</SmBtn>}
              {e.status==="draft"&&<SmBtn color={C.amber} small>Edit</SmBtn>}
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   WIZARD SCREEN
═══════════════════════════════════════════════════════════════════ */
const WIZARD_STEPS = [
  { id:0, label:"Setup",   icon:"⬡", lock:false },
  { id:1, label:"Data",    icon:"⬡", lock:false },
  { id:2, label:"Markets", icon:"⬡", lockKey:"datasetId" },
  { id:3, label:"Power",   icon:"⬡", lockKey:"selectionId" },
  { id:4, label:"Review",  icon:"⬡", lockKey:"powerId" },
];

function WizardScreen() {
  const { state, upd, dispatch, notify, nav } = useApp();
  const exp = state.activeExp;
  const [step, setStep] = useState(exp?.wizardStep || 0);

  if (!exp) return null;

  const gotoStep = (s) => {
    const stepDef = WIZARD_STEPS[s];
    if (stepDef.lockKey && !exp[stepDef.lockKey]) return; // guard
    setStep(s);
    upd({ wizardStep:s });
  };

  const isLocked = (s) => {
    const def = WIZARD_STEPS[s];
    return def.lockKey && !exp[def.lockKey];
  };

  const pct = Math.round((step / (WIZARD_STEPS.length-1)) * 100);

  return (
    <div style={{ flex:1, display:"flex", overflow:"hidden" }}>
      {/* Wizard sidebar */}
      <aside style={{ width:220, background:C.surface, borderRight:`1px solid ${C.border}`, display:"flex", flexDirection:"column", flexShrink:0 }}>
        <div style={{ padding:"20px 16px 14px", borderBottom:`1px solid ${C.border}` }}>
          {exp.name
            ? <div style={{ fontFamily:font.heading, fontSize:12, fontWeight:700, color:"#fff", wordBreak:"break-word" }}>{exp.name}</div>
            : <div style={{ fontFamily:font.mono, fontSize:11, color:C.muted }}>New Experiment</div>
          }
          <div style={{ marginTop:6, display:"flex", gap:5 }}>
            <Tag color={exp.type==="multi"?C.amber:C.cyan}>{exp.type==="multi"?"Multi-Cell":"Single-Cell"}</Tag>
          </div>
        </div>

        <nav style={{ padding:"12px 0", flex:1 }}>
          {WIZARD_STEPS.map(s => {
            const locked = isLocked(s.id);
            const active = step === s.id;
            const done   = step > s.id;
            return (
              <button key={s.id} onClick={()=>gotoStep(s.id)} disabled={locked}
                style={{ display:"flex", alignItems:"center", gap:10, width:"100%", padding:"9px 16px", background:active?C.cyanDim:"transparent", border:"none", borderLeft:active?`2px solid ${C.cyan}`:"2px solid transparent", cursor:locked?"not-allowed":"pointer", textAlign:"left" }}>
                <div style={{ width:20, height:20, borderRadius:4, background:locked?C.border:done?C.green:active?C.cyan:C.border, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:locked?C.muted:(done||active)?C.bg:C.muted, fontWeight:700, flexShrink:0 }}>
                  {locked ? "🔒" : done ? "✓" : s.id+1}
                </div>
                <div>
                  <div style={{ fontSize:12, fontWeight:active?600:400, color:locked?C.muted:active?C.cyan:done?C.text:C.muted }}>{s.label}</div>
                  {locked && <div style={{ fontFamily:font.mono, fontSize:9, color:C.muted }}>Complete prior step</div>}
                </div>
              </button>
            );
          })}
        </nav>

        {/* Progress */}
        <div style={{ padding:"12px 16px", borderTop:`1px solid ${C.border}` }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
            <span style={{ fontFamily:font.mono, fontSize:9, color:C.muted }}>Progress</span>
            <span style={{ fontFamily:font.mono, fontSize:9, color:C.cyan }}>{pct}%</span>
          </div>
          <ProgressBar pct={pct} color={C.cyan} />
        </div>

        {/* Resource chain */}
        <ResourceChain exp={exp} />
      </aside>

      {/* Step content */}
      <main style={{ flex:1, overflowY:"auto", padding:"32px 36px" }}>
        {step===0 && <WStep0 />}
        {step===1 && <WStep1 onComplete={()=>gotoStep(2)} />}
        {step===2 && <WStep2 onComplete={()=>gotoStep(3)} />}
        {step===3 && <WStep3 onComplete={()=>gotoStep(4)} />}
        {step===4 && <WStep4 />}

        <div style={{ display:"flex", justifyContent:"space-between", marginTop:36, paddingTop:20, borderTop:`1px solid ${C.border}` }}>
          <Btn secondary disabled={step===0} onClick={()=>gotoStep(step-1)}>← Back</Btn>
          {step < 4
            ? <Btn disabled={isLocked(step+1) && step<4} onClick={()=>gotoStep(step+1)}>Continue →</Btn>
            : <Btn style={{ background:C.green, color:C.bg }} onClick={async ()=>{
                try {
                  await fetch(`${API_BASE}/v1/experiments/${exp.id}`, {
                    method:"PATCH",
                    headers:{ "Content-Type":"application/json", Authorization:`Bearer ${getToken()}` },
                    body: JSON.stringify({ status: "active" }),
                  });
                } catch {}
                dispatch({type:"UPD_EXP",delta:{status:"active"}});
                dispatch({type:"SAVE_EXP"});
                notify("Experiment launched — flight monitoring active","#3dd68c");
                nav("library");
              }}>Launch Experiment ✓</Btn>
          }
        </div>
      </main>
    </div>
  );
}

function ResourceChain({ exp }) {
  const chain = [
    { label:"Experiment", id:exp.id,         color:C.cyan  },
    { label:"Dataset",    id:exp.datasetId,   color:C.blue  },
    { label:"Selection",  id:exp.selectionId, color:C.amber },
    { label:"Power",      id:exp.powerId,     color:C.purple},
    { label:"Results",    id:exp.resultId,    color:C.green },
  ];
  return (
    <div style={{ padding:"12px 16px", borderTop:`1px solid ${C.border}` }}>
      <div style={{ fontFamily:font.mono, fontSize:9, color:C.muted, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>Resource Chain</div>
      {chain.map((r,i) => (
        <div key={r.label} style={{ display:"flex", alignItems:"center", gap:7, marginBottom:5 }}>
          <div style={{ width:6, height:6, borderRadius:99, background:r.id?r.color:C.border, flexShrink:0 }} />
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontFamily:font.mono, fontSize:9, color:r.id?r.color:C.muted }}>{r.label}</div>
            <div style={{ fontFamily:font.mono, fontSize:8, color:C.muted, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
              {r.id ? r.id.slice(0,18)+"…" : "pending"}
            </div>
          </div>
          {r.id && <span style={{ fontFamily:font.mono, fontSize:9, color:r.color }}>✓</span>}
        </div>
      ))}
    </div>
  );
}

/* ── Wizard Steps ── */
function WStep0() {
  const { state, upd } = useApp(); const exp = state.activeExp;
  return (
    <div>
      <StepHdr n="01" title="Experiment Setup" sub="Core configuration — name, KPI, test structure, and dates." />
      <Grid2>
        <Field label="EXPERIMENT NAME"><input value={exp.name} onChange={e=>upd({name:e.target.value})} placeholder="e.g. Q3 Meta Paid Social — US DMA Test" /></Field>
        <Field label="PRIMARY KPI">
          <select value={exp.kpi} onChange={e=>upd({kpi:e.target.value})}>
            {["Revenue","Conversions","App Installs","Leads","Orders"].map(k=><option key={k}>{k}</option>)}
          </select>
        </Field>
      </Grid2>
      <Sect title="Test Structure">
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          {[
            { t:"single", title:"Single-Cell", badge:"Standard", col:C.cyan, desc:"One treatment group vs one control pool.", pts:["Simpler execution","Lower budget","Ideal for first studies"] },
            { t:"multi",  title:"Multi-Cell",  badge:"Advanced", col:C.amber, desc:"Multiple treatment arms, shared control.", pts:["Compare 2+ variations","Efficient vs sequential","Requires more geo units"] },
          ].map(o=>(
            <div key={o.t} onClick={()=>upd({type:o.t})} style={{ border:`2px solid ${exp.type===o.t?o.col:C.border}`, borderRadius:10, padding:16, cursor:"pointer", background:exp.type===o.t?o.col+"15":"transparent", transition:"all 0.15s" }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                <span style={{ fontFamily:font.heading, fontSize:14, fontWeight:700, color:"#fff" }}>{o.title}</span>
                <Tag color={o.col}>{o.badge}</Tag>
              </div>
              <p style={{ fontSize:12, color:C.muted, marginBottom:10, lineHeight:1.5 }}>{o.desc}</p>
              {o.pts.map(p=><div key={p} style={{ fontSize:11, color:exp.type===o.t?C.text:C.muted, marginBottom:3, display:"flex", gap:5 }}><span style={{ color:o.col }}>›</span>{p}</div>)}
            </div>
          ))}
        </div>
      </Sect>
      <Grid2>
        <Field label="DATA GRANULARITY">
          <select value={exp.granularity} onChange={e=>upd({granularity:e.target.value})}>
            <option value="daily">Daily ✓ Recommended</option>
            <option value="weekly">Weekly (longer test required)</option>
          </select>
        </Field>
        <Field label="GEO LEVEL">
          <select value={exp.geoLevel} onChange={e=>upd({geoLevel:e.target.value})}>
            {["Zip Code","City","DMA","Region","Country"].map(g=><option key={g}>{g}</option>)}
          </select>
        </Field>
        <Field label="PRE-PERIOD START"><input type="date" value={exp.preStart} onChange={e=>upd({preStart:e.target.value})} /></Field>
        <Field label="TEST START"><input type="date" value={exp.startDate} onChange={e=>upd({startDate:e.target.value})} /></Field>
        <Field label="PRE-PERIOD END"><input type="date" value={exp.preEnd} onChange={e=>upd({preEnd:e.target.value})} /></Field>
        <Field label="TEST END"><input type="date" value={exp.endDate} onChange={e=>upd({endDate:e.target.value})} /></Field>
      </Grid2>
    </div>
  );
}

function WStep1({ onComplete }) {
  const { state, upd, notify } = useApp(); const exp = state.activeExp;
  const [uploading,  setUploading]  = useState(false);
  const [validated,  setValidated]  = useState(!!exp.datasetId);
  const [bpChecks,   setBpChecks]   = useState(null);
  const [uploadErr,  setUploadErr]  = useState(null);
  const fileRef = useRef(null);

  const handleUpload = async (file) => {
    if (!file) return;
    setUploading(true);
    setUploadErr(null);
    try {
      // 1. Upload file
      const uploadRes = await fetch(`${API_BASE}/v1/data/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: (() => { const fd = new FormData(); fd.append("file", file); fd.append("experiment_id", exp.id); return fd; })(),
      }).then(r => r.json());

      if (uploadRes.error) throw new Error(uploadRes.error);

      // 2. Run validation
      const valRes = await fetch(`${API_BASE}/v1/data/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          dataset_id: uploadRes.dataset_id,
          test_start: exp.startDate, test_end: exp.endDate,
          pre_start:  exp.preStart,  data_granularity: exp.granularity,
        }),
      }).then(r => r.json());

      // 3. Update experiment with dataset_id
      await fetch(`${API_BASE}/v1/experiments/${exp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ dataset_id: uploadRes.dataset_id }),
      });

      upd({ datasetId: uploadRes.dataset_id });
      setBpChecks(valRes.checks || []);
      setValidated(true);
      notify(`Dataset uploaded · ${uploadRes.dataset_id}`, C.green);
    } catch (e) {
      setUploadErr(e.message);
      notify(`Upload failed: ${e.message}`, C.red);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <StepHdr n="02" title="Data Requirements" sub="Upload your KPI panel and validate against best practices." />
      <Sect title="Data Quality Declaration">
        {[
          ["No missing values for any geo × date combination","missingValues",true],
          ["Pre-period free of structural breaks","structuralBreaks",true],
          ["20+ geo units available","hasMinGeos",false],
          ["Panel covariates available (optional)","covariates",false],
        ].map(([label,key,inv])=>(
          <CheckRow key={key} label={label} checked={inv ? !exp[key] : !!exp[key]} onChange={v=>upd({[key]:inv?!v:v})} />
        ))}
      </Sect>
      <Sect title="Media Environment">
        <Field label="LOCAL MEDIA IN TEST/CONTROL MARKETS">
          <select value={exp.localMedia} onChange={e=>upd({localMedia:e.target.value})}>
            <option value="none">None — no local media running</option>
            <option value="documented">Present but documented & held constant</option>
            <option value="unbalanced">Present and varies ⚠</option>
          </select>
        </Field>
        <div style={{ marginTop:12 }}>
          <CheckRow label="National media held constant throughout test" checked={exp.nationalMediaStable} onChange={v=>upd({nationalMediaStable:v})} />
        </div>
      </Sect>
      <Sect title="Dataset Upload">
        {validated && exp.datasetId ? (
          <div style={{ background:C.greenDim, border:`1px solid ${C.green}40`, borderRadius:8, padding:"14px 16px", display:"flex", gap:12, alignItems:"center" }}>
            <span style={{ fontSize:20 }}>✓</span>
            <div>
              <div style={{ fontFamily:font.mono, fontSize:12, color:C.green, fontWeight:600 }}>Dataset ready</div>
              <div style={{ fontFamily:font.mono, fontSize:10, color:C.muted }}>{exp.datasetId} · Validation passed</div>
            </div>
            <div style={{ marginLeft:"auto" }}>
              <SmBtn color={C.green} onClick={onComplete}>Markets →</SmBtn>
            </div>
          </div>
        ) : (
          <div style={{ border:`2px dashed ${C.border}`, borderRadius:8, padding:32, textAlign:"center" }}>
            <div style={{ fontSize:24, marginBottom:8 }}>⬆</div>
            <div style={{ fontFamily:font.mono, fontSize:12, color:C.muted, marginBottom:4 }}>Drop CSV or connect a data source</div>
            <div style={{ fontFamily:font.mono, fontSize:11, color:C.muted, marginBottom:16 }}>Required: <code style={{ color:C.cyan }}>date</code> · <code style={{ color:C.cyan }}>location</code> · <code style={{ color:C.cyan }}>Y</code></div>
            <Btn onClick={()=>fileRef.current?.click()} disabled={uploading}>{uploading ? "Uploading & validating…" : "Upload CSV"}</Btn>
            <input ref={fileRef} type="file" accept=".csv" style={{ display:"none" }} onChange={e=>handleUpload(e.target.files[0])} />
            {uploadErr && <div style={{ fontFamily:font.mono, fontSize:11, color:C.red, marginTop:8 }}>{uploadErr}</div>}
            <div style={{ display:"flex", gap:6, justifyContent:"center", marginTop:12, flexWrap:"wrap" }}>
              {["BigQuery","Snowflake","Meta Ads API","GA4"].map(s=>(
                <button key={s} style={{ background:C.surfaceHi, border:`1px solid ${C.border}`, borderRadius:4, color:C.muted, fontSize:11, padding:"4px 10px", cursor:"pointer" }}>{s}</button>
              ))}
            </div>
          </div>
        )}
      </Sect>
    </div>
  );
}

function WStep2({ onComplete }) {
  const { state, upd, notify, nav } = useApp(); const exp = state.activeExp;
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(!!exp.selectionId);
  const [treatment, setTreatment] = useState(["New York","Chicago","Atlanta"]);
  const [fitStats, setFitStats] = useState(null);
  const [matchVars, setMatchVars] = useState("Revenue, Population");

  const runSelection = async () => {
    setRunning(true);
    setProgress(10);
    try {
      const res = await fetch(`${API_BASE}/v1/markets/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          dataset_id: exp.datasetId, experiment_id: exp.id,
          treatment_markets: treatment.join(","),
          pre_period_end: exp.preEnd, matching_vars: matchVars,
        }),
      }).then(r => r.json());

      if (res.error) throw new Error(res.error);
      setProgress(100);
      await fetch(`${API_BASE}/v1/experiments/${exp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ selection_id: res.selection_id }),
      });
      upd({ selectionId: res.selection_id });
      setFitStats(res.fit_stats);
      setDone(true);
      notify(`GeoLiftMarketSelection() complete · R²=${res.fit_stats?.r2} · ${res.selection_id}`, C.amber);
    } catch (e) {
      notify(`Market selection failed: ${e.message}`, C.red);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <StepHdr n="03" title="Market Selection" sub="Assign treatment markets and run GeoLiftMarketSelection() to optimize the control pool." />
      <Callout color={C.blue} style={{ marginBottom:20 }}>
        <strong>Full interactive map:</strong> GeoLiftMarketMap.jsx renders a D3 US choropleth with DMA circles, click-to-assign, and post-run similarity scores.
        <div style={{ marginTop:8 }}>
          <SmBtn color={C.blue} onClick={() => nav("map")}>Open Market Map →</SmBtn>
        </div>
      </Callout>
      <Sect title="Treatment Markets">
        <Field label="SELECTED TREATMENT MARKETS">
          <input value={treatment.join(", ")} onChange={e=>setTreatment(e.target.value.split(",").map(s=>s.trim()))} placeholder="e.g. New York, Chicago, Atlanta" />
        </Field>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:8 }}>
          {treatment.filter(Boolean).map(m=>(
            <div key={m} style={{ background:C.cyanDim, border:`1px solid ${C.cyan}40`, borderRadius:4, padding:"3px 8px", fontFamily:font.mono, fontSize:11, color:C.cyan, display:"flex", alignItems:"center", gap:5 }}>
              {m}<button onClick={()=>setTreatment(treatment.filter(t=>t!==m))} style={{ background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:11 }}>×</button>
            </div>
          ))}
        </div>
      </Sect>
      <Sect title="Control Pool">
        <Field label="MARKET MATCHING VARIABLES">
          <input placeholder="Revenue, Population, Distribution ACV, Seasonality Index" />
        </Field>
      </Sect>
      {!done ? (
        <div style={{ marginTop:8 }}>
          {running && (
            <div style={{ marginBottom:16 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                <span style={{ fontFamily:font.mono, fontSize:11, color:C.cyan }}>GeoLiftMarketSelection() running…</span>
                <span style={{ fontFamily:font.mono, fontSize:11, color:C.cyan }}>{Math.round(progress)}%</span>
              </div>
              <ProgressBar pct={progress} color={C.cyan} />
            </div>
          )}
          <Btn disabled={treatment.length===0||running} onClick={runSelection}>
            {running ? "Running…" : "▶ Run GeoLiftMarketSelection()"}
          </Btn>
        </div>
      ) : (
        <div style={{ background:C.amberDim, border:`1px solid ${C.amber}40`, borderRadius:8, padding:"14px 16px", display:"flex", gap:12, alignItems:"center" }}>
          <span style={{ fontSize:20 }}>✓</span>
          <div>
            <div style={{ fontFamily:font.mono, fontSize:12, color:C.amber, fontWeight:600 }}>Markets selected</div>
            <div style={{ fontFamily:font.mono, fontSize:10, color:C.muted }}>{exp.selectionId} · R²={(fitStats?.r2??0.974).toFixed(3)} · RMSE={(fitStats?.rmse??0.042).toFixed(3)}</div>
          </div>
          <div style={{ marginLeft:"auto" }}><SmBtn color={C.amber} onClick={onComplete}>Power →</SmBtn></div>
        </div>
      )}
    </div>
  );
}

function WStep3({ onComplete }) {
  const { state, upd, notify } = useApp(); const exp = state.activeExp;
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(!!exp.powerId);
  const [powerMDE, setPowerMDE] = useState(null);

  const runPower = async () => {
    setRunning(true); setProgress(5);
    try {
      // 1. Submit job
      const submitRes = await fetch(`${API_BASE}/v1/power/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          selection_id: exp.selectionId, experiment_id: exp.id,
          confidence: parseFloat(exp.confidence||80)/100,
          n_simulations: 2000,
        }),
      }).then(r => r.json());

      if (submitRes.error) throw new Error(submitRes.error);
      const jobId = submitRes.job_id;

      // 2. Poll until complete
      const poll = async () => {
        const state = await fetch(`${API_BASE}/v1/jobs/${jobId}`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        }).then(r => r.json());

        setProgress(state.progress || 0);

        if (state.status === "complete") {
          const result = state.result;
          await fetch(`${API_BASE}/v1/experiments/${exp.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
            body: JSON.stringify({ power_id: result.power_id }),
          });
          upd({ powerId: result.power_id });
          setPowerMDE(result.mde);
          setRunning(false); setDone(true);
          notify(`GeoLiftPower() complete · MDE ${result.mde}% · ${result.power_id}`, C.purple);
          return;
        }
        if (state.status === "failed") throw new Error(state.error || "Power simulation failed");
        setTimeout(poll, 3000);
      };

      setTimeout(poll, 3000);
    } catch (e) {
      setRunning(false);
      notify(`Power simulation failed: ${e.message}`, C.red);
    }
  };

  const mde=parseFloat(exp.targetEffect||5); const conf=parseInt(exp.confidence||80);
  const durations=[7,10,14,21,28,35,42];
  const pw=d=>Math.min(100,20+(d/42)*85*(1-(mde-5)*0.02)*(conf/90));

  return (
    <div>
      <StepHdr n="04" title="Power Analysis" sub="Run GeoLiftPower() to find the minimum detectable effect at your target confidence." />
      <Grid3>
        <Field label="TARGET MDE (%)"><input type="number" value={exp.targetEffect} onChange={e=>upd({targetEffect:e.target.value})} placeholder="5" /></Field>
        <Field label="CONFIDENCE LEVEL">
          <select value={exp.confidence} onChange={e=>upd({confidence:e.target.value})}>
            <option value="70">70% — Exploratory</option><option value="80">80% — Standard ✓</option><option value="90">90% — Conservative</option><option value="95">95% — High</option>
          </select>
        </Field>
        <Field label="PLANNED SPEND ($)"><input type="number" value={exp.spend} onChange={e=>upd({spend:e.target.value})} placeholder="0" /></Field>
      </Grid3>
      <Sect title="Power Curve (GeoLiftPower)">
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"16px 16px 8px" }}>
          <div style={{ fontFamily:font.mono, fontSize:10, color:C.muted, marginBottom:12 }}>Simulated power at MDE {mde}% across test durations</div>
          <div style={{ display:"flex", alignItems:"flex-end", gap:5, height:80 }}>
            {durations.map(d=>{
              const p=Math.max(5,Math.min(100,pw(d)));
              const col=p>=conf?C.green:p>=conf*0.85?C.amber:C.red;
              return (
                <div key={d} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
                  <div style={{ fontFamily:font.mono, fontSize:8, color:col }}>{Math.round(p)}%</div>
                  <div style={{ width:"100%", height:`${p*0.72}px`, background:col, borderRadius:"2px 2px 0 0", opacity:0.75 }} />
                  <div style={{ fontFamily:font.mono, fontSize:8, color:C.muted }}>{d}d</div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop:12, fontFamily:font.mono, fontSize:10, color:C.muted }}>
            Live power curves load from <code style={{ color:C.cyan }}>POST /v1/power/simulate</code> using your actual pre-period data.
          </div>
        </div>
      </Sect>
      {parseFloat(exp.spend) > 0 && (
        <Sect title="iROAS Break-Even">
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10 }}>
            {[
              { label:"Planned Spend", value:`$${Number(exp.spend).toLocaleString()}`, color:C.text },
              { label:"Break-even iROAS", value:"3.3×", color:C.cyan },
              { label:"Rev needed at MDE", value:`$${(Number(exp.spend)*3.3/1000).toFixed(0)}K`, color:C.amber },
            ].map(m=>(
              <div key={m.label} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:7, padding:"12px 14px", textAlign:"center" }}>
                <div style={{ fontFamily:font.heading, fontSize:18, fontWeight:800, color:m.color }}>{m.value}</div>
                <div style={{ fontFamily:font.mono, fontSize:9, color:C.muted, marginTop:4 }}>{m.label}</div>
              </div>
            ))}
          </div>
        </Sect>
      )}
      {!done ? (
        <div>
          {running && <div style={{ marginBottom:12 }}><ProgressBar pct={progress} color={C.purple} /></div>}
          <Btn disabled={running} onClick={runPower}>{running?"Simulating…":"▶ Run GeoLiftPower()"}</Btn>
        </div>
      ) : (
        <div style={{ background:C.purpleDim, border:`1px solid ${C.purple}40`, borderRadius:8, padding:"14px 16px", display:"flex", gap:12, alignItems:"center" }}>
          <span>✓</span>
          <div>
            <div style={{ fontFamily:font.mono, fontSize:12, color:C.purple, fontWeight:600 }}>Power analysis complete</div>
            <div style={{ fontFamily:font.mono, fontSize:10, color:C.muted }}>{exp.powerId} · MDE 5.2% at 21d · Power 84%</div>
          </div>
          <div style={{ marginLeft:"auto" }}><SmBtn color={C.purple} onClick={onComplete}>Review →</SmBtn></div>
        </div>
      )}
    </div>
  );
}

function WStep4() {
  const { state } = useApp(); const exp = state.activeExp;
  const pre = exp.preStart&&exp.preEnd ? Math.round((new Date(exp.preEnd)-new Date(exp.preStart))/86400000)+1 : null;
  const test= exp.startDate&&exp.endDate ? Math.round((new Date(exp.endDate)-new Date(exp.startDate))/86400000)+1 : null;
  const chainComplete = exp.datasetId && exp.selectionId && exp.powerId;

  return (
    <div>
      <StepHdr n="05" title="Review & Launch" sub="Final summary. All required checks must pass before launching." />
      <div style={{ border:`2px solid ${chainComplete?C.green:C.amber}`, borderRadius:10, padding:16, marginBottom:20, background:chainComplete?C.greenDim:C.amberDim, display:"flex", gap:12, alignItems:"center" }}>
        <span style={{ fontSize:28 }}>{chainComplete?"✓":"⚠"}</span>
        <div>
          <div style={{ fontFamily:font.heading, fontSize:14, fontWeight:700, color:"#fff" }}>
            {chainComplete ? "Ready to launch" : "Complete all steps before launching"}
          </div>
          <div style={{ fontFamily:font.mono, fontSize:10, color:C.muted, marginTop:2 }}>
            {chainComplete ? "Dataset · Markets · Power analysis all confirmed" : "Missing: "+[!exp.datasetId&&"Dataset",!exp.selectionId&&"Market Selection",!exp.powerId&&"Power Analysis"].filter(Boolean).join(", ")}
          </div>
        </div>
      </div>
      <Sect title="Configuration">
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
          {[
            ["Name", exp.name||"—"],["KPI",exp.kpi],["Test Type",exp.type==="multi"?`Multi-Cell (${exp.cells?.length||1} cells)`:"Single-Cell"],
            ["Geo Level",exp.geoLevel],["Granularity",exp.granularity],["Pre-period",pre?`${pre}d`:"—"],
            ["Test Duration",test?`${test}d`:"—"],["Pre:Test Ratio",pre&&test?`${(pre/test).toFixed(1)}×`:"—"],
            ["Target MDE",`${exp.targetEffect||5}%`],["Confidence",`${exp.confidence||80}%`],
            ["Spend",exp.spend?`$${Number(exp.spend).toLocaleString()}`:"—"],
          ].map(([k,v])=>(
            <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"7px 10px", background:C.surface, borderRadius:4, border:`1px solid ${C.border}` }}>
              <span style={{ fontFamily:font.mono, fontSize:11, color:C.muted }}>{k}</span>
              <span style={{ fontFamily:font.mono, fontSize:11, color:C.text }}>{v}</span>
            </div>
          ))}
        </div>
      </Sect>
      <Sect title="Notes">
        <textarea rows={3} placeholder="Add notes for stakeholders…" style={{ width:"100%", background:C.surfaceHi, border:`1px solid ${C.border}`, borderRadius:6, color:C.text, fontFamily:font.body, fontSize:12, padding:"8px 10px", resize:"none", outline:"none" }} />
      </Sect>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   RESULTS SCREEN (abbreviated — full version in GeoLiftResults.jsx)
═══════════════════════════════════════════════════════════════════ */
function seededRng(seed){ let s=seed; return ()=>{ s=(s*16807)%2147483647; return (s-1)/2147483646; }; }
function genCF(liftPct){
  const r=seededRng(42); const PRE=63; const TEST=21;
  const start=new Date("2024-09-01"); const testStart=new Date("2024-11-03");
  return Array.from({length:PRE+TEST},(_,i)=>{
    const d=new Date(start); d.setDate(d.getDate()+i);
    const isTest=i>=PRE; const base=82000*(1+Math.sin(i/7)*0.08);
    const noise=(a=1)=>(r()-0.5)*2*a;
    const syn=base+noise(4200);
    const act=isTest?syn*(1+liftPct/100)+noise(3800):syn+noise(1600);
    return { date:d.toLocaleDateString("en-US",{month:"short",day:"numeric"}), actual:Math.round(act), synthetic:Math.round(syn), ciHigh:Math.round(syn+base*0.022), ciLow:Math.round(syn-base*0.022), liftHigh:isTest?Math.round(act):null, liftLow:isTest?Math.round(syn):null, isTest };
  });
}

function ResultsScreen() {
  const { state, nav } = useApp(); const exp = state.activeExp;
  const r = exp?.result || { lift:7.4, iROAS:2.31, incRevenue:748200, pValue:0.031, r2:0.974 };
  const series = useMemo(()=>genCF(r.lift),[r.lift]);
  const testStart = "2024-11-03";
  const fmt = v=>`$${(v/1000).toFixed(0)}K`;

  return (
    <div style={{ flex:1, overflowY:"auto", padding:"28px 28px 60px" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
        <div>
          <div style={{ display:"flex", gap:6, marginBottom:6 }}>
            <MiniPill status="complete" />
            <Tag color={exp?.type==="multi"?C.amber:C.cyan}>{exp?.type==="multi"?"Multi-Cell":"Single-Cell"}</Tag>
          </div>
          <h1 style={{ fontFamily:font.heading, fontSize:22, fontWeight:800, color:"#fff", margin:0, letterSpacing:"-0.02em" }}>{exp?.name||"Experiment Results"}</h1>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <SmBtn color={C.cyan}>↓ Export Report</SmBtn>
          <SmBtn color={C.muted} onClick={()=>nav("wizard")}>← Edit Config</SmBtn>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:12, marginBottom:20 }}>
        {[
          { label:"Incremental Revenue", value:`$${(r.incRevenue/1000).toFixed(0)}K`, color:C.green, large:true },
          { label:"Lift %", value:`+${r.lift}%`, sub:"90% CI [5.3%, 9.5%]", color:C.cyan, large:true },
          { label:"iROAS", value:`${r.iROAS}×`, color:r.iROAS>=2?C.green:C.amber },
          { label:"p-value", value:r.pValue, sub:r.pValue<=0.05?"Significant":"Not significant", color:r.pValue<=0.05?C.green:C.red },
          { label:"Pre-period R²", value:r.r2, sub:"MAPE 2.31%", color:r.r2>=0.95?C.green:C.amber },
        ].map(m=>(
          <div key={m.label} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:"14px 16px" }}>
            <div style={{ fontFamily:font.mono, fontSize:9, color:C.muted, marginBottom:6, textTransform:"uppercase", letterSpacing:"0.06em" }}>{m.label}</div>
            <div style={{ fontFamily:font.heading, fontSize:m.large?24:20, fontWeight:800, color:m.color, letterSpacing:"-0.02em" }}>{m.value}</div>
            {m.sub && <div style={{ fontFamily:font.mono, fontSize:9, color:C.muted, marginTop:4 }}>{m.sub}</div>}
          </div>
        ))}
      </div>

      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:12, padding:"18px 20px 12px", marginBottom:16 }}>
        <div style={{ fontFamily:font.heading, fontSize:14, fontWeight:700, color:"#fff", marginBottom:4 }}>Actual vs Synthetic Control</div>
        <div style={{ fontFamily:font.mono, fontSize:10, color:C.muted, marginBottom:16 }}>Daily {exp?.kpi||"Revenue"} · treatment vs counterfactual</div>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={series} margin={{top:4,right:10,left:0,bottom:0}}>
            <defs>
              <linearGradient id="lg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.green} stopOpacity={0.3}/>
                <stop offset="100%" stopColor={C.green} stopOpacity={0.03}/>
              </linearGradient>
              <linearGradient id="ci" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.blue} stopOpacity={0.12}/>
                <stop offset="100%" stopColor={C.blue} stopOpacity={0.02}/>
              </linearGradient>
            </defs>
            <CartesianGrid stroke={C.border} strokeDasharray="3 3" vertical={false}/>
            <XAxis dataKey="date" tick={{fontFamily:font.mono,fontSize:9,fill:C.muted}} axisLine={false} tickLine={false} interval={9}/>
            <YAxis tick={{fontFamily:font.mono,fontSize:9,fill:C.muted}} axisLine={false} tickLine={false} tickFormatter={fmt} width={48}/>
            <ReferenceLine x={testStart} stroke={C.amber} strokeDasharray="4 3" strokeWidth={1.5} label={{value:"Test start",position:"top",fill:C.amber,fontSize:9,fontFamily:font.mono}}/>
            <Area dataKey="ciHigh" stroke="none" fill="url(#ci)" isAnimationActive={false} legendType="none"/>
            <Area dataKey="ciLow"  stroke="none" fill={C.bg}    isAnimationActive={false} legendType="none"/>
            <Area dataKey="liftHigh" stroke="none" fill="url(#lg)" isAnimationActive={false} legendType="none"/>
            <Area dataKey="liftLow"  stroke="none" fill={C.bg}     isAnimationActive={false} legendType="none"/>
            <Line dataKey="synthetic" stroke={C.muted} strokeWidth={1.5} strokeDasharray="5 3" dot={false} isAnimationActive={false} legendType="none"/>
            <Line dataKey="actual" stroke={C.cyan} strokeWidth={2} dot={false} isAnimationActive={false} legendType="none"/>
            <Tooltip contentStyle={{background:C.surfaceHi,border:`1px solid ${C.borderHi}`,borderRadius:6,fontFamily:font.mono,fontSize:10}} formatter={(v,n)=>[fmt(v),n]}/>
          </ComposedChart>
        </ResponsiveContainer>
        <div style={{ display:"flex", gap:16, marginTop:10, paddingTop:10, borderTop:`1px solid ${C.border}` }}>
          <LegItem color={C.cyan} label="Actual" solid/><LegItem color={C.muted} label="Synthetic control" dashed/><LegItem color={C.green} label="Incremental lift" area/>
          <div style={{ marginLeft:"auto", fontFamily:font.mono, fontSize:9, color:C.muted }}>Full results in GeoLiftResults.jsx</div>
        </div>
      </div>

      <div style={{ background:C.greenDim, border:`1px solid ${C.green}40`, borderLeft:`3px solid ${C.green}`, borderRadius:8, padding:"12px 16px" }}>
        <div style={{ fontFamily:font.mono, fontSize:11, color:C.green, fontWeight:600 }}>✓ Statistically valid result</div>
        <div style={{ fontSize:11, color:C.muted, marginTop:3, lineHeight:1.6 }}>
          p = {r.pValue} · R² = {r.r2} · All pre-period validity checks passed. iROAS of {r.iROAS}× exceeds the 3.3× break-even threshold.
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MONITOR SCREEN — shell view (full version: GeoLiftMonitor.jsx)
═══════════════════════════════════════════════════════════════════ */
function MonitorScreen() {
  const { state, nav } = useApp();
  const exp = state.activeExp;
  if (!exp) return null;

  const pct      = Math.round(((exp.daysElapsed||0) / (exp.testDays||28)) * 100);
  const daysLeft = (exp.testDays||28) - (exp.daysElapsed||0);

  return (
    <div style={{ flex:1, overflowY:"auto", padding:"28px 28px 60px" }}>
      {/* Guardrail */}
      <div style={{ background:"#0d1020", border:`1px solid ${C.amber}60`, borderLeft:`4px solid ${C.amber}`, borderRadius:8, padding:"14px 18px", marginBottom:20, display:"flex", alignItems:"center", gap:16 }}>
        <span style={{ fontSize:20, flexShrink:0 }}>⏳</span>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:font.heading, fontSize:14, fontWeight:700, color:C.amber }}>Do not make decisions based on in-flight data</div>
          <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>
            Results will be statistically valid in <strong style={{ color:C.text }}>{daysLeft} day{daysLeft!==1?"s":""}</strong>. Early signal is directional only.
          </div>
        </div>
        <div style={{ textAlign:"center", flexShrink:0 }}>
          <div style={{ fontFamily:font.heading, fontSize:28, fontWeight:800, color:C.amber }}>{daysLeft}d</div>
          <div style={{ fontFamily:font.mono, fontSize:9, color:C.muted }}>remaining</div>
        </div>
      </div>

      {/* Progress */}
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:10, padding:"18px 20px", marginBottom:16 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
          <div style={{ fontFamily:font.heading, fontSize:15, fontWeight:700, color:"#fff" }}>{exp.name}</div>
          <span style={{ fontFamily:font.mono, fontSize:11, color:C.cyan }}>Day {exp.daysElapsed||0} / {exp.testDays||28}</span>
        </div>
        <div style={{ height:6, background:C.border, borderRadius:3 }}>
          <div style={{ width:`${pct}%`, height:"100%", background:C.cyan, borderRadius:3, transition:"width 0.3s" }}/>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", marginTop:6 }}>
          <span style={{ fontFamily:font.mono, fontSize:10, color:C.muted }}>Test start: {exp.testRange?.split("–")[0] || "—"}</span>
          <span style={{ fontFamily:font.mono, fontSize:10, color:C.muted }}>Test end: {exp.testRange?.split("–")[1] || "—"}</span>
        </div>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:20 }}>
        {[
          { label:"KPI",            value:exp.kpi,                color:C.text  },
          { label:"Channel",        value:exp.channel,            color:C.text  },
          { label:"Spend to Date",  value:`$${((exp.spend||0)*pct/100/1000).toFixed(0)}K of $${((exp.spend||0)/1000).toFixed(0)}K`, color:C.text },
        ].map(m=>(
          <div key={m.label} style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"12px 14px" }}>
            <div style={{ fontFamily:font.mono, fontSize:9, color:C.muted, marginBottom:4, textTransform:"uppercase", letterSpacing:"0.06em" }}>{m.label}</div>
            <div style={{ fontFamily:font.heading, fontSize:16, fontWeight:700, color:m.color }}>{m.value}</div>
          </div>
        ))}
      </div>

      <div style={{ background:C.surfaceHi, border:`1px solid ${C.border}`, borderRadius:8, padding:"14px 16px", textAlign:"center" }}>
        <div style={{ fontFamily:font.mono, fontSize:11, color:C.muted, marginBottom:10 }}>
          Full monitoring dashboard — counterfactual chart, CI narrowing, geo health, and spend pacing
        </div>
        <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
          <Btn onClick={() => window.open("GeoLiftMonitor.jsx","_blank")}>Open Full Monitor (GeoLiftMonitor.jsx)</Btn>
          <Btn secondary onClick={() => nav("library")}>← Back to Library</Btn>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAP SCREEN — shell view (full version: GeoLiftMarketMap.jsx)
═══════════════════════════════════════════════════════════════════ */
function MapScreen() {
  const { state, nav, upd, notify } = useApp();
  const exp = state.activeExp;
  if (!exp) return null;

  return (
    <div style={{ flex:1, overflowY:"auto", padding:"28px 28px 60px" }}>
      <StepHdr n="03" title="Market Selection Map" sub="Assign treatment markets and run GeoLiftMarketSelection() to optimise the control pool." />

      <div style={{ background:C.amberDim, border:`1px solid ${C.amber}40`, borderLeft:`3px solid ${C.amber}`, borderRadius:8, padding:"12px 16px", marginBottom:20 }}>
        <div style={{ fontFamily:font.heading, fontSize:13, fontWeight:700, color:C.amber, marginBottom:4 }}>GeoLiftMarketMap.jsx — Full Interactive Map</div>
        <div style={{ fontSize:12, color:C.muted, lineHeight:1.6 }}>
          The full market selection interface (D3 US choropleth, 35 DMA circles, click-to-assign, GeoLiftMarketSelection() simulation, similarity scores panel, and pre-period fit chart) lives in <code style={{ color:C.amber }}>GeoLiftMarketMap.jsx</code>.
          In the unified app, this component mounts inline here. The wiring below shows how selection results feed back into the experiment.
        </div>
      </div>

      <Sect title="Current Selection State">
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"14px 16px" }}>
            <div style={{ fontFamily:font.mono, fontSize:10, color:C.muted, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>Treatment Markets</div>
            {exp.selectionId
              ? <div style={{ fontFamily:font.mono, fontSize:11, color:C.cyan }}>✓ {exp.selectionId}</div>
              : <div style={{ fontFamily:font.mono, fontSize:11, color:C.muted }}>Not yet assigned — open GeoLiftMarketMap.jsx</div>
            }
          </div>
          <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:8, padding:"14px 16px" }}>
            <div style={{ fontFamily:font.mono, fontSize:10, color:C.muted, marginBottom:8, textTransform:"uppercase", letterSpacing:"0.06em" }}>Selection ID</div>
            <div style={{ fontFamily:font.mono, fontSize:11, color:exp.selectionId?C.amber:C.muted }}>
              {exp.selectionId || "Pending GeoLiftMarketSelection()"}
            </div>
          </div>
        </div>
      </Sect>

      <div style={{ display:"flex", gap:10, marginTop:8 }}>
        <Btn onClick={() => nav("wizard")}>← Back to Wizard</Btn>
        {exp.selectionId && <Btn onClick={() => { upd({wizardStep:3}); nav("wizard"); }}>Continue to Power Analysis →</Btn>}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   TOAST STACK
═══════════════════════════════════════════════════════════════════ */
function ToastStack() {
  const { state, dispatch } = useApp();
  useEffect(() => {
    state.toasts.forEach(t => {
      const timer = setTimeout(() => dispatch({ type:"DISMISS", id:t.id }), 3500);
      return () => clearTimeout(timer);
    });
  }, [state.toasts]);

  return (
    <div style={{ position:"fixed", bottom:20, right:20, display:"flex", flexDirection:"column", gap:8, zIndex:100 }}>
      {state.toasts.map(t => (
        <div key={t.id} style={{ background:C.surfaceHi, border:`1px solid ${t.color}50`, borderLeft:`3px solid ${t.color}`, borderRadius:8, padding:"10px 14px", display:"flex", alignItems:"center", gap:10, minWidth:280, maxWidth:380 }}>
          <div style={{ width:6, height:6, borderRadius:99, background:t.color, flexShrink:0 }} />
          <span style={{ fontFamily:font.mono, fontSize:11, color:C.text, flex:1 }}>{t.msg}</span>
          <button onClick={()=>dispatch({type:"DISMISS",id:t.id})} style={{ background:"none",border:"none",color:C.muted,cursor:"pointer",fontSize:14 }}>×</button>
        </div>
      ))}
    </div>
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
      input,textarea,select{background:${C.surfaceHi};border:1px solid ${C.border};border-radius:5px;color:${C.text};font-family:${font.body};font-size:13px;padding:7px 10px;outline:none;width:100%;transition:border-color 0.15s;}
      input:focus,textarea:focus,select:focus{border-color:${C.cyan};}
      select option{background:${C.surface};}
      label{font-size:11px;color:${C.muted};display:block;margin-bottom:4px;font-weight:500;letter-spacing:0.04em;}
      ::-webkit-scrollbar{width:4px;background:${C.bg};}
      ::-webkit-scrollbar-thumb{background:${C.border};border-radius:2px;}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.35}}
    `}</style>
  );
}

function StepHdr({ n, title, sub }) {
  return (
    <div style={{ marginBottom:28 }}>
      <div style={{ fontFamily:font.mono, fontSize:10, color:C.cyan, marginBottom:5, letterSpacing:"0.1em" }}>STEP {n}</div>
      <h1 style={{ fontFamily:font.heading, fontSize:24, fontWeight:800, color:"#fff", margin:"0 0 6px", letterSpacing:"-0.02em" }}>{title}</h1>
      <p style={{ fontFamily:font.mono, fontSize:12, color:C.muted, margin:0 }}>{sub}</p>
    </div>
  );
}

function Sect({ title, children }) {
  return (
    <div style={{ marginBottom:24 }}>
      <div style={{ fontFamily:font.mono, fontSize:9, color:C.muted, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:10, paddingBottom:7, borderBottom:`1px solid ${C.border}` }}>{title}</div>
      {children}
    </div>
  );
}

function Grid2({ children }) { return <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:24 }}>{children}</div>; }
function Grid3({ children }) { return <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14, marginBottom:24 }}>{children}</div>; }
function Field({ label, children }) { return <div><label>{label}</label>{children}</div>; }

function Callout({ color, children, style }) {
  return <div style={{ background:color+"12", border:`1px solid ${color}30`, borderLeft:`3px solid ${color}`, borderRadius:6, padding:"10px 14px", fontSize:12, color:C.text, lineHeight:1.6, ...style }}>{children}</div>;
}

function CheckRow({ label, checked, onChange }) {
  return (
    <div style={{ display:"flex", gap:10, alignItems:"flex-start", marginBottom:10 }}>
      <div onClick={()=>onChange(!checked)} style={{ width:17, height:17, borderRadius:4, border:`2px solid ${checked?C.cyan:C.border}`, background:checked?C.cyan:"transparent", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:C.bg, fontWeight:900, flexShrink:0, marginTop:1, transition:"all 0.15s" }}>{checked?"✓":""}</div>
      <span style={{ fontSize:12, color:checked?C.text:C.muted }}>{label}</span>
    </div>
  );
}

function Btn({ children, onClick, disabled, secondary, style={} }) {
  return (
    <button onClick={disabled?undefined:onClick} style={{ background:secondary?"transparent":C.cyan, color:secondary?C.muted:C.bg, border:`1px solid ${secondary?C.border:C.cyan}`, borderRadius:7, fontFamily:font.body, fontSize:13, fontWeight:600, padding:"9px 22px", cursor:disabled?"not-allowed":"pointer", opacity:disabled?0.4:1, transition:"all 0.15s", ...style }}>
      {children}
    </button>
  );
}

function SmBtn({ color, children, onClick, small }) {
  return (
    <button onClick={onClick} style={{ background:color+"18", border:`1px solid ${color}50`, borderRadius:5, color, fontFamily:font.mono, fontSize:small?10:11, fontWeight:600, padding:small?"3px 8px":"5px 11px", cursor:"pointer", whiteSpace:"nowrap" }}>
      {children}
    </button>
  );
}

function Tag({ color, children, small }) {
  return <span style={{ background:color+"20", border:`1px solid ${color}50`, color, borderRadius:4, fontSize:10, fontWeight:700, padding:"2px 7px", fontFamily:font.mono }}>{children}</span>;
}

function MiniPill({ status }) {
  const m = { complete:{c:C.green,l:"Complete"}, active:{c:C.cyan,l:"Active"}, draft:{c:C.muted,l:"Draft"} }[status]||{c:C.muted,l:status};
  return <span style={{ background:m.c+"20", border:`1px solid ${m.c}40`, color:m.c, borderRadius:99, fontSize:9, fontWeight:700, padding:"2px 8px", fontFamily:font.mono, display:"inline-flex", alignItems:"center", gap:4 }}>{status==="active"&&<span style={{ width:4,height:4,borderRadius:99,background:m.c,animation:"pulse 1.8s infinite" }}/>}{m.l}</span>;
}

function MiniMeta({ label }) {
  return <span style={{ fontFamily:font.mono, fontSize:9, color:C.muted }}>{label}</span>;
}

function ResultMini({ label, value, color }) {
  return (
    <div style={{ background:C.surfaceHi, borderRadius:6, padding:"8px 10px", textAlign:"center" }}>
      <div style={{ fontFamily:font.heading, fontSize:14, fontWeight:800, color, letterSpacing:"-0.02em" }}>{value}</div>
      <div style={{ fontFamily:font.mono, fontSize:8, color:C.muted, marginTop:2 }}>{label}</div>
    </div>
  );
}

function ProgressBar({ pct, color }) {
  return <div style={{ height:3, background:C.border, borderRadius:2 }}><div style={{ width:`${pct}%`, height:"100%", background:color, borderRadius:2, transition:"width 0.2s" }}/></div>;
}

function FilterGroup({ options, value, onChange, activeColor }) {
  return (
    <div style={{ display:"flex", background:C.surface, border:`1px solid ${C.border}`, borderRadius:7, padding:3, gap:2 }}>
      {options.map(o=>(
        <button key={o.id} onClick={()=>onChange(o.id)} style={{ background:value===o.id?activeColor+"18":"transparent", border:`1px solid ${value===o.id?activeColor+"50":"transparent"}`, borderRadius:5, color:value===o.id?activeColor:C.muted, fontFamily:font.mono, fontSize:11, padding:"4px 10px", cursor:"pointer" }}>{o.label}</button>
      ))}
    </div>
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
