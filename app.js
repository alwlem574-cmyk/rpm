/* RPM — Front-end + Firebase (Realtime Database) + Invoice + Reports
   الميزات (9):
   1) Dashboard KPIs + آخر نشاط
   2) CRUD الزبائن
   3) CRUD السيارات + ربطها بالزبون
   4) أوامر العمل Work Orders
   5) فواتير احترافية (طباعة) + ترقيم تلقائي
   6) تقارير كاملة + Charts (Canvas)
   7) بحث + فلاتر + حالات (مدفوع/غير مدفوع)
   8) نسخ احتياطي Export/Import JSON
   9) وضع محلي Local fallback + Sync عند الاتصال
*/

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
const escapeHtml = (s="") => String(s)
  .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
  .replaceAll('"',"&quot;").replaceAll("'","&#039;");

const fmtIQD = new Intl.NumberFormat("ar-IQ", { style:"currency", currency:"IQD", maximumFractionDigits:0 });
const fmtNum = new Intl.NumberFormat("ar-IQ");
const fmtDate = (ts) => {
  try{
    const d = (typeof ts === "number") ? new Date(ts) : (ts?.toMillis ? new Date(ts.toMillis()) : new Date(ts));
    return d.toLocaleString("ar-IQ", { year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" });
  }catch{ return "—"; }
};
const ymd = (d) => {
  const x = new Date(d);
  const m = String(x.getMonth()+1).padStart(2,"0");
  const dd = String(x.getDate()).padStart(2,"0");
  return `${x.getFullYear()}-${m}-${dd}`;
};
const startOfDay = (d) => {
  const x = new Date(d); x.setHours(0,0,0,0); return x.getTime();
};
const endOfDay = (d) => {
  const x = new Date(d); x.setHours(23,59,59,999); return x.getTime();
};

const toast = (msg, type="") => {
  const root = $("#toastRoot");
  const el = document.createElement("div");
  el.className = `toast ${type}`.trim();
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(()=> el.remove(), 3200);
};

const modal = {
  open({title, bodyHtml, footerHtml, onMount}){
    const root = $("#modalRoot");
    root.innerHTML = `
      <div class="modalOverlay" id="modalOverlay">
        <div class="modal" role="dialog" aria-modal="true">
          <div class="modalHeader">
            <div class="modalTitle">${escapeHtml(title || "")}</div>
            <button class="iconBtn modalClose" id="modalClose" title="إغلاق">✕</button>
          </div>
          <div class="modalBody" id="modalBody">${bodyHtml || ""}</div>
          <div class="modalFooter">${footerHtml || ""}</div>
        </div>
      </div>
    `;
    $("#modalClose").addEventListener("click", modal.close);
    $("#modalOverlay").addEventListener("click", (e)=>{ if(e.target.id==="modalOverlay") modal.close(); });
    if(onMount) onMount();
  },
  close(){ $("#modalRoot").innerHTML = ""; }
};

// ------------------ Local DB (fallback) ------------------
const LOCAL_KEY = "rpm_local_db_v1";
const loadLocalDB = () => {
  try{
    const raw = localStorage.getItem(LOCAL_KEY);
    if(!raw) return {
      customers:{}, cars:{}, workOrders:{}, invoices:{}, services:{},
      settings:{ company:{}, invoice:{}, ui:{} },
      meta:{ counters:{ invoiceNo: 1000 } }
    };
    return JSON.parse(raw);
  }catch{
    return {
      customers:{}, cars:{}, workOrders:{}, invoices:{}, services:{},
      settings:{ company:{}, invoice:{}, ui:{} },
      meta:{ counters:{ invoiceNo: 1000 } }
    };
  }
};
const saveLocalDB = () => localStorage.setItem(LOCAL_KEY, JSON.stringify(state.localDB));

const toArray = (obj={}) => Object.entries(obj).map(([id, data]) => ({ id, ...data }));

// ------------------ Firebase Config Wizard ------------------
const CFG_KEY = "rpm_firebase_config_v1";

/* إعدادات Firebase المعروفة من مشروعج (rpm574)
   إذا ناقص apiKey / messagingSenderId: عبّيهم من Firebase console مرة وحدة داخل الإعدادات.
*/
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyC0p4cqNHuqZs9_gNuKLl7nEY0MqRXbf_A",
  authDomain: "rpm574.firebaseapp.com",
  databaseURL: "https://rpm574-default-rtdb.firebaseio.com",
  projectId: "rpm574",
  storageBucket: "rpm574.firebasestorage.app",
  messagingSenderId: "150918603525",
  appId: "1:150918603525:web:fe1d0fbe5c4505936c4d6c"
};


const loadFirebaseConfig = () => {
  try{
    const raw = localStorage.getItem(CFG_KEY);
    if(!raw) return { ...DEFAULT_FIREBASE_CONFIG };
    const obj = JSON.parse(raw);
    return { ...DEFAULT_FIREBASE_CONFIG, ...obj };
  }catch{
    return { ...DEFAULT_FIREBASE_CONFIG };
  }
};
const saveFirebaseConfig = (cfg) => localStorage.setItem(CFG_KEY, JSON.stringify(cfg));

// ------------------ App State ------------------
const state = {
  firebase: {
    ready:false,
    err:"",
    cfg: loadFirebaseConfig(),
    app:null,
    db:null,
    auth:null,
    user:null,
    api: null, // firebase module methods
    sdkVer: "12.9.0",
  },
  mode: "local", // local | firebase
  localDB: loadLocalDB(),
  data: {
    customers: [],
    cars: [],
    workOrders: [],
    invoices: [],
    services: [],
    settings: null
  },
  ui:{
    sidebarOpen:false,
    lastSyncAt:0
  }
};

const setNetPill = (kind, text) => {
  const el = $("#netPill");
  el.className = `pill ${kind}`.trim();
  el.textContent = text;
};

// ------------------ Firebase Init (Realtime Database) ------------------
async function initFirebase(){
  const cfg = state.firebase.cfg;

  // حد أدنى: لازم projectId + databaseURL + (غالبًا) apiKey
  const missing = [];
  if(!cfg.projectId) missing.push("projectId");
  if(!cfg.databaseURL) missing.push("databaseURL");
  if(!cfg.apiKey) missing.push("apiKey");
  if(missing.length){
    state.firebase.ready = false;
    state.firebase.err = `ناقص: ${missing.join(", ")}`;
    state.mode = "local";
    setNetPill("warn", "📦 وضع محلي — Firebase غير جاهز");
    return;
  }

  try{
    setNetPill("", "⏳ جاري ربط Firebase...");
    const v = state.firebase.sdkVer;

    // حسب توثيق Firebase CDN (ES Modules)
    const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-app.js`);
    const {
      getDatabase, ref, onValue, push, set, update, remove, runTransaction, get, child
    } = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-database.js`);
    const {
      getAuth, onAuthStateChanged, signInAnonymously, GoogleAuthProvider, signInWithPopup, signOut
    } = await import(`https://www.gstatic.com/firebasejs/${v}/firebase-auth.js`);

    const app = initializeApp(cfg);
    const db = getDatabase(app);
    const auth = getAuth(app);

    state.firebase.app = app;
    state.firebase.db = db;
    state.firebase.auth = auth;

    state.firebase.api = {
      ref, onValue, push, set, update, remove, runTransaction, get, child,
      onAuthStateChanged, signInAnonymously, GoogleAuthProvider, signInWithPopup, signOut
    };

    state.firebase.ready = true;
    state.mode = "firebase";

    // Auth (اختياري)
    onAuthStateChanged(auth, (u)=>{
      state.firebase.user = u || null;
      renderTopUserBadge();
    });

    // Auto sign-in anonymous (حتى ما تتعطل القراءة/الكتابة إذا كانت القواعد تتطلب auth)
    try{ await signInAnonymously(auth); }catch{}

    // Subscriptions
    subscribeAll();

    setNetPill("good", "✅ Firebase متصل");
    toast("تم ربط Firebase بنجاح", "good");
  }catch(err){
    state.firebase.ready = false;
    state.firebase.err = String(err?.message || err);
    state.mode = "local";
    setNetPill("bad", "⚠️ فشل ربط Firebase — وضع محلي");
    toast("فشل ربط Firebase (تحققي من apiKey / القواعد / Database)", "bad");
  }
}

function subscribeAll(){
  const { ref, onValue } = state.firebase.api;
  const db = state.firebase.db;

  const sub = (path, cb) => onValue(ref(db, path), (snap)=>{
    cb(snap.exists() ? snap.val() : {});
  });

  sub("customers", (v)=> { state.data.customers = toArray(v).sort((a,b)=> (b.createdAt||0)-(a.createdAt||0)); safeMirrorLocal("customers", v); renderRoute(); });
  sub("cars", (v)=> { state.data.cars = toArray(v).sort((a,b)=> (b.createdAt||0)-(a.createdAt||0)); safeMirrorLocal("cars", v); renderRoute(); });
  sub("workOrders", (v)=> { state.data.workOrders = toArray(v).sort((a,b)=> (b.createdAt||0)-(a.createdAt||0)); safeMirrorLocal("workOrders", v); renderRoute(); });
  sub("invoices", (v)=> { state.data.invoices = toArray(v).sort((a,b)=> (b.createdAt||0)-(a.createdAt||0)); safeMirrorLocal("invoices", v); renderRoute(); });
  sub("services", (v)=> { state.data.services = toArray(v).sort((a,b)=> (a.name||"").localeCompare(b.name||"")); safeMirrorLocal("services", v); renderRoute(); });
  sub("settings", (v)=> { state.data.settings = v; safeMirrorLocal("settings", v, true); renderRoute(); });

  // init from local if empty
  hydrateFromLocal();
}

