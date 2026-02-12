/* RPM Workshop — Firestore Front-end (3 files)
   - يقرأ كل الداتا من Cloud Firestore (حسب هيكل مشروعج)
   - مخزن فارغ (stockItems/stockMoves) + استهلاك عند paid/completed (مرة وحدة فقط)
   - موظفين/أقسام + حقول إضافية
   - إضافة زبون + سيارات متعددة بنفس الفورم
   - uiConfig nav + Pages ديناميكية بدون تعديل كود
   - Dashboard Builder (Widgets بلا حدود) محفوظ بـ uiConfig/main
   - طباعة فاتورة من invoiceTemplates (html+css) مع Replace للمتغيرات
*/

const $ = (s, r=document)=> r.querySelector(s);
const $$ = (s, r=document)=> [...r.querySelectorAll(s)];
const esc = (s="") => String(s)
  .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
  .replaceAll('"',"&quot;").replaceAll("'","&#039;");

const fmtIQD = new Intl.NumberFormat("ar-IQ", { style:"currency", currency:"IQD", maximumFractionDigits:0 });
const fmtNum = new Intl.NumberFormat("ar-IQ");
const tsMs = (t)=>{
  if(!t) return 0;
  if(typeof t === "number") return t;
  if(t?.toMillis) return t.toMillis();
  if(t?.seconds) return t.seconds*1000;
  const d = new Date(t); return isNaN(d.getTime()) ? 0 : d.getTime();
};
const fmtDate = (t)=> {
  const ms = tsMs(t) || Date.now();
  return new Date(ms).toLocaleString("ar-IQ", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
};
const ymd = (d)=>{
  const x = new Date(d); const m = String(x.getMonth()+1).padStart(2,"0"); const dd = String(x.getDate()).padStart(2,"0");
  return `${x.getFullYear()}-${m}-${dd}`;
};
const startDay = (s)=> { const d=new Date(s); d.setHours(0,0,0,0); return d.getTime(); };
const endDay = (s)=> { const d=new Date(s); d.setHours(23,59,59,999); return d.getTime(); };

const toast = (msg, type="")=>{
  const root = $("#toastRoot");
  const el = document.createElement("div");
  el.className = `toast ${type}`.trim();
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(()=> el.remove(), 3200);
};

const modal = {
  open({title, bodyHtml, footerHtml, onMount}){
    $("#modalRoot").innerHTML = `
      <div class="modalOverlay" id="modalOverlay">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modalHeader">
            <div class="modalTitle">${esc(title||"")}</div>
            <button class="iconBtn modalClose" id="modalClose" title="إغلاق">✕</button>
          </div>
          <div class="modalBody" id="modalBody">${bodyHtml||""}</div>
          <div class="modalFooter">${footerHtml||""}</div>
        </div>
      </div>
    `;
    $("#modalClose").onclick = modal.close;
    $("#modalOverlay").onclick = (e)=>{ if(e.target.id==="modalOverlay") modal.close(); };
    if(onMount) onMount();
  },
  close(){ $("#modalRoot").innerHTML=""; }
};

const setTitle = (t, s="")=> { $("#pageTitle").textContent=t; $("#pageSubtitle").textContent=s||"—"; };
const pill = (kind, txt)=> { const p=$("#netPill"); p.className=`pill ${kind}`.trim(); p.textContent=txt; };
const statusTag = (s)=>{
  if(s==="paid") return `<span class="tag good">مدفوعة</span>`;
  if(s==="unpaid") return `<span class="tag warn">غير مدفوعة</span>`;
  if(s==="draft") return `<span class="tag">مسودة</span>`;
  if(s==="void"||s==="cancelled") return `<span class="tag bad">ملغاة</span>`;
  if(s==="completed") return `<span class="tag good">مكتمل</span>`;
  if(s==="in_progress") return `<span class="tag warn">قيد العمل</span>`;
  return `<span class="tag">—</span>`;
};

function uid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

// ---------------- Firebase (Firestore) ----------------
const firebaseConfig = {
  apiKey: "AIzaSyC0p4cqNHuqZs9_gNuKLl7nEY0MqRXbf_A",
  authDomain: "rpm574.firebaseapp.com",
  databaseURL: "https://rpm574-default-rtdb.firebaseio.com",
  projectId: "rpm574",
  storageBucket: "rpm574.firebasestorage.app",
  messagingSenderId: "150918603525",
  appId: "1:150918603525:web:fe1d0fbe5c4505936c4d6c"
};

const state = {
  sdkVer: "12.9.0",
  app:null, db:null, auth:null,
  user:null, role:"viewer",
  settings:null,
  uiApp:null, uiMain:null,
  counters:null,
  templates:[],
  // cache lists (on demand)
  cache: {
    customers: [], cars: [], invoices: [], orders: [],
    employees: [], departments: [],
    stockItems: [], // new
  },
  unsub: {},
};

async function init(){
  try{
    pill("", "⏳ ربط Firestore...");
    const v = state.sdkVer;
    const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-app.js`);
    const { getAuth, onAuthStateChanged, signInAnonymously, GoogleAuthProvider, signInWithPopup, signOut } =
      await import(`https://www.gstatic.com/firebasejs/${v}/firebase-auth.js`);
    const {
      getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc,
      collection, query, where, orderBy, limit, onSnapshot, getDocs,
      serverTimestamp, runTransaction, increment
    } = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-firestore.js`);

    state.api = { doc, getDoc, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where, orderBy, limit, onSnapshot, getDocs, serverTimestamp, runTransaction, increment };
    state.app = initializeApp(firebaseConfig);
    state.auth = getAuth(state.app);
    state.db = getFirestore(state.app);

    // auth (خفيف)
    onAuthStateChanged(state.auth, async (u)=>{
      state.user = u || null;
      await resolveRole();
      renderUserPill();
      rebuildNav();
      renderRoute();
    });

    // anonymous by default (حتى createdBy يصير موجود)
    try{ await signInAnonymously(state.auth); }catch{}

    // core docs subscriptions
    subDoc("settingsApp", doc(state.db, "settings", "app"), (d)=>{
      state.settings = d || null;
      // default policy أفضل: finalize_only
      if(state.settings && !state.settings.stockConsumePolicy){
        state.settings.stockConsumePolicy = "finalize_only";
      }
      $("#brandSub").textContent = state.settings ? `Firestore • ${state.settings.workshopName||"RPM Workshop"}` : "Firestore";
      renderRoute();
    });
    subDoc("uiApp", doc(state.db, "uiConfig", "app"), (d)=>{ state.uiApp = d || null; rebuildNav(); renderRoute(); });
    subDoc("uiMain", doc(state.db, "uiConfig", "main"), (d)=>{ state.uiMain = d || null; renderRoute(); });
    subDoc("counters", doc(state.db, "meta", "counters"), (d)=>{ state.counters = d || null; });

    pill("good", "✅ Firestore متصل");
    bindShell();
    if(!location.hash) location.hash = "#/dashboard";
    renderRoute();
  }catch(e){
    console.error(e);
    pill("bad", "⚠️ فشل الاتصال");
    $("#view").innerHTML = `<div class="card pad"><div class="empty">فشل ربط Firebase/Firestore: ${esc(e?.message||String(e))}</div></div>`;
  }
}

function subDoc(key, ref, cb){
  if(state.unsub[key]) state.unsub[key]();
  const { onSnapshot } = state.api;
  state.unsub[key] = onSnapshot(ref, (snap)=> cb(snap.exists() ? snap.data() : null), (err)=> console.error(err));
}

function subCol(key, q, mapTo){
  if(state.unsub[key]) state.unsub[key]();
  const { onSnapshot } = state.api;
  state.unsub[key] = onSnapshot(q, (snap)=>{
    state.cache[mapTo] = snap.docs.map(d=> ({ id:d.id, ...d.data() }));
    renderRoute();
  }, (err)=> console.error(err));
}

async function resolveRole(){
  // role من users/{uid} => {role:"admin"}
  state.role = "viewer";
  const u = state.user;
  if(!u) return;
  try{
    const { doc, getDoc } = state.api;
    const s = await getDoc(doc(state.db, "users", u.uid));
    if(s.exists()){
      state.role = s.data().role || "viewer";
    } else {
      // إذا ماكو doc، خلي viewer
      state.role = "viewer";
    }
  }catch{
    state.role = "viewer";
  }
}

function renderUserPill(){
  const u = state.user;
  if(!u){ $("#userPill").textContent = "—"; return; }
  const who = u.isAnonymous ? "Anonymous" : (u.email || u.uid.slice(0,8));
  $("#userPill").textContent = `${who} • role: ${state.role}`;
}

function bindShell(){
  $("#btnToggleSidebar").onclick = ()=>{
    $("#sidebar").classList.toggle("open");
  };
  $("#btnSync").onclick = ()=> { toast("تم التحديث", "good"); renderRoute(true); };
  $("#btnQuickAdd").onclick = quickAdd;
  $("#btnUser").onclick = userMenu;
  window.addEventListener("hashchange", ()=> renderRoute());
}

function canAdmin(){
  return ["admin","manager"].includes(state.role);
}

// ---------------- Navigation from uiConfig/app.nav ----------------
const BUILTIN = [
  { slug:"dashboard", title:"لوحة التحكم", icon:"🏠" },
  { slug:"customers", title:"الزبائن", icon:"👤" },
  { slug:"cars", title:"السيارات", icon:"🚗" },
  { slug:"orders", title:"أوامر العمل", icon:"🧰" },
  { slug:"invoices", title:"الفواتير", icon:"🧾" },
  { slug:"inventory", title:"المخزن", icon:"📦" },
  { slug:"employees", title:"الموظفين", icon:"🧑‍🔧" },
  { slug:"pages", title:"الصفحات", icon:"🧩" },
  { slug:"reports", title:"التقارير", icon:"📊" },
  { slug:"settings", title:"الإعدادات", icon:"⚙️" },
];

function rebuildNav(){
  const nav = $("#nav");
  const mobile = $("#mobileNav");

  const brand = state.uiApp?.brandName || "RPM";
  $("#brandName").textContent = brand;

  const raw = state.uiApp?.nav?.length ? state.uiApp.nav : BUILTIN.map(x=>({ ...x, roles:["admin","manager","tech","viewer"] }));
  const items = raw.filter(it=>{
    const roles = it.roles || ["admin","manager","tech","viewer"];
    return roles.includes(state.role);
  });

  nav.innerHTML = items.map(it=>{
    const slug = it.slug || "";
    return `<button class="navItem" data-route="#/${esc(slug)}">
      <span class="ico">${esc(it.icon||"•")}</span><span>${esc(it.title||slug)}</span>
    </button>`;
  }).join("");

  $$(".navItem", nav).forEach(b=> b.onclick = ()=> { location.hash = b.dataset.route; });

  // mobile quick nav
  const mobPick = ["dashboard","customers","invoices","inventory","settings"];
  const mobItems = items.filter(x=> mobPick.includes(x.slug)).slice(0,5);
  mobile.innerHTML = mobItems.map(it=> `<button data-route="#/${esc(it.slug)}" title="${esc(it.title)}">${esc(it.icon||"•")}</button>`).join("");
  $$("button", mobile).forEach(b=> b.onclick = ()=> location.hash = b.dataset.route);

  // mark active
  markActive();
}

function markActive(){
  const h = location.hash || "#/dashboard";
  $$(".navItem").forEach(b=> b.classList.toggle("active", b.dataset.route === h));
  $$("#mobileNav button").forEach(b=> b.classList.toggle("active", b.dataset.route === h));
}

// ---------------- Route Manager ----------------
const routes = {
  "#/dashboard": pageDashboard,
  "#/customers": pageCustomers,
  "#/cars": pageCars,
  "#/orders": pageOrders,
  "#/invoices": pageInvoices,
  "#/inventory": pageInventory,
  "#/employees": pageEmployees,
  "#/pages": pagePages,
  "#/reports": pageReports,
  "#/settings": pageSettings,
};

function ensureSubsFor(slug){
  const { collection, query, orderBy, limit } = state.api;

  // subscribe only what needed per page
  const db = state.db;

  if(slug==="dashboard" || slug==="reports"){
    subCol("invoices", query(collection(db,"invoices"), orderBy("createdAt","desc"), limit(200)), "invoices");
    subCol("orders", query(collection(db,"orders"), orderBy("createdAt","desc"), limit(200)), "orders");
    subCol("stockItems", query(collection(db,"stockItems"), orderBy("createdAt","desc"), limit(500)), "stockItems");
  }
  if(slug==="customers"){
    subCol("customers", query(collection(db,"customers"), orderBy("createdAt","desc"), limit(500)), "customers");
  }
  if(slug==="cars"){
    subCol("cars", query(collection(db,"cars"), orderBy("createdAt","desc"), limit(800)), "cars");
    subCol("customers", query(collection(db,"customers"), orderBy("createdAt","desc"), limit(500)), "customers");
  }
  if(slug==="orders"){
    subCol("orders", query(collection(db,"orders"), orderBy("createdAt","desc"), limit(500)), "orders");
    subCol("cars", query(collection(db,"cars"), orderBy("createdAt","desc"), limit(800)), "cars");
    subCol("customers", query(collection(db,"customers"), orderBy("createdAt","desc"), limit(500)), "customers");
    subCol("stockItems", query(collection(db,"stockItems"), orderBy("createdAt","desc"), limit(500)), "stockItems");
  }
  if(slug==="invoices"){
    subCol("invoices", query(collection(db,"invoices"), orderBy("createdAt","desc"), limit(800)), "invoices");
    subCol("cars", query(collection(db,"cars"), orderBy("createdAt","desc"), limit(800)), "cars");
    subCol("customers", query(collection(db,"customers"), orderBy("createdAt","desc"), limit(500)), "customers");
    subCol("templates", query(collection(db,"invoiceTemplates"), orderBy("createdAt","desc"), limit(50)), "templates");
    subCol("stockItems", query(collection(db,"stockItems"), orderBy("createdAt","desc"), limit(500)), "stockItems");
  }
  if(slug==="inventory"){
    subCol("stockItems", query(collection(db,"stockItems"), orderBy("createdAt","desc"), limit(2000)), "stockItems");
  }
  if(slug==="employees"){
    subCol("employees", query(collection(db,"employees"), orderBy("createdAt","desc"), limit(500)), "employees");
    subCol("departments", query(collection(db,"departments"), orderBy("createdAt","desc"), limit(500)), "departments");
  }
  if(slug==="pages"){
    // dynamic pages config stored in uiPages collection
    subCol("uiPages", query(collection(db,"uiPages"), orderBy("createdAt","desc"), limit(200)), "uiPages");
  }
}

function renderRoute(force=false){
  const h = location.hash || "#/dashboard";
  markActive();
  const fn = routes[h] || routes["#/dashboard"];
  const slug = h.replace("#/","");
  ensureSubsFor(slug);
  fn(force);
}

// ---------------- Counters (meta/counters) ----------------
async function nextCounter(field){
  const { doc, runTransaction, serverTimestamp } = state.api;
  const ref = doc(state.db,"meta","counters");
  const v = await runTransaction(state.db, async (tx)=>{
    const snap = await tx.get(ref);
    const cur = snap.exists() ? (snap.data()[field] || 0) : 0;
    const next = cur + 1;
    if(!snap.exists()){
      tx.set(ref, { [field]: next, updatedAt: serverTimestamp() }, { merge:true });
    } else {
      tx.update(ref, { [field]: next, updatedAt: serverTimestamp() });
    }
    return next;
  });
  return v;
}

function padNum(n, width=6){
  const s = String(n||0);
  return s.length>=width ? s : ("0".repeat(width-s.length) + s);
}

// ---------------- Templates render (invoiceTemplates) ----------------
function renderTemplate(html, vars){
  return String(html||"").replace(/\{\{(\w+)\}\}/g, (_,k)=> esc(vars?.[k] ?? ""));
}

// fallback nice invoice if template missing
function builtInInvoice(inv, settings){
  const shop = settings?.workshopName || "RPM Workshop";
  const phone = settings?.phone || "";
  const addr = settings?.address || "";
  const sub = inv.subTotal||0, tax=inv.tax||0, total=inv.total||0;
  return {
    css: `
      body{font-family:Tahoma,Arial;direction:rtl;padding:18px;background:#f6f7fb}
      .paper{max-width:900px;margin:auto;background:#fff;border:1px solid #e7e8ef;border-radius:16px;overflow:hidden}
      .hdr{background:linear-gradient(135deg,#0b1220,#1b2b55);color:#fff;padding:16px;display:flex;justify-content:space-between;gap:12px}
      .t{font-size:18px;font-weight:800;margin:0}
      .m{font-size:12px;opacity:.9;margin-top:4px}
      table{width:100%;border-collapse:collapse}
      th,td{padding:10px;border-bottom:1px solid #eee;text-align:right}
      th{background:#f4f6fb;color:#4a5a7a}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:14px}
      .box{border:1px solid #e7e8ef;border-radius:14px;padding:12px;background:#fbfbfe}
      .sum{display:flex;justify-content:flex-end;padding:14px}
      .sum .card{border:1px solid #e7e8ef;border-radius:14px;padding:12px;background:#fbfbfe;min-width:280px}
      .row{display:flex;justify-content:space-between;margin:6px 0}
      @page{margin:12mm}
    `,
    html: `
      <div class="paper">
        <div class="hdr">
          <div>
            <div class="t">${shop}</div>
            <div class="m">${addr} • ${phone}</div>
          </div>
          <div style="text-align:left">
            <div class="m">فاتورة</div>
            <div style="font-weight:800">${esc(inv.invoiceCode||inv.invoiceNo||"—")}</div>
            <div class="m">${esc(fmtDate(inv.createdAt))}</div>
          </div>
        </div>
        <div class="grid">
          <div class="box">
            <div class="m">الزبون</div>
            <div><b>${esc(inv.customerName||"—")}</b></div>
            <div class="m">${esc(inv.customerPhone||"")}</div>
          </div>
          <div class="box">
            <div class="m">السيارة</div>
            <div><b>${esc(inv.carPlate||"—")}</b></div>
            <div class="m">${esc(inv.carModel||"")}</div>
          </div>
        </div>
        <div style="padding:0 14px 14px">
          <table>
            <thead><tr><th>البند</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
            <tbody>
              ${(inv.items||[]).map(it=>{
                const q=Number(it.qty||1); const p=Number(it.price||0); const line=q*p;
                return `<tr><td>${esc(it.desc||"")}</td><td>${esc(q)}</td><td>${esc(fmtIQD.format(p))}</td><td><b>${esc(fmtIQD.format(line))}</b></td></tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
        <div class="sum">
          <div class="card">
            <div class="row"><span>الإجمالي</span><span>${esc(fmtIQD.format(sub))}</span></div>
            <div class="row"><span>الضريبة</span><span>${esc(fmtIQD.format(tax))}</span></div>
            <div class="row" style="border-top:1px dashed #ddd;padding-top:8px"><b>المجموع</b><b>${esc(fmtIQD.format(total))}</b></div>
          </div>
        </div>
      </div>
    `
  };
}

async function printInvoice(inv){
  const { doc, getDoc } = state.api;
  const settings = state.settings || {};
  const templateId = inv.templateId || settings.defaultInvoiceTemplateId || "default_ar";

  let tpl = null;
  try{
    const snap = await getDoc(doc(state.db,"invoiceTemplates", templateId));
    if(snap.exists()) tpl = snap.data();
  }catch{}

  let css = tpl?.css || "";
  let html = tpl?.html || "";

  // vars compatible with template style you already have
  const vars = {
    workshopName: settings.workshopName || "RPM Workshop",
    phone: settings.phone || "",
    address: settings.address || "",
    invoiceNo: inv.invoiceCode || inv.invoiceNo || "",
    date: fmtDate(inv.createdAt),
    customerName: inv.customerName || "",
    customerPhone: inv.customerPhone || "",
    plate: inv.carPlate || "",
    carModel: inv.carModel || "",
  };

  if(!html || !css){
    const b = builtInInvoice(inv, settings);
    css = b.css;
    html = b.html;
  } else {
    // دعم جدول items ضمن القالب
    const itemsHtml = (inv.items||[]).map(it=>{
      const q=Number(it.qty||1); const p=Number(it.price||0);
      return `<tr><td>${esc(it.desc||"")}</td><td>${esc(q)}</td><td>${esc(fmtIQD.format(p))}</td><td><b>${esc(fmtIQD.format(q*p))}</b></td></tr>`;
    }).join("");
    vars.itemsRows = itemsHtml;
    vars.subTotal = fmtIQD.format(inv.subTotal||0);
    vars.tax = fmtIQD.format(inv.tax||0);
    vars.total = fmtIQD.format(inv.total||0);
    vars.discount = fmtIQD.format(inv.discount||0);
    html = renderTemplate(html, vars).replace("{{itemsRows}}", itemsHtml);
  }

  const w = window.open("", "_blank");
  if(!w){ toast("فعّلي فتح النوافذ للطباعة", "warn"); return; }
  w.document.open();
  w.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><title>Invoice</title><style>${css}</style></head><body>${html}<script>setTimeout(()=>window.print(),250)</script></body></html>`);
  w.document.close();
}

// ---------------- Stock Consume (transaction) ----------------
async function consumeStockFromInvoice(invoiceId){
  // يصرف مرة وحدة فقط: إذا stockConsumed true => skip
  const { doc, runTransaction, serverTimestamp } = state.api;
  const invRef = doc(state.db,"invoices", invoiceId);

  await runTransaction(state.db, async (tx)=>{
    const invSnap = await tx.get(invRef);
    if(!invSnap.exists()) throw new Error("الفاتورة غير موجودة");
    const inv = invSnap.data();
    if(inv.stockConsumed) return;

    const items = Array.isArray(inv.items) ? inv.items : [];
    const consumes = items
      .filter(it=> it.stockItemId && Number(it.qty||1)>0)
      .map(it=> ({ itemId: it.stockItemId, qty: Number(it.qty||1), name: it.desc||"" }));

    if(consumes.length===0){
      tx.update(invRef, { stockConsumed:true, stockConsumedAt: serverTimestamp() });
      return;
    }

    // read all stock docs
    for(const c of consumes){
      const itemRef = doc(state.db,"stockItems", c.itemId);
      const itemSnap = await tx.get(itemRef);
      if(!itemSnap.exists()) throw new Error("مادة مخزن مفقودة");
      const cur = Number(itemSnap.data().qty||0);
      const next = cur - c.qty;
      if(next < 0) throw new Error(`المخزون غير كافي لـ (${itemSnap.data().name||"مادة"})`);
      tx.update(itemRef, { qty: next, updatedAt: serverTimestamp() });

      // حركة مخزن
      const moveId = uid();
      const moveRef = doc(state.db,"stockMoves", moveId);
      tx.set(moveRef, {
        type:"out",
        itemId: c.itemId,
        qty: c.qty,
        refType:"invoice",
        refId: invoiceId,
        note: c.name || "",
        createdAt: serverTimestamp(),
        createdBy: state.user?.uid || "",
        createdByEmail: state.user?.email || ""
      });
    }

    tx.update(invRef, { stockConsumed:true, stockConsumedAt: serverTimestamp() });
  });
}

async function consumeStockFromOrder(orderId){
  const { doc, runTransaction, serverTimestamp } = state.api;
  const woRef = doc(state.db,"orders", orderId);

  await runTransaction(state.db, async (tx)=>{
    const woSnap = await tx.get(woRef);
    if(!woSnap.exists()) throw new Error("الأمر غير موجود");
    const wo = woSnap.data();
    if(wo.stockConsumed) return;

    const parts = Array.isArray(wo.parts) ? wo.parts : [];
    const consumes = parts
      .filter(p=> p.stockItemId && Number(p.qty||1)>0)
      .map(p=> ({ itemId: p.stockItemId, qty: Number(p.qty||1), name: p.name||"" }));

    if(consumes.length===0){
      tx.update(woRef, { stockConsumed:true, stockConsumedAt: serverTimestamp() });
      return;
    }

    for(const c of consumes){
      const itemRef = doc(state.db,"stockItems", c.itemId);
      const itemSnap = await tx.get(itemRef);
      if(!itemSnap.exists()) throw new Error("مادة مخزن مفقودة");
      const cur = Number(itemSnap.data().qty||0);
      const next = cur - c.qty;
      if(next < 0) throw new Error(`المخزون غير كافي لـ (${itemSnap.data().name||"مادة"})`);
      tx.update(itemRef, { qty: next, updatedAt: serverTimestamp() });

      const moveId = uid();
      const moveRef = doc(state.db,"stockMoves", moveId);
      tx.set(moveRef, {
        type:"out",
        itemId: c.itemId,
        qty: c.qty,
        refType:"order",
        refId: orderId,
        note: c.name || "",
        createdAt: serverTimestamp(),
        createdBy: state.user?.uid || "",
        createdByEmail: state.user?.email || ""
      });
    }

    tx.update(woRef, { stockConsumed:true, stockConsumedAt: serverTimestamp() });
  });
}

function stockPolicy(){
  // اخترت الأفضل: finalize_only
  const p = state.settings?.stockConsumePolicy || "finalize_only";
  // normalize بعض القيم الموجودة عندج
  if(p==="invoice_create") return "invoice_create";
  if(p==="manual") return "manual";
  return "finalize_only";
}

// ---------------- Quick Add / User Menu ----------------
function quickAdd(){
  modal.open({
    title:"إضافة",
    bodyHtml: `
      <div class="grid" style="grid-template-columns:1fr; gap:10px">
        <button class="btn" id="qCustomer">+ زبون + سيارة</button>
        <button class="btn" id="qInvoice">+ فاتورة</button>
        <button class="btn" id="qOrder">+ أمر عمل</button>
        <button class="btn" id="qStock">+ مادة مخزن</button>
        <button class="btn" id="qEmployee">+ موظف</button>
      </div>
    `,
    footerHtml:`<button class="iconBtn" id="mClose">إغلاق</button>`,
    onMount(){
      $("#mClose").onclick = modal.close;
      $("#qCustomer").onclick = ()=>{ modal.close(); openCustomerWithCars(); };
      $("#qInvoice").onclick = ()=>{ modal.close(); openInvoiceEditor(); };
      $("#qOrder").onclick = ()=>{ modal.close(); openOrderEditor(); };
      $("#qStock").onclick = ()=>{ modal.close(); openStockEditor(); };
      $("#qEmployee").onclick = ()=>{ modal.close(); openEmployeeEditor(); };
    }
  });
}

function userMenu(){
  modal.open({
    title:"الحساب",
    bodyHtml: `
      <div class="card pad" style="background: rgba(255,255,255,.02)">
        <div class="row" style="justify-content:space-between"><div class="muted">role</div><div><b>${esc(state.role)}</b></div></div>
        <div class="row" style="justify-content:space-between; margin-top:8px"><div class="muted">user</div><div><b>${esc(state.user?.isAnonymous ? "Anonymous" : (state.user?.email||"—"))}</b></div></div>
        <div class="muted small" style="margin-top:10px">Google Login اختياري. إذا ما تحتاجين، خليه Anonymous.</div>
      </div>
    `,
    footerHtml: `
      <button class="iconBtn" id="mClose">إغلاق</button>
      <button class="btn" id="mGoogle">Google</button>
      <button class="btn" id="mAnon">Anonymous</button>
      <button class="btn" id="mOut">Sign out</button>
    `,
    onMount(){
      $("#mClose").onclick = modal.close;
      $("#mGoogle").onclick = async ()=>{
        try{
          const { GoogleAuthProvider, signInWithPopup } = await import(`https://www.gstatic.com/firebasejs/${state.sdkVer}/firebase-auth.js`);
          const provider = new GoogleAuthProvider();
          await signInWithPopup(state.auth, provider);
          toast("تم تسجيل الدخول", "good");
          modal.close();
        }catch(e){
          toast("فشل Google Login (ربما Authorized domains)", "warn");
        }
      };
      $("#mAnon").onclick = async ()=>{
        try{
          const { signInAnonymously } = await import(`https://www.gstatic.com/firebasejs/${state.sdkVer}/firebase-auth.js`);
          await signInAnonymously(state.auth);
          toast("تم الدخول كمجهول", "good");
          modal.close();
        }catch{ toast("تعذر الدخول", "bad"); }
      };
      $("#mOut").onclick = async ()=>{
        try{
          const { signOut } = await import(`https://www.gstatic.com/firebasejs/${state.sdkVer}/firebase-auth.js`);
          await signOut(state.auth);
          toast("تم تسجيل الخروج", "warn");
          modal.close();
        }catch{ toast("تعذر تسجيل الخروج", "bad"); }
      };
    }
  });
}

// ---------------- Pages ----------------
function pageDashboard(){
  setTitle("لوحة التحكم", "داشبورد حر (Widgets) + رسم + نشاط");
  const inv = state.cache.invoices || [];
  const orders = state.cache.orders || [];
  const stock = state.cache.stockItems || [];

  const paid = inv.filter(x=> x.status==="paid");
  const unpaid = inv.filter(x=> x.status==="unpaid" || x.status==="draft" || !x.status);
  const revenue = paid.reduce((a,b)=> a + Number(b.total||0), 0);
  const due = unpaid.reduce((a,b)=> a + Number(b.total||0), 0);

  const low = stock.filter(i=> Number(i.qty||0) <= Number(i.minQty||0));
  const recentInv = inv.slice(0,7);
  const recentOrders = orders.slice(0,7);

  // widgets config from uiConfig/main.dashboardWidgets
  const widgets = Array.isArray(state.uiMain?.dashboardWidgets) && state.uiMain.dashboardWidgets.length
    ? state.uiMain.dashboardWidgets
    : [
        { type:"kpis" },
        { type:"chartRevenue14" },
        { type:"tableRecentInvoices" },
        { type:"tableLowStock" },
        { type:"tableRecentOrders" },
      ];

  const renderWidget = (w)=>{
    if(w.type==="kpis"){
      return `
        <div class="grid kpis">
          <div class="card kpi"><div class="h">إيراد (مدفوع)</div><div class="v">${esc(fmtIQD.format(revenue))}</div><div class="s">مدفوعة: ${esc(fmtNum.format(paid.length))}</div></div>
          <div class="card kpi"><div class="h">مستحقات</div><div class="v">${esc(fmtIQD.format(due))}</div><div class="s">غير مدفوعة: ${esc(fmtNum.format(unpaid.length))}</div></div>
          <div class="card kpi"><div class="h">أوامر عمل</div><div class="v">${esc(fmtNum.format(orders.length))}</div><div class="s">آخر 7 بالأسفل</div></div>
          <div class="card kpi"><div class="h">مخزون منخفض</div><div class="v">${esc(fmtNum.format(low.length))}</div><div class="s">تنبيه تلقائي</div></div>
        </div>
      `;
    }
    if(w.type==="chartRevenue14"){
      return `
        <div class="card pad" style="margin-top:12px">
          <div style="font-weight:900">الإيراد آخر 14 يوم (مدفوع)</div>
          <div class="muted small">رسم بسيط وسريع</div>
          <hr class="hr"/>
          <canvas id="revChart" height="160" style="width:100%"></canvas>
        </div>
      `;
    }
    if(w.type==="tableRecentInvoices"){
      return `
        <div class="card pad" style="margin-top:12px">
          <div class="row" style="justify-content:space-between; align-items:center">
            <div><div style="font-weight:900">آخر الفواتير</div><div class="muted small">طباعة من قالب invoiceTemplates</div></div>
            <div class="row">
              <button class="btn" id="goInv">فتح الفواتير</button>
              <button class="btn" id="newInv">+ فاتورة</button>
            </div>
          </div>
          <hr class="hr"/>
          ${recentInv.length ? `
            <table class="table">
              <thead><tr><th>رقم</th><th>الزبون</th><th>المبلغ</th><th>الحالة</th><th>تاريخ</th><th></th></tr></thead>
              <tbody>
              ${recentInv.map(x=>`
                <tr>
                  <td><b>${esc(x.invoiceCode||x.invoiceNo||"—")}</b></td>
                  <td>${esc(x.customerName||"—")}</td>
                  <td>${esc(fmtIQD.format(Number(x.total||0)))}</td>
                  <td>${statusTag(x.status||"draft")}</td>
                  <td>${esc(fmtDate(x.createdAt))}</td>
                  <td class="row end" style="gap:6px">
                    <button class="iconBtn" data-edit-inv="${esc(x.id)}" title="تعديل">✏️</button>
                    <button class="iconBtn" data-print-inv="${esc(x.id)}" title="طباعة">🖨️</button>
                  </td>
                </tr>
              `).join("")}
              </tbody>
            </table>
          ` : `<div class="empty">لا توجد فواتير بعد.</div>`}
        </div>
      `;
    }
    if(w.type==="tableLowStock"){
      return `
        <div class="card pad" style="margin-top:12px">
          <div class="row" style="justify-content:space-between; align-items:center">
            <div><div style="font-weight:900">مخزون منخفض</div><div class="muted small">إذا qty <= minQty</div></div>
            <button class="btn" id="goStock">فتح المخزن</button>
          </div>
          <hr class="hr"/>
          ${low.length ? `
            <table class="table">
              <thead><tr><th>المادة</th><th>الكمية</th><th>الحد</th></tr></thead>
              <tbody>
                ${low.slice(0,8).map(i=>`
                  <tr><td><b>${esc(i.name||"—")}</b></td><td>${esc(i.qty??0)}</td><td>${esc(i.minQty??0)}</td></tr>
                `).join("")}
              </tbody>
            </table>
          ` : `<div class="empty">المخزن طبيعي حالياً.</div>`}
        </div>
      `;
    }
    if(w.type==="tableRecentOrders"){
      return `
        <div class="card pad" style="margin-top:12px">
          <div class="row" style="justify-content:space-between; align-items:center">
            <div><div style="font-weight:900">آخر أوامر العمل</div><div class="muted small">Completed يصرف مخزن</div></div>
            <div class="row">
              <button class="btn" id="goOrders">فتح الأوامر</button>
              <button class="btn" id="newOrder">+ أمر</button>
            </div>
          </div>
          <hr class="hr"/>
          ${recentOrders.length ? `
            <table class="table">
              <thead><tr><th>رقم</th><th>الزبون</th><th>السيارة</th><th>الحالة</th><th>تاريخ</th><th></th></tr></thead>
              <tbody>
              ${recentOrders.map(x=>`
                <tr>
                  <td><b>${esc(x.orderCode||x.orderNo||"—")}</b></td>
                  <td>${esc(x.customerName||"—")}</td>
                  <td>${esc((x.carPlate||"")+" "+(x.carModel||""))}</td>
                  <td>${statusTag(x.status||"open")}</td>
                  <td>${esc(fmtDate(x.createdAt))}</td>
                  <td class="row end" style="gap:6px">
                    <button class="iconBtn" data-edit-wo="${esc(x.id)}">✏️</button>
                  </td>
                </tr>
              `).join("")}
              </tbody>
            </table>
          ` : `<div class="empty">لا توجد أوامر بعد.</div>`}
        </div>
      `;
    }
    return `<div class="card pad" style="margin-top:12px"><div class="empty">Widget غير معروف: ${esc(w.type)}</div></div>`;
  };

  $("#view").innerHTML = `
    ${widgets.map(renderWidget).join("")}
    ${canAdmin() ? `
      <div class="card pad" style="margin-top:12px">
        <div class="row" style="justify-content:space-between; align-items:center">
          <div>
            <div style="font-weight:900">Dashboard Builder</div>
            <div class="muted small">إضافة/حذف Widgets وتخزينها بـ uiConfig/main</div>
          </div>
          <button class="btn" id="editDash">تعديل الداشبورد</button>
        </div>
      </div>
    ` : ``}
  `;

  // bind actions
  $("#goInv") && ($("#goInv").onclick = ()=> location.hash="#/invoices");
  $("#newInv") && ($("#newInv").onclick = ()=> openInvoiceEditor());
  $("#goStock") && ($("#goStock").onclick = ()=> location.hash="#/inventory");
  $("#goOrders") && ($("#goOrders").onclick = ()=> location.hash="#/orders");
  $("#newOrder") && ($("#newOrder").onclick = ()=> openOrderEditor());
  $("#editDash") && ($("#editDash").onclick = ()=> openDashboardBuilder());

  $$("[data-edit-inv]").forEach(b=> b.onclick = ()=>{
    const inv = (state.cache.invoices||[]).find(x=>x.id===b.dataset.editInv);
    if(inv) openInvoiceEditor(inv);
  });
  $$("[data-print-inv]").forEach(b=> b.onclick = ()=>{
    const inv = (state.cache.invoices||[]).find(x=>x.id===b.dataset.printInv);
    if(inv) printInvoice(inv);
  });
  $$("[data-edit-wo]").forEach(b=> b.onclick = ()=>{
    const wo = (state.cache.orders||[]).find(x=>x.id===b.dataset.editWo);
    if(wo) openOrderEditor(wo);
  });

  // draw chart
  const c = $("#revChart");
  if(c){
    const series = revenueSeries14(paid);
    drawLine(c, series.map(x=>x.v));
  }
}

function revenueSeries14(paidInvoices){
  const now = Date.now();
  const start = now - 13*86400000;
  const days = [];
  for(let t=start; t<=now; t+=86400000) days.push(t);
  return days.map(t=>{
    const end = t + 86400000 - 1;
    const v = paidInvoices.filter(x=>{
      const ms = tsMs(x.createdAt);
      return ms>=t && ms<=end;
    }).reduce((a,b)=> a + Number(b.total||0), 0);
    return {t, v};
  });
}

function drawLine(canvas, values){
  const ctx = canvas.getContext("2d");
  const w = canvas.width = canvas.clientWidth * devicePixelRatio;
  const h = canvas.height = 160 * devicePixelRatio;
  ctx.clearRect(0,0,w,h);

  const pad=16*devicePixelRatio;
  const x0=pad, y0=pad, x1=w-pad, y1=h-pad;
  const max = Math.max(1, ...values);
  ctx.globalAlpha=.35; ctx.strokeStyle="#8fb6ff"; ctx.lineWidth=1*devicePixelRatio;
  for(let i=0;i<4;i++){
    const y = y0 + (i/3)*(y1-y0);
    ctx.beginPath(); ctx.moveTo(x0,y); ctx.lineTo(x1,y); ctx.stroke();
  }
  ctx.globalAlpha=1;
  const n=values.length;
  const px=(i)=> x0 + (i/Math.max(1,n-1))*(x1-x0);
  const py=(v)=> y1 - (v/max)*(y1-y0);

  ctx.strokeStyle="#ffffff"; ctx.lineWidth=2*devicePixelRatio;
  ctx.beginPath();
  values.forEach((v,i)=>{ const x=px(i), y=py(v); i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
  ctx.stroke();

  ctx.fillStyle="#6aa7ff";
  values.forEach((v,i)=>{ const x=px(i), y=py(v); ctx.beginPath(); ctx.arc(x,y,3.5*devicePixelRatio,0,Math.PI*2); ctx.fill(); });
}

async function openDashboardBuilder(){
  if(!canAdmin()) return;
  const current = Array.isArray(state.uiMain?.dashboardWidgets) ? state.uiMain.dashboardWidgets : [];
  const list = current.length ? current : [
    { type:"kpis" },
    { type:"chartRevenue14" },
    { type:"tableRecentInvoices" },
    { type:"tableLowStock" },
    { type:"tableRecentOrders" },
  ];

  const renderList = ()=>{
    $("#wList").innerHTML = list.map((w,i)=>`
      <tr>
        <td><b>${esc(w.type)}</b></td>
        <td class="row end" style="gap:6px">
          <button class="iconBtn" data-up="${i}" title="فوق">⬆️</button>
          <button class="iconBtn" data-down="${i}" title="جوه">⬇️</button>
          <button class="iconBtn" data-del="${i}" title="حذف">🗑️</button>
        </td>
      </tr>
    `).join("");
    $$("[data-up]").forEach(b=> b.onclick=()=>{ const i=+b.dataset.up; if(i>0){ const t=list[i-1]; list[i-1]=list[i]; list[i]=t; renderList(); }});
    $$("[data-down]").forEach(b=> b.onclick=()=>{ const i=+b.dataset.down; if(i<list.length-1){ const t=list[i+1]; list[i+1]=list[i]; list[i]=t; renderList(); }});
    $$("[data-del]").forEach(b=> b.onclick=()=>{ const i=+b.dataset.del; list.splice(i,1); renderList(); });
  };

  modal.open({
    title:"Dashboard Builder",
    bodyHtml: `
      <div class="formGrid">
        <div>
          <label>إضافة Widget</label>
          <select id="wType" class="input">
            <option value="kpis">kpis</option>
            <option value="chartRevenue14">chartRevenue14</option>
            <option value="tableRecentInvoices">tableRecentInvoices</option>
            <option value="tableLowStock">tableLowStock</option>
            <option value="tableRecentOrders">tableRecentOrders</option>
          </select>
        </div>
        <div class="row end" style="align-items:flex-end">
          <button class="btn" id="wAdd">+ إضافة</button>
        </div>
      </div>
      <hr class="hr"/>
      <table class="table">
        <thead><tr><th>Widget</th><th></th></tr></thead>
        <tbody id="wList"></tbody>
      </table>
    `,
    footerHtml: `
      <button class="iconBtn" id="mClose">إغلاق</button>
      <button class="btn" id="mSave">حفظ</button>
    `,
    onMount(){
      renderList();
      $("#mClose").onclick = modal.close;
      $("#wAdd").onclick = ()=>{ list.push({ type: $("#wType").value }); renderList(); };
      $("#mSave").onclick = async ()=>{
        const { doc, setDoc, serverTimestamp } = state.api;
        await setDoc(doc(state.db,"uiConfig","main"), { dashboardWidgets:list, updatedAt: serverTimestamp() }, { merge:true });
        toast("تم حفظ الداشبورد", "good");
        modal.close();
      };
    }
  });
}

// ---------------- Customers (with cars inside) ----------------
function pageCustomers(){
  setTitle("الزبائن", "إضافة زبون + سيارات متعددة");
  const params = new URLSearchParams((location.hash.split("?")[1]||""));
  const q = (params.get("q")||"").toLowerCase().trim();

  const list = (state.cache.customers||[]).filter(c=>{
    const s = `${c.name||""} ${c.phone||""}`.toLowerCase();
    return !q || s.includes(q);
  });

  $("#view").innerHTML = `
    <div class="card pad">
      <div class="row" style="justify-content:space-between; align-items:center">
        <div><div style="font-weight:900">إدارة الزبائن</div><div class="muted small">الزبون مرتبط بسياراته وفواتيره</div></div>
        <div class="row">
          <input class="input" id="q" placeholder="بحث..." style="width:min(360px,60vw)" value="${esc(params.get("q")||"")}"/>
          <button class="btn" id="add">+ زبون + سيارة</button>
        </div>
      </div>
      <hr class="hr"/>
      ${list.length ? `
        <table class="table">
          <thead><tr><th>الاسم</th><th>الهاتف</th><th>تاريخ</th><th></th></tr></thead>
          <tbody>
            ${list.map(c=>`
              <tr>
                <td><b>${esc(c.name||"—")}</b></td>
                <td>${esc(c.phone||"—")}</td>
                <td>${esc(fmtDate(c.createdAt))}</td>
                <td class="row end" style="gap:6px">
                  <button class="iconBtn" data-edit="${esc(c.id)}">✏️</button>
                  <button class="iconBtn" data-del="${esc(c.id)}">🗑️</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `<div class="empty">لا يوجد زبائن.</div>`}
    </div>
  `;

  $("#q").oninput = ()=> location.hash = `#/customers?q=${encodeURIComponent($("#q").value.trim())}`;
  $("#add").onclick = ()=> openCustomerWithCars();

  $$("[data-edit]").forEach(b=> b.onclick = ()=>{
    const c = (state.cache.customers||[]).find(x=>x.id===b.dataset.edit);
    if(c) openCustomerWithCars(c);
  });
  $$("[data-del]").forEach(b=> b.onclick = async ()=>{
    if(!canAdmin() && state.role!=="tech"){ toast("الصلاحية غير كافية", "bad"); return; }
    if(!confirm("حذف الزبون؟")) return;
    const { doc, deleteDoc } = state.api;
    await deleteDoc(doc(state.db,"customers", b.dataset.del));
    toast("تم الحذف", "warn");
  });
}

function openCustomerWithCars(customer=null){
  const isEdit = !!customer;
  const cars = (state.cache.cars||[]).filter(v=> v.customerId === customer?.id);

  const carForms = (cars.length ? cars : [{ plate:"", model:"", year:"" }]).map((v,i)=> ({...v, _i:i}));

  const renderCars = ()=>{
    $("#carsWrap").innerHTML = carForms.map((c,i)=>`
      <div class="card pad" style="background: rgba(255,255,255,.02); border-color: rgba(255,255,255,.10); margin-top:10px">
        <div class="row" style="justify-content:space-between; align-items:center">
          <div><b>سيارة ${i+1}</b></div>
          <button class="iconBtn" data-rm="${i}" title="حذف">🗑️</button>
        </div>
        <div class="formGrid" style="margin-top:10px">
          <div>
            <label>اللوحة</label>
            <input class="input" data-f="plate" data-i="${i}" value="${esc(c.plate||"")}" />
          </div>
          <div>
            <label>الموديل</label>
            <input class="input" data-f="model" data-i="${i}" value="${esc(c.model||"")}" />
          </div>
        </div>
        <div class="formGrid" style="margin-top:10px">
          <div>
            <label>السنة</label>
            <input class="input" data-f="year" data-i="${i}" type="number" value="${esc(c.year??"")}" />
          </div>
          <div>
            <label>—</label>
            <div class="muted small">اختياري</div>
          </div>
        </div>
      </div>
    `).join("");

    $$("[data-rm]").forEach(b=> b.onclick = ()=>{
      const i = +b.dataset.rm;
      carForms.splice(i,1);
      renderCars();
    });

    $$("[data-f]").forEach(inp=>{
      inp.oninput = ()=>{
        const i = +inp.dataset.i;
        const f = inp.dataset.f;
        carForms[i][f] = inp.value;
      };
    });
  };

  modal.open({
    title: isEdit ? "تعديل زبون + سياراته" : "إضافة زبون + سياراته",
    bodyHtml: `
      <div class="formGrid">
        <div>
          <label>اسم الزبون</label>
          <input class="input" id="cName" value="${esc(customer?.name||"")}" />
        </div>
        <div>
          <label>الهاتف</label>
          <input class="input" id="cPhone" value="${esc(customer?.phone||"")}" />
        </div>
      </div>
      <hr class="hr"/>
      <div class="row" style="justify-content:space-between; align-items:center">
        <div><div style="font-weight:900">السيارات</div><div class="muted small">تقدرين تضيفين أكثر من سيارة</div></div>
        <button class="btn" id="addCar">+ سيارة</button>
      </div>
      <div id="carsWrap"></div>
    `,
    footerHtml: `
      <button class="iconBtn" id="mClose">إلغاء</button>
      <button class="btn" id="mSave">حفظ</button>
    `,
    onMount(){
      renderCars();
      $("#mClose").onclick = modal.close;
      $("#addCar").onclick = ()=>{ carForms.push({ plate:"", model:"", year:"" }); renderCars(); };
      $("#mSave").onclick = async ()=>{
        const name = $("#cName").value.trim();
        const phone = $("#cPhone").value.trim();
        if(!name){ toast("اسم الزبون مطلوب", "bad"); return; }

        const { doc, setDoc, updateDoc, addDoc, collection, serverTimestamp } = state.api;

        let customerId = customer?.id;
        if(isEdit){
          await updateDoc(doc(state.db,"customers", customerId), { name, phone, updatedAt: serverTimestamp() });
        }else{
          const id = uid();
          customerId = id;
          await setDoc(doc(state.db,"customers", id), { name, phone, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        }

        // upsert cars (بسيط: نضيف سيارات جديدة، والسيارات القديمة تبقى)
        for(const c of carForms){
          const plate = String(c.plate||"").trim();
          if(!plate) continue;
          const model = String(c.model||"").trim();
          const year = c.year!=="" ? Number(c.year||0) : null;

          if(c.id){
            await updateDoc(doc(state.db,"cars", c.id), {
              plate, model, year,
              customerId, customerName:name, customerPhone:phone,
              updatedAt: serverTimestamp()
            });
          }else{
            await addDoc(collection(state.db,"cars"), {
              plate, model, year,
              customerId, customerName:name, customerPhone:phone,
              createdAt: serverTimestamp(), updatedAt: serverTimestamp()
            });
          }
        }

        toast("تم الحفظ", "good");
        modal.close();
      };
    }
  });
}

// ---------------- Cars ----------------
function pageCars(){
  setTitle("السيارات", "مرتبطة بـ customers");
  const cars = state.cache.cars || [];
  $("#view").innerHTML = `
    <div class="card pad">
      <div class="row" style="justify-content:space-between; align-items:center">
        <div><div style="font-weight:900">إدارة السيارات</div><div class="muted small">تعديل بيانات السيارة وربطها بالزبون</div></div>
        <button class="btn" id="addCar">+ سيارة</button>
      </div>
      <hr class="hr"/>
      ${cars.length ? `
      <table class="table">
        <thead><tr><th>اللوحة</th><th>الموديل</th><th>السنة</th><th>الزبون</th><th>الهاتف</th><th></th></tr></thead>
        <tbody>
          ${cars.map(v=>`
            <tr>
              <td><b>${esc(v.plate||"—")}</b></td>
              <td>${esc(v.model||"—")}</td>
              <td>${esc(v.year??"—")}</td>
              <td>${esc(v.customerName||"—")}</td>
              <td>${esc(v.customerPhone||"")}</td>
              <td class="row end" style="gap:6px">
                <button class="iconBtn" data-edit="${esc(v.id)}">✏️</button>
                <button class="iconBtn" data-del="${esc(v.id)}">🗑️</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>` : `<div class="empty">لا توجد سيارات.</div>`}
    </div>
  `;
  $("#addCar").onclick = ()=> openCarEditor();
  $$("[data-edit]").forEach(b=> b.onclick = ()=>{
    const v = cars.find(x=>x.id===b.dataset.edit);
    if(v) openCarEditor(v);
  });
  $$("[data-del]").forEach(b=> b.onclick = async ()=>{
    if(!canAdmin()){ toast("الصلاحية غير كافية", "bad"); return; }
    if(!confirm("حذف السيارة؟")) return;
    const { doc, deleteDoc } = state.api;
    await deleteDoc(doc(state.db,"cars", b.dataset.del));
    toast("تم الحذف", "warn");
  });
}

function openCarEditor(car=null){
  const isEdit = !!car;
  const customers = state.cache.customers || [];
  modal.open({
    title: isEdit ? "تعديل سيارة" : "إضافة سيارة",
    bodyHtml: `
      <div class="formGrid">
        <div><label>اللوحة</label><input class="input" id="vPlate" value="${esc(car?.plate||"")}" /></div>
        <div><label>الموديل</label><input class="input" id="vModel" value="${esc(car?.model||"")}" /></div>
      </div>
      <div class="formGrid" style="margin-top:10px">
        <div><label>السنة</label><input class="input" id="vYear" type="number" value="${esc(car?.year??"")}" /></div>
        <div>
          <label>الزبون</label>
          <select class="input" id="vCustomer">
            <option value="">— اختاري —</option>
            ${customers.map(c=>`<option value="${esc(c.id)}" ${car?.customerId===c.id?"selected":""}>${esc(c.name)} — ${esc(c.phone||"")}</option>`).join("")}
          </select>
        </div>
      </div>
    `,
    footerHtml: `<button class="iconBtn" id="mClose">إلغاء</button><button class="btn" id="mSave">حفظ</button>`,
    onMount(){
      $("#mClose").onclick = modal.close;
      $("#mSave").onclick = async ()=>{
        const plate = $("#vPlate").value.trim();
        if(!plate){ toast("اللوحة مطلوبة", "bad"); return; }
        const model = $("#vModel").value.trim();
        const year = $("#vYear").value ? Number($("#vYear").value) : null;
        const customerId = $("#vCustomer").value;
        const c = customers.find(x=>x.id===customerId);

        const { doc, setDoc, updateDoc, addDoc, collection, serverTimestamp } = state.api;
        const payload = {
          plate, model, year,
          customerId: customerId||"",
          customerName: c?.name || car?.customerName || "",
          customerPhone: c?.phone || car?.customerPhone || "",
          updatedAt: serverTimestamp()
        };

        if(isEdit){
          await updateDoc(doc(state.db,"cars", car.id), payload);
        }else{
          await addDoc(collection(state.db,"cars"), { ...payload, createdAt: serverTimestamp() });
        }
        toast("تم الحفظ", "good");
        modal.close();
      };
    }
  });
}

// ---------------- Orders (work orders) ----------------
function pageOrders(){
  setTitle("أوامر العمل", "Completed يصرف مخزن حسب السياسة");
  const params = new URLSearchParams(location.hash.split("?")[1]||"");
  const st = params.get("st") || "all";
  const q = (params.get("q")||"").toLowerCase().trim();

  const list = (state.cache.orders||[]).filter(o=>{
    const okS = st==="all" ? true : ((o.status||"open")===st);
    const blob = `${o.orderCode||o.orderNo||""} ${o.customerName||""} ${o.customerPhone||""} ${o.carPlate||""} ${o.carModel||""}`.toLowerCase();
    const okQ = !q || blob.includes(q);
    return okS && okQ;
  });

  $("#view").innerHTML = `
    <div class="card pad">
      <div class="row" style="justify-content:space-between; align-items:center">
        <div><div style="font-weight:900">أوامر العمل</div><div class="muted small">Parts تقدر تربطيها بمخزن عبر stockItemId</div></div>
        <div class="row">
          <input class="input" id="q" placeholder="بحث..." style="width:min(320px,60vw)" value="${esc(params.get("q")||"")}"/>
          <select class="input" id="st" style="width:170px">
            <option value="all" ${st==="all"?"selected":""}>كل الحالات</option>
            <option value="open" ${st==="open"?"selected":""}>open</option>
            <option value="in_progress" ${st==="in_progress"?"selected":""}>in_progress</option>
            <option value="completed" ${st==="completed"?"selected":""}>completed</option>
            <option value="cancelled" ${st==="cancelled"?"selected":""}>cancelled</option>
          </select>
          <button class="btn" id="add">+ أمر</button>
        </div>
      </div>
      <hr class="hr"/>
      ${list.length ? `
        <table class="table">
          <thead><tr><th>رقم</th><th>الزبون</th><th>السيارة</th><th>الحالة</th><th>تاريخ</th><th></th></tr></thead>
          <tbody>
            ${list.map(o=>`
              <tr>
                <td><b>${esc(o.orderCode||o.orderNo||"—")}</b></td>
                <td>${esc(o.customerName||"—")}</td>
                <td>${esc((o.carPlate||"")+" "+(o.carModel||""))}</td>
                <td>${statusTag(o.status||"open")}${o.stockConsumed?` <span class="tag good">Stock✓</span>`:""}</td>
                <td>${esc(fmtDate(o.createdAt))}</td>
                <td class="row end" style="gap:6px">
                  <button class="iconBtn" data-edit="${esc(o.id)}">✏️</button>
                  <button class="iconBtn" data-del="${esc(o.id)}">🗑️</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `<div class="empty">لا توجد أوامر.</div>`}
    </div>
  `;

  $("#q").oninput = ()=> location.hash = `#/orders?q=${encodeURIComponent($("#q").value.trim())}&st=${encodeURIComponent($("#st").value)}`;
  $("#st").onchange = ()=> location.hash = `#/orders?q=${encodeURIComponent($("#q").value.trim())}&st=${encodeURIComponent($("#st").value)}`;
  $("#add").onclick = ()=> openOrderEditor();

  $$("[data-edit]").forEach(b=> b.onclick = ()=>{
    const o = (state.cache.orders||[]).find(x=>x.id===b.dataset.edit);
    if(o) openOrderEditor(o);
  });
  $$("[data-del]").forEach(b=> b.onclick = async ()=>{
    if(!canAdmin()){ toast("الصلاحية غير كافية", "bad"); return; }
    if(!confirm("حذف الأمر؟")) return;
    const { doc, deleteDoc } = state.api;
    await deleteDoc(doc(state.db,"orders", b.dataset.del));
    toast("تم الحذف", "warn");
  });
}

function openOrderEditor(order=null){
  const isEdit = !!order;
  const customers = state.cache.customers || [];
  const cars = state.cache.cars || [];
  const stock = state.cache.stockItems || [];

  const parts = Array.isArray(order?.parts) ? order.parts.map(p=>({...p})) : [{ name:"", qty:1, stockItemId:"" }];

  const renderParts = ()=>{
    $("#partsBody").innerHTML = parts.map((p,i)=>`
      <tr>
        <td><input class="input" data-pf="name" data-i="${i}" value="${esc(p.name||"")}" placeholder="قطعة/عمل"/></td>
        <td style="width:120px"><input class="input" data-pf="qty" data-i="${i}" type="number" min="1" step="1" value="${esc(p.qty??1)}"/></td>
        <td style="width:260px">
          <select class="input" data-pf="stockItemId" data-i="${i}">
            <option value="">(بدون مخزن)</option>
            ${stock.map(s=>`<option value="${esc(s.id)}" ${p.stockItemId===s.id?"selected":""}>${esc(s.name)} — ${esc(s.qty??0)} ${esc(s.unit||"")}</option>`).join("")}
          </select>
        </td>
        <td style="width:60px"><button class="iconBtn" data-prm="${i}">🗑️</button></td>
      </tr>
    `).join("");

    $$("[data-pf]").forEach(inp=>{
      inp.oninput = ()=>{
        const i = +inp.dataset.i;
        const f = inp.dataset.pf;
        parts[i][f] = (f==="qty") ? Number(inp.value||1) : inp.value;
      };
      inp.onchange = inp.oninput;
    });
    $$("[data-prm]").forEach(b=> b.onclick = ()=>{ parts.splice(+b.dataset.prm,1); renderParts(); });
  };

  modal.open({
    title: isEdit ? "تعديل أمر عمل" : "أمر عمل جديد",
    bodyHtml: `
      <div class="formGrid">
        <div>
          <label>الزبون</label>
          <select class="input" id="woCustomer">
            <option value="">— اختاري —</option>
            ${customers.map(c=>`<option value="${esc(c.id)}" ${order?.customerId===c.id?"selected":""}>${esc(c.name)} — ${esc(c.phone||"")}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>السيارة</label>
          <select class="input" id="woCar">
            <option value="">— اختاري —</option>
            ${cars.map(v=>`<option value="${esc(v.id)}" ${order?.carId===v.id?"selected":""}>${esc(v.plate)} — ${esc(v.model||"")}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="formGrid" style="margin-top:10px">
        <div>
          <label>الحالة</label>
          <select class="input" id="woStatus">
            <option value="open" ${(order?.status||"open")==="open"?"selected":""}>open</option>
            <option value="in_progress" ${(order?.status||"open")==="in_progress"?"selected":""}>in_progress</option>
            <option value="completed" ${(order?.status||"open")==="completed"?"selected":""}>completed</option>
            <option value="cancelled" ${(order?.status||"open")==="cancelled"?"selected":""}>cancelled</option>
          </select>
        </div>
        <div>
          <label>ملاحظات</label>
          <input class="input" id="woNotes" value="${esc(order?.notes||"")}" />
        </div>
      </div>

      <hr class="hr"/>
      <div class="row" style="justify-content:space-between; align-items:center">
        <div><div style="font-weight:900">Parts / أعمال</div><div class="muted small">إذا تربطينها بمادة مخزن → ينقص عند completed</div></div>
        <button class="btn" id="addPart">+ بند</button>
      </div>
      <div style="margin-top:10px; overflow:auto">
        <table class="table">
          <thead><tr><th>البند</th><th>الكمية</th><th>مخزن</th><th></th></tr></thead>
          <tbody id="partsBody"></tbody>
        </table>
      </div>

      ${order?.stockConsumed ? `<div class="empty" style="margin-top:10px">تم صرف المخزن لهذا الأمر مسبقاً ✅</div>` : ``}
    `,
    footerHtml: `
      <button class="iconBtn" id="mClose">إلغاء</button>
      <button class="btn" id="mSave">حفظ</button>
    `,
    onMount(){
      renderParts();
      $("#mClose").onclick = modal.close;
      $("#addPart").onclick = ()=>{ parts.push({ name:"", qty:1, stockItemId:"" }); renderParts(); };

      $("#mSave").onclick = async ()=>{
        const customerId = $("#woCustomer").value;
        if(!customerId){ toast("اختاري زبون", "bad"); return; }
        const carId = $("#woCar").value;
        const c = customers.find(x=>x.id===customerId);
        const v = cars.find(x=>x.id===carId);

        const status = $("#woStatus").value;
        const notes = $("#woNotes").value.trim();

        const { doc, setDoc, updateDoc, addDoc, collection, serverTimestamp } = state.api;
        const payload = {
          customerId, customerName: c?.name||"", customerPhone: c?.phone||"",
          carId: carId||"", carPlate: v?.plate||order?.carPlate||"", carModel: v?.model||order?.carModel||"", carYear: v?.year ?? order?.carYear ?? null,
          status,
          notes,
          parts: parts.filter(p=> (p.name||"").trim()),
          updatedAt: serverTimestamp()
        };

        let id = order?.id;
        if(isEdit){
          await updateDoc(doc(state.db,"orders", id), payload);
        }else{
          const no = await nextCounter("orderNo");
          const pref = state.settings?.woPrefix || "WO";
          const width = Number(state.settings?.numberWidth || 6);
          const code = `${pref}-${padNum(no, width)}`;
          await addDoc(collection(state.db,"orders"), { ...payload, orderNo:no, orderCode:code, createdAt: serverTimestamp() });
        }

        // سياسة المخزن
        if(stockPolicy()==="finalize_only" && status==="completed"){
          try{
            // إذا تعديل: صرف على نفس doc
            if(isEdit){
              await consumeStockFromOrder(id);
              toast("تم صرف المخزن ✅", "good");
            } else {
              toast("تم حفظ الأمر. (سيتم صرف المخزن عند تحديث القائمة)", "good");
            }
          }catch(e){
            toast(e?.message || "فشل صرف المخزن", "bad");
          }
        }

        toast("تم الحفظ", "good");
        modal.close();
      };
    }
  });
}

// ---------------- Invoices ----------------
function pageInvoices(){
  setTitle("الفواتير", "قوالب invoiceTemplates + صرف مخزن عند paid");
  const params = new URLSearchParams(location.hash.split("?")[1]||"");
  const q = (params.get("q")||"").toLowerCase().trim();
  const st = params.get("st") || "all";

  const list = (state.cache.invoices||[]).filter(x=>{
    const status = x.status || "draft";
    const okS = st==="all" ? true : status===st;
    const blob = `${x.invoiceCode||x.invoiceNo||""} ${x.customerName||""} ${x.customerPhone||""} ${x.carModel||""}`.toLowerCase();
    const okQ = !q || blob.includes(q);
    return okS && okQ;
  });

  $("#view").innerHTML = `
    <div class="card pad">
      <div class="row" style="justify-content:space-between; align-items:center">
        <div><div style="font-weight:900">الفواتير</div><div class="muted small">items[] (desc, price, qty) + discount + tax</div></div>
        <div class="row">
          <input class="input" id="q" placeholder="بحث..." style="width:min(320px,60vw)" value="${esc(params.get("q")||"")}"/>
          <select class="input" id="st" style="width:170px">
            <option value="all" ${st==="all"?"selected":""}>كل الحالات</option>
            <option value="draft" ${st==="draft"?"selected":""}>draft</option>
            <option value="unpaid" ${st==="unpaid"?"selected":""}>unpaid</option>
            <option value="paid" ${st==="paid"?"selected":""}>paid</option>
            <option value="void" ${st==="void"?"selected":""}>void</option>
          </select>
          <button class="btn" id="add">+ فاتورة</button>
        </div>
      </div>
      <hr class="hr"/>
      ${list.length ? `
        <table class="table">
          <thead><tr><th>رقم</th><th>الزبون</th><th>المبلغ</th><th>الحالة</th><th>تاريخ</th><th></th></tr></thead>
          <tbody>
            ${list.map(x=>`
              <tr>
                <td><b>${esc(x.invoiceCode||x.invoiceNo||"—")}</b></td>
                <td>${esc(x.customerName||"—")}</td>
                <td>${esc(fmtIQD.format(Number(x.total||0)))}</td>
                <td>${statusTag(x.status||"draft")}${x.stockConsumed?` <span class="tag good">Stock✓</span>`:""}</td>
                <td>${esc(fmtDate(x.createdAt))}</td>
                <td class="row end" style="gap:6px">
                  <button class="iconBtn" data-edit="${esc(x.id)}">✏️</button>
                  <button class="iconBtn" data-print="${esc(x.id)}">🖨️</button>
                  <button class="iconBtn" data-del="${esc(x.id)}">🗑️</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `<div class="empty">لا توجد فواتير.</div>`}
    </div>
  `;

  $("#q").oninput = ()=> location.hash = `#/invoices?q=${encodeURIComponent($("#q").value.trim())}&st=${encodeURIComponent($("#st").value)}`;
  $("#st").onchange = ()=> location.hash = `#/invoices?q=${encodeURIComponent($("#q").value.trim())}&st=${encodeURIComponent($("#st").value)}`;
  $("#add").onclick = ()=> openInvoiceEditor();

  $$("[data-edit]").forEach(b=> b.onclick = ()=>{
    const inv = (state.cache.invoices||[]).find(x=>x.id===b.dataset.edit);
    if(inv) openInvoiceEditor(inv);
  });
  $$("[data-print]").forEach(b=> b.onclick = ()=>{
    const inv = (state.cache.invoices||[]).find(x=>x.id===b.dataset.print);
    if(inv) printInvoice(inv);
  });
  $$("[data-del]").forEach(b=> b.onclick = async ()=>{
    if(!canAdmin()){ toast("الصلاحية غير كافية", "bad"); return; }
    if(!confirm("حذف الفاتورة؟")) return;
    const { doc, deleteDoc } = state.api;
    await deleteDoc(doc(state.db,"invoices", b.dataset.del));
    toast("تم الحذف", "warn");
  });
}

function openInvoiceEditor(inv=null){
  const isEdit = !!inv;
  const customers = state.cache.customers || [];
  const cars = state.cache.cars || [];
  const templates = state.cache.templates || [];
  const stock = state.cache.stockItems || [];

  const settings = state.settings || {};
  const taxRateDefault = Number(settings.taxRate ?? 0);
  const discountDefault = 0;

  const items = Array.isArray(inv?.items) ? inv.items.map(it=>({
    desc: it.desc || it.name || "",
    price: Number(it.price||0),
    qty: Number(it.qty||1),
    stockItemId: it.stockItemId || ""
  })) : [{ desc:"", price:0, qty:1, stockItemId:"" }];

  const calc = ()=>{
    const sub = items.reduce((a,b)=> a + (Number(b.qty||1)*Number(b.price||0)), 0);
    const discount = Number($("#iDiscount")?.value||0);
    const taxable = Math.max(0, sub - discount);
    const taxRate = Number($("#iTax")?.value||0);
    const tax = Math.round(taxable * (taxRate/100));
    const total = taxable + tax;
    $("#vSub").textContent = fmtIQD.format(sub);
    $("#vTax").textContent = fmtIQD.format(tax);
    $("#vTotal").textContent = fmtIQD.format(total);
    return { sub, discount, taxRate, tax, total };
  };

  const rowHtml = (it,i)=>`
    <tr>
      <td><input class="input" data-f="desc" data-i="${i}" value="${esc(it.desc||"")}" placeholder="وصف"/></td>
      <td style="width:120px"><input class="input" data-f="qty" data-i="${i}" type="number" min="1" step="1" value="${esc(it.qty??1)}"/></td>
      <td style="width:160px"><input class="input" data-f="price" data-i="${i}" type="number" min="0" step="250" value="${esc(it.price??0)}"/></td>
      <td style="width:260px">
        <select class="input" data-f="stockItemId" data-i="${i}">
          <option value="">(بدون مخزن)</option>
          ${stock.map(s=>`<option value="${esc(s.id)}" ${it.stockItemId===s.id?"selected":""}>${esc(s.name)} — ${esc(s.qty??0)} ${esc(s.unit||"")}</option>`).join("")}
        </select>
      </td>
      <td style="width:60px"><button class="iconBtn" data-rm="${i}">🗑️</button></td>
    </tr>
  `;

  const renderItems = ()=>{
    $("#itemsBody").innerHTML = items.map(rowHtml).join("");
    $$("[data-f]").forEach(inp=>{
      const apply = ()=>{
        const i = +inp.dataset.i;
        const f = inp.dataset.f;
        items[i][f] = (f==="qty"||f==="price") ? Number(inp.value||0) : inp.value;
        calc();
      };
      inp.oninput = apply;
      inp.onchange = apply;
    });
    $$("[data-rm]").forEach(b=> b.onclick = ()=>{ items.splice(+b.dataset.rm,1); renderItems(); calc(); });
  };

  modal.open({
    title: isEdit ? `تعديل فاتورة ${inv.invoiceCode||inv.invoiceNo||""}` : "فاتورة جديدة",
    bodyHtml: `
      <div class="formGrid">
        <div>
          <label>الزبون</label>
          <select class="input" id="iCustomer">
            <option value="">— اختاري —</option>
            ${customers.map(c=>`<option value="${esc(c.id)}" ${inv?.customerId===c.id?"selected":""}>${esc(c.name)} — ${esc(c.phone||"")}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>السيارة</label>
          <select class="input" id="iCar">
            <option value="">— اختاري —</option>
            ${cars.map(v=>`<option value="${esc(v.id)}" ${inv?.carId===v.id?"selected":""}>${esc(v.plate)} — ${esc(v.model||"")}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="formGrid" style="margin-top:10px">
        <div>
          <label>الحالة</label>
          <select class="input" id="iStatus">
            <option value="draft" ${(inv?.status||"draft")==="draft"?"selected":""}>draft</option>
            <option value="unpaid" ${(inv?.status||"draft")==="unpaid"?"selected":""}>unpaid</option>
            <option value="paid" ${(inv?.status||"draft")==="paid"?"selected":""}>paid</option>
            <option value="void" ${(inv?.status||"draft")==="void"?"selected":""}>void</option>
          </select>
        </div>
        <div>
          <label>قالب الطباعة</label>
          <select class="input" id="iTpl">
            ${templates.length ? templates.map(t=>`<option value="${esc(t.id)}" ${(inv?.templateId || settings.defaultInvoiceTemplateId || "default_ar")===t.id ? "selected":""}>${esc(t.id)}</option>`).join("") : `<option value="default_ar">default_ar</option>`}
          </select>
        </div>
      </div>

      <div class="formGrid" style="margin-top:10px">
        <div><label>خصم</label><input class="input" id="iDiscount" type="number" min="0" step="250" value="${esc(inv?.discount ?? discountDefault)}"/></div>
        <div><label>ضريبة %</label><input class="input" id="iTax" type="number" min="0" step="0.1" value="${esc(inv?.taxRate ?? taxRateDefault)}"/></div>
      </div>

      <hr class="hr"/>
      <div class="row" style="justify-content:space-between; align-items:center">
        <div><div style="font-weight:900">بنود الفاتورة</div><div class="muted small">ربط البند بمادة مخزن => ينقص عند paid</div></div>
        <button class="btn" id="addItem">+ بند</button>
      </div>

      <div style="margin-top:10px; overflow:auto">
        <table class="table">
          <thead><tr><th>الوصف</th><th>qty</th><th>price</th><th>مخزن</th><th></th></tr></thead>
          <tbody id="itemsBody"></tbody>
        </table>
      </div>

      <div class="row end" style="margin-top:12px">
        <div class="card pad" style="min-width:min(420px,100%); background: rgba(255,255,255,.02); border-color: rgba(255,255,255,.10)">
          <div class="row" style="justify-content:space-between"><div class="muted">الإجمالي</div><div id="vSub">0</div></div>
          <div class="row" style="justify-content:space-between"><div class="muted">الضريبة</div><div id="vTax">0</div></div>
          <hr class="hr"/>
          <div class="row" style="justify-content:space-between"><div style="font-weight:900">المجموع</div><div style="font-weight:900" id="vTotal">0</div></div>
        </div>
      </div>

      ${inv?.stockConsumed ? `<div class="empty" style="margin-top:10px">تم صرف المخزن لهذه الفاتورة مسبقاً ✅</div>` : ``}
    `,
    footerHtml: `
      <button class="iconBtn" id="mClose">إلغاء</button>
      <button class="btn" id="mSave">حفظ</button>
      ${isEdit ? `<button class="btn" id="mPrint">طباعة</button>` : ``}
    `,
    onMount(){
      renderItems();
      calc();

      $("#iDiscount").oninput = calc;
      $("#iTax").oninput = calc;

      $("#addItem").onclick = ()=>{ items.push({ desc:"", price:0, qty:1, stockItemId:"" }); renderItems(); calc(); };
      $("#mClose").onclick = modal.close;

      $("#mSave").onclick = async ()=>{
        const customerId = $("#iCustomer").value;
        if(!customerId){ toast("اختاري زبون", "bad"); return; }
        const carId = $("#iCar").value;
        const c = customers.find(x=>x.id===customerId);
        const v = cars.find(x=>x.id===carId);

        const status = $("#iStatus").value;
        const templateId = $("#iTpl").value;
        const totals = calc();

        const { doc, setDoc, updateDoc, addDoc, collection, serverTimestamp } = state.api;
        const payload = {
          customerId, customerName: c?.name||"", customerPhone: c?.phone||"",
          carId: carId||"", carModel: v?.model||inv?.carModel||"", carPlate: v?.plate||inv?.carPlate||"",
          discount: totals.discount,
          taxRate: totals.taxRate,
          tax: totals.tax,
          subTotal: totals.sub,
          total: totals.total,
          status,
          templateId,
          items: items.filter(i=> (i.desc||"").trim()).map(i=>({
            desc: String(i.desc||"").trim(),
            price: Number(i.price||0),
            qty: Number(i.qty||1),
            stockItemId: i.stockItemId || ""
          })),
          updatedAt: serverTimestamp()
        };

        let id = inv?.id;

        if(isEdit){
          await updateDoc(doc(state.db,"invoices", id), payload);
        }else{
          const no = await nextCounter("invoiceNo");
          const pref = state.settings?.invoicePrefix || "INV";
          const width = Number(state.settings?.numberWidth || 6);
          const code = `${pref}-${padNum(no, width)}`;
          await addDoc(collection(state.db,"invoices"), {
            ...payload,
            invoiceNo: no,
            invoiceCode: code,
            createdAt: serverTimestamp()
          });
        }

        // سياسة المخزن: finalize_only => عند paid فقط
        if(stockPolicy()==="finalize_only" && status==="paid"){
          try{
            if(isEdit){
              await consumeStockFromInvoice(id);
              toast("تم صرف المخزن ✅", "good");
            } else {
              toast("تم حفظ الفاتورة. (سيتم صرف المخزن بعد ظهورها بالقائمة عند تعديلها إلى paid)", "good");
            }
          }catch(e){
            toast(e?.message || "فشل صرف المخزن", "bad");
          }
        }

        toast("تم الحفظ", "good");
        modal.close();
      };

      if(isEdit){
        $("#mPrint").onclick = ()=> printInvoice(inv);
      }
    }
  });
}

// ---------------- Inventory ----------------
function pageInventory(){
  setTitle("المخزن", "فارغ بالبداية — أضيفي موادك هنا");
  const items = state.cache.stockItems || [];
  const params = new URLSearchParams(location.hash.split("?")[1]||"");
  const q = (params.get("q")||"").toLowerCase().trim();

  const list = items.filter(x=>{
    const blob = `${x.name||""} ${x.sku||""} ${x.unit||""}`.toLowerCase();
    return !q || blob.includes(q);
  });

  $("#view").innerHTML = `
    <div class="card pad">
      <div class="row" style="justify-content:space-between; align-items:center">
        <div><div style="font-weight:900">مواد المخزن</div><div class="muted small">الخصائص: qty, unit, minQty, cost, price</div></div>
        <div class="row">
          <input class="input" id="q" placeholder="بحث..." style="width:min(320px,60vw)" value="${esc(params.get("q")||"")}"/>
          <button class="btn" id="add">+ مادة</button>
        </div>
      </div>
      <hr class="hr"/>
      ${list.length ? `
        <table class="table">
          <thead><tr><th>المادة</th><th>qty</th><th>unit</th><th>min</th><th>تنبيه</th><th></th></tr></thead>
          <tbody>
            ${list.map(i=>{
              const low = Number(i.qty||0) <= Number(i.minQty||0);
              return `
                <tr>
                  <td><b>${esc(i.name||"—")}</b><div class="muted small">${esc(i.sku||"")}</div></td>
                  <td>${esc(i.qty??0)}</td>
                  <td>${esc(i.unit||"")}</td>
                  <td>${esc(i.minQty??0)}</td>
                  <td>${low ? `<span class="tag warn">LOW</span>` : `<span class="tag good">OK</span>`}</td>
                  <td class="row end" style="gap:6px">
                    <button class="iconBtn" data-edit="${esc(i.id)}">✏️</button>
                    <button class="iconBtn" data-adj="${esc(i.id)}">➕➖</button>
                    <button class="iconBtn" data-del="${esc(i.id)}">🗑️</button>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      ` : `<div class="empty">المخزن فارغ ✅ اضغطي “+ مادة” وابدئي.</div>`}
    </div>
  `;

  $("#q").oninput = ()=> location.hash = `#/inventory?q=${encodeURIComponent($("#q").value.trim())}`;
  $("#add").onclick = ()=> openStockEditor();

  $$("[data-edit]").forEach(b=> b.onclick = ()=>{
    const it = items.find(x=>x.id===b.dataset.edit);
    if(it) openStockEditor(it);
  });
  $$("[data-adj]").forEach(b=> b.onclick = ()=>{
    const it = items.find(x=>x.id===b.dataset.adj);
    if(it) openStockAdjust(it);
  });
  $$("[data-del]").forEach(b=> b.onclick = async ()=>{
    if(!canAdmin()){ toast("الصلاحية غير كافية", "bad"); return; }
    if(!confirm("حذف المادة؟")) return;
    const { doc, deleteDoc } = state.api;
    await deleteDoc(doc(state.db,"stockItems", b.dataset.del));
    toast("تم الحذف", "warn");
  });
}

function openStockEditor(item=null){
  const isEdit = !!item;
  modal.open({
    title: isEdit ? "تعديل مادة" : "إضافة مادة",
    bodyHtml: `
      <div class="formGrid">
        <div><label>اسم المادة</label><input class="input" id="sName" value="${esc(item?.name||"")}" /></div>
        <div><label>SKU (اختياري)</label><input class="input" id="sSku" value="${esc(item?.sku||"")}" /></div>
      </div>
      <div class="formGrid" style="margin-top:10px">
        <div><label>الكمية</label><input class="input" id="sQty" type="number" step="0.01" value="${esc(item?.qty ?? 0)}" /></div>
        <div><label>الوحدة</label><input class="input" id="sUnit" placeholder="لتر/قطعة/علبة" value="${esc(item?.unit||"")}" /></div>
      </div>
      <div class="formGrid" style="margin-top:10px">
        <div><label>حد التنبيه (minQty)</label><input class="input" id="sMin" type="number" step="0.01" value="${esc(item?.minQty ?? 0)}" /></div>
        <div><label>سعر البيع (اختياري)</label><input class="input" id="sPrice" type="number" step="250" value="${esc(item?.price ?? 0)}" /></div>
      </div>
      <div style="margin-top:10px">
        <label>كلفة الشراء (اختياري)</label>
        <input class="input" id="sCost" type="number" step="250" value="${esc(item?.cost ?? 0)}" />
      </div>
    `,
    footerHtml: `<button class="iconBtn" id="mClose">إلغاء</button><button class="btn" id="mSave">حفظ</button>`,
    onMount(){
      $("#mClose").onclick = modal.close;
      $("#mSave").onclick = async ()=>{
        const name = $("#sName").value.trim();
        if(!name){ toast("اسم المادة مطلوب", "bad"); return; }
        const sku = $("#sSku").value.trim();
        const qty = Number($("#sQty").value||0);
        const unit = $("#sUnit").value.trim();
        const minQty = Number($("#sMin").value||0);
        const price = Number($("#sPrice").value||0);
        const cost = Number($("#sCost").value||0);

        const { doc, setDoc, updateDoc, addDoc, collection, serverTimestamp } = state.api;
        const payload = { name, sku, qty, unit, minQty, price, cost, updatedAt: serverTimestamp() };

        if(isEdit){
          await updateDoc(doc(state.db,"stockItems", item.id), payload);
        }else{
          await addDoc(collection(state.db,"stockItems"), { ...payload, createdAt: serverTimestamp() });
        }
        toast("تم الحفظ", "good");
        modal.close();
      };
    }
  });
}

function openStockAdjust(item){
  modal.open({
    title:`تعديل كمية: ${item.name}`,
    bodyHtml: `
      <div class="formGrid">
        <div>
          <label>العملية</label>
          <select class="input" id="op">
            <option value="in">إضافة (IN)</option>
            <option value="out">صرف (OUT)</option>
            <option value="set">تثبيت قيمة (SET)</option>
          </select>
        </div>
        <div>
          <label>الكمية</label>
          <input class="input" id="qty" type="number" step="0.01" value="1" />
        </div>
      </div>
      <div style="margin-top:10px">
        <label>سبب (اختياري)</label>
        <input class="input" id="note" placeholder="شراء/تصحيح/..." />
      </div>
    `,
    footerHtml:`<button class="iconBtn" id="mClose">إلغاء</button><button class="btn" id="mSave">تنفيذ</button>`,
    onMount(){
      $("#mClose").onclick = modal.close;
      $("#mSave").onclick = async ()=>{
        const { doc, runTransaction, serverTimestamp } = state.api;
        const op = $("#op").value;
        const q = Number($("#qty").value||0);
        const note = $("#note").value.trim();

        if(q<=0 && op!=="set"){ toast("الكمية لازم > 0", "bad"); return; }

        try{
          await runTransaction(state.db, async (tx)=>{
            const ref = doc(state.db,"stockItems", item.id);
            const snap = await tx.get(ref);
            if(!snap.exists()) throw new Error("المادة غير موجودة");
            const cur = Number(snap.data().qty||0);
            let next = cur;
            if(op==="in") next = cur + q;
            if(op==="out") next = cur - q;
            if(op==="set") next = q;
            if(next < 0) throw new Error("المخزون ما يكفي");
            tx.update(ref, { qty: next, updatedAt: serverTimestamp() });

            const moveRef = doc(state.db,"stockMoves", uid());
            tx.set(moveRef, {
              type: op==="in" ? "in" : (op==="out" ? "out" : "set"),
              itemId: item.id,
              qty: q,
              refType: "manual",
              refId: "",
              note,
              createdAt: serverTimestamp(),
              createdBy: state.user?.uid || "",
              createdByEmail: state.user?.email || ""
            });
          });

          toast("تم التعديل", "good");
          modal.close();
        }catch(e){
          toast(e?.message || "فشل التعديل", "bad");
        }
      };
    }
  });
}

// ---------------- Employees + Departments ----------------
function pageEmployees(){
  setTitle("الموظفين", "رواتب + اختصاص + هاتف + قسم");
  const emps = state.cache.employees || [];
  const deps = state.cache.departments || [];

  $("#view").innerHTML = `
    <div class="grid" style="grid-template-columns: 1fr 1fr;">
      <div class="card pad">
        <div class="row" style="justify-content:space-between; align-items:center">
          <div><div style="font-weight:900">الموظفين</div><div class="muted small">تطوير حقول: phone, salary, specialty, departmentId, active</div></div>
          <button class="btn" id="addEmp">+ موظف</button>
        </div>
        <hr class="hr"/>
        ${emps.length ? `
          <table class="table">
            <thead><tr><th>الاسم</th><th>الدور</th><th>الهاتف</th><th>الراتب</th><th></th></tr></thead>
            <tbody>
              ${emps.map(e=>`
                <tr>
                  <td><b>${esc(e.name||"—")}</b><div class="muted small">${esc(e.specialty||"")}</div></td>
                  <td>${esc(e.role||"—")}</td>
                  <td>${esc(e.phone||"")}</td>
                  <td>${esc(e.salary??"")}</td>
                  <td class="row end" style="gap:6px">
                    <button class="iconBtn" data-edit="${esc(e.id)}">✏️</button>
                    <button class="iconBtn" data-del="${esc(e.id)}">🗑️</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        ` : `<div class="empty">لا يوجد موظفين.</div>`}
      </div>

      <div class="card pad">
        <div class="row" style="justify-content:space-between; align-items:center">
          <div><div style="font-weight:900">الأقسام</div><div class="muted small">departments (active)</div></div>
          <button class="btn" id="addDep">+ قسم</button>
        </div>
        <hr class="hr"/>
        ${deps.length ? `
          <table class="table">
            <thead><tr><th>القسم</th><th>active</th><th></th></tr></thead>
            <tbody>
              ${deps.map(d=>`
                <tr>
                  <td><b>${esc(d.name||"—")}</b></td>
                  <td>${d.active ? `<span class="tag good">true</span>` : `<span class="tag bad">false</span>`}</td>
                  <td class="row end" style="gap:6px">
                    <button class="iconBtn" data-editdep="${esc(d.id)}">✏️</button>
                    <button class="iconBtn" data-deldep="${esc(d.id)}">🗑️</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        ` : `<div class="empty">لا يوجد أقسام.</div>`}
      </div>
    </div>
  `;

  $("#addEmp").onclick = ()=> openEmployeeEditor();
  $("#addDep").onclick = ()=> openDepartmentEditor();

  $$("[data-edit]").forEach(b=> b.onclick = ()=>{
    const e = emps.find(x=>x.id===b.dataset.edit);
    if(e) openEmployeeEditor(e);
  });
  $$("[data-del]").forEach(b=> b.onclick = async ()=>{
    if(!canAdmin()){ toast("الصلاحية غير كافية", "bad"); return; }
    if(!confirm("حذف الموظف؟")) return;
    const { doc, deleteDoc } = state.api;
    await deleteDoc(doc(state.db,"employees", b.dataset.del));
    toast("تم الحذف", "warn");
  });

  $$("[data-editdep]").forEach(b=> b.onclick = ()=>{
    const d = deps.find(x=>x.id===b.dataset.editdep);
    if(d) openDepartmentEditor(d);
  });
  $$("[data-deldep]").forEach(b=> b.onclick = async ()=>{
    if(!canAdmin()){ toast("الصلاحية غير كافية", "bad"); return; }
    if(!confirm("حذف القسم؟")) return;
    const { doc, deleteDoc } = state.api;
    await deleteDoc(doc(state.db,"departments", b.dataset.deldep));
    toast("تم الحذف", "warn");
  });
}

function openEmployeeEditor(emp=null){
  if(!canAdmin()){ toast("هذه الصفحة للأدمن/المدير", "warn"); return; }
  const isEdit = !!emp;
  const deps = state.cache.departments || [];
  modal.open({
    title: isEdit ? "تعديل موظف" : "إضافة موظف",
    bodyHtml: `
      <div class="formGrid">
        <div><label>الاسم</label><input class="input" id="eName" value="${esc(emp?.name||"")}" /></div>
        <div><label>الدور</label><input class="input" id="eRole" value="${esc(emp?.role||"tech")}" placeholder="admin/manager/tech/viewer"/></div>
      </div>
      <div class="formGrid" style="margin-top:10px">
        <div><label>الهاتف</label><input class="input" id="ePhone" value="${esc(emp?.phone||"")}" /></div>
        <div><label>الراتب</label><input class="input" id="eSalary" type="number" step="1000" value="${esc(emp?.salary ?? "")}" /></div>
      </div>
      <div class="formGrid" style="margin-top:10px">
        <div><label>الاختصاص</label><input class="input" id="eSpec" value="${esc(emp?.specialty||"")}" /></div>
        <div>
          <label>القسم</label>
          <select class="input" id="eDep">
            <option value="">—</option>
            ${deps.map(d=>`<option value="${esc(d.id)}" ${(emp?.departmentId||"")===d.id?"selected":""}>${esc(d.name)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div style="margin-top:10px">
        <label>active</label>
        <select class="input" id="eActive">
          <option value="true" ${(emp?.active ?? true) ? "selected":""}>true</option>
          <option value="false" ${!(emp?.active ?? true) ? "selected":""}>false</option>
        </select>
      </div>
    `,
    footerHtml:`<button class="iconBtn" id="mClose">إلغاء</button><button class="btn" id="mSave">حفظ</button>`,
    onMount(){
      $("#mClose").onclick = modal.close;
      $("#mSave").onclick = async ()=>{
        const name = $("#eName").value.trim();
        if(!name){ toast("الاسم مطلوب", "bad"); return; }
        const role = $("#eRole").value.trim() || "tech";
        const phone = $("#ePhone").value.trim();
        const salary = $("#eSalary").value ? Number($("#eSalary").value) : null;
        const specialty = $("#eSpec").value.trim();
        const departmentId = $("#eDep").value;
        const active = $("#eActive").value === "true";

        const { doc, setDoc, updateDoc, addDoc, collection, serverTimestamp } = state.api;
        const payload = {
          name, role, phone, salary, specialty, departmentId, active,
          updatedAt: serverTimestamp(),
          createdBy: emp?.createdBy || state.user?.uid || "",
          createdByEmail: emp?.createdByEmail || state.user?.email || ""
        };

        if(isEdit){
          await updateDoc(doc(state.db,"employees", emp.id), payload);
        }else{
          await addDoc(collection(state.db,"employees"), { ...payload, createdAt: serverTimestamp() });
        }
        toast("تم الحفظ", "good");
        modal.close();
      };
    }
  });
}

function openDepartmentEditor(dep=null){
  if(!canAdmin()){ toast("هذه الصفحة للأدمن/المدير", "warn"); return; }
  const isEdit = !!dep;
  modal.open({
    title: isEdit ? "تعديل قسم" : "إضافة قسم",
    bodyHtml: `
      <div class="formGrid">
        <div><label>اسم القسم</label><input class="input" id="dName" value="${esc(dep?.name||"")}" /></div>
        <div>
          <label>active</label>
          <select class="input" id="dActive">
            <option value="true" ${(dep?.active ?? true) ? "selected":""}>true</option>
            <option value="false" ${!(dep?.active ?? true) ? "selected":""}>false</option>
          </select>
        </div>
      </div>
    `,
    footerHtml:`<button class="iconBtn" id="mClose">إلغاء</button><button class="btn" id="mSave">حفظ</button>`,
    onMount(){
      $("#mClose").onclick = modal.close;
      $("#mSave").onclick = async ()=>{
        const name = $("#dName").value.trim();
        if(!name){ toast("اسم القسم مطلوب", "bad"); return; }
        const active = $("#dActive").value==="true";
        const { doc, setDoc, updateDoc, addDoc, collection, serverTimestamp } = state.api;
        const payload = { name, active, updatedAt: serverTimestamp() };
        if(isEdit){
          await updateDoc(doc(state.db,"departments", dep.id), payload);
        }else{
          await addDoc(collection(state.db,"departments"), { ...payload, createdAt: serverTimestamp() });
        }
        toast("تم الحفظ", "good");
        modal.close();
      };
    }
  });
}

// ---------------- Pages (Dynamic without touching code) ----------------
function pagePages(){
  setTitle("الصفحات", "تضيفين صفحات من داخل البرنامج (uiPages)");
  if(!canAdmin()){
    $("#view").innerHTML = `<div class="card pad"><div class="empty">هذه الصفحة للأدمن/المدير.</div></div>`;
    return;
  }
  const pages = state.cache.uiPages || [];
  $("#view").innerHTML = `
    <div class="card pad">
      <div class="row" style="justify-content:space-between; align-items:center">
        <div><div style="font-weight:900">إدارة صفحات ديناميكية</div><div class="muted small">تنشئ صفحة تعرض Collection وتحدد الأعمدة</div></div>
        <button class="btn" id="add">+ صفحة</button>
      </div>
      <hr class="hr"/>
      ${pages.length ? `
        <table class="table">
          <thead><tr><th>slug</th><th>title</th><th>collection</th><th></th></tr></thead>
          <tbody>
            ${pages.map(p=>`
              <tr>
                <td><b>${esc(p.slug||p.id)}</b></td>
                <td>${esc(p.title||"")}</td>
                <td>${esc(p.collection||"")}</td>
                <td class="row end" style="gap:6px">
                  <button class="iconBtn" data-edit="${esc(p.id)}">✏️</button>
                  <button class="iconBtn" data-open="${esc(p.id)}">👁️</button>
                  <button class="iconBtn" data-del="${esc(p.id)}">🗑️</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `<div class="empty">ماكو صفحات بعد. اضغطي “+ صفحة”.</div>`}
      <hr class="hr"/>
      <div class="muted small">
        ملاحظة: حتى تظهر بالسايدبار، أضيفيها إلى <b>uiConfig/app.nav</b> (راح أسهلها بالزر داخل محرر الصفحة).
      </div>
    </div>
  `;

  $("#add").onclick = ()=> openPageEditor();
  $$("[data-edit]").forEach(b=> b.onclick = ()=>{ const p = pages.find(x=>x.id===b.dataset.edit); openPageEditor(p); });
  $$("[data-open]").forEach(b=> b.onclick = ()=> openDynamicPage(b.dataset.open));
  $$("[data-del]").forEach(b=> b.onclick = async ()=>{
    if(!confirm("حذف الصفحة؟")) return;
    const { doc, deleteDoc } = state.api;
    await deleteDoc(doc(state.db,"uiPages", b.dataset.del));
    toast("تم الحذف", "warn");
  });
}

function openPageEditor(p=null){
  const isEdit = !!p;
  modal.open({
    title: isEdit ? "تعديل صفحة" : "إضافة صفحة",
    bodyHtml: `
      <div class="formGrid">
        <div><label>slug</label><input class="input" id="pSlug" value="${esc(p?.slug||"")}" placeholder="مثال: expenses"/></div>
        <div><label>العنوان</label><input class="input" id="pTitle" value="${esc(p?.title||"")}" placeholder="مصروفات"/></div>
      </div>
      <div style="margin-top:10px">
        <label>اسم Collection</label>
        <input class="input" id="pCol" value="${esc(p?.collection||"")}" placeholder="مثال: expenses"/>
        <div class="muted small" style="margin-top:6px">راح نعرض documents بجدول بسيط مع بحث.</div>
      </div>
      <div style="margin-top:10px">
        <label>الأعمدة (CSV)</label>
        <input class="input" id="pCols" value="${esc((p?.columns||[]).join(","))}" placeholder="name,phone,createdAt"/>
      </div>
      <div style="margin-top:10px">
        <label>roles (CSV)</label>
        <input class="input" id="pRoles" value="${esc((p?.roles||["admin","manager"]).join(","))}" />
      </div>
    `,
    footerHtml: `
      <button class="iconBtn" id="mClose">إلغاء</button>
      <button class="btn" id="mSave">حفظ</button>
      <button class="btn" id="mAddNav">أضفها للمنيو</button>
    `,
    onMount(){
      $("#mClose").onclick = modal.close;
      $("#mSave").onclick = async ()=>{
        const slug = $("#pSlug").value.trim();
        const title = $("#pTitle").value.trim();
        const collectionName = $("#pCol").value.trim();
        const columns = $("#pCols").value.split(",").map(s=>s.trim()).filter(Boolean);
        const roles = $("#pRoles").value.split(",").map(s=>s.trim()).filter(Boolean);
        if(!slug || !collectionName){ toast("slug و collection مطلوبات", "bad"); return; }

        const { doc, setDoc, serverTimestamp } = state.api;
        const id = p?.id || slug;
        await setDoc(doc(state.db,"uiPages", id), {
          slug, title, collection: collectionName, columns, roles,
          updatedAt: serverTimestamp(),
          createdAt: p?.createdAt || serverTimestamp()
        }, { merge:true });

        toast("تم الحفظ", "good");
        modal.close();
      };

      $("#mAddNav").onclick = async ()=>{
        // يضيف nav item إلى uiConfig/app.nav
        const slug = $("#pSlug").value.trim();
        const title = $("#pTitle").value.trim() || slug;
        if(!slug){ toast("اكتبي slug", "bad"); return; }
        const roles = $("#pRoles").value.split(",").map(s=>s.trim()).filter(Boolean);
        const { doc, setDoc, serverTimestamp } = state.api;

        const nav = Array.isArray(state.uiApp?.nav) ? [...state.uiApp.nav] : [];
        const exists = nav.some(n=> n.slug === `page:${slug}`);
        if(!exists){
          nav.push({ slug:`page:${slug}`, title, icon:"🧩", roles: roles.length?roles:["admin","manager"] });
          await setDoc(doc(state.db,"uiConfig","app"), { nav, updatedAt: serverTimestamp() }, { merge:true });
          toast("تمت إضافتها للمنيو", "good");
          modal.close();
        }else{
          toast("موجودة بالمنيو مسبقاً", "warn");
        }
      };
    }
  });
}

async function openDynamicPage(pageId){
  // صفحة تعرض Collection بأي أعمدة
  const { doc, getDoc, collection, query, orderBy, limit, getDocs } = state.api;
  const pageSnap = await getDoc(doc(state.db,"uiPages", pageId));
  if(!pageSnap.exists()){ toast("الصفحة غير موجودة", "bad"); return; }
  const cfg = pageSnap.data();
  if(cfg.roles && !cfg.roles.includes(state.role)){ toast("ما عندج صلاحية", "bad"); return; }

  const colName = cfg.collection;
  const cols = Array.isArray(cfg.columns) && cfg.columns.length ? cfg.columns : ["id","createdAt"];
  const q = query(collection(state.db, colName), orderBy("createdAt","desc"), limit(200));
  const snap = await getDocs(q);
  const rows = snap.docs.map(d=> ({ id:d.id, ...d.data() }));

  modal.open({
    title: cfg.title || cfg.slug || "صفحة",
    bodyHtml: `
      <div class="muted small">Collection: <b>${esc(colName)}</b> — آخر 200 وثيقة</div>
      <hr class="hr"/>
      ${rows.length ? `
      <div style="overflow:auto">
        <table class="table">
          <thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join("")}</tr></thead>
          <tbody>
            ${rows.map(r=>`
              <tr>
                ${cols.map(c=>{
                  const v = r[c];
                  if(c==="createdAt"||c==="updatedAt") return `<td>${esc(fmtDate(v))}</td>`;
                  if(typeof v === "object") return `<td class="muted small">[object]</td>`;
                  return `<td>${esc(v ?? "")}</td>`;
                }).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>` : `<div class="empty">لا توجد بيانات.</div>`}
    `,
    footerHtml:`<button class="iconBtn" id="mClose">إغلاق</button>`,
    onMount(){ $("#mClose").onclick = modal.close; }
  });
}

// ---------------- Reports ----------------
function pageReports(){
  setTitle("التقارير", "فلترة + رسم + CSV");
  const inv = state.cache.invoices || [];
  const today = new Date();
  const fromDef = new Date(today.getFullYear(), today.getMonth(), today.getDate()-14);

  const params = new URLSearchParams(location.hash.split("?")[1]||"");
  const from = params.get("from") || ymd(fromDef);
  const to = params.get("to") || ymd(today);

  const fromTs = startDay(from);
  const toTs = endDay(to);

  const range = inv.filter(x=>{
    const t = tsMs(x.createdAt);
    return t>=fromTs && t<=toTs;
  });

  const paid = range.filter(x=> (x.status||"draft")==="paid");
  const revenue = paid.reduce((a,b)=> a + Number(b.total||0), 0);
  const count = range.length;

  $("#view").innerHTML = `
    <div class="card pad">
      <div class="row" style="justify-content:space-between; align-items:center">
        <div><div style="font-weight:900">فلترة</div><div class="muted small">من/إلى</div></div>
        <div class="row">
          <div style="width:160px"><label>من</label><input class="input" id="from" type="date" value="${esc(from)}"/></div>
          <div style="width:160px"><label>إلى</label><input class="input" id="to" type="date" value="${esc(to)}"/></div>
          <button class="btn" id="apply">تطبيق</button>
        </div>
      </div>
    </div>

    <div class="grid kpis" style="margin-top:12px">
      <div class="card kpi"><div class="h">إيراد مدفوع</div><div class="v">${esc(fmtIQD.format(revenue))}</div><div class="s">paid: ${esc(fmtNum.format(paid.length))}</div></div>
      <div class="card kpi"><div class="h">عدد الفواتير</div><div class="v">${esc(fmtNum.format(count))}</div><div class="s">ضمن الفترة</div></div>
      <div class="card kpi"><div class="h">متوسط المدفوع</div><div class="v">${esc(fmtIQD.format(paid.length?Math.round(revenue/paid.length):0))}</div><div class="s">—</div></div>
      <div class="card kpi"><div class="h">الحالات</div><div class="v">${esc(fmtNum.format(range.filter(x=>(x.status||"draft")==="unpaid").length))}</div><div class="s">unpaid داخل الفترة</div></div>
    </div>

    <div class="card pad" style="margin-top:12px">
      <div style="font-weight:900">الإيراد اليومي (مدفوع)</div>
      <div class="muted small">Chart</div>
      <hr class="hr"/>
      <canvas id="rChart" height="160" style="width:100%"></canvas>
    </div>

    <div class="card pad" style="margin-top:12px">
      <div class="row" style="justify-content:space-between; align-items:center">
        <div><div style="font-weight:900">تصدير CSV</div><div class="muted small">فواتير الفترة</div></div>
        <button class="btn" id="csv">CSV</button>
      </div>
    </div>
  `;

  $("#apply").onclick = ()=> location.hash = `#/reports?from=${encodeURIComponent($("#from").value)}&to=${encodeURIComponent($("#to").value)}`;
  $("#csv").onclick = ()=>{
    const rows = [
      ["invoiceCode","invoiceNo","status","customerName","customerPhone","carModel","total","createdAt"],
      ...range.map(x=>[
        x.invoiceCode||"", x.invoiceNo||"", x.status||"",
        x.customerName||"", x.customerPhone||"", x.carModel||"",
        x.total||0, tsMs(x.createdAt)||0
      ])
    ];
    const csv = rows.map(r=> r.map(v=> `"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
    download(`rpm_invoices_${from}_to_${to}.csv`, csv, "text/csv;charset=utf-8");
  };

  const c = $("#rChart");
  if(c){
    const series = [];
    for(let t=fromTs; t<=toTs; t+=86400000){
      const end = t + 86400000 - 1;
      const v = paid.filter(x=>{
        const ms = tsMs(x.createdAt);
        return ms>=t && ms<=end;
      }).reduce((a,b)=> a + Number(b.total||0), 0);
      series.push(v);
    }
    drawLine(c, series);
  }
}

// ---------------- Settings ----------------
function pageSettings(){
  setTitle("الإعدادات", "settings/app + defaultInvoiceTemplateId + stockConsumePolicy");
  if(!canAdmin()){
    $("#view").innerHTML = `<div class="card pad"><div class="empty">هذه الصفحة للأدمن/المدير.</div></div>`;
    return;
  }
  const s = state.settings || {};
  const templates = state.cache.templates || [];

  $("#view").innerHTML = `
    <div class="grid" style="grid-template-columns: 1fr 1fr;">
      <div class="card pad">
        <div style="font-weight:900">بيانات الورشة</div>
        <div class="muted small">تظهر على الفاتورة</div>
        <hr class="hr"/>
        <div style="display:grid; gap:10px">
          <div><label>workshopName</label><input class="input" id="wName" value="${esc(s.workshopName||"RPM Workshop")}" /></div>
          <div class="formGrid">
            <div><label>phone</label><input class="input" id="wPhone" value="${esc(s.phone||"")}" /></div>
            <div><label>address</label><input class="input" id="wAddr" value="${esc(s.address||"")}" /></div>
          </div>
          <div class="formGrid">
            <div><label>currency</label><input class="input" id="wCur" value="${esc(s.currency||"IQD")}" /></div>
            <div><label>taxRate (%)</label><input class="input" id="wTax" type="number" step="0.1" value="${esc(s.taxRate ?? 0)}" /></div>
          </div>
        </div>
      </div>

      <div class="card pad">
        <div style="font-weight:900">فواتير/ترقيم/مخزن</div>
        <div class="muted small">meta/counters + policy</div>
        <hr class="hr"/>
        <div style="display:grid; gap:10px">
          <div class="formGrid">
            <div><label>invoicePrefix</label><input class="input" id="iPref" value="${esc(s.invoicePrefix||"INV")}" /></div>
            <div><label>woPrefix</label><input class="input" id="woPref" value="${esc(s.woPrefix||"WO")}" /></div>
          </div>
          <div class="formGrid">
            <div><label>numberWidth</label><input class="input" id="nWidth" type="number" min="3" step="1" value="${esc(s.numberWidth ?? 6)}" /></div>
            <div>
              <label>defaultInvoiceTemplateId</label>
              <select class="input" id="defTpl">
                ${(templates.length ? templates : [{id:"default_ar"}]).map(t=>`<option value="${esc(t.id)}" ${(s.defaultInvoiceTemplateId||"default_ar")===t.id?"selected":""}>${esc(t.id)}</option>`).join("")}
              </select>
            </div>
          </div>
          <div>
            <label>stockConsumePolicy</label>
            <select class="input" id="pol">
              <option value="finalize_only" ${(stockPolicy()==="finalize_only")?"selected":""}>finalize_only (الأفضل: paid/completed)</option>
              <option value="invoice_create" ${(stockPolicy()==="invoice_create")?"selected":""}>invoice_create</option>
              <option value="manual" ${(stockPolicy()==="manual")?"selected":""}>manual</option>
            </select>
            <div class="muted small" style="margin-top:6px">اخترت لك الأفضل افتراضياً: finalize_only.</div>
          </div>

          <div class="row end">
            <button class="btn" id="save">حفظ</button>
          </div>

          <hr class="hr"/>
          <div class="muted small">
            counters: invoiceNo=${esc(state.counters?.invoiceNo ?? "—")} • orderNo=${esc(state.counters?.orderNo ?? "—")}
          </div>
        </div>
      </div>
    </div>
  `;

  $("#save").onclick = async ()=>{
    const { doc, setDoc, serverTimestamp } = state.api;
    await setDoc(doc(state.db,"settings","app"), {
      workshopName: $("#wName").value.trim(),
      phone: $("#wPhone").value.trim(),
      address: $("#wAddr").value.trim(),
      currency: $("#wCur").value.trim() || "IQD",
      taxRate: Number($("#wTax").value||0),
      invoicePrefix: $("#iPref").value.trim() || "INV",
      woPrefix: $("#woPref").value.trim() || "WO",
      numberWidth: Number($("#nWidth").value||6),
      defaultInvoiceTemplateId: $("#defTpl").value,
      stockConsumePolicy: $("#pol").value,
      updatedAt: serverTimestamp()
    }, { merge:true });

    toast("تم حفظ الإعدادات", "good");
  };
}

// ---------------- Download helper ----------------
function download(name, content, mime){
  const blob = new Blob([content], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=> URL.revokeObjectURL(url), 2000);
}

// ---------------- Boot ----------------
// دعم nav items اللي سلَغها "page:xxx"
routes["#/page"] = ()=>{}; // placeholder

// hook dynamic nav routing
window.addEventListener("hashchange", async ()=>{
  const h = location.hash || "#/dashboard";
  if(h.startsWith("#/page:")){
    const slug = h.replace("#/page:","");
    await openDynamicPage(slug);
    // ارجع للداشبورد بعد إغلاق المودال
    // (اختياري) ما نغير الهاش
  }
});

init();

// --------------------------------------------------------
// ملاحظة مهمة:
// إذا عندج uiConfig/app.nav يحتوي slug مثل "dashboard" تمام.
// وإذا تريدين صفحة ديناميكية تخلي slug: "page:expenses" مثلاً.
// --------------------------------------------------------
