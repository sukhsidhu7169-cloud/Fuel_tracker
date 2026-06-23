import { useState, useEffect, useRef } from "react";

const SUPABASE_URL = "https://iukoqjsnlksdgmhfmmjt.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1a29xanNubGtzZGdtaGZtbWp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE4OTc1MjEsImV4cCI6MjA5NzQ3MzUyMX0.g0okm_WNVOt0Uv_HGqVJUPPXfGec-y5YB1Q5iLAhI1M";
const DASHBOARD_PASSWORD = "Thunderbay12";

const DRIVERS = ["Sukhpreet Sidhu","Rajwinder","Sukhpreet Brar","Honey Singh","Dilpreet Singh","Ritik Yadav"];
const VANS    = ["Mid Roof","Green Transit","Ford Extended","Odyssey (MAG)","Silver Odyssey","Red Chrysler"];

const C = {
  bg:"#0f1117", card:"#1a1d27", border:"#2a2d3a",
  amber:"#f59e0b", text:"#f1f5f9", muted:"#64748b",
  input:"#252836", rowA:"#1e2130", danger:"#ef4444",
  green:"#10b981",
};

const BASE_HEADERS = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
};

async function dbLoad() {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/fuel_entries?select=*&order=created_at.desc&created_at=gte.${since.toISOString()}`,
    { method: "GET", headers: BASE_HEADERS }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  return JSON.parse(text);
}

async function dbInsert(entry) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/fuel_entries`, {
    method: "POST",
    headers: { ...BASE_HEADERS, "Prefer": "return=representation" },
    body: JSON.stringify(entry),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  return JSON.parse(text);
}

async function dbDelete(id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/fuel_entries?id=eq.${id}`, {
    method: "DELETE", headers: BASE_HEADERS,
  });
  if (!res.ok) throw new Error(await res.text());
}

// AI receipt scanning via Anthropic
async function scanReceipt(base64Image) {
  const mediaType = base64Image.split(";")[0].split(":")[1] || "image/jpeg";
  const base64Data = base64Image.split(",")[1];
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64Data }
          },
          {
            type: "text",
            text: `Look at this fuel receipt and extract the total amount paid in dollars and the number of litres/liters purchased. 
Respond ONLY with a JSON object like this, no other text:
{"cost": 77.50, "liters": 45.2}
If you cannot find one of the values, use null for that field.`
          }
        ]
      }]
    })
  });
  const data = await res.json();
  const text = data.content?.find(b => b.type === "text")?.text || "";
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

const emptyForm = {
  date: new Date().toISOString().slice(0,10),
  driver:"", van:"", liters:"", cost:"",
  receipt:null, receipt_name:"",
};

function fmt$(n){ return `$${parseFloat(n||0).toFixed(2)}`; }
function fmtDate(iso){
  if(!iso) return "";
  const d = new Date(iso+"T00:00:00");
  return d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
}

const inp = {
  width:"100%", padding:"12px 14px", background:C.input,
  border:`1.5px solid ${C.border}`, borderRadius:10,
  color:C.text, fontSize:15, outline:"none",
  boxSizing:"border-box", appearance:"none",
};
const lbl = {
  fontSize:12, fontWeight:600, color:C.muted,
  textTransform:"uppercase", letterSpacing:"0.06em",
  marginBottom:6, display:"block",
};

export default function FuelTracker() {
  const [tab, setTab]           = useState("log");
  const [form, setForm]         = useState(emptyForm);
  const [entries, setEntries]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [scanning, setScanning] = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState(null);
  const [dbError, setDbError]   = useState(null);
  const [viewEntry, setView]    = useState(null);
  const [fDriver, setFD]        = useState("All");
  const [fVan, setFV]           = useState("All");
  // Password state
  const [dashUnlocked, setDashUnlocked] = useState(false);
  const [pwInput, setPwInput]           = useState("");
  const [pwError, setPwError]           = useState(false);
  const fileRef = useRef();

  async function loadEntries() {
    try {
      setLoading(true); setDbError(null);
      const data = await dbLoad();
      setEntries(Array.isArray(data) ? data : []);
    } catch(e) { setDbError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { loadEntries(); }, []);

  function handleFile(e) {
    const file = e.target.files[0]; if(!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const base64 = ev.target.result;
      setForm(f => ({...f, receipt: base64, receipt_name: file.name}));
      // Auto-scan receipt
      try {
        setScanning(true);
        const result = await scanReceipt(base64);
        setForm(f => ({
          ...f,
          receipt: base64,
          receipt_name: file.name,
          cost:   result.cost   != null ? String(result.cost)   : f.cost,
          liters: result.liters != null ? String(result.liters) : f.liters,
        }));
      } catch(err) {
        // scanning failed silently — user can fill manually
      } finally { setScanning(false); }
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit() {
    if(!form.driver||!form.van||!form.liters||!form.cost){
      alert("Please fill in all fields."); return;
    }
    try {
      setSaving(true); setError(null);
      const entry = {
        date: form.date, driver: form.driver, van: form.van,
        liters: parseFloat(form.liters), cost: parseFloat(form.cost),
        receipt: form.receipt || null, receipt_name: form.receipt_name || null,
      };
      const result = await dbInsert(entry);
      const inserted = Array.isArray(result) ? result[0] : result;
      setEntries(prev => [inserted, ...prev]);
      setForm(emptyForm);
      setSaved(true); setTimeout(()=>setSaved(false), 2500);
    } catch(e) { setError("Could not save: " + e.message); }
    finally { setSaving(false); }
  }

  async function handleDelete(id) {
    if(!confirm("Delete this entry?")) return;
    try { await dbDelete(id); setEntries(prev=>prev.filter(e=>e.id!==id)); setView(null); }
    catch(e) { alert("Could not delete: " + e.message); }
  }

  function handlePasswordSubmit() {
    if(pwInput === DASHBOARD_PASSWORD) {
      setDashUnlocked(true); setPwError(false); setPwInput("");
    } else {
      setPwError(true); setPwInput("");
    }
  }

  const filtered = entries.filter(e =>
    (fDriver==="All"||e.driver===fDriver) && (fVan==="All"||e.van===fVan)
  );
  const totalCost   = filtered.reduce((s,e)=>s+parseFloat(e.cost||0),0);
  const totalLiters = filtered.reduce((s,e)=>s+parseFloat(e.liters||0),0);
  const byVan = VANS.map(v=>({
    van:v,
    cost:  filtered.filter(e=>e.van===v).reduce((s,e)=>s+parseFloat(e.cost||0),0),
    count: filtered.filter(e=>e.van===v).length,
  })).filter(v=>v.count>0).sort((a,b)=>b.cost-a.cost);
  const maxVan = byVan.length ? byVan[0].cost : 1;

  return (
    <div style={{background:C.bg,minHeight:"100vh",fontFamily:"'Inter',system-ui,sans-serif",color:C.text}}>
      {/* Header */}
      <div style={{background:C.card,borderBottom:`1px solid ${C.border}`,padding:"14px 18px",position:"sticky",top:0,zIndex:10}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
          <span style={{fontSize:22}}>⛽</span>
          <div>
            <div style={{fontSize:10,fontWeight:700,color:C.amber,textTransform:"uppercase",letterSpacing:"0.1em"}}>17780613 Canada Inc.</div>
            <div style={{fontSize:17,fontWeight:700}}>Fleet Fuel Tracker</div>
            <div style={{fontSize:11,color:C.muted}}>{entries.length} entries · last 30 days</div>
          </div>
          <button onClick={loadEntries} style={{marginLeft:"auto",background:"none",border:`1px solid ${C.border}`,borderRadius:8,color:C.muted,padding:"6px 10px",cursor:"pointer",fontSize:13}}>↻</button>
        </div>
        <div style={{display:"flex",gap:8}}>
          {["log","dashboard"].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{
              flex:1,padding:"9px 0",borderRadius:8,border:"none",cursor:"pointer",fontSize:14,fontWeight:600,
              background:tab===t?C.amber:C.input, color:tab===t?"#000":C.muted,
            }}>
              {t==="log"?"📋 Log Fuel":"📊 Dashboard"}
            </button>
          ))}
        </div>
      </div>

      <div style={{padding:"18px 16px",maxWidth:480,margin:"0 auto"}}>
        {dbError && (
          <div style={{background:"#1c1000",border:`1px solid ${C.amber}`,borderRadius:10,padding:"12px 16px",color:C.amber,marginBottom:16,fontSize:13}}>
            ⚠️ {dbError}
            <button onClick={loadEntries} style={{display:"block",marginTop:8,background:C.amber,color:"#000",border:"none",borderRadius:6,padding:"6px 12px",cursor:"pointer",fontWeight:600,fontSize:12}}>Retry</button>
          </div>
        )}
        {error && <div style={{background:"#3f1010",border:`1px solid ${C.danger}`,borderRadius:10,padding:"12px 16px",color:C.danger,marginBottom:16,fontSize:13}}>{error}</div>}

        {/* ── LOG TAB ── */}
        {tab==="log" && (
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {saved && <div style={{background:"#064e3b",border:`1px solid ${C.green}`,borderRadius:10,padding:"12px 16px",color:"#6ee7b7",fontWeight:600,textAlign:"center"}}>✓ Fuel stop saved!</div>}

            <div><label style={lbl}>Date</label>
              <input type="date" style={inp} value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}/>
            </div>
            <div><label style={lbl}>Driver</label>
              <select style={inp} value={form.driver} onChange={e=>setForm(f=>({...f,driver:e.target.value}))}>
                <option value="">Select driver…</option>
                {DRIVERS.map(d=><option key={d}>{d}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Van</label>
              <select style={inp} value={form.van} onChange={e=>setForm(f=>({...f,van:e.target.value}))}>
                <option value="">Select van…</option>
                {VANS.map(v=><option key={v}>{v}</option>)}
              </select>
            </div>

            {/* Receipt first — AI fills fields */}
            <div>
              <label style={lbl}>Receipt Photo 📷 <span style={{color:C.amber,fontSize:11,textTransform:"none",letterSpacing:0}}>— AI will auto-fill cost & liters</span></label>
              <input type="file" accept="image/*" capture="environment" ref={fileRef} style={{display:"none"}} onChange={handleFile}/>
              <button onClick={()=>fileRef.current.click()} style={{width:"100%",padding:"14px",borderRadius:10,border:`1.5px dashed ${form.receipt?C.amber:C.border}`,background:C.input,color:form.receipt?C.amber:C.muted,fontSize:14,cursor:"pointer",fontWeight:500}}>
                {scanning ? "🔍 Scanning receipt with AI…" : form.receipt ? `📎 ${form.receipt_name}` : "📷 Take photo or upload receipt"}
              </button>
              {scanning && (
                <div style={{textAlign:"center",color:C.amber,fontSize:13,marginTop:8,padding:"8px",background:"#1c1000",borderRadius:8,border:`1px solid ${C.amber}`}}>
                  ✨ AI is reading your receipt and filling in the details…
                </div>
              )}
              {form.receipt && !scanning && <img src={form.receipt} alt="receipt" style={{width:"100%",borderRadius:10,marginTop:10,border:`1px solid ${C.border}`}}/>}
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div>
                <label style={lbl}>Liters {form.liters && !scanning ? <span style={{color:C.green}}>✓ auto-filled</span> : null}</label>
                <input type="number" inputMode="decimal" placeholder="0.00" style={{...inp, borderColor: form.liters ? C.green : C.border}} value={form.liters} onChange={e=>setForm(f=>({...f,liters:e.target.value}))}/>
              </div>
              <div>
                <label style={lbl}>Total Cost ($) {form.cost && !scanning ? <span style={{color:C.green}}>✓ auto-filled</span> : null}</label>
                <input type="number" inputMode="decimal" placeholder="0.00" style={{...inp, borderColor: form.cost ? C.green : C.border}} value={form.cost} onChange={e=>setForm(f=>({...f,cost:e.target.value}))}/>
              </div>
            </div>

            <button onClick={handleSubmit} disabled={saving||scanning} style={{width:"100%",padding:"15px",borderRadius:12,border:"none",background:(saving||scanning)?"#92400e":C.amber,color:"#000",fontSize:16,fontWeight:700,cursor:(saving||scanning)?"not-allowed":"pointer",marginTop:4}}>
              {saving?"Saving…":scanning?"Please wait…":"Save Fuel Stop"}
            </button>

            {loading && <div style={{textAlign:"center",color:C.muted,padding:"20px 0"}}>Loading entries…</div>}
            {!loading && entries.length>0 && (
              <div style={{marginTop:4}}>
                <div style={{fontSize:12,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>Recent Entries — All Drivers</div>
                {entries.slice(0,10).map((e,i)=>(
                  <div key={e.id} onClick={()=>setView(e)} style={{background:i%2===0?C.card:C.rowA,border:`1px solid ${C.border}`,borderRadius:12,padding:"13px 15px",marginBottom:8,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontWeight:600,fontSize:14}}>{e.driver}</div>
                      <div style={{fontSize:12,color:C.muted,marginTop:2}}>{e.van} · {fmtDate(e.date)} · {e.liters}L</div>
                    </div>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontWeight:700,color:C.amber,fontSize:15}}>{fmt$(e.cost)}</div>
                      {e.receipt && <div style={{fontSize:10,color:C.muted}}>📎 receipt</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!loading && entries.length===0 && !dbError && (
              <div style={{textAlign:"center",color:C.muted,padding:"30px 0",fontSize:14}}>No entries yet. Log your first fuel stop!</div>
            )}
          </div>
        )}

        {/* ── DASHBOARD TAB ── */}
        {tab==="dashboard" && (
          !dashUnlocked ? (
            /* Password screen */
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"60px 0",gap:20}}>
              <div style={{fontSize:48}}>🔒</div>
              <div style={{fontSize:18,fontWeight:700}}>Dashboard Access</div>
              <div style={{fontSize:14,color:C.muted,textAlign:"center"}}>Enter your password to view all entries and reports</div>
              <input
                type="password"
                placeholder="Enter password…"
                value={pwInput}
                onChange={e=>{ setPwInput(e.target.value); setPwError(false); }}
                onKeyDown={e=>e.key==="Enter"&&handlePasswordSubmit()}
                style={{...inp, textAlign:"center", fontSize:18, letterSpacing:"0.2em", maxWidth:280}}
              />
              {pwError && <div style={{color:C.danger,fontSize:13,fontWeight:600}}>❌ Incorrect password</div>}
              <button onClick={handlePasswordSubmit} style={{width:200,padding:"13px",borderRadius:12,border:"none",background:C.amber,color:"#000",fontSize:15,fontWeight:700,cursor:"pointer"}}>
                Unlock Dashboard
              </button>
            </div>
          ) : (
            /* Dashboard content */
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontSize:13,color:C.green,fontWeight:600}}>🔓 Dashboard unlocked</div>
                <button onClick={()=>setDashUnlocked(false)} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,color:C.muted,padding:"5px 10px",cursor:"pointer",fontSize:12}}>Lock</button>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label style={lbl}>Filter Driver</label>
                  <select style={inp} value={fDriver} onChange={e=>setFD(e.target.value)}>
                    <option>All</option>{DRIVERS.map(d=><option key={d}>{d}</option>)}
                  </select>
                </div>
                <div><label style={lbl}>Filter Van</label>
                  <select style={inp} value={fVan} onChange={e=>setFV(e.target.value)}>
                    <option>All</option>{VANS.map(v=><option key={v}>{v}</option>)}
                  </select>
                </div>
              </div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {[
                  {label:"Total Spent",value:fmt$(totalCost),icon:"💰"},
                  {label:"Total Liters",value:`${totalLiters.toFixed(1)}L`,icon:"🪣"},
                  {label:"Fuel Stops",value:filtered.length,icon:"⛽"},
                  {label:"Avg per Stop",value:filtered.length?fmt$(totalCost/filtered.length):"$0",icon:"📊"},
                ].map(s=>(
                  <div key={s.label} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"14px"}}>
                    <div style={{fontSize:20,marginBottom:4}}>{s.icon}</div>
                    <div style={{fontSize:20,fontWeight:700,color:C.amber}}>{s.value}</div>
                    <div style={{fontSize:11,color:C.muted,marginTop:2}}>{s.label}</div>
                  </div>
                ))}
              </div>

              {byVan.length>0 && (
                <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"16px"}}>
                  <div style={{fontWeight:700,marginBottom:14,fontSize:14}}>Cost by Van</div>
                  {byVan.map(v=>(
                    <div key={v.van} style={{marginBottom:12}}>
                      <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,fontSize:13}}>
                        <span>{v.van}</span>
                        <span style={{color:C.amber,fontWeight:600}}>{fmt$(v.cost)}</span>
                      </div>
                      <div style={{background:C.input,borderRadius:4,height:8,overflow:"hidden"}}>
                        <div style={{width:`${(v.cost/maxVan)*100}%`,height:"100%",background:C.amber,borderRadius:4}}/>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {loading && <div style={{textAlign:"center",color:C.muted,padding:"30px 0"}}>Loading…</div>}
              {!loading && filtered.length>0 && (
                <div>
                  <div style={{fontSize:12,fontWeight:600,color:C.muted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:10}}>All Entries ({filtered.length})</div>
                  {filtered.map((e,i)=>(
                    <div key={e.id} onClick={()=>setView(e)} style={{background:i%2===0?C.card:C.rowA,border:`1px solid ${C.border}`,borderRadius:12,padding:"13px 15px",marginBottom:8,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div>
                        <div style={{fontWeight:600,fontSize:14}}>{e.driver}</div>
                        <div style={{fontSize:12,color:C.muted,marginTop:2}}>{e.van} · {fmtDate(e.date)} · {e.liters}L</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontWeight:700,color:C.amber,fontSize:15}}>{fmt$(e.cost)}</div>
                        {e.receipt && <div style={{fontSize:10,color:C.muted}}>📎 receipt</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!loading && filtered.length===0 && <div style={{textAlign:"center",color:C.muted,padding:"40px 0"}}>No entries yet.</div>}
            </div>
          )
        )}
      </div>

      {/* Detail modal */}
      {viewEntry && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:50,display:"flex",alignItems:"flex-end"}} onClick={()=>setView(null)}>
          <div onClick={e=>e.stopPropagation()} style={{background:C.card,borderRadius:"20px 20px 0 0",border:`1px solid ${C.border}`,padding:"22px 18px",width:"100%",maxWidth:480,margin:"0 auto"}}>
            <div style={{width:40,height:4,background:C.border,borderRadius:2,margin:"0 auto 18px"}}/>
            <div style={{fontSize:17,fontWeight:700,marginBottom:14}}>Fuel Stop Details</div>
            {[
              ["Date",fmtDate(viewEntry.date)],
              ["Driver",viewEntry.driver],
              ["Van",viewEntry.van],
              ["Liters",`${viewEntry.liters}L`],
              ["Total Cost",fmt$(viewEntry.cost)],
              ["$/Liter",fmt$(parseFloat(viewEntry.cost)/parseFloat(viewEntry.liters))],
            ].map(([k,v])=>(
              <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
                <span style={{color:C.muted,fontSize:14}}>{k}</span>
                <span style={{fontWeight:600,fontSize:14}}>{v}</span>
              </div>
            ))}
            {viewEntry.receipt && (
              <div style={{marginTop:14}}>
                <div style={{fontSize:11,color:C.muted,marginBottom:8}}>RECEIPT</div>
                <img src={viewEntry.receipt} alt="receipt" style={{width:"100%",borderRadius:10,border:`1px solid ${C.border}`}}/>
              </div>
            )}
            <button onClick={()=>handleDelete(viewEntry.id)} style={{width:"100%",marginTop:18,padding:13,borderRadius:12,border:"none",background:"#3f1010",color:C.danger,fontWeight:600,fontSize:15,cursor:"pointer"}}>
              🗑 Delete Entry
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