function safeMirrorLocal(key, value, direct=false){
  // نحافظ نسخة محلية كنسخ احتياطي
  if(direct){
    state.localDB[key] = value;
  }else{
    state.localDB[key] = value || {};
  }
  saveLocalDB();
  state.ui.lastSyncAt = Date.now();
}

function hydrateFromLocal(){
  // إذا Firebase بعده ما جاب بيانات، نعرض المحلي
  if(!state.data.settings) state.data.settings = state.localDB.settings || { company:{}, invoice:{}, ui:{} };
  if(!state.data.customers.length) state.data.customers = toArray(state.localDB.customers).sort((a,b)=> (b.createdAt||0)-(a.createdAt||0));
  if(!state.data.cars.length) state.data.cars = toArray(state.localDB.cars).sort((a,b)=> (b.createdAt||0)-(a.createdAt||0));
  if(!state.data.workOrders.length) state.data.workOrders = toArray(state.localDB.workOrders).sort((a,b)=> (b.createdAt||0)-(a.createdAt||0));
  if(!state.data.invoices.length) state.data.invoices = toArray(state.localDB.invoices).sort((a,b)=> (b.createdAt||0)-(a.createdAt||0));
  if(!state.data.services.length) state.data.services = toArray(state.localDB.services).sort((a,b)=> (a.name||"").localeCompare(b.name||""));
}

// ------------------ Data Layer (firebase/local) ------------------
const genId = () => Math.random().toString(16).slice(2) + Date.now().toString(16);

async function dbSet(path, obj){
  if(state.mode === "firebase" && state.firebase.ready){
    const { ref, set } = state.firebase.api;
    await set(ref(state.firebase.db, path), obj);
  }else{
    // local
    const [root, id] = path.split("/");
    if(id){
      state.localDB[root] = state.localDB[root] || {};
      state.localDB[root][id] = obj;
    }else{
      state.localDB[root] = obj;
    }
    saveLocalDB();
  }
}
async function dbUpdate(path, patch){
  if(state.mode === "firebase" && state.firebase.ready){
    const { ref, update } = state.firebase.api;
    await update(ref(state.firebase.db, path), patch);
  }else{
    const [root, id] = path.split("/");
    state.localDB[root] = state.localDB[root] || {};
    state.localDB[root][id] = { ...(state.localDB[root][id]||{}), ...patch };
    saveLocalDB();
  }
}
async function dbRemove(path){
  if(state.mode === "firebase" && state.firebase.ready){
    const { ref, remove } = state.firebase.api;
    await remove(ref(state.firebase.db, path));
  }else{
    const [root, id] = path.split("/");
    if(state.localDB[root]) delete state.localDB[root][id];
    saveLocalDB();
  }
}
async function dbNextInvoiceNo(){
  if(state.mode === "firebase" && state.firebase.ready){
    const { ref, runTransaction } = state.firebase.api;
    const r = ref(state.firebase.db, "meta/counters/invoiceNo");
    const res = await runTransaction(r, (cur) => (cur || 1000) + 1);
    return res.snapshot.val();
  }else{
    state.localDB.meta = state.localDB.meta || { counters:{ invoiceNo:1000 } };
    state.localDB.meta.counters.invoiceNo = (state.localDB.meta.counters.invoiceNo || 1000) + 1;
    saveLocalDB();
    return state.localDB.meta.counters.invoiceNo;
  }
}

// ------------------ Settings helpers ------------------
function getSettings(){
  const s = state.data.settings || state.localDB.settings || { company:{}, invoice:{}, ui:{} };
  s.company = s.company || {};
  s.invoice = s.invoice || {};
  s.ui = s.ui || {};

  // Defaults
  if(!s.company.name) s.company.name = "RPM — حسن الوليم";
  if(!s.company.phone) s.company.phone = "";
  if(!s.company.address) s.company.address = "العراق";
  if(!s.invoice.prefix) s.invoice.prefix = "RPM";
  if(!s.invoice.taxRate && s.invoice.taxRate !== 0) s.invoice.taxRate = 0; // %
  if(!s.invoice.footerNote) s.invoice.footerNote = "شكراً لثقتكم — نلتزم بأفضل خدمة.";
  if(!s.ui.currency) s.ui.currency = "IQD";

  return s;
}
async function saveSettings(newSettings){
  await dbSet("settings", newSettings);
  toast("تم حفظ الإعدادات", "good");
}

// ------------------ UI Shell ------------------
function setTitle(title, subtitle=""){
  $("#pageTitle").textContent = title;
  $("#pageSubtitle").textContent = subtitle || "—";
}

function bindNav(){
  $$(".navItem").forEach(b=>{
    b.addEventListener("click", ()=> { location.hash = b.dataset.route; });
  });
  $$(".mobileNav button").forEach(b=>{
    b.addEventListener("click", ()=> { location.hash = b.dataset.route; });
  });

  $("#btnToggleSidebar").addEventListener("click", ()=>{
    state.ui.sidebarOpen = !state.ui.sidebarOpen;
    $("#sidebar").classList.toggle("open", state.ui.sidebarOpen);
  });

  $("#btnSync").addEventListener("click", ()=>{
    hydrateFromLocal();
    renderRoute();
    toast("تم التحديث", "good");
  });

  $("#btnQuickAdd").addEventListener("click", quickAddMenu);
  $("#btnUser").addEventListener("click", userMenu);

  window.addEventListener("click", (e)=>{
    // close sidebar on mobile when click outside
    if(window.innerWidth <= 960){
      const sb = $("#sidebar");
      const btn = $("#btnToggleSidebar");
      if(state.ui.sidebarOpen && !sb.contains(e.target) && e.target !== btn){
        state.ui.sidebarOpen = false;
        sb.classList.remove("open");
      }
    }
  });
}

function markActiveNav(route){
  $$(".navItem").forEach(b=> b.classList.toggle("active", b.dataset.route === route));
  $$(".mobileNav button").forEach(b=> b.classList.toggle("active", b.dataset.route === route));
}

function renderTopUserBadge(){
  // مجرد Toast خفيف إذا صار login
  const u = state.firebase.user;
  if(!state.firebase.ready) return;
  if(u?.isAnonymous) return;
  if(u?.email) $("#buildInfo").textContent = `مرحباً: ${u.email}`;
}

// ------------------ Pages ------------------
const routes = {
  "#/dashboard": renderDashboard,
  "#/customers": renderCustomers,
  "#/cars": renderCars,
  "#/workorders": renderWorkOrders,
  "#/invoices": renderInvoices,
  "#/reports": renderReports,
  "#/settings": renderSettings
};

function renderRoute(){
  const hash = location.hash || "#/dashboard";
  const fn = routes[hash] || routes["#/dashboard"];
  markActiveNav(hash);
  fn();
}

// Dashboard
function renderDashboard(){
  const s = getSettings();

  const inv = state.data.invoices || [];
  const wo = state.data.workOrders || [];

  const totalPaid = inv.filter(x=> x.status==="paid").reduce((a,b)=> a + (b.total||0), 0);
  const totalUnpaid = inv.filter(x=> x.status!=="paid").reduce((a,b)=> a + (b.total||0), 0);
  const cntInv = inv.length;
  const cntWO = wo.length;

  const recentInv = inv.slice(0,7);

  setTitle("لوحة التحكم", state.mode === "firebase" ? "متصل بـ Firebase" : "وضع محلي (Fallback)");

  $("#view").innerHTML = `
    <div class="grid kpis">
      <div class="card kpi">
        <div class="h">إيراد (مدفوع)</div>
        <div class="v">${escapeHtml(fmtIQD.format(totalPaid))}</div>
        <div class="s">عدد الفواتير: ${escapeHtml(fmtNum.format(cntInv))}</div>
      </div>
      <div class="card kpi">
        <div class="h">مستحقات (غير مدفوعة)</div>
        <div class="v">${escapeHtml(fmtIQD.format(totalUnpaid))}</div>
        <div class="s">تابعي التحصيل من صفحة الفواتير</div>
      </div>
      <div class="card kpi">
        <div class="h">أوامر عمل</div>
        <div class="v">${escapeHtml(fmtNum.format(cntWO))}</div>
        <div class="s">قيد الإنجاز + مكتملة</div>
      </div>
      <div class="card kpi">
        <div class="h">الورشة</div>
        <div class="v">${escapeHtml(s.company.name || "RPM")}</div>
        <div class="s">آخر مزامنة: ${state.ui.lastSyncAt ? fmtDate(state.ui.lastSyncAt) : "—"}</div>
      </div>
    </div>

    <div class="grid" style="margin-top:12px; grid-template-columns: 1.2fr .8fr;">
      <div class="card pad">
        <div class="row" style="justify-content:space-between; align-items:center">
          <div>
            <div style="font-weight:900">آخر الفواتير</div>
            <div class="muted small">طباعة فاتورة احترافية بنقرة واحدة</div>
          </div>
          <div class="row">
            <button class="btn" id="goInvoices">فتح الفواتير</button>
            <button class="btn" id="newInvoice">+ فاتورة جديدة</button>
          </div>
        </div>
        <hr class="sep"/>
        ${recentInv.length ? `
        <table class="table">
          <thead>
            <tr><th>رقم</th><th>الزبون</th><th>المبلغ</th><th>الحالة</th><th>تاريخ</th><th></th></tr>
          </thead>
          <tbody>
            ${recentInv.map(x=>`
              <tr>
                <td>${escapeHtml(x.invoiceNo||"—")}</td>
                <td>${escapeHtml(x.customerName||"—")}</td>
                <td>${escapeHtml(fmtIQD.format(x.total||0))}</td>
                <td>${statusTag(x.status)}</td>
                <td>${escapeHtml(fmtDate(x.createdAt||Date.now()))}</td>
                <td><button class="iconBtn" data-print="${x.id}" title="طباعة">🖨️</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>` : `<div class="empty">لا توجد فواتير بعد. اضغطي “فاتورة جديدة”.</div>`}
      </div>

      <div class="card pad">
        <div style="font-weight:900">إجراءات سريعة</div>
        <div class="muted small">تنظيم أسرع للشغل اليومي</div>
        <hr class="sep"/>
        <div class="grid" style="grid-template-columns:1fr; gap:10px">
          <button class="btn" id="qaCustomer">+ إضافة زبون</button>
          <button class="btn" id="qaCar">+ إضافة سيارة</button>
          <button class="btn" id="qaWO">+ أمر عمل</button>
          <button class="btn" id="qaReport">فتح التقارير</button>
        </div>
        <hr class="sep"/>
        <div class="muted small">
          إذا Firebase مو مضبوط، روحي <b>الإعدادات</b> وخلي apiKey و messagingSenderId.
        </div>
      </div>
    </div>
  `;

  $("#goInvoices").onclick = ()=> location.hash="#/invoices";
  $("#newInvoice").onclick = ()=> openInvoiceEditor();
  $("#qaCustomer").onclick = ()=> openCustomerEditor();
  $("#qaCar").onclick = ()=> openCarEditor();
  $("#qaWO").onclick = ()=> openWorkOrderEditor();
  $("#qaReport").onclick = ()=> location.hash="#/reports";

  $$("[data-print]").forEach(b=> b.addEventListener("click", ()=>{
    const id = b.dataset.print;
    const inv = state.data.invoices.find(x=> x.id===id);
    if(inv) printInvoice(inv);
  }));
}

function statusTag(status){
  const s = status || "draft";
  if(s==="paid") return `<span class="tag good">مدفوعة</span>`;
  if(s==="unpaid") return `<span class="tag warn">غير مدفوعة</span>`;
  if(s==="cancelled") return `<span class="tag bad">ملغاة</span>`;
  return `<span class="tag">مسودة</span>`;
}

// Customers
function renderCustomers(){
  setTitle("الزبائن", "إضافة/تعديل/بحث");

  const q = (new URLSearchParams(location.hash.split("?")[1]||"")).get("q") || "";
  const list = (state.data.customers || []).filter(c=>{
    const x = `${c.name||""} ${c.phone||""}`.toLowerCase();
    return x.includes(q.toLowerCase());
  });

  $("#view").innerHTML = `
    <div class="card pad">
      <div class="row" style="justify-content:space-between; align-items:center">
        <div>
          <div style="font-weight:900">إدارة الزبائن</div>
          <div class="muted small">كل زبون مرتبط بسياراته وفواتيره</div>
        </div>
        <div class="row">
          <input class="input" id="custSearch" placeholder="بحث بالاسم أو الهاتف..." style="width:min(360px, 60vw)" value="${escapeHtml(q)}"/>
          <button class="btn" id="btnAdd">+ زبون</button>
        </div>
      </div>
      <hr class="sep"/>
      ${list.length ? `
        <table class="table">
          <thead><tr><th>الاسم</th><th>الهاتف</th><th>ملاحظات</th><th>تاريخ الإضافة</th><th></th></tr></thead>
          <tbody>
            ${list.map(c=>`
              <tr>
                <td>${escapeHtml(c.name||"—")}</td>
                <td>${escapeHtml(c.phone||"—")}</td>
                <td>${escapeHtml(c.note||"")}</td>
                <td>${escapeHtml(fmtDate(c.createdAt||Date.now()))}</td>
                <td>
                  <button class="iconBtn" data-edit="${c.id}" title="تعديل">✏️</button>
                  <button class="iconBtn" data-del="${c.id}" title="حذف">🗑️</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `<div class="empty">ماكو زبائن بعد. اضغطي “+ زبون”.</div>`}
    </div>
  `;

  $("#custSearch").addEventListener("input", (e)=>{
    const val = e.target.value.trim();
    location.hash = `#/customers?q=${encodeURIComponent(val)}`;
  });
  $("#btnAdd").onclick = ()=> openCustomerEditor();

  $$("[data-edit]").forEach(b=> b.addEventListener("click", ()=>{
    const c = state.data.customers.find(x=> x.id===b.dataset.edit);
    openCustomerEditor(c);
  }));
  $$("[data-del]").forEach(b=> b.addEventListener("click", async ()=>{
    const id = b.dataset.del;
    if(!confirm("حذف الزبون؟")) return;
    await dbRemove(`customers/${id}`);
    toast("تم الحذف", "warn");
  }));
}

function openCustomerEditor(cust=null){
  const isEdit = !!cust;
  modal.open({
    title: isEdit ? "تعديل زبون" : "إضافة زبون",
    bodyHtml: `
      <div class="formGrid">
        <div>
          <label>اسم الزبون</label>
          <input class="input" id="cName" value="${escapeHtml(cust?.name||"")}" />
        </div>
        <div>
          <label>الهاتف</label>
          <input class="input" id="cPhone" value="${escapeHtml(cust?.phone||"")}" />
        </div>
      </div>
      <div style="margin-top:10px">
        <label>ملاحظات</label>
        <textarea class="input" id="cNote" rows="3">${escapeHtml(cust?.note||"")}</textarea>
      </div>
    `,
    footerHtml: `
      <button class="iconBtn" id="mCancel">إلغاء</button>
      <button class="btn" id="mSave">حفظ</button>
    `,
    onMount(){
      $("#mCancel").onclick = modal.close;
      $("#mSave").onclick = async ()=>{
        const obj = {
          name: $("#cName").value.trim(),
          phone: $("#cPhone").value.trim(),
          note: $("#cNote").value.trim(),
          updatedAt: Date.now()
        };
        if(!obj.name){ toast("اسم الزبون مطلوب", "bad"); return; }

        if(isEdit){
          await dbUpdate(`customers/${cust.id}`, obj);
        }else{
          const id = genId();
          await dbSet(`customers/${id}`, { ...obj, createdAt: Date.now() });
        }
        modal.close();
        toast("تم الحفظ", "good");
      };
    }
  });
}

// Cars
function renderCars(){
  setTitle("السيارات", "ربط سيارة بالزبون + لوحة + موديل");
  const customers = state.data.customers || [];
  const cars = state.data.cars || [];

  $("#view").innerHTML = `
    <div class="card pad">
      <div class="row" style="justify-content:space-between; align-items:center">
        <div>
          <div style="font-weight:900">إدارة السيارات</div>
          <div class="muted small">السيارة مرتبطة بالزبون وتظهر بالفواتير/أوامر العمل</div>
        </div>
        <div class="row">
          <button class="btn" id="btnAddCar">+ سيارة</button>
        </div>
      </div>
      <hr class="sep"/>
      ${cars.length ? `
        <table class="table">
          <thead><tr><th>اللوحة</th><th>الموديل</th><th>الزبون</th><th>ملاحظات</th><th></th></tr></thead>
          <tbody>
            ${cars.map(car=>{
              const c = customers.find(x=> x.id===car.customerId);
              return `
                <tr>
                  <td><b>${escapeHtml(car.plate||"—")}</b></td>
                  <td>${escapeHtml(car.model||"—")}</td>
                  <td>${escapeHtml(c?.name || car.customerName || "—")}</td>
                  <td>${escapeHtml(car.note||"")}</td>
                  <td>
                    <button class="iconBtn" data-edit="${car.id}" title="تعديل">✏️</button>
                    <button class="iconBtn" data-del="${car.id}" title="حذف">🗑️</button>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      ` : `<div class="empty">ماكو سيارات بعد. اضغطي “+ سيارة”.</div>`}
    </div>
  `;

  $("#btnAddCar").onclick = ()=> openCarEditor();

  $$("[data-edit]").forEach(b=> b.addEventListener("click", ()=>{
    const car = state.data.cars.find(x=> x.id===b.dataset.edit);
    openCarEditor(car);
  }));
  $$("[data-del]").forEach(b=> b.addEventListener("click", async ()=>{
    const id = b.dataset.del;
    if(!confirm("حذف السيارة؟")) return;
    await dbRemove(`cars/${id}`);
    toast("تم الحذف", "warn");
  }));
}

function openCarEditor(car=null){
  const isEdit = !!car;
  const customers = state.data.customers || [];

  modal.open({
    title: isEdit ? "تعديل سيارة" : "إضافة سيارة",
    bodyHtml: `
      <div class="formGrid">
        <div>
          <label>لوحة السيارة</label>
          <input class="input" id="vPlate" value="${escapeHtml(car?.plate||"")}" placeholder="مثال: بغداد 12345"/>
        </div>
        <div>
          <label>موديل/نوع السيارة</label>
          <input class="input" id="vModel" value="${escapeHtml(car?.model||"")}" placeholder="مثال: Camry 2020"/>
        </div>
      </div>
      <div class="formGrid" style="margin-top:10px">
        <div>
          <label>الزبون</label>
          <select id="vCustomer" class="input">
            <option value="">— اختاري زبون —</option>
            ${customers.map(c=>`
              <option value="${escapeHtml(c.id)}" ${car?.customerId===c.id ? "selected":""}>${escapeHtml(c.name)} — ${escapeHtml(c.phone||"")}</option>
            `).join("")}
          </select>
        </div>
        <div>
          <label>ملاحظات</label>
          <input class="input" id="vNote" value="${escapeHtml(car?.note||"")}" />
        </div>
      </div>
    `,
    footerHtml: `
      <button class="iconBtn" id="mCancel">إلغاء</button>
      <button class="btn" id="mSave">حفظ</button>
    `,
    onMount(){
      $("#mCancel").onclick = modal.close;
      $("#mSave").onclick = async ()=>{
        const customerId = $("#vCustomer").value;
        const customer = customers.find(x=> x.id===customerId);

        const obj = {
          plate: $("#vPlate").value.trim(),
          model: $("#vModel").value.trim(),
          customerId: customerId || "",
          customerName: customer?.name || "",
          note: $("#vNote").value.trim(),
          updatedAt: Date.now()
        };
        if(!obj.plate){ toast("لوحة السيارة مطلوبة", "bad"); return; }

        if(isEdit){
          await dbUpdate(`cars/${car.id}`, obj);
        }else{
          const id = genId();
          await dbSet(`cars/${id}`, { ...obj, createdAt: Date.now() });
        }
        modal.close();
        toast("تم الحفظ", "good");
      };
    }
  });
}

// Work Orders
function renderWorkOrders(){
  setTitle("أوامر العمل", "تتبع الشغل قبل الفاتورة أو معها");

  const list = state.data.workOrders || [];
  $("#view").innerHTML = `
    <div class="card pad">
      <div class="row" style="justify-content:space-between; align-items:center">
        <div>
          <div style="font-weight:900">أوامر العمل</div>
          <div class="muted small">سجل أعمال الصيانة قبل إصدار الفاتورة</div>
        </div>
        <div class="row">
          <button class="btn" id="btnAddWO">+ أمر عمل</button>
        </div>
      </div>
      <hr class="sep"/>
      ${list.length ? `
        <table class="table">
          <thead><tr><th>رقم</th><th>الزبون</th><th>السيارة</th><th>الحالة</th><th>تاريخ</th><th></th></tr></thead>
          <tbody>
            ${list.map(x=>`
              <tr>
                <td>${escapeHtml(x.no||"—")}</td>
                <td>${escapeHtml(x.customerName||"—")}</td>
                <td>${escapeHtml(`${x.carPlate||""} ${x.carModel||""}`.trim() || "—")}</td>
                <td>${woTag(x.status)}</td>
                <td>${escapeHtml(fmtDate(x.createdAt||Date.now()))}</td>
                <td>
                  <button class="iconBtn" data-edit="${x.id}">✏️</button>
                  <button class="iconBtn" data-del="${x.id}">🗑️</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `<div class="empty">ماكو أوامر عمل. اضغطي “+ أمر عمل”.</div>`}
    </div>
  `;

  $("#btnAddWO").onclick = ()=> openWorkOrderEditor();

  $$("[data-edit]").forEach(b=> b.addEventListener("click", ()=>{
    const wo = state.data.workOrders.find(x=> x.id===b.dataset.edit);
    openWorkOrderEditor(wo);
  }));
  $$("[data-del]").forEach(b=> b.addEventListener("click", async ()=>{
    const id = b.dataset.del;
    if(!confirm("حذف أمر العمل؟")) return;
    await dbRemove(`workOrders/${id}`);
    toast("تم الحذف", "warn");
  }));
}

function woTag(status){
  const s = status || "open";
  if(s==="done") return `<span class="tag good">مكتمل</span>`;
  if(s==="cancelled") return `<span class="tag bad">ملغي</span>`;
  return `<span class="tag warn">قيد العمل</span>`;
}

function openWorkOrderEditor(wo=null){
  const isEdit = !!wo;
  const customers = state.data.customers || [];
  const cars = state.data.cars || [];

  modal.open({
    title: isEdit ? "تعديل أمر عمل" : "أمر عمل جديد",
    bodyHtml: `
      <div class="formGrid">
        <div>
          <label>الزبون</label>
          <select id="woCustomer" class="input">
            <option value="">— اختاري —</option>
            ${customers.map(c=>`<option value="${escapeHtml(c.id)}" ${wo?.customerId===c.id?"selected":""}>${escapeHtml(c.name)} — ${escapeHtml(c.phone||"")}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>السيارة</label>
          <select id="woCar" class="input">
            <option value="">— اختاري —</option>
            ${cars.map(v=>`<option value="${escapeHtml(v.id)}" ${wo?.carId===v.id?"selected":""}>${escapeHtml(v.plate||"")} — ${escapeHtml(v.model||"")}</option>`).join("")}
          </select>
        </div>
      </div>
      <div style="margin-top:10px">
        <label>الأعمال المطلوبة</label>
        <textarea class="input" id="woDesc" rows="5" placeholder="مثال: تبديل دهن + فلتر">${escapeHtml(wo?.desc||"")}</textarea>
      </div>
      <div class="formGrid" style="margin-top:10px">
        <div>
          <label>الحالة</label>
          <select id="woStatus" class="input">
            <option value="open" ${(wo?.status||"open")==="open"?"selected":""}>قيد العمل</option>
            <option value="done" ${(wo?.status||"open")==="done"?"selected":""}>مكتمل</option>
            <option value="cancelled" ${(wo?.status||"open")==="cancelled"?"selected":""}>ملغي</option>
          </select>
        </div>
        <div>
          <label>ملاحظات</label>
          <input class="input" id="woNote" value="${escapeHtml(wo?.note||"")}" />
        </div>
      </div>
    `,
    footerHtml: `
      <button class="iconBtn" id="mCancel">إلغاء</button>
      <button class="btn" id="mSave">حفظ</button>
    `,
    onMount(){
      $("#mCancel").onclick = modal.close;
      $("#mSave").onclick = async ()=>{
        const customerId = $("#woCustomer").value;
        const carId = $("#woCar").value;
        const c = customers.find(x=> x.id===customerId);
        const v = cars.find(x=> x.id===carId);

        const obj = {
          customerId, customerName: c?.name||"",
          carId, carPlate: v?.plate||"", carModel: v?.model||"",
          desc: $("#woDesc").value.trim(),
          status: $("#woStatus").value,
          note: $("#woNote").value.trim(),
          updatedAt: Date.now()
        };
        if(!obj.customerId && !obj.customerName) { toast("اختاري زبون", "bad"); return; }

        if(isEdit){
          await dbUpdate(`workOrders/${wo.id}`, obj);
        }else{
          const id = genId();
          const no = `WO-${String(Date.now()).slice(-6)}`;
          await dbSet(`workOrders/${id}`, { ...obj, no, createdAt: Date.now() });
        }

        modal.close();
        toast("تم الحفظ", "good");
      };
    }
  });
}

// Invoices
function renderInvoices(){
  setTitle("الفواتير", "بحث + حالة + طباعة");

  const params = new URLSearchParams(location.hash.split("?")[1]||"");
  const q = (params.get("q")||"").trim().toLowerCase();
  const st = params.get("st") || "all";

  const list = (state.data.invoices || []).filter(x=>{
    const blob = `${x.invoiceNo||""} ${x.customerName||""} ${x.customerPhone||""} ${x.carPlate||""} ${x.carModel||""}`.toLowerCase();
    const okQ = !q || blob.includes(q);
    const okS = st==="all" ? true : (x.status===st);
    return okQ && okS;
  });

  $("#view").innerHTML = `
    <div class="card pad">
      <div class="row" style="justify-content:space-between; align-items:center">
        <div>
          <div style="font-weight:900">الفواتير</div>
          <div class="muted small">تصميم طباعة “راقي” + مجموع + ضريبة اختيارية</div>
        </div>
        <div class="row">
          <input class="input" id="invSearch" placeholder="بحث..." style="width:min(360px, 60vw)" value="${escapeHtml(params.get("q")||"")}" />
          <select class="input" id="invStatus" style="width:160px">
            <option value="all" ${st==="all"?"selected":""}>كل الحالات</option>
            <option value="paid" ${st==="paid"?"selected":""}>مدفوعة</option>
            <option value="unpaid" ${st==="unpaid"?"selected":""}>غير مدفوعة</option>
            <option value="draft" ${st==="draft"?"selected":""}>مسودة</option>
            <option value="cancelled" ${st==="cancelled"?"selected":""}>ملغاة</option>
          </select>
          <button class="btn" id="btnNewInv">+ فاتورة</button>
        </div>
      </div>
      <hr class="sep"/>

      ${list.length ? `
        <table class="table">
          <thead><tr><th>رقم</th><th>الزبون</th><th>السيارة</th><th>المجموع</th><th>الحالة</th><th>تاريخ</th><th></th></tr></thead>
          <tbody>
            ${list.map(x=>`
              <tr>
                <td><b>${escapeHtml(x.invoiceNo||"—")}</b></td>
                <td>${escapeHtml(x.customerName||"—")}</td>
                <td>${escapeHtml(`${x.carPlate||""} ${x.carModel||""}`.trim() || "—")}</td>
                <td>${escapeHtml(fmtIQD.format(x.total||0))}</td>
                <td>${statusTag(x.status)}</td>
                <td>${escapeHtml(fmtDate(x.createdAt||Date.now()))}</td>
                <td class="row end" style="gap:6px">
                  <button class="iconBtn" data-edit="${x.id}" title="تعديل">✏️</button>
                  <button class="iconBtn" data-print="${x.id}" title="طباعة">🖨️</button>
                  <button class="iconBtn" data-del="${x.id}" title="حذف">🗑️</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `<div class="empty">لا توجد نتائج.</div>`}
    </div>
  `;

  $("#invSearch").addEventListener("input", ()=>{
    const q2 = $("#invSearch").value.trim();
    const st2 = $("#invStatus").value;
    location.hash = `#/invoices?q=${encodeURIComponent(q2)}&st=${encodeURIComponent(st2)}`;
  });
  $("#invStatus").addEventListener("change", ()=>{
    const q2 = $("#invSearch").value.trim();
    const st2 = $("#invStatus").value;
    location.hash = `#/invoices?q=${encodeURIComponent(q2)}&st=${encodeURIComponent(st2)}`;
  });
  $("#btnNewInv").onclick = ()=> openInvoiceEditor();

  $$("[data-edit]").forEach(b=> b.addEventListener("click", ()=>{
    const inv = state.data.invoices.find(x=> x.id===b.dataset.edit);
    openInvoiceEditor(inv);
  }));
  $$("[data-print]").forEach(b=> b.addEventListener("click", ()=>{
    const inv = state.data.invoices.find(x=> x.id===b.dataset.print);
    if(inv) printInvoice(inv);
  }));
  $$("[data-del]").forEach(b=> b.addEventListener("click", async ()=>{
    const id = b.dataset.del;
    if(!confirm("حذف الفاتورة؟")) return;
    await dbRemove(`invoices/${id}`);
    toast("تم الحذف", "warn");
  }));
}

function openInvoiceEditor(inv=null){
  const isEdit = !!inv;
  const s = getSettings();
  const customers = state.data.customers || [];
  const cars = state.data.cars || [];

  const items = (inv?.items && Array.isArray(inv.items)) ? inv.items : [
    { name:"تبديل دهن", qty:1, price:0 }
  ];

  const calc = (items, taxRate)=>{
    const sub = items.reduce((a,b)=> a + (Number(b.qty||0)*Number(b.price||0)), 0);
    const tax = Math.round(sub * (Number(taxRate||0)/100));
    const total = sub + tax;
    return { sub, tax, total };
  };

  const initial = calc(items, s.invoice.taxRate);

  modal.open({
    title: isEdit ? `تعديل فاتورة ${inv.invoiceNo||""}` : "فاتورة جديدة",
    bodyHtml: `
      <div class="card pad" style="background: rgba(255,255,255,.02); border-color: rgba(255,255,255,.10)">
        <div class="formGrid">
          <div>
            <label>الزبون</label>
            <select id="iCustomer" class="input">
              <option value="">— اختاري زبون —</option>
              ${customers.map(c=>`<option value="${escapeHtml(c.id)}" ${inv?.customerId===c.id?"selected":""}>${escapeHtml(c.name)} — ${escapeHtml(c.phone||"")}</option>`).join("")}
            </select>
          </div>
          <div>
            <label>السيارة</label>
            <select id="iCar" class="input">
              <option value="">— اختاري سيارة —</option>
              ${cars.map(v=>`<option value="${escapeHtml(v.id)}" ${inv?.carId===v.id?"selected":""}>${escapeHtml(v.plate||"")} — ${escapeHtml(v.model||"")}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="formGrid" style="margin-top:10px">
          <div>
            <label>نسبة الضريبة (%)</label>
            <input id="iTax" class="input" type="number" min="0" step="0.1" value="${escapeHtml(String(inv?.taxRate ?? s.invoice.taxRate ?? 0))}" />
          </div>
          <div>
            <label>الحالة</label>
            <select id="iStatus" class="input">
              <option value="draft" ${(inv?.status||"draft")==="draft"?"selected":""}>مسودة</option>
              <option value="unpaid" ${(inv?.status||"draft")==="unpaid"?"selected":""}>غير مدفوعة</option>
              <option value="paid" ${(inv?.status||"draft")==="paid"?"selected":""}>مدفوعة</option>
              <option value="cancelled" ${(inv?.status||"draft")==="cancelled"?"selected":""}>ملغاة</option>
            </select>
          </div>
        </div>

        <hr class="sep"/>

        <div class="row" style="justify-content:space-between; align-items:center">
          <div>
            <div style="font-weight:900">بنود الخدمة</div>
            <div class="muted small">اسم الخدمة + كمية + سعر</div>
          </div>
          <button class="btn" id="addItem">+ بند</button>
        </div>

        <div style="margin-top:10px; overflow:auto">
          <table class="table" id="itemsTable">
            <thead><tr><th>الخدمة</th><th>الكمية</th><th>السعر</th><th>المجموع</th><th></th></tr></thead>
            <tbody>
              ${items.map((it, idx)=> itemRow(it, idx)).join("")}
            </tbody>
          </table>
        </div>

        <div class="row end" style="margin-top:12px">
          <div class="card pad" style="min-width:min(360px,100%); background: rgba(255,255,255,.02); border-color: rgba(255,255,255,.10)">
            <div class="row" style="justify-content:space-between"><div class="muted">الإجمالي الفرعي</div><div id="subV">${escapeHtml(fmtIQD.format(initial.sub))}</div></div>
            <div class="row" style="justify-content:space-between; margin-top:6px"><div class="muted">الضريبة</div><div id="taxV">${escapeHtml(fmtIQD.format(initial.tax))}</div></div>
            <hr class="sep"/>
            <div class="row" style="justify-content:space-between"><div style="font-weight:900">المجموع</div><div style="font-weight:900" id="totalV">${escapeHtml(fmtIQD.format(initial.total))}</div></div>
          </div>
        </div>

        <div style="margin-top:10px">
          <label>ملاحظات على الفاتورة</label>
          <textarea class="input" id="iNote" rows="3" placeholder="...">${escapeHtml(inv?.note||"")}</textarea>
        </div>
      </div>
    `,
    footerHtml: `
      <button class="iconBtn" id="mCancel">إلغاء</button>
      <button class="btn" id="mSave">حفظ</button>
      ${isEdit ? `<button class="btn" id="mPrint">طباعة</button>` : ``}
    `,
    onMount(){
      const recalcUI = ()=>{
        const taxRate = Number($("#iTax").value||0);
        const items2 = readItemsFromTable();
        const r = calc(items2, taxRate);
        $("#subV").textContent = fmtIQD.format(r.sub);
        $("#taxV").textContent = fmtIQD.format(r.tax);
        $("#totalV").textContent = fmtIQD.format(r.total);
      };

      const readItemsFromTable = ()=>{
        const rows = $$("#itemsTable tbody tr");
        return rows.map(tr=>{
          const name = tr.querySelector("[data-f=name]")?.value?.trim() || "";
          const qty = Number(tr.querySelector("[data-f=qty]")?.value || 0);
          const price = Number(tr.querySelector("[data-f=price]")?.value || 0);
          return { name, qty, price };
        }).filter(x=> x.name || x.qty || x.price);
      };

      $("#mCancel").onclick = modal.close;

      $("#addItem").onclick = ()=>{
        const tbody = $("#itemsTable tbody");
        const idx = tbody.children.length;
        const tr = document.createElement("tr");
        tr.innerHTML = itemRow({name:"", qty:1, price:0}, idx);
        tbody.appendChild(tr);
        bindRow(tbody.lastElementChild);
        recalcUI();
      };

      function bindRow(tr){
        tr.querySelectorAll("input").forEach(inp=>{
          inp.addEventListener("input", ()=>{
            // update line total preview
            const qty = Number(tr.querySelector("[data-f=qty]").value||0);
            const price = Number(tr.querySelector("[data-f=price]").value||0);
            tr.querySelector("[data-line]").textContent = fmtIQD.format(qty*price);
            recalcUI();
          });
        });
        tr.querySelector("[data-delrow]").addEventListener("click", ()=>{
          tr.remove();
          recalcUI();
        });
      }

      // bind all existing rows
      $$("#itemsTable tbody tr").forEach(bindRow);

      $("#iTax").addEventListener("input", recalcUI);

      $("#mSave").onclick = async ()=>{
        const customerId = $("#iCustomer").value;
        const carId = $("#iCar").value;
        const c = customers.find(x=> x.id===customerId);
        const v = cars.find(x=> x.id===carId);

        if(!customerId){ toast("اختاري زبون", "bad"); return; }

        const taxRate = Number($("#iTax").value||0);
        const items2 = readItemsFromTable();
        if(!items2.length){ toast("أضيفي بند واحد على الأقل", "bad"); return; }

        const r = calc(items2, taxRate);

        const base = {
          customerId,
          customerName: c?.name || "",
          customerPhone: c?.phone || "",
          carId: carId || "",
          carPlate: v?.plate || "",
          carModel: v?.model || "",
          items: items2,
          subTotal: r.sub,
          taxRate,
          tax: r.tax,
          total: r.total,
          status: $("#iStatus").value,
          note: $("#iNote").value.trim(),
          updatedAt: Date.now()
        };

        if(isEdit){
          await dbUpdate(`invoices/${inv.id}`, base);
          toast("تم تحديث الفاتورة", "good");
          modal.close();
          return;
        }

        const nextNo = await dbNextInvoiceNo();
        const invoiceNo = `${s.invoice.prefix || "RPM"}-${nextNo}`;

        const id = genId();
        await dbSet(`invoices/${id}`, { ...base, invoiceNo, createdAt: Date.now() });

        toast("تم إنشاء الفاتورة", "good");
        modal.close();
      };

      if(isEdit){
        $("#mPrint").onclick = ()=>{
          const updated = state.data.invoices.find(x=> x.id===inv.id) || inv;
          printInvoice(updated);
        };
      }
    }
  });

  function itemRow(it, idx){
    const line = (Number(it.qty||0)*Number(it.price||0));
    return `
      <tr>
        <td><input class="input" data-f="name" value="${escapeHtml(it.name||"")}" placeholder="مثال: فلتر دهن"/></td>
        <td style="width:120px"><input class="input" data-f="qty" type="number" min="0" step="1" value="${escapeHtml(String(it.qty ?? 1))}"/></td>
        <td style="width:160px"><input class="input" data-f="price" type="number" min="0" step="250" value="${escapeHtml(String(it.price ?? 0))}"/></td>
        <td style="width:180px"><span data-line>${escapeHtml(fmtIQD.format(line))}</span></td>
        <td style="width:60px"><button class="iconBtn" data-delrow title="حذف">🗑️</button></td>
      </tr>
    `;
  }
}

// Print Invoice (تصميم أرقى)
function printInvoice(inv){
  const s = getSettings();
  const company = s.company || {};
  const invoice = s.invoice || {};
  const now = new Date();

  const sub = inv.subTotal || inv.subTotal===0 ? inv.subTotal : (inv.items||[]).reduce((a,b)=>a+(Number(b.qty||0)*Number(b.price||0)),0);
  const tax = inv.tax || 0;
  const total = inv.total || (sub + tax);

  const safe = (x)=> escapeHtml(x||"—");

  const html = `
<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${safe(inv.invoiceNo)} — فاتورة</title>
  <style>
    *{box-sizing:border-box}
    body{font-family: ui-sans-serif, system-ui, Tahoma, Arial; margin:0; background:#f6f7fb; color:#111}
    .page{padding:22px}
    .paper{
      background:#fff; border:1px solid #e7e8ef; border-radius:16px; overflow:hidden;
      box-shadow: 0 20px 70px rgba(0,0,0,.08);
    }
    .hdr{
      padding:18px 18px 14px;
      background: linear-gradient(135deg, #0b1220, #1b2b55);
      color:#fff;
      display:flex; gap:14px; align-items:flex-start; justify-content:space-between;
    }
    .brand{display:flex; gap:12px; align-items:center}
    .mark{
      width:44px; height:44px; border-radius:14px;
      background: radial-gradient(circle at 30% 30%, #fff, #6aa7ff);
      box-shadow: 0 0 24px rgba(106,167,255,.45);
    }
    .brand h1{margin:0; font-size:18px; letter-spacing:.3px}
    .brand .sub{opacity:.85; font-size:12px; margin-top:3px}
    .meta{ text-align:left; font-size:12px; opacity:.95 }
    .meta b{font-size:14px}
    .body{padding:16px 18px}
    .grid{display:grid; gap:12px; grid-template-columns: 1fr 1fr}
    .box{
      border:1px solid #e7e8ef; border-radius:14px; padding:12px;
      background: linear-gradient(180deg, #fff, #fbfbfe);
    }
    .box h3{margin:0 0 8px; font-size:12px; color:#4a5a7a}
    .box .row{display:flex; justify-content:space-between; gap:10px; font-size:13px; margin:4px 0}
    table{width:100%; border-collapse:collapse; margin-top:12px; overflow:hidden; border-radius:14px; border:1px solid #e7e8ef}
    th,td{padding:10px 10px; border-bottom:1px solid #eef0f6; text-align:right; font-size:13px}
    th{background:#f4f6fb; color:#4a5a7a; font-weight:700}
    .totals{margin-top:12px; display:flex; justify-content:flex-end}
    .sum{
      width: min(360px, 100%);
      border:1px solid #e7e8ef; border-radius:14px; padding:12px; background:#fbfbfe;
    }
    .sum .r{display:flex; justify-content:space-between; margin:6px 0; font-size:13px}
    .sum .r strong{font-size:14px}
    .foot{
      padding:12px 18px 18px;
      display:flex; justify-content:space-between; gap:12px; align-items:flex-end;
      color:#4a5a7a; font-size:12px;
    }
    .tag{
      display:inline-block; padding:6px 10px; border-radius:999px; font-size:12px;
      border:1px solid #e7e8ef; background:#f4f6fb;
    }
    .tag.paid{background:#e9fbf1; border-color:#bff0d3; color:#0e7a3f}
    .tag.unpaid{background:#fff7e6; border-color:#ffe0a8; color:#915b00}
    .tag.draft{background:#eef1f8; border-color:#dde2f3}
    .note{margin-top:10px; padding:10px 12px; border-radius:14px; border:1px dashed #d9ddee; background:#fbfbfe}
    @page{margin:12mm}
    @media print{
      body{background:#fff}
      .page{padding:0}
      .paper{box-shadow:none; border:none}
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="paper">
      <div class="hdr">
        <div class="brand">
          <div class="mark"></div>
          <div>
            <h1>${safe(company.name || "RPM — حسن الوليم")}</h1>
            <div class="sub">${safe(company.address || "العراق")} • ${safe(company.phone || "")}</div>
          </div>
        </div>
        <div class="meta">
          <div>فاتورة خدمة</div>
          <div><b>${safe(inv.invoiceNo || "—")}</b></div>
          <div>${safe(fmtDate(inv.createdAt || now.getTime()))}</div>
          <div style="margin-top:6px">
            ${inv.status==="paid" ? `<span class="tag paid">مدفوعة</span>` :
              inv.status==="unpaid" ? `<span class="tag unpaid">غير مدفوعة</span>` :
              inv.status==="cancelled" ? `<span class="tag">ملغاة</span>` :
              `<span class="tag draft">مسودة</span>`}
          </div>
        </div>
      </div>

      <div class="body">
        <div class="grid">
          <div class="box">
            <h3>الزبون</h3>
            <div class="row"><span>الاسم</span><span><b>${safe(inv.customerName)}</b></span></div>
            <div class="row"><span>الهاتف</span><span>${safe(inv.customerPhone)}</span></div>
          </div>
          <div class="box">
            <h3>السيارة</h3>
            <div class="row"><span>اللوحة</span><span><b>${safe(inv.carPlate)}</b></span></div>
            <div class="row"><span>الموديل</span><span>${safe(inv.carModel)}</span></div>
          </div>
        </div>

        <table>
          <thead>
            <tr><th>الخدمة</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr>
          </thead>
          <tbody>
            ${(inv.items||[]).map(it=>{
              const line = (Number(it.qty||0)*Number(it.price||0));
              return `<tr>
                <td>${safe(it.name)}</td>
                <td>${safe(it.qty)}</td>
                <td>${safe(fmtIQD.format(Number(it.price||0)))}</td>
                <td><b>${safe(fmtIQD.format(line))}</b></td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>

        <div class="totals">
          <div class="sum">
            <div class="r"><span>الإجمالي الفرعي</span><span>${safe(fmtIQD.format(sub))}</span></div>
            <div class="r"><span>الضريبة (${safe(inv.taxRate ?? 0)}%)</span><span>${safe(fmtIQD.format(tax))}</span></div>
            <div class="r" style="border-top:1px dashed #e1e5f2; padding-top:8px; margin-top:8px">
              <strong>المجموع</strong><strong>${safe(fmtIQD.format(total))}</strong>
            </div>
          </div>
        </div>

        ${inv.note ? `<div class="note"><b>ملاحظات:</b> ${safe(inv.note)}</div>` : ``}
      </div>

      <div class="foot">
        <div>${safe(invoice.footerNote || "شكراً لثقتكم — نلتزم بأفضل خدمة.")}</div>
        <div class="muted">توقيع/ختم: __________________</div>
      </div>
    </div>
  </div>

  <script>
    // طباعة تلقائية (اختياري)
    setTimeout(()=> window.print(), 250);
  </script>
</body>
</html>
  `.trim();

  const w = window.open("", "_blank");
  if(!w){ toast("الرجاء السماح بفتح نافذة للطباعة", "warn"); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// Reports
function renderReports(){
  setTitle("التقارير", "ملخص + رسوم بيانية");

  const inv = state.data.invoices || [];
  const today = new Date();
  const fromDefault = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 14);
  const params = new URLSearchParams(location.hash.split("?")[1]||"");
  const from = params.get("from") || ymd(fromDefault);
  const to = params.get("to") || ymd(today);

  const fromTs = startOfDay(from);
  const toTs = endOfDay(to);

  const inRange = inv.filter(x=>{
    const t = Number(x.createdAt || 0);
    return t>=fromTs && t<=toTs;
  });

  const paid = inRange.filter(x=> x.status==="paid");
  const unpaid = inRange.filter(x=> x.status==="unpaid" || x.status==="draft");

  const revenue = paid.reduce((a,b)=> a + (b.total||0), 0);
  const due = unpaid.reduce((a,b)=> a + (b.total||0), 0);
  const avg = paid.length ? Math.round(revenue / paid.length) : 0;

  // daily revenue series
  const days = [];
  for(let t=fromTs; t<=toTs; t+=86400000){
    days.push(t);
  }
  const series = days.map(t=>{
    const dayEnd = t + 86400000 - 1;
    const v = paid.filter(x=> Number(x.createdAt||0)>=t && Number(x.createdAt||0)<=dayEnd)
      .reduce((a,b)=> a + (b.total||0), 0);
    return { t, v };
  });

  // top services
  const svc = new Map();
  inRange.forEach(x=>{
    (x.items||[]).forEach(it=>{
      const name = (it.name||"").trim() || "غير محدد";
      const line = (Number(it.qty||0)*Number(it.price||0));
      svc.set(name, (svc.get(name)||0)+line);
    });
  });
  const topServices = [...svc.entries()].sort((a,b)=> b[1]-a[1]).slice(0,7);

  $("#view").innerHTML = `
    <div class="card pad">
      <div class="row" style="justify-content:space-between; align-items:center">
        <div>
          <div style="font-weight:900">فلترة التاريخ</div>
          <div class="muted small">اختاري المدة وشوفي النتائج فوراً</div>
        </div>
        <div class="row">
          <div style="width:160px">
            <label>من</label>
            <input class="input" type="date" id="rFrom" value="${escapeHtml(from)}"/>
          </div>
          <div style="width:160px">
            <label>إلى</label>
            <input class="input" type="date" id="rTo" value="${escapeHtml(to)}"/>
          </div>
          <button class="btn" id="rApply">تطبيق</button>
        </div>
      </div>
    </div>

    <div class="grid kpis" style="margin-top:12px">
      <div class="card kpi">
        <div class="h">إيراد (مدفوع)</div>
        <div class="v">${escapeHtml(fmtIQD.format(revenue))}</div>
        <div class="s">عدد المدفوعة: ${escapeHtml(fmtNum.format(paid.length))}</div>
      </div>
      <div class="card kpi">
        <div class="h">مستحقات</div>
        <div class="v">${escapeHtml(fmtIQD.format(due))}</div>
        <div class="s">غير مدفوعة/مسودات: ${escapeHtml(fmtNum.format(unpaid.length))}</div>
      </div>
      <div class="card kpi">
        <div class="h">متوسط الفاتورة (مدفوع)</div>
        <div class="v">${escapeHtml(fmtIQD.format(avg))}</div>
        <div class="s">يعطي صورة عن مستوى الشغل</div>
      </div>
      <div class="card kpi">
        <div class="h">إجمالي الفواتير</div>
        <div class="v">${escapeHtml(fmtNum.format(inRange.length))}</div>
        <div class="s">ضمن الفترة المحددة</div>
      </div>
    </div>

    <div class="grid" style="margin-top:12px; grid-template-columns: 1.2fr .8fr;">
      <div class="card pad">
        <div style="font-weight:900">الإيراد اليومي</div>
        <div class="muted small">خط بسيط — بدون مكتبات</div>
        <hr class="sep"/>
        <canvas id="revChart" height="160" style="width:100%"></canvas>
      </div>

      <div class="card pad">
        <div style="font-weight:900">أعلى الخدمات</div>
        <div class="muted small">حسب مجموع البنود</div>
        <hr class="sep"/>
        ${topServices.length ? `
          <table class="table">
            <thead><tr><th>الخدمة</th><th>الإجمالي</th></tr></thead>
            <tbody>
              ${topServices.map(([name, val])=>`
                <tr><td>${escapeHtml(name)}</td><td><b>${escapeHtml(fmtIQD.format(val))}</b></td></tr>
              `).join("")}
            </tbody>
          </table>
        ` : `<div class="empty">لا توجد بيانات كافية.</div>`}
      </div>
    </div>

    <div class="card pad" style="margin-top:12px">
      <div class="row" style="justify-content:space-between; align-items:center">
        <div>
          <div style="font-weight:900">تصدير التقارير (CSV)</div>
          <div class="muted small">تصدير قائمة الفواتير ضمن الفترة</div>
        </div>
        <button class="btn" id="expCsv">تصدير CSV</button>
      </div>
    </div>
  `;

  $("#rApply").onclick = ()=>{
    const f = $("#rFrom").value;
    const t = $("#rTo").value;
    location.hash = `#/reports?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`;
  };

  $("#expCsv").onclick = ()=>{
    const rows = [
      ["invoiceNo","status","customerName","customerPhone","carPlate","carModel","total","createdAt"],
      ...inRange.map(x=>[
        x.invoiceNo||"",
        x.status||"",
        x.customerName||"",
        x.customerPhone||"",
        x.carPlate||"",
        x.carModel||"",
        x.total||0,
        x.createdAt||0
      ])
    ];
    const csv = rows.map(r=> r.map(v=> `"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
    downloadFile(`rpm_reports_${from}_to_${to}.csv`, csv, "text/csv;charset=utf-8");
  };

  drawLineChart($("#revChart"), series.map(x=> x.v));
}

function drawLineChart(canvas, values){
  const ctx = canvas.getContext("2d");
  const w = canvas.width = canvas.clientWidth * devicePixelRatio;
  const h = canvas.height = canvas.height * devicePixelRatio;
  ctx.clearRect(0,0,w,h);

  const pad = 16*devicePixelRatio;
  const x0 = pad, y0 = pad, x1 = w-pad, y1 = h-pad;

  const max = Math.max(1, ...values);
  const min = 0;

  // grid
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "#8fb6ff";
  ctx.lineWidth = 1*devicePixelRatio;
  for(let i=0;i<4;i++){
    const y = y0 + (i/3)*(y1-y0);
    ctx.beginPath(); ctx.moveTo(x0,y); ctx.lineTo(x1,y); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // line
  const n = values.length;
  const px = (i)=> x0 + (i/(Math.max(1,n-1)))*(x1-x0);
  const py = (v)=> y1 - ((v-min)/(max-min))*(y1-y0);

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2*devicePixelRatio;
  ctx.beginPath();
  values.forEach((v,i)=>{
    const x = px(i), y = py(v);
    if(i===0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  });
  ctx.stroke();

  // points
  ctx.fillStyle = "#6aa7ff";
  values.forEach((v,i)=>{
    const x = px(i), y = py(v);
    ctx.beginPath(); ctx.arc(x,y, 3.5*devicePixelRatio, 0, Math.PI*2); ctx.fill();
  });
}

// Settings
function renderSettings(){
  setTitle("الإعدادات", "Firebase + بيانات الورشة + نسخ احتياطي");

  const s = getSettings();
  const cfg = state.firebase.cfg;
  const missing = (!cfg.apiKey || !cfg.messagingSenderId);

  $("#view").innerHTML = `
    <div class="grid" style="grid-template-columns: 1fr 1fr;">
      <div class="card pad">
        <div style="font-weight:900">بيانات الورشة</div>
        <div class="muted small">تظهر في رأس الفاتورة</div>
        <hr class="sep"/>

        <div style="display:grid; gap:10px">
          <div>
            <label>اسم الورشة</label>
            <input class="input" id="sName" value="${escapeHtml(s.company.name||"")}" />
          </div>
          <div class="formGrid">
            <div>
              <label>الهاتف</label>
              <input class="input" id="sPhone" value="${escapeHtml(s.company.phone||"")}" />
            </div>
            <div>
              <label>العنوان</label>
              <input class="input" id="sAddr" value="${escapeHtml(s.company.address||"")}" />
            </div>
          </div>
          <div class="formGrid">
            <div>
              <label>بادئة رقم الفاتورة (Prefix)</label>
              <input class="input" id="sPrefix" value="${escapeHtml(s.invoice.prefix||"RPM")}" />
            </div>
            <div>
              <label>ضريبة افتراضية (%)</label>
              <input class="input" id="sTax" type="number" min="0" step="0.1" value="${escapeHtml(String(s.invoice.taxRate ?? 0))}" />
            </div>
          </div>
          <div>
            <label>نص أسفل الفاتورة</label>
            <input class="input" id="sFooter" value="${escapeHtml(s.invoice.footerNote||"")}" />
          </div>

          <div class="row end">
            <button class="btn" id="saveSettings">حفظ</button>
          </div>
        </div>
      </div>

      <div class="card pad">
        <div style="font-weight:900">Firebase (مشروع rpm574)</div>
        <div class="muted small">حتى يشتغل الويب لازم apiKey + messagingSenderId</div>
        <hr class="sep"/>

        ${missing ? `
          <div class="empty" style="border-color: rgba(255,204,102,.35)">
            <b>ناقص إعدادات Firebase.</b><br/>
            روحي Firebase console → Project settings → Web app config وانسخي:
            <div style="margin-top:8px" class="muted small">
              apiKey + messagingSenderId
            </div>
          </div>
          <hr class="sep"/>
        ` : ``}

        <div class="formGrid">
          <div>
            <label>apiKey</label>
            <input class="input" id="fApiKey" value="${escapeHtml(cfg.apiKey||"")}" placeholder="AIza..." />
          </div>
          <div>
            <label>messagingSenderId</label>
            <input class="input" id="fSender" value="${escapeHtml(cfg.messagingSenderId||"")}" placeholder="1509..." />
          </div>
        </div>

        <div class="formGrid" style="margin-top:10px">
          <div>
            <label>projectId</label>
            <input class="input" id="fProj" value="${escapeHtml(cfg.projectId||"")}" />
          </div>
          <div>
            <label>databaseURL</label>
            <input class="input" id="fDbUrl" value="${escapeHtml(cfg.databaseURL||"")}" />
          </div>
        </div>

        <div class="formGrid" style="margin-top:10px">
          <div>
            <label>authDomain</label>
            <input class="input" id="fAuth" value="${escapeHtml(cfg.authDomain||"")}" />
          </div>
          <div>
            <label>storageBucket</label>
            <input class="input" id="fBucket" value="${escapeHtml(cfg.storageBucket||"")}" />
          </div>
        </div>

        <div style="margin-top:10px">
          <label>appId</label>
          <input class="input" id="fAppId" value="${escapeHtml(cfg.appId||"")}" />
        </div>

        <div class="row end" style="margin-top:10px">
          <button class="btn" id="saveFirebase">حفظ Firebase</button>
          <button class="btn" id="reInit">إعادة ربط</button>
        </div>
      </div>
    </div>

    <div class="grid" style="margin-top:12px; grid-template-columns: 1fr 1fr;">
      <div class="card pad">
        <div style="font-weight:900">نسخ احتياطي</div>
        <div class="muted small">Export/Import JSON</div>
        <hr class="sep"/>
        <div class="row">
          <button class="btn" id="expJson">تصدير JSON</button>
          <button class="btn" id="impJson">استيراد JSON</button>
          <button class="btn" id="seedDemo">بيانات تجريبية</button>
        </div>
        <input type="file" id="filePick" accept="application/json" style="display:none"/>
        <div class="muted small" style="margin-top:10px">
          التصدير يشمل: زبائن، سيارات، أوامر عمل، فواتير، إعدادات.
        </div>
      </div>

      <div class="card pad">
        <div style="font-weight:900">وضع التشغيل</div>
        <div class="muted small">Firebase / محلي</div>
        <hr class="sep"/>
        <div class="row" style="justify-content:space-between">
          <div>الحالة الحالية</div>
          <div><b>${escapeHtml(state.mode)}</b></div>
        </div>
        <div class="row" style="justify-content:space-between; margin-top:8px">
          <div>Firebase</div>
          <div>${state.firebase.ready ? `<span class="tag good">متصل</span>` : `<span class="tag warn">غير جاهز</span>`}</div>
        </div>
        ${state.firebase.err ? `<div class="note" style="margin-top:10px; border:1px dashed #d9ddee; padding:10px; border-radius:14px">${escapeHtml(state.firebase.err)}</div>` : ``}
      </div>
    </div>
  `;

  $("#saveSettings").onclick = async ()=>{
    const ns = getSettings();
    ns.company.name = $("#sName").value.trim();
    ns.company.phone = $("#sPhone").value.trim();
    ns.company.address = $("#sAddr").value.trim();
    ns.invoice.prefix = $("#sPrefix").value.trim() || "RPM";
    ns.invoice.taxRate = Number($("#sTax").value||0);
    ns.invoice.footerNote = $("#sFooter").value.trim();
    await saveSettings(ns);
  };

  $("#saveFirebase").onclick = ()=>{
    const newCfg = {
      apiKey: $("#fApiKey").value.trim(),
      messagingSenderId: $("#fSender").value.trim(),
      projectId: $("#fProj").value.trim(),
      databaseURL: $("#fDbUrl").value.trim(),
      authDomain: $("#fAuth").value.trim(),
      storageBucket: $("#fBucket").value.trim(),
      appId: $("#fAppId").value.trim()
    };
    saveFirebaseConfig(newCfg);
    state.firebase.cfg = loadFirebaseConfig();
    toast("تم حفظ Firebase بالمتصفح", "good");
  };

  $("#reInit").onclick = async ()=>{
    await initFirebase();
    renderRoute();
  };

  $("#expJson").onclick = ()=>{
    const payload = {
      exportedAt: Date.now(),
      data: {
        customers: state.localDB.customers,
        cars: state.localDB.cars,
        workOrders: state.localDB.workOrders,
        invoices: state.localDB.invoices,
        services: state.localDB.services,
        settings: state.localDB.settings,
        meta: state.localDB.meta
      }
    };
    downloadFile(`rpm_backup_${Date.now()}.json`, JSON.stringify(payload, null, 2), "application/json");
  };

  $("#impJson").onclick = ()=> $("#filePick").click();
  $("#filePick").addEventListener("change", async (e)=>{
    const file = e.target.files?.[0];
    if(!file) return;
    const txt = await file.text();
    try{
      const obj = JSON.parse(txt);
      const d = obj.data || {};
      // merge
      state.localDB.customers = { ...(state.localDB.customers||{}), ...(d.customers||{}) };
      state.localDB.cars = { ...(state.localDB.cars||{}), ...(d.cars||{}) };
      state.localDB.workOrders = { ...(state.localDB.workOrders||{}), ...(d.workOrders||{}) };
      state.localDB.invoices = { ...(state.localDB.invoices||{}), ...(d.invoices||{}) };
      state.localDB.services = { ...(state.localDB.services||{}), ...(d.services||{}) };
      state.localDB.settings = d.settings || state.localDB.settings;
      state.localDB.meta = d.meta || state.localDB.meta;
      saveLocalDB();

      hydrateFromLocal();
      toast("تم الاستيراد (محلياً).", "good");

      // إذا Firebase شغال، نقدر ندزّ البيانات (اختياري)
      if(state.firebase.ready){
        if(confirm("تريدين رفع البيانات المستوردة إلى Firebase؟ (دمج)")){
          await pushLocalToFirebase();
          toast("تم رفع البيانات إلى Firebase", "good");
        }
      }
      renderRoute();
    }catch{
      toast("ملف JSON غير صالح", "bad");
    }finally{
      e.target.value = "";
    }
  });

  $("#seedDemo").onclick = async ()=>{
    if(!confirm("إضافة بيانات تجريبية؟")) return;
    await seedDemoData();
    toast("تمت إضافة بيانات تجريبية", "good");
    renderRoute();
  };
}

async function pushLocalToFirebase(){
  if(!state.firebase.ready) return;
  // دمج إلى Firebase (بدون مسح الموجود)
  const dbObj = state.localDB;

  const mergeRoot = async (rootName, obj) => {
    const entries = Object.entries(obj || {});
    for(const [id, val] of entries){
      await dbSet(`${rootName}/${id}`, val);
    }
  };

  await mergeRoot("customers", dbObj.customers);
  await mergeRoot("cars", dbObj.cars);
  await mergeRoot("workOrders", dbObj.workOrders);
  await mergeRoot("invoices", dbObj.invoices);
  await mergeRoot("services", dbObj.services);
  await dbSet("settings", dbObj.settings || getSettings());
  await dbSet("meta", dbObj.meta || { counters:{ invoiceNo:1000 } });
}

function downloadFile(name, content, mime){
  const blob = new Blob([content], { type: mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=> URL.revokeObjectURL(url), 2500);
}

// Quick add
function quickAddMenu(){
  modal.open({
    title:"إضافة سريعة",
    bodyHtml: `
      <div class="grid" style="grid-template-columns:1fr; gap:10px">
        <button class="btn" id="q1">+ زبون</button>
        <button class="btn" id="q2">+ سيارة</button>
        <button class="btn" id="q3">+ أمر عمل</button>
        <button class="btn" id="q4">+ فاتورة</button>
      </div>
    `,
    footerHtml:`<button class="iconBtn" id="mCancel">إغلاق</button>`,
    onMount(){
      $("#mCancel").onclick = modal.close;
      $("#q1").onclick = ()=>{ modal.close(); openCustomerEditor(); };
      $("#q2").onclick = ()=>{ modal.close(); openCarEditor(); };
      $("#q3").onclick = ()=>{ modal.close(); openWorkOrderEditor(); };
      $("#q4").onclick = ()=>{ modal.close(); openInvoiceEditor(); };
    }
  });
}

// User menu
function userMenu(){
  const u = state.firebase.user;
  modal.open({
    title:"الحساب",
    bodyHtml: `
      <div class="card pad" style="background: rgba(255,255,255,.02)">
        <div class="row" style="justify-content:space-between">
          <div class="muted">الوضع</div><div><b>${escapeHtml(state.mode)}</b></div>
        </div>
        <div class="row" style="justify-content:space-between; margin-top:8px">
          <div class="muted">Firebase</div><div>${state.firebase.ready ? "✅" : "❌"}</div>
        </div>
        <hr class="sep"/>
        <div class="muted small">
          ${u ? (u.isAnonymous ? "مستخدم مجهول (Anonymous)" : `مستخدم: ${escapeHtml(u.email||u.uid)}`) : "لا يوجد مستخدم"}
        </div>
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
        if(!state.firebase.ready){ toast("Firebase غير جاهز", "bad"); return; }
        try{
          const { GoogleAuthProvider, signInWithPopup } = state.firebase.api;
          const provider = new GoogleAuthProvider();
          await signInWithPopup(state.firebase.auth, provider);
          toast("تم تسجيل الدخول", "good");
          modal.close();
        }catch(e){
          toast("فشل Google Login", "bad");
        }
      };
      $("#mAnon").onclick = async ()=>{
        if(!state.firebase.ready){ toast("Firebase غير جاهز", "bad"); return; }
        try{
          const { signInAnonymously } = state.firebase.api;
          await signInAnonymously(state.firebase.auth);
          toast("تم الدخول كمجهول", "good");
          modal.close();
        }catch{ toast("فشل الدخول", "bad"); }
      };
      $("#mOut").onclick = async ()=>{
        if(!state.firebase.ready){ modal.close(); return; }
        try{
          const { signOut } = state.firebase.api;
          await signOut(state.firebase.auth);
          toast("تم تسجيل الخروج", "warn");
          modal.close();
        }catch{ toast("تعذر تسجيل الخروج", "bad"); }
      };
    }
  });
}

// Demo data
async function seedDemoData(){
  const c1 = { name:"علي كريم", phone:"0770xxxxxxx", note:"زبون دائم", createdAt:Date.now()-86400000, updatedAt:Date.now()-86400000 };
  const c2 = { name:"سجاد عباس", phone:"0780xxxxxxx", note:"", createdAt:Date.now()-43200000, updatedAt:Date.now()-43200000 };
  const id1 = genId(), id2 = genId();
  await dbSet(`customers/${id1}`, c1);
  await dbSet(`customers/${id2}`, c2);

  const v1id = genId();
  await dbSet(`cars/${v1id}`, { plate:"بغداد 12345", model:"Camry 2020", customerId:id1, customerName:c1.name, note:"", createdAt:Date.now()-86000000, updatedAt:Date.now()-86000000 });

  const nextNo = await dbNextInvoiceNo();
  const invId = genId();
  await dbSet(`invoices/${invId}`, {
    invoiceNo:`RPM-${nextNo}`,
    customerId:id1, customerName:c1.name, customerPhone:c1.phone,
    carId:v1id, carPlate:"بغداد 12345", carModel:"Camry 2020",
    items:[{name:"تبديل دهن", qty:1, price:25000},{name:"فلتر دهن", qty:1, price:10000}],
    subTotal:35000, taxRate:0, tax:0, total:35000,
    status:"paid", note:"", createdAt:Date.now()-40000000, updatedAt:Date.now()-40000000
  });

  hydrateFromLocal();
}

// ------------------ Boot ------------------
function boot(){
  bindNav();
  window.addEventListener("hashchange", renderRoute);
  if(!location.hash) location.hash = "#/dashboard";
  renderRoute();

  // Firebase init
  initFirebase();
}

boot();
