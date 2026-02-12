/**
 * RPM Workshop ERP (3 files فقط)
 * - Frontend SPA يعمل على GitHub Pages
 * - Firebase Auth + Firestore
 *
 * قبل التشغيل:
 * 1) Firebase Console -> Authentication -> Email/Password = Enabled
 * 2) Firebase Console -> Firestore Database = Enabled
 * 3) ضع firebaseConfig بالأسفل
 *
 * ملاحظة أمنية:
 * هذا الكود يطبّق صلاحيات على الواجهة.
 * للأمان الحقيقي لازم Firestore Rules (أرفقتها لك داخل تعليق في الأسفل).
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  getDocs, query, where, orderBy, limit, serverTimestamp, writeBatch,
  runTransaction, increment
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* =========================
   Firebase Config (ضعه هنا)
========================= */
const firebaseConfig = {
  apiKey: "AIzaSyC0p4cqNHuqZs9_gNuKLl7nEY0MqRXbf_A",
  authDomain: "rpm574.firebaseapp.com",
  databaseURL: "https://rpm574-default-rtdb.firebaseio.com",
  projectId: "rpm574",
  storageBucket: "rpm574.firebasestorage.app",
  messagingSenderId: "150918603525",
  appId: "1:150918603525:web:fe1d0fbe5c4505936c4d6c"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* =========================
   Helpers
========================= */
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);
const pad = (n, w=6) => String(n).padStart(w, "0");
const nowISO = () => new Date().toISOString().slice(0,19).replace("T"," ");
const money = (v, currency="IQD") => {
  const x = Number(v||0);
  try { return new Intl.NumberFormat("ar-IQ",{maximumFractionDigits:0}).format(x) + " " + currency; }
  catch { return x + " " + currency; }
};
const escapeHtml = (s="") => String(s)
  .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
  .replaceAll('"',"&quot;").replaceAll("'","&#039;");

function toast(title, message=""){
  const host = $("#toastHost");
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<div class="t">${escapeHtml(title)}</div><div class="m">${escapeHtml(message)}</div>`;
  host.appendChild(el);
  setTimeout(()=> el.remove(), 4200);
}

function modal({title, bodyHTML, footerHTML, onMount}){
  const host = $("#modalHost");
  host.classList.remove("hidden");
  host.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modalHeader">
        <div>
          <div class="modalTitle">${escapeHtml(title||"")}</div>
          <div class="smallMuted">${escapeHtml(nowISO())}</div>
        </div>
        <button class="btn ghost small" data-x>إغلاق</button>
      </div>
      <div class="modalBody">${bodyHTML||""}</div>
      <div class="modalFooter">${footerHTML||""}</div>
    </div>`;
  host.addEventListener("click", (e)=>{
    if(e.target === host) closeModal();
    if(e.target?.dataset?.x != null) closeModal();
  }, { once:false });

  const closeModal = () => { host.classList.add("hidden"); host.innerHTML=""; window.removeEventListener("keydown", onEsc); };
  const onEsc = (e)=>{ if(e.key==="Escape") closeModal(); };
  window.addEventListener("keydown", onEsc);

  onMount?.(host, closeModal);
  return closeModal;
}

function htmlToText(s=""){ return String(s).replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim(); }

function hashRoute(){
  const h = location.hash.replace(/^#\/?/,"");
  const [path, qs] = h.split("?");
  const params = Object.fromEntries(new URLSearchParams(qs||"").entries());
  return { path: path || "dashboard", params };
}

async function safeConfirm(msg){
  return confirm(msg);
}

/* =========================
   App State
========================= */
const State = {
  user: null,
  profile: null,      // users/{uid}
  role: "guest",
  settings: null,     // settings/app
  templates: [],      // invoiceTemplates
  customPages: [],    // customPages
};

/* =========================
   Firestore Helpers
========================= */
async function getOne(ref){
  const snap = await getDoc(ref);
  return snap.exists() ? { id:snap.id, ...snap.data() } : null;
}
async function listCol(colName, {whereArr=[], orderArr=null, lim=200}={}){
  let qy = collection(db, colName);
  const clauses = [];
  for(const w of whereArr) clauses.push(where(...w));
  if(orderArr) clauses.push(orderBy(...orderArr));
  clauses.push(limit(lim));
  const qq = query(qy, ...clauses);
  const sn = await getDocs(qq);
  return sn.docs.map(d => ({ id:d.id, ...d.data() }));
}
async function addCol(colName, data){
  const ref = await addDoc(collection(db, colName), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return ref.id;
}
async function setDocId(colName, id, data, merge=true){
  await setDoc(doc(db, colName, id), { ...data, updatedAt: serverTimestamp() }, { merge });
}
async function upd(colName, id, data){
  await updateDoc(doc(db, colName, id), { ...data, updatedAt: serverTimestamp() });
}
async function del(colName, id){
  await deleteDoc(doc(db, colName, id));
}

async function audit(action, entity, entityId, before=null, after=null){
  try{
    const by = State.user?.uid || "unknown";
    await addDoc(collection(db, "auditLogs"), {
      action, entity, entityId,
      by,
      before, after,
      at: serverTimestamp(),
      email: State.user?.email || ""
    });
  }catch(e){ /* ignore */ }
}

/* =========================
   Settings & Seed
========================= */
const DEFAULT_SETTINGS = {
  workshopName: "RPM Workshop",
  phone: "",
  address: "",
  currency: "IQD",
  taxRate: 0,                 // نسبة (مثلاً 5)
  invoicePrefix: "INV",
  woPrefix: "WO",
  numberWidth: 6,
  stockConsumePolicy: "invoice_create", // invoice_create | invoice_paid
  defaultInvoiceTemplateId: "default_ar",
};

const DEFAULT_TEMPLATES = [
  {
    id: "default_ar",
    name: "قالب عربي — عام",
    css: `
      body{font-family:Tahoma,Arial;direction:rtl;padding:18px}
      h2{margin:0 0 6px 0}
      .muted{color:#555;font-size:12px}
      hr{border:0;border-top:1px solid #ddd;margin:12px 0}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      table{width:100%;border-collapse:collapse;margin-top:10px}
      th,td{border-bottom:1px solid #eee;padding:8px 10px;text-align:right}
      th{background:#f7f7f7}
      .sum{margin-top:12px;display:flex;justify-content:flex-start}
      .sum div{min-width:240px}
    `.trim(),
    html: `
      <h2>فاتورة خدمة — {{workshopName}}</h2>
      <div class="muted">رقم الفاتورة: <b>{{invoiceNo}}</b> • التاريخ: {{date}}</div>
      <hr/>
      <div class="grid">
        <div>
          <h3 style="margin:0 0 6px 0;font-size:14px">الزبون</h3>
          <div>الاسم: <b>{{customerName}}</b></div>
          <div>الهاتف: {{customerPhone}}</div>
        </div>
        <div>
          <h3 style="margin:0 0 6px 0;font-size:14px">السيارة</h3>
          <div>اللوحة: <b>{{plate}}</b></div>
          <div>الموديل: {{carModel}}</div>
          <div>السنة: {{carYear}}</div>
          <div>كم: {{km}}</div>
        </div>
      </div>

      <hr/>
      <h3 style="margin:0 0 6px 0;font-size:14px">تفاصيل الخدمات والقطع</h3>
      <table>
        <thead>
          <tr>
            <th>النوع</th>
            <th>الوصف</th>
            <th>الكمية</th>
            <th>سعر الوحدة</th>
            <th>المجموع</th>
          </tr>
        </thead>
        <tbody>
          {{#items}}
          <tr>
            <td>{{type}}</td>
            <td>{{name}}</td>
            <td>{{qty}}</td>
            <td>{{price}}</td>
            <td>{{lineTotal}}</td>
          </tr>
          {{/items}}
        </tbody>
      </table>

      <div class="sum">
        <div>
          <div>المجموع: <b>{{subTotal}}</b></div>
          <div>خصم: {{discount}}</div>
          <div>ضريبة: {{tax}}</div>
          <div style="margin-top:8px;font-size:16px">الإجمالي: <b>{{grandTotal}}</b></div>
          <div class="muted" style="margin-top:8px">ملاحظات: {{notes}}</div>
        </div>
      </div>
    `.trim()
  },
  {
    id: "oil_change_ar",
    name: "قالب عربي — تبديل دهن",
    css: `
      body{font-family:Tahoma,Arial;direction:rtl;padding:18px}
      h2{margin:0 0 6px 0}
      .muted{color:#555;font-size:12px}
      .tag{display:inline-block;padding:4px 10px;border-radius:999px;background:#f2f2ff;border:1px solid #c7c7ff;font-size:12px}
      hr{border:0;border-top:1px solid #ddd;margin:12px 0}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
      table{width:100%;border-collapse:collapse;margin-top:10px}
      th,td{border-bottom:1px solid #eee;padding:8px 10px;text-align:right}
      th{background:#f7f7f7}
    `.trim(),
    html: `
      <h2>فاتورة خدمة — تبديل دهن</h2>
      <div class="muted">رقم الفاتورة: <b>{{invoiceNo}}</b> • التاريخ: {{date}} • <span class="tag">RPM</span></div>
      <hr/>

      <div class="grid">
        <div>
          <h3 style="margin:0 0 6px 0;font-size:14px">الزبون</h3>
          <div>الاسم: <b>{{customerName}}</b></div>
          <div>الهاتف: {{customerPhone}}</div>
        </div>
        <div>
          <h3 style="margin:0 0 6px 0;font-size:14px">السيارة</h3>
          <div>اللوحة: <b>{{plate}}</b></div>
          <div>الموديل: {{carModel}}</div>
          <div>كم: {{km}}</div>
        </div>
      </div>

      <hr/>
      <table>
        <thead>
          <tr>
            <th>النوع</th>
            <th>الوصف</th>
            <th>الكمية</th>
            <th>سعر الوحدة</th>
            <th>المجموع</th>
          </tr>
        </thead>
        <tbody>
          {{#items}}
          <tr>
            <td>{{type}}</td>
            <td>{{name}}</td>
            <td>{{qty}}</td>
            <td>{{price}}</td>
            <td>{{lineTotal}}</td>
          </tr>
          {{/items}}
        </tbody>
      </table>

      <hr/>
      <div style="font-size:16px">الإجمالي: <b>{{grandTotal}}</b></div>
      <div class="muted" style="margin-top:6px">ملاحظات: {{notes}}</div>
    `.trim()
  }
];

async function ensureSeed(){
  // settings/app
  const sRef = doc(db, "settings", "app");
  const s = await getOne(sRef);
  if(!s){
    await setDoc(sRef, { ...DEFAULT_SETTINGS, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge:true });
  }

  // invoiceTemplates seed
  const existing = await listCol("invoiceTemplates", { lim: 50 });
  if(existing.length === 0){
    const batch = writeBatch(db);
    for(const t of DEFAULT_TEMPLATES){
      batch.set(doc(db, "invoiceTemplates", t.id), { name:t.name, html:t.html, css:t.css, builtIn:true, createdAt:serverTimestamp(), updatedAt:serverTimestamp() }, { merge:true });
    }
    await batch.commit();
  }
}

/* =========================
   Auth & User Profile
========================= */
async function loadProfile(uid){
  const pRef = doc(db, "users", uid);
  let p = await getOne(pRef);
  if(!p){
    // أول مستخدم يسجّل دخول/يسوي حساب نخليه Admin تلقائياً إذا ماكو أي user docs
    const anyUsers = await listCol("users", { lim: 2 });
    const role = anyUsers.length === 0 ? "admin" : "staff";
    p = {
      id: uid,
      uid,
      email: State.user?.email || "",
      name: State.user?.displayName || "",
      role,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    await setDoc(pRef, p, { merge:true });
  }
  return p;
}

/* =========================
   Numbering (WO & Invoice)
========================= */
async function nextNumber(kind){
  // kind: "invoice" | "wo" | "po"
  const key = kind + "Counter";
  const sRef = doc(db, "settings", "app");
  const res = await runTransaction(db, async (tx)=>{
    const snap = await tx.get(sRef);
    const data = snap.exists() ? snap.data() : { ...DEFAULT_SETTINGS };
    const current = Number(data[key] || 0) + 1;
    tx.set(sRef, { [key]: current, updatedAt: serverTimestamp() }, { merge:true });
    return { current, data };
  });
  const year = new Date().getFullYear();
  const w = Number(res.data.numberWidth || 6);
  const prefix =
    kind === "invoice" ? (res.data.invoicePrefix||"INV") :
    kind === "wo" ? (res.data.woPrefix||"WO") :
    "PO";
  return `${prefix}-${year}-${pad(res.current, w)}`;
}

/* =========================
   Upsert Customer + Vehicle (من أمر الشغل)
========================= */
async function upsertCustomerAndVehicle({customerName, customerPhone, plate, carModel, carYear, vin, km}){
  let customerId = null;

  // 1) حاول بالهاتف
  if(customerPhone){
    const hit = await listCol("customers", { whereArr: [["phone","==",customerPhone]], lim: 1 });
    if(hit[0]) customerId = hit[0].id;
  }

  // 2) إذا ماكو، أنشئ زبون جديد
  if(!customerId){
    customerId = await addCol("customers", {
      name: customerName || "زبون جديد",
      phone: customerPhone || "",
      note: "",
      createdBy: State.user?.uid || ""
    });
    await audit("create", "customers", customerId, null, { name:customerName, phone:customerPhone });
  } else {
    // تحديث بسيط للاسم إذا تغيّر
    await upd("customers", customerId, { name: customerName || "" });
  }

  // Vehicle: حاول باللوحة ضمن نفس الزبون
  let vehicleId = null;
  if(plate){
    const vh = await listCol("vehicles", { whereArr: [["customerId","==",customerId], ["plate","==",plate]], lim: 1 });
    if(vh[0]) vehicleId = vh[0].id;
  }
  if(!vehicleId){
    vehicleId = await addCol("vehicles", {
      customerId,
      plate: plate || "",
      model: carModel || "",
      year: carYear || "",
      vin: vin || "",
      km: Number(km||0),
      createdBy: State.user?.uid || ""
    });
    await audit("create", "vehicles", vehicleId, null, { plate, model:carModel });
  } else {
    await upd("vehicles", vehicleId, {
      model: carModel || "",
      year: carYear || "",
      vin: vin || "",
      km: Number(km||0),
    });
  }

  return { customerId, vehicleId };
}

/* =========================
   Templates Engine (Mini Mustache)
   - supports {{key}}
   - supports {{#items}}...{{/items}} list
========================= */
function renderTemplate(html, data){
  let out = html;

  // list block
  out = out.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, inner)=>{
    const arr = data[key];
    if(!Array.isArray(arr) || arr.length===0) return "";
    return arr.map(item=>{
      let chunk = inner;
      chunk = chunk.replace(/\{\{(\w+)\}\}/g, (m,k)=> escapeHtml(item?.[k] ?? ""));
      return chunk;
    }).join("");
  });

  // scalars
  out = out.replace(/\{\{(\w+)\}\}/g, (_, k)=> escapeHtml(data[k] ?? ""));
  return out;
}

/* =========================
   UI Shell
========================= */
const ROOT = $("#app");

function iconDot(){ return `<span class="pill" style="padding:4px 8px">•</span>`; }

function requireAdmin(){
  if(State.role !== "admin"){
    toast("صلاحية غير كافية", "هذه الصفحة للأدمن فقط.");
    location.hash = "#/dashboard";
    return false;
  }
  return true;
}

function pageLayout({title, subtitle, actionsHTML=""}){
  return `
    <div class="topbar">
      <div class="left">
        <div>
          <div class="h1">${escapeHtml(title||"")}</div>
          <div class="meta">${escapeHtml(subtitle||"")}</div>
        </div>
      </div>
      <div class="btnRow">${actionsHTML}</div>
    </div>
    <div id="pageBody" class="main"></div>
  `;
}

/* =========================
   Router + Pages Registry
   - يدعم Custom Pages من Firestore بدون تعديل ملفات لاحقاً
========================= */
const BuiltinPages = [
  { id:"dashboard", title:"لوحة التحكم", hint:"ملخص سريع", adminOnly:false },
  { id:"workorders", title:"أوامر الشغل", hint:"إنشاء + متابعة + تحويل لفاتورة", adminOnly:false },
  { id:"invoices", title:"الفواتير", hint:"تعديل + طباعة + قوالب", adminOnly:false },
  { id:"inventory", title:"المخزون", hint:"قطع الغيار + تنبيه نفاد", adminOnly:false },
  { id:"purchases", title:"المشتريات", hint:"فاتورة شراء + تحديث مخزون", adminOnly:false },
  { id:"suppliers", title:"الموردين", hint:"إدارة الموردين", adminOnly:false },
  { id:"customers", title:"الزبائن والسيارات", hint:"إدارة عامة", adminOnly:false },
  { id:"reports", title:"التقارير", hint:"مبيعات + مخزون", adminOnly:false },
  { id:"users", title:"المستخدمين والصلاحيات", hint:"Admin فقط", adminOnly:true },
  { id:"templates", title:"قوالب الفواتير", hint:"محرر + معاينة", adminOnly:true },
  { id:"pages", title:"صفحات إضافية", hint:"إنشاء صفحات بدون تعديل الكود", adminOnly:true },
  { id:"audit", title:"سجل التدقيق", hint:"من عدّل ماذا؟", adminOnly:true },
  { id:"settings", title:"الإعدادات", hint:"ترقيم + ضريبة + سياسة مخزون", adminOnly:true },
];

function navHTML(){
  const r = hashRoute().path;
  const show = (p)=> !p.adminOnly || State.role==="admin";
  const links = BuiltinPages.filter(show).map(p=>{
    const active = r===p.id ? "active" : "";
    return `<a class="${active}" href="#/${p.id}">
      <span>${escapeHtml(p.title)}<br><small>${escapeHtml(p.hint||"")}</small></span>
      <span>${iconDot()}</span>
    </a>`;
  }).join("");

  const custom = (State.customPages||[])
    .filter(p => (p.visibility||"admin") === "admin" ? (State.role==="admin") : true)
    .map(p=>{
      const active = r===`page/${p.slug}` ? "active" : "";
      return `<a class="${active}" href="#/page/${encodeURIComponent(p.slug)}">
        <span>${escapeHtml(p.title)}<br><small>صفحة مخصصة</small></span>
        <span>${iconDot()}</span>
      </a>`;
    }).join("");

  return `
    <div class="sidebar">
      <div class="brand">
        <div class="logo">
          <div style="width:36px;height:36px;border-radius:14px;background:rgba(124,92,255,.2);border:1px solid rgba(124,92,255,.35);display:flex;align-items:center;justify-content:center;font-weight:950">RPM</div>
          <div>
            <div class="title">${escapeHtml(State.settings?.workshopName || "RPM")}</div>
            <div class="sub">Workshop ERP • ${escapeHtml(State.role)}</div>
          </div>
        </div>
        <span class="badge">⛽🛠️</span>
      </div>

      <div class="nav">
        ${links}
        ${custom ? `<hr/>${custom}` : ""}
      </div>

      <div class="sidebarFooter">
        <div class="badge">المستخدم: ${escapeHtml(State.user?.email||"")}</div>
        <div class="btnRow">
          <button class="btn small ghost" id="btnRefresh">تحديث</button>
          <button class="btn small danger" id="btnLogout">تسجيل خروج</button>
        </div>
      </div>
    </div>
  `;
}

function shellHTML(){
  return `
    <div class="shell">
      ${navHTML()}
      <div class="main">
        <div id="routeOutlet"></div>
      </div>
    </div>
  `;
}

async function renderShell(){
  ROOT.innerHTML = shellHTML();
  $("#btnLogout").onclick = async ()=>{ await signOut(auth); };
  $("#btnRefresh").onclick = async ()=>{ await bootstrap(true); };
}

async function route(){
  const { path, params } = hashRoute();

  // custom page route
  if(path.startsWith("page/")){
    const slug = decodeURIComponent(path.slice(5));
    await renderCustomPage(slug);
    setActiveNav();
    return;
  }

  switch(path){
    case "dashboard": await renderDashboard(); break;
    case "workorders": await renderWorkOrders(); break;
    case "invoices": await renderInvoices(); break;
    case "inventory": await renderInventory(); break;
    case "purchases": await renderPurchases(); break;
    case "suppliers": await renderSuppliers(); break;
    case "customers": await renderCustomers(); break;
    case "reports": await renderReports(); break;
    case "users": await renderUsers(); break;
    case "templates": await renderTemplates(); break;
    case "pages": await renderPagesManager(); break;
    case "audit": await renderAudit(); break;
    case "settings": await renderSettings(); break;
    default:
      location.hash = "#/dashboard";
  }
  setActiveNav();
}

function setActiveNav(){
  const r = hashRoute().path;
  $$(".nav a").forEach(a=>{
    const href = a.getAttribute("href")||"";
    const clean = href.replace(/^#\/?/,"");
    a.classList.toggle("active", clean === r);
  });
}

/* =========================
   Login UI
========================= */
function loginUI(){
  ROOT.innerHTML = `
    <div class="loginShell">
      <div class="loginCard">
        <div class="loginTitle">RPM — تسجيل الدخول</div>
        <div class="loginSub">Email/Password (Firebase Auth)</div>
        <hr/>
        <label>البريد</label>
        <input class="input" id="email" placeholder="admin@rpm.com" />
        <label>كلمة المرور</label>
        <input class="input" id="pass" type="password" placeholder="••••••••" />
        <label>اسم (اختياري لأول حساب)</label>
        <input class="input" id="name" placeholder="قمر" />
        <div class="btnRow" style="margin-top:12px">
          <button class="btn primary" id="btnLogin">دخول</button>
          <button class="btn ghost" id="btnCreate">إنشاء حساب</button>
        </div>
        <div class="smallMuted" style="margin-top:10px">
          إذا هذا أول حساب يتسجّل: يتعيّن تلقائياً <b>Admin</b>.
        </div>
      </div>
    </div>
  `;

  $("#btnLogin").onclick = async ()=>{
    const email = $("#email").value.trim();
    const pass = $("#pass").value;
    try{
      await signInWithEmailAndPassword(auth, email, pass);
    }catch(e){
      toast("فشل الدخول", e.message);
    }
  };

  $("#btnCreate").onclick = async ()=>{
    const email = $("#email").value.trim();
    const pass = $("#pass").value;
    const name = $("#name").value.trim();
    try{
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      if(name) await updateProfile(cred.user, { displayName: name });
      toast("تم إنشاء الحساب", "الآن يمكنك الدخول.");
    }catch(e){
      toast("فشل إنشاء الحساب", e.message);
    }
  };
}

/* =========================
   Bootstrap
========================= */
async function bootstrap(force=false){
  if(!State.user) return;

  await ensureSeed();

  // settings
  State.settings = await getOne(doc(db,"settings","app")) || { ...DEFAULT_SETTINGS };

  // profile
  State.profile = await loadProfile(State.user.uid);
  State.role = State.profile?.role || "staff";

  // templates
  State.templates = await listCol("invoiceTemplates", { orderArr:["name","asc"], lim: 200 });

  // custom pages
  State.customPages = await listCol("customPages", { orderArr:["title","asc"], lim: 200 });

  await renderShell();
  await route();
}

/* =========================
   Components
========================= */
function statusPill(status){
  const s = status || "open";
  if(["done","closed","paid"].includes(s)) return `<span class="pill ok">${escapeHtml(s)}</span>`;
  if(["waiting_parts","waiting_approval"].includes(s)) return `<span class="pill warn">${escapeHtml(s)}</span>`;
  if(["cancelled","void"].includes(s)) return `<span class="pill bad">${escapeHtml(s)}</span>`;
  return `<span class="pill">${escapeHtml(s)}</span>`;
}

function tableHTML({columns, rows}){
  const thead = `<tr>${columns.map(c=>`<th>${escapeHtml(c.label)}</th>`).join("")}</tr>`;
  const tbody = rows.map(r=>`<tr>${columns.map(c=>`<td>${c.render ? c.render(r) : escapeHtml(r[c.key] ?? "")}</td>`).join("")}</tr>`).join("");
  return `<div class="tableWrap"><table><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>`;
}

function twoCols(a,b){
  return `<div class="row"><div class="col-6">${a}</div><div class="col-6">${b}</div></div>`;
}

function calcInvoiceTotals(items, discount=0, taxRate=0){
  const sub = items.reduce((s,it)=> s + (Number(it.qty||0)*Number(it.price||0)), 0);
  const disc = Number(discount||0);
  const tax = Math.round((Math.max(sub-disc,0) * Number(taxRate||0)) / 100);
  const grand = Math.max(sub - disc + tax, 0);
  return { subTotal: sub, discount: disc, tax, grandTotal: grand };
}

/* =========================
   Dashboard
========================= */
async function renderDashboard(){
  const outlet = $("#routeOutlet");
  outlet.innerHTML = pageLayout({
    title: "لوحة التحكم",
    subtitle: "ملخص سريع — أوامر شغل، فواتير، مخزون",
    actionsHTML: `<button class="btn primary" id="newWO">أمر شغل جديد</button>`
  });
  $("#newWO").onclick = ()=> openWorkOrderEditor();

  const body = $("#pageBody");

  const [wos, inv, invItems, lowStock] = await Promise.all([
    listCol("workOrders", { orderArr:["updatedAt","desc"], lim: 10 }),
    listCol("invoices", { orderArr:["updatedAt","desc"], lim: 10 }),
    listCol("invoices", { orderArr:["updatedAt","desc"], lim: 50 }),
    listCol("inventoryItems", { orderArr:["updatedAt","desc"], lim: 300 }),
  ]);

  const totalSales = invItems.reduce((s,i)=> s + Number(i?.totals?.grandTotal||0), 0);
  const low = lowStock.filter(x => Number(x.stock||0) <= Number(x.minStock||0));

  body.innerHTML = `
    <div class="grid">
      <div class="card" style="grid-column:span 4">
        <div class="cardHeader">
          <div>
            <div class="cardTitle">أوامر شغل (آخر 10)</div>
            <div class="cardDesc">تتبع الحالات مباشرة</div>
          </div>
        </div>
        <div class="smallMuted">آخر تحديث</div>
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
          ${wos.map(x=>`
            <a href="#/workorders" style="text-decoration:none">
              <div class="pill" style="justify-content:space-between;width:100%">
                <span><b>${escapeHtml(x.woNo||x.id)}</b> • ${escapeHtml(x.customerSnapshot?.name||"")}</span>
                <span>${htmlToText(statusPill(x.status))}</span>
              </div>
            </a>
          `).join("") || `<div class="smallMuted">لا يوجد بيانات.</div>`}
        </div>
      </div>

      <div class="card" style="grid-column:span 4">
        <div class="cardHeader">
          <div>
            <div class="cardTitle">الفواتير (آخر 10)</div>
            <div class="cardDesc">تعديل + طباعة + مدفوعات</div>
          </div>
        </div>
        <div class="smallMuted">إجمالي آخر 50 فاتورة: <b>${money(totalSales, State.settings.currency)}</b></div>
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
          ${inv.map(x=>`
            <a href="#/invoices" style="text-decoration:none">
              <div class="pill" style="justify-content:space-between;width:100%">
                <span><b>${escapeHtml(x.invoiceNo||x.id)}</b> • ${escapeHtml(x.customerSnapshot?.name||"")}</span>
                <span><b>${money(x?.totals?.grandTotal||0, State.settings.currency)}</b></span>
              </div>
            </a>
          `).join("") || `<div class="smallMuted">لا يوجد بيانات.</div>`}
        </div>
      </div>

      <div class="card" style="grid-column:span 4">
        <div class="cardHeader">
          <div>
            <div class="cardTitle">تنبيه المخزون</div>
            <div class="cardDesc">الأصناف القريبة من النفاد</div>
          </div>
          <div class="btnRow">
            <a class="btn small ghost" href="#/inventory">فتح المخزون</a>
          </div>
        </div>
        ${low.length ? `
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:10px">
            ${low.slice(0,10).map(x=>`
              <div class="pill warn" style="justify-content:space-between;width:100%">
                <span>${escapeHtml(x.name||"")}</span>
                <span>المتوفر: <b>${escapeHtml(String(x.stock||0))}</b></span>
              </div>
            `).join("")}
          </div>
        ` : `<div class="smallMuted">لا توجد تنبيهات حالياً ✅</div>`}
      </div>

      <div class="card" style="grid-column:span 12">
        <div class="cardHeader">
          <div>
            <div class="cardTitle">اختصارات</div>
            <div class="cardDesc">أوامر شغل + فواتير + قوالب + صفحات</div>
          </div>
        </div>
        <div class="btnRow">
          <button class="btn primary" id="dashNewWO">أمر شغل جديد</button>
          <a class="btn ghost" href="#/invoices">إدارة الفواتير</a>
          <a class="btn ghost" href="#/templates">قوالب الفواتير</a>
          <a class="btn ghost" href="#/pages">صفحات إضافية</a>
          <a class="btn ghost" href="#/settings">الإعدادات</a>
        </div>
      </div>
    </div>
  `;
  $("#dashNewWO").onclick = ()=> openWorkOrderEditor();
}

/* =========================
   Work Orders
========================= */
async function renderWorkOrders(){
  const outlet = $("#routeOutlet");
  outlet.innerHTML = pageLayout({
    title:"أوامر الشغل",
    subtitle:"إنشاء الزبون والسيارة تلقائياً + حالات + تحويل لفاتورة",
    actionsHTML: `
      <button class="btn primary" id="newWO">أمر شغل جديد</button>
      <button class="btn ghost" id="refreshWO">تحديث</button>
    `
  });

  $("#newWO").onclick = ()=> openWorkOrderEditor();
  $("#refreshWO").onclick = ()=> renderWorkOrders();

  const body = $("#pageBody");
  body.innerHTML = `<div class="card"><div class="cardTitle">تحميل...</div></div>`;

  const rows = await listCol("workOrders", { orderArr:["updatedAt","desc"], lim: 200 });

  body.innerHTML = `
    <div class="card">
      <div class="cardHeader">
        <div>
          <div class="cardTitle">قائمة أوامر الشغل</div>
          <div class="cardDesc">اضغط تعديل لفتح كل التفاصيل</div>
        </div>
        <div style="min-width:320px">
          <input class="input" id="woSearch" placeholder="بحث: رقم أمر، اسم زبون، لوحة..." />
        </div>
      </div>
      <div id="woTable"></div>
    </div>
  `;

  const render = (filter="")=>{
    const f = filter.trim().toLowerCase();
    const data = !f ? rows : rows.filter(x=>{
      const t = [
        x.woNo, x.status,
        x.customerSnapshot?.name, x.customerSnapshot?.phone,
        x.vehicleSnapshot?.plate, x.vehicleSnapshot?.model
      ].join(" ").toLowerCase();
      return t.includes(f);
    });

    $("#woTable").innerHTML = tableHTML({
      columns:[
        { label:"رقم", render:r=> `<b>${escapeHtml(r.woNo||r.id)}</b><div class="smallMuted">${escapeHtml(r.vehicleSnapshot?.plate||"")}</div>` },
        { label:"الزبون", render:r=> `${escapeHtml(r.customerSnapshot?.name||"")}<div class="smallMuted">${escapeHtml(r.customerSnapshot?.phone||"")}</div>` },
        { label:"السيارة", render:r=> `${escapeHtml(r.vehicleSnapshot?.model||"")}<div class="smallMuted">${escapeHtml(String(r.vehicleSnapshot?.year||""))}</div>` },
        { label:"الحالة", render:r=> statusPill(r.status) },
        { label:"الإجراء", render:r=> `
          <div class="btnRow">
            <button class="btn small ghost" data-edit="${r.id}">تعديل</button>
            <button class="btn small success" data-inv="${r.id}">تحويل لفاتورة</button>
            <button class="btn small danger" data-del="${r.id}">حذف</button>
          </div>
        ` }
      ],
      rows:data
    });

    // bind actions
    $$("button[data-edit]").forEach(b=> b.onclick = ()=> openWorkOrderEditor(rows.find(x=>x.id===b.dataset.edit)));
    $$("button[data-inv]").forEach(b=> b.onclick = ()=> createInvoiceFromWO(rows.find(x=>x.id===b.dataset.inv)));
    $$("button[data-del]").forEach(b=> b.onclick = async ()=>{
      if(!await safeConfirm("حذف أمر الشغل؟")) return;
      const before = rows.find(x=>x.id===b.dataset.del) || null;
      await del("workOrders", b.dataset.del);
      await audit("delete","workOrders", b.dataset.del, before, null);
      toast("تم الحذف", "تم حذف أمر الشغل.");
      renderWorkOrders();
    });
  };

  render();
  $("#woSearch").oninput = (e)=> render(e.target.value);
}

function emptyChecklist(){
  return {
    oil:"", coolant:"", brakes:"", tires:"", battery:"", scan:"", notes:""
  };
}

function emptyWO(){
  return {
    woNo: "",
    status: "open",
    customerSnapshot: { name:"", phone:"" },
    vehicleSnapshot: { plate:"", model:"", year:"", vin:"", km:0 },
    checklist: emptyChecklist(),
    laborItems: [],
    partsItems: [],
    notes: "",
  };
}

function itemRowEditor(items, {type}){
  const rows = items.map((it, idx)=>`
    <div class="row" style="align-items:end;border:1px solid var(--line);border-radius:16px;padding:10px;margin-top:10px">
      <div class="col-6">
        <label>الوصف</label>
        <input class="input" data-k="name" data-i="${idx}" value="${escapeHtml(it.name||"")}" placeholder="${type==="part"?"مثال: فلتر زيت":"مثال: أجرة تبديل دهن"}"/>
      </div>
      <div class="col-2">
        <label>الكمية</label>
        <input class="input" data-k="qty" data-i="${idx}" type="number" value="${escapeHtml(String(it.qty||1))}"/>
      </div>
      <div class="col-2">
        <label>سعر الوحدة</label>
        <input class="input" data-k="price" data-i="${idx}" type="number" value="${escapeHtml(String(it.price||0))}"/>
      </div>
      <div class="col-2">
        <label>إجراء</label>
        <button class="btn small danger" data-delitem="${idx}">حذف</button>
      </div>
      ${type==="part" ? `
        <div class="col-12 smallMuted">اختياري: ربط بالمخزون داخل الفاتورة (عند التحويل/التعديل)</div>
      ` : ``}
    </div>
  `).join("");

  return `
    <div>
      ${rows || `<div class="smallMuted">لا يوجد عناصر. أضف عنصر.</div>`}
      <div class="btnRow" style="margin-top:10px">
        <button class="btn small ghost" data-additem>+ إضافة</button>
      </div>
    </div>
  `;
}

function openWorkOrderEditor(existing=null){
  const data = existing ? JSON.parse(JSON.stringify(existing)) : emptyWO();

  const close = modal({
    title: existing ? `تعديل أمر شغل: ${existing.woNo||existing.id}` : "أمر شغل جديد",
    bodyHTML: `
      <div class="row">
        <div class="col-8">
          <div class="card" style="padding:12px">
            <div class="cardTitle">بيانات الزبون + السيارة (تنشأ تلقائياً)</div>
            <div class="cardDesc">اكتب اسم الزبون والسيارة — عند الحفظ سيتم إنشاء/تحديث الزبون والسيارة تلقائياً</div>

            <div class="row">
              <div class="col-6">
                <label>اسم الزبون</label>
                <input class="input" id="cName" value="${escapeHtml(data.customerSnapshot?.name||"")}" placeholder="مثال: علي أحمد" />
              </div>
              <div class="col-6">
                <label>هاتف الزبون</label>
                <input class="input" id="cPhone" value="${escapeHtml(data.customerSnapshot?.phone||"")}" placeholder="07xxxxxxxxx" />
              </div>
              <div class="col-3">
                <label>لوحة السيارة</label>
                <input class="input" id="plate" value="${escapeHtml(data.vehicleSnapshot?.plate||"")}" placeholder="مثال: بغداد 12345" />
              </div>
              <div class="col-3">
                <label>الموديل</label>
                <input class="input" id="carModel" value="${escapeHtml(data.vehicleSnapshot?.model||"")}" placeholder="Camry / Accent..." />
              </div>
              <div class="col-3">
                <label>السنة</label>
                <input class="input" id="carYear" value="${escapeHtml(String(data.vehicleSnapshot?.year||""))}" placeholder="2020" />
              </div>
              <div class="col-3">
                <label>كم</label>
                <input class="input" id="km" type="number" value="${escapeHtml(String(data.vehicleSnapshot?.km||0))}" />
              </div>
              <div class="col-6">
                <label>VIN (اختياري)</label>
                <input class="input" id="vin" value="${escapeHtml(String(data.vehicleSnapshot?.vin||""))}" />
              </div>
              <div class="col-6">
                <label>الحالة</label>
                <select class="input" id="status">
                  ${["open","diagnosis","waiting_approval","waiting_parts","in_progress","done","closed","cancelled"].map(s=>
                    `<option ${data.status===s?"selected":""} value="${s}">${s}</option>`
                  ).join("")}
                </select>
              </div>
            </div>
          </div>

          <div class="card" style="padding:12px;margin-top:14px">
            <div class="cardTitle">Checklist سريع</div>
            <div class="row">
              <div class="col-4"><label>زيت</label><input class="input" id="ck_oil" value="${escapeHtml(data.checklist?.oil||"")}"/></div>
              <div class="col-4"><label>تبريد</label><input class="input" id="ck_coolant" value="${escapeHtml(data.checklist?.coolant||"")}"/></div>
              <div class="col-4"><label>فرامل</label><input class="input" id="ck_brakes" value="${escapeHtml(data.checklist?.brakes||"")}"/></div>
              <div class="col-4"><label>إطارات</label><input class="input" id="ck_tires" value="${escapeHtml(data.checklist?.tires||"")}"/></div>
              <div class="col-4"><label>بطارية</label><input class="input" id="ck_battery" value="${escapeHtml(data.checklist?.battery||"")}"/></div>
              <div class="col-4"><label>فحص كمبيوتر</label><input class="input" id="ck_scan" value="${escapeHtml(data.checklist?.scan||"")}"/></div>
              <div class="col-12"><label>ملاحظات checklist</label><textarea class="input" id="ck_notes">${escapeHtml(data.checklist?.notes||"")}</textarea></div>
            </div>
          </div>

          <div class="card" style="padding:12px;margin-top:14px">
            <div class="cardTitle">ملاحظات عامة</div>
            <textarea class="input" id="notes">${escapeHtml(data.notes||"")}</textarea>
          </div>
        </div>

        <div class="col-4">
          <div class="card" style="padding:12px">
            <div class="cardTitle">أجور العمل (Labor)</div>
            <div id="laborEditor"></div>
          </div>

          <div class="card" style="padding:12px;margin-top:14px">
            <div class="cardTitle">قطع (Parts)</div>
            <div class="cardDesc">يمكن تركها تقديرية هنا — تُعتمد وتخصم من المخزون داخل الفاتورة</div>
            <div id="partsEditor"></div>
          </div>
        </div>
      </div>
    `,
    footerHTML: `
      <button class="btn primary" id="saveWO">حفظ</button>
      ${existing ? `<button class="btn success" id="toInvoice">تحويل لفاتورة</button>` : ""}
      <button class="btn ghost" data-x>إغلاق</button>
    `,
    onMount: (host, closeModal)=>{
      const laborWrap = $("#laborEditor", host);
      const partsWrap = $("#partsEditor", host);

      const renderItems = ()=>{
        laborWrap.innerHTML = itemRowEditor(data.laborItems, {type:"labor"});
        partsWrap.innerHTML = itemRowEditor(data.partsItems, {type:"part"});

        // labor bind
        $$("[data-additem]", laborWrap).forEach(btn=>{
          btn.onclick = ()=>{
            data.laborItems.push({ type:"labor", name:"", qty:1, price:0 });
            renderItems();
          };
        });
        $$("[data-delitem]", laborWrap).forEach(btn=>{
          btn.onclick = ()=>{
            data.laborItems.splice(Number(btn.dataset.delitem), 1);
            renderItems();
          };
        });
        $$("input[data-k]", laborWrap).forEach(inp=>{
          inp.oninput = ()=>{
            const i = Number(inp.dataset.i);
            const k = inp.dataset.k;
            data.laborItems[i][k] = (k==="qty"||k==="price") ? Number(inp.value||0) : inp.value;
            data.laborItems[i].type = "labor";
          };
        });

        // parts bind
        $$("[data-additem]", partsWrap).forEach(btn=>{
          btn.onclick = ()=>{
            data.partsItems.push({ type:"part", name:"", qty:1, price:0, inventoryItemId:"" });
            renderItems();
          };
        });
        $$("[data-delitem]", partsWrap).forEach(btn=>{
          btn.onclick = ()=>{
            data.partsItems.splice(Number(btn.dataset.delitem), 1);
            renderItems();
          };
        });
        $$("input[data-k]", partsWrap).forEach(inp=>{
          inp.oninput = ()=>{
            const i = Number(inp.dataset.i);
            const k = inp.dataset.k;
            data.partsItems[i][k] = (k==="qty"||k==="price") ? Number(inp.value||0) : inp.value;
            data.partsItems[i].type = "part";
          };
        });
      };
      renderItems();

      $("#saveWO", host).onclick = async ()=>{
        try{
          // collect fields
          data.customerSnapshot = {
            name: $("#cName", host).value.trim(),
            phone: $("#cPhone", host).value.trim()
          };
          data.vehicleSnapshot = {
            plate: $("#plate", host).value.trim(),
            model: $("#carModel", host).value.trim(),
            year: $("#carYear", host).value.trim(),
            vin: $("#vin", host).value.trim(),
            km: Number($("#km", host).value||0),
          };
          data.status = $("#status", host).value;

          data.checklist = {
            oil: $("#ck_oil", host).value.trim(),
            coolant: $("#ck_coolant", host).value.trim(),
            brakes: $("#ck_brakes", host).value.trim(),
            tires: $("#ck_tires", host).value.trim(),
            battery: $("#ck_battery", host).value.trim(),
            scan: $("#ck_scan", host).value.trim(),
            notes: $("#ck_notes", host).value.trim(),
          };
          data.notes = $("#notes", host).value;

          // upsert customer & vehicle
          const { customerId, vehicleId } = await upsertCustomerAndVehicle({
            customerName: data.customerSnapshot.name,
            customerPhone: data.customerSnapshot.phone,
            plate: data.vehicleSnapshot.plate,
            carModel: data.vehicleSnapshot.model,
            carYear: data.vehicleSnapshot.year,
            vin: data.vehicleSnapshot.vin,
            km: data.vehicleSnapshot.km,
          });

          data.customerId = customerId;
          data.vehicleId = vehicleId;

          if(!existing){
            data.woNo = await nextNumber("wo");
            const newId = await addCol("workOrders", {
              ...data,
              createdBy: State.user?.uid || "",
              createdByEmail: State.user?.email || ""
            });
            await audit("create","workOrders", newId, null, data);
            toast("تم الحفظ", `أمر شغل جديد: ${data.woNo}`);
          }else{
            const before = existing;
            await upd("workOrders", existing.id, data);
            await audit("update","workOrders", existing.id, before, data);
            toast("تم التحديث", `أمر شغل: ${existing.woNo||existing.id}`);
          }

          closeModal();
          renderWorkOrders();
        }catch(e){
          toast("خطأ", e.message);
        }
      };

      if(existing){
        $("#toInvoice", host).onclick = async ()=>{
          await $("#saveWO", host).onclick?.();
          // بعد الحفظ، افتح تحويل
          closeModal();
          // refresh list then convert by latest? بسيط: افتح صفحة الفواتير
          toast("جاهز للتحويل", "افتح الفواتير أو حوّل من الجدول.");
        };
      }
    }
  });
}

/* =========================
   Create Invoice from WO
========================= */
async function createInvoiceFromWO(wo){
  if(!wo) return;

  try{
    const woFresh = await getOne(doc(db,"workOrders", wo.id));
    if(!woFresh){ toast("غير موجود", "تعذر إيجاد أمر الشغل."); return; }

    const invoiceNo = await nextNumber("invoice");
    const templateId = State.settings?.defaultInvoiceTemplateId || "default_ar";
    const items = [
      ...(woFresh.laborItems||[]).map(x=>({ type:"خدمة", name:x.name||"", qty:Number(x.qty||1), price:Number(x.price||0), inventoryItemId:"" })),
      ...(woFresh.partsItems||[]).map(x=>({ type:"قطعة", name:x.name||"", qty:Number(x.qty||1), price:Number(x.price||0), inventoryItemId:x.inventoryItemId||"" })),
    ].filter(x => x.name || x.price);

    const totals = calcInvoiceTotals(items, 0, Number(State.settings?.taxRate||0));

    const invData = {
      invoiceNo,
      status: "unpaid",
      workOrderId: woFresh.id,
      woNo: woFresh.woNo || "",
      customerId: woFresh.customerId || "",
      vehicleId: woFresh.vehicleId || "",
      customerSnapshot: woFresh.customerSnapshot || {},
      vehicleSnapshot: woFresh.vehicleSnapshot || {},
      items,
      discount: 0,
      taxRate: Number(State.settings?.taxRate||0),
      totals,
      payments: [],
      notes: woFresh.notes || "",
      templateId,
      createdBy: State.user?.uid || "",
      createdByEmail: State.user?.email || ""
    };

    // سياسة خصم المخزون
    if((State.settings?.stockConsumePolicy||"invoice_create") === "invoice_create"){
      await consumeStockForInvoiceItems(invData.items);
    }

    const invId = await addCol("invoices", invData);
    await audit("create","invoices", invId, null, invData);

    toast("تم إنشاء فاتورة", invoiceNo);
    location.hash = "#/invoices";
  }catch(e){
    toast("خطأ", e.message);
  }
}

async function consumeStockForInvoiceItems(items){
  // يخصم فقط العناصر التي تحمل inventoryItemId أو التي يمكن مطابقتها بالاسم (اختياري)
  const parts = items.filter(x => (x.type==="قطعة" || String(x.type).includes("قط")) && Number(x.qty||0) > 0);
  if(parts.length === 0) return;

  await runTransaction(db, async (tx)=>{
    for(const it of parts){
      let invId = it.inventoryItemId || "";
      if(!invId) continue; // الخصم فقط عندما مرتبط
      const ref = doc(db,"inventoryItems", invId);
      const snap = await tx.get(ref);
      if(!snap.exists()) continue;
      const data = snap.data();
      const current = Number(data.stock||0);
      const need = Number(it.qty||0);
      if(current < need){
        throw new Error(`المخزون غير كافٍ: ${data.name||invId} (المتوفر ${current})`);
      }
      tx.update(ref, { stock: current - need, updatedAt: serverTimestamp() });
    }
  });
}

/* =========================
   Invoices (Edit + Templates + Print)
========================= */
async function renderInvoices(){
  const outlet = $("#routeOutlet");
  outlet.innerHTML = pageLayout({
    title:"الفواتير",
    subtitle:"تعديل + معاينة + طباعة + مدفوعات + ربط بالمخزون",
    actionsHTML: `
      <button class="btn ghost" id="refreshInv">تحديث</button>
    `
  });
  $("#refreshInv").onclick = ()=> renderInvoices();

  const body = $("#pageBody");
  body.innerHTML = `<div class="card"><div class="cardTitle">تحميل...</div></div>`;

  const rows = await listCol("invoices", { orderArr:["updatedAt","desc"], lim: 250 });

  body.innerHTML = `
    <div class="card">
      <div class="cardHeader">
        <div>
          <div class="cardTitle">قائمة الفواتير</div>
          <div class="cardDesc">يمكنك تعديل الفاتورة، اختيار قالب، أو طباعة PDF</div>
        </div>
        <div style="min-width:320px">
          <input class="input" id="invSearch" placeholder="بحث: رقم فاتورة، زبون، لوحة..." />
        </div>
      </div>
      <div id="invTable"></div>
    </div>
  `;

  const render = (filter="")=>{
    const f = filter.trim().toLowerCase();
    const data = !f ? rows : rows.filter(x=>{
      const t = [
        x.invoiceNo, x.status,
        x.customerSnapshot?.name, x.customerSnapshot?.phone,
        x.vehicleSnapshot?.plate, x.vehicleSnapshot?.model,
      ].join(" ").toLowerCase();
      return t.includes(f);
    });

    $("#invTable").innerHTML = tableHTML({
      columns:[
        { label:"رقم", render:r=> `<b>${escapeHtml(r.invoiceNo||r.id)}</b><div class="smallMuted">WO: ${escapeHtml(r.woNo||"")}</div>` },
        { label:"الزبون", render:r=> `${escapeHtml(r.customerSnapshot?.name||"")}<div class="smallMuted">${escapeHtml(r.customerSnapshot?.phone||"")}</div>` },
        { label:"السيارة", render:r=> `${escapeHtml(r.vehicleSnapshot?.plate||"")}<div class="smallMuted">${escapeHtml(r.vehicleSnapshot?.model||"")}</div>` },
        { label:"الإجمالي", render:r=> `<b>${money(r?.totals?.grandTotal||0, State.settings.currency)}</b>` },
        { label:"الحالة", render:r=> statusPill(r.status) },
        { label:"إجراء", render:r=> `
          <div class="btnRow">
            <button class="btn small ghost" data-edit="${r.id}">تعديل</button>
            <button class="btn small success" data-print="${r.id}">طباعة</button>
            <button class="btn small danger" data-del="${r.id}">حذف</button>
          </div>
        ` },
      ],
      rows:data
    });

    $$("button[data-edit]").forEach(b=> b.onclick = async ()=>{
      const inv = rows.find(x=>x.id===b.dataset.edit);
      openInvoiceEditor(inv);
    });
    $$("button[data-print]").forEach(b=> b.onclick = async ()=>{
      const inv = rows.find(x=>x.id===b.dataset.print);
      await printInvoice(inv.id);
    });
    $$("button[data-del]").forEach(b=> b.onclick = async ()=>{
      if(!await safeConfirm("حذف الفاتورة؟")) return;
      const before = rows.find(x=>x.id===b.dataset.del) || null;
      await del("invoices", b.dataset.del);
      await audit("delete","invoices", b.dataset.del, before, null);
      toast("تم الحذف", "تم حذف الفاتورة.");
      renderInvoices();
    });
  };

  render();
  $("#invSearch").oninput = (e)=> render(e.target.value);
}

function openInvoiceEditor(existing){
  const data = JSON.parse(JSON.stringify(existing||{}));
  data.items = Array.isArray(data.items) ? data.items : [];
  data.discount = Number(data.discount||0);
  data.taxRate = Number(data.taxRate ?? State.settings.taxRate ?? 0);

  const close = modal({
    title: `تعديل فاتورة: ${data.invoiceNo||data.id}`,
    bodyHTML: `
      <div class="row">
        <div class="col-7">
          <div class="card" style="padding:12px">
            <div class="cardTitle">البيانات الأساسية</div>
            <div class="row">
              <div class="col-6">
                <label>الحالة</label>
                <select class="input" id="invStatus">
                  ${["unpaid","partial","paid","void"].map(s=>`<option ${data.status===s?"selected":""} value="${s}">${s}</option>`).join("")}
                </select>
              </div>
              <div class="col-6">
                <label>قالب الفاتورة</label>
                <select class="input" id="tpl">
                  ${State.templates.map(t=>`<option ${data.templateId===t.id?"selected":""} value="${t.id}">${escapeHtml(t.name||t.id)}</option>`).join("")}
                </select>
              </div>
              <div class="col-6">
                <label>خصم</label>
                <input class="input" id="discount" type="number" value="${escapeHtml(String(data.discount||0))}"/>
              </div>
              <div class="col-6">
                <label>ضريبة (%)</label>
                <input class="input" id="taxRate" type="number" value="${escapeHtml(String(data.taxRate||0))}"/>
              </div>
              <div class="col-12">
                <label>ملاحظات</label>
                <textarea class="input" id="invNotes">${escapeHtml(data.notes||"")}</textarea>
              </div>
            </div>
          </div>

          <div class="card" style="padding:12px;margin-top:14px">
            <div class="cardHeader">
              <div>
                <div class="cardTitle">عناصر الفاتورة</div>
                <div class="cardDesc">يمكن ربط القطعة بالمخزون لضمان الخصم الصحيح</div>
              </div>
              <div class="btnRow">
                <button class="btn small ghost" id="addService">+ خدمة</button>
                <button class="btn small ghost" id="addPart">+ قطعة</button>
              </div>
            </div>
            <div id="itemsArea"></div>
          </div>

          <div class="card" style="padding:12px;margin-top:14px">
            <div class="cardTitle">المدفوعات</div>
            <div class="cardDesc">سلفة/دفعة/شبكة/تحويل</div>
            <div id="payArea"></div>
          </div>
        </div>

        <div class="col-5">
          <div class="card" style="padding:12px">
            <div class="cardHeader">
              <div>
                <div class="cardTitle">معاينة الفاتورة (Live)</div>
                <div class="cardDesc">يتحدث فوراً عند التعديل</div>
              </div>
              <div class="btnRow">
                <button class="btn small success" id="btnPrint">طباعة</button>
              </div>
            </div>
            <div class="tableWrap" style="min-width:auto">
              <div id="preview" style="background:#fff;color:#111;border-radius:16px;padding:10px"></div>
            </div>
          </div>

          <div class="card" style="padding:12px;margin-top:14px">
            <div class="cardTitle">ملخص</div>
            <div id="sumBox"></div>
          </div>
        </div>
      </div>
    `,
    footerHTML: `
      <button class="btn primary" id="saveInv">حفظ</button>
      <button class="btn ghost" data-x>إغلاق</button>
    `,
    onMount: async (host, closeModal)=>{
      // load inventory once for linking
      const invItems = await listCol("inventoryItems", { orderArr:["name","asc"], lim: 500 });

      const renderItems = ()=>{
        const wrap = $("#itemsArea", host);
        wrap.innerHTML = data.items.map((it, idx)=>{
          const isPart = String(it.type||"").includes("قط");
          return `
            <div class="row" style="align-items:end;border:1px solid var(--line);border-radius:16px;padding:10px;margin-top:10px">
              <div class="col-3">
                <label>النوع</label>
                <select class="input" data-k="type" data-i="${idx}">
                  ${["خدمة","قطعة"].map(t=>`<option ${(it.type===t)?"selected":""} value="${t}">${t}</option>`).join("")}
                </select>
              </div>
              <div class="col-5">
                <label>الوصف</label>
                <input class="input" data-k="name" data-i="${idx}" value="${escapeHtml(it.name||"")}"/>
              </div>
              <div class="col-2">
                <label>كمية</label>
                <input class="input" data-k="qty" data-i="${idx}" type="number" value="${escapeHtml(String(it.qty||1))}"/>
              </div>
              <div class="col-2">
                <label>سعر</label>
                <input class="input" data-k="price" data-i="${idx}" type="number" value="${escapeHtml(String(it.price||0))}"/>
              </div>

              <div class="col-8">
                <label>ربط بالمخزون (للقطع فقط)</label>
                <select class="input" data-k="inventoryItemId" data-i="${idx}" ${isPart ? "" : "disabled"}>
                  <option value="">— بدون ربط —</option>
                  ${invItems.map(x=>`<option ${(it.inventoryItemId===x.id)?"selected":""} value="${x.id}">${escapeHtml(x.name||"")} • متوفر:${escapeHtml(String(x.stock||0))}</option>`).join("")}
                </select>
              </div>
              <div class="col-4">
                <label>إجراء</label>
                <div class="btnRow">
                  <button class="btn small danger" data-del="${idx}">حذف</button>
                </div>
              </div>
            </div>
          `;
        }).join("") || `<div class="smallMuted">لا توجد عناصر.</div>`;

        // bind
        $$("[data-del]", host).forEach(b=> b.onclick = ()=>{
          data.items.splice(Number(b.dataset.del), 1);
          refreshAll();
        });

        $$("input[data-k], select[data-k]", host).forEach(el=>{
          el.oninput = ()=>{
            const i = Number(el.dataset.i);
            const k = el.dataset.k;
            const v = (k==="qty"||k==="price") ? Number(el.value||0) : el.value;
            data.items[i][k] = v;
            refreshAll();
          };
        });
      };

      const renderPayments = ()=>{
        data.payments = Array.isArray(data.payments) ? data.payments : [];
        const wrap = $("#payArea", host);
        const sumPaid = data.payments.reduce((s,p)=> s + Number(p.amount||0), 0);

        wrap.innerHTML = `
          <div class="pill" style="justify-content:space-between;width:100%">
            <span>المدفوع</span>
            <span><b>${money(sumPaid, State.settings.currency)}</b></span>
          </div>

          ${data.payments.map((p,idx)=>`
            <div class="row" style="align-items:end;border:1px solid var(--line);border-radius:16px;padding:10px;margin-top:10px">
              <div class="col-4">
                <label>النوع</label>
                <select class="input" data-pk="method" data-pi="${idx}">
                  ${["cash","card","transfer","other"].map(m=>`<option ${(p.method===m)?"selected":""} value="${m}">${m}</option>`).join("")}
                </select>
              </div>
              <div class="col-4">
                <label>المبلغ</label>
                <input class="input" data-pk="amount" data-pi="${idx}" type="number" value="${escapeHtml(String(p.amount||0))}"/>
              </div>
              <div class="col-4">
                <label>ملاحظة</label>
                <input class="input" data-pk="note" data-pi="${idx}" value="${escapeHtml(String(p.note||""))}"/>
              </div>
              <div class="col-12">
                <button class="btn small danger" data-pdel="${idx}">حذف دفعة</button>
              </div>
            </div>
          `).join("")}

          <div class="btnRow" style="margin-top:10px">
            <button class="btn small ghost" id="addPay">+ إضافة دفعة</button>
          </div>
        `;

        $("#addPay", host).onclick = ()=>{
          data.payments.push({ method:"cash", amount:0, note:"" });
          refreshAll();
        };

        $$("button[data-pdel]", host).forEach(b=> b.onclick = ()=>{
          data.payments.splice(Number(b.dataset.pdel), 1);
          refreshAll();
        });

        $$("input[data-pk], select[data-pk]", host).forEach(el=>{
          el.oninput = ()=>{
            const i = Number(el.dataset.pi);
            const k = el.dataset.pk;
            data.payments[i][k] = (k==="amount") ? Number(el.value||0) : el.value;
            refreshAll();
          };
        });
      };

      const renderPreview = ()=>{
        const tplId = $("#tpl", host).value;
        const tpl = State.templates.find(t=>t.id===tplId) || State.templates[0];

        const items = data.items.map(it=>{
          const lt = Number(it.qty||0)*Number(it.price||0);
          return {
            type: it.type || "",
            name: it.name || "",
            qty: String(it.qty||0),
            price: money(it.price||0, State.settings.currency),
            lineTotal: money(lt, State.settings.currency),
          };
        });

        const totals = calcInvoiceTotals(data.items, Number($("#discount", host).value||0), Number($("#taxRate", host).value||0));
        const payload = {
          workshopName: State.settings.workshopName || "RPM",
          invoiceNo: data.invoiceNo || "",
          date: nowISO(),
          customerName: data.customerSnapshot?.name || "",
          customerPhone: data.customerSnapshot?.phone || "",
          plate: data.vehicleSnapshot?.plate || "",
          carModel: data.vehicleSnapshot?.model || "",
          carYear: data.vehicleSnapshot?.year || "",
          km: String(data.vehicleSnapshot?.km||0),
          items,
          subTotal: money(totals.subTotal, State.settings.currency),
          discount: money(totals.discount, State.settings.currency),
          tax: money(totals.tax, State.settings.currency),
          grandTotal: money(totals.grandTotal, State.settings.currency),
          notes: $("#invNotes", host).value || "",
        };

        const html = renderTemplate(tpl.html||"", payload);
        $("#preview", host).innerHTML = `
          <style>${tpl.css||""}</style>
          <div>${html}</div>
        `;

        $("#sumBox", host).innerHTML = `
          <div class="pill" style="justify-content:space-between;width:100%">
            <span>المجموع</span><span><b>${money(totals.subTotal, State.settings.currency)}</b></span>
          </div>
          <div class="pill" style="justify-content:space-between;width:100%;margin-top:8px">
            <span>خصم</span><span><b>${money(totals.discount, State.settings.currency)}</b></span>
          </div>
          <div class="pill" style="justify-content:space-between;width:100%;margin-top:8px">
            <span>ضريبة</span><span><b>${money(totals.tax, State.settings.currency)}</b></span>
          </div>
          <div class="pill ok" style="justify-content:space-between;width:100%;margin-top:8px">
            <span>الإجمالي</span><span><b>${money(totals.grandTotal, State.settings.currency)}</b></span>
          </div>
        `;
      };

      const refreshAll = ()=>{
        // sync header fields
        data.status = $("#invStatus", host).value;
        data.templateId = $("#tpl", host).value;
        data.discount = Number($("#discount", host).value||0);
        data.taxRate = Number($("#taxRate", host).value||0);
        data.notes = $("#invNotes", host).value;

        renderItems();
        renderPayments();
        renderPreview();
      };

      $("#addService", host).onclick = ()=>{
        data.items.push({ type:"خدمة", name:"", qty:1, price:0, inventoryItemId:"" });
        refreshAll();
      };
      $("#addPart", host).onclick = ()=>{
        data.items.push({ type:"قطعة", name:"", qty:1, price:0, inventoryItemId:"" });
        refreshAll();
      };

      $("#btnPrint", host).onclick = async ()=>{ await printInvoice(data.id); };

      // bind top fields
      ["invStatus","tpl","discount","taxRate","invNotes"].forEach(id=>{
        $("#"+id, host).oninput = ()=> renderPreview();
      });

      refreshAll();

      $("#saveInv", host).onclick = async ()=>{
        try{
          const before = existing;
          const totals = calcInvoiceTotals(data.items, data.discount, data.taxRate);

          // إذا سياسة الخصم عند paid: عند تغيير للحالة paid نخصم المخزون
          const policy = (State.settings?.stockConsumePolicy||"invoice_create");
          const becamePaid = policy==="invoice_paid" && before.status!=="paid" && data.status==="paid";
          if(becamePaid){
            await consumeStockForInvoiceItems(data.items);
          }

          data.totals = totals;
          await upd("invoices", data.id, data);
          await audit("update","invoices", data.id, before, data);

          toast("تم الحفظ", `فاتورة: ${data.invoiceNo}`);
          closeModal();
          renderInvoices();
        }catch(e){
          toast("خطأ", e.message);
        }
      };
    }
  });
}

async function printInvoice(invoiceId){
  const inv = await getOne(doc(db,"invoices", invoiceId));
  if(!inv){ toast("غير موجود","تعذر إيجاد الفاتورة."); return; }
  const tpl = State.templates.find(t=>t.id===inv.templateId) || State.templates[0];
  const items = (inv.items||[]).map(it=>{
    const lt = Number(it.qty||0)*Number(it.price||0);
    return {
      type: it.type || "",
      name: it.name || "",
      qty: String(it.qty||0),
      price: money(it.price||0, State.settings.currency),
      lineTotal: money(lt, State.settings.currency),
    };
  });
  const payload = {
    workshopName: State.settings.workshopName || "RPM",
    invoiceNo: inv.invoiceNo || "",
    date: nowISO(),
    customerName: inv.customerSnapshot?.name || "",
    customerPhone: inv.customerSnapshot?.phone || "",
    plate: inv.vehicleSnapshot?.plate || "",
    carModel: inv.vehicleSnapshot?.model || "",
    carYear: inv.vehicleSnapshot?.year || "",
    km: String(inv.vehicleSnapshot?.km||0),
    items,
    subTotal: money(inv?.totals?.subTotal||0, State.settings.currency),
    discount: money(inv?.totals?.discount||0, State.settings.currency),
    tax: money(inv?.totals?.tax||0, State.settings.currency),
    grandTotal: money(inv?.totals?.grandTotal||0, State.settings.currency),
    notes: inv.notes || "",
  };

  const html = renderTemplate(tpl.html||"", payload);

  const w = window.open("", "_blank");
  w.document.write(`
    <!doctype html><html lang="ar" dir="rtl">
    <head><meta charset="utf-8"/><title>${escapeHtml(inv.invoiceNo||"Invoice")}</title>
    <style>${tpl.css||""}</style></head>
    <body>${html}
      <script>window.onload=()=>{window.print();}</script>
    </body></html>
  `);
  w.document.close();
}

/* =========================
   Inventory
========================= */
async function renderInventory(){
  const outlet = $("#routeOutlet");
  outlet.innerHTML = pageLayout({
    title:"المخزون",
    subtitle:"قطع الغيار + تنبيه نفاد + ربط مع الفواتير",
    actionsHTML: `
      <button class="btn primary" id="newItem">إضافة صنف</button>
      <button class="btn ghost" id="refreshInvn">تحديث</button>
    `
  });
  $("#refreshInvn").onclick = ()=> renderInventory();
  $("#newItem").onclick = ()=> openInventoryEditor();

  const body = $("#pageBody");
  body.innerHTML = `<div class="card"><div class="cardTitle">تحميل...</div></div>`;

  const rows = await listCol("inventoryItems", { orderArr:["updatedAt","desc"], lim: 600 });

  body.innerHTML = `
    <div class="card">
      <div class="cardHeader">
        <div>
          <div class="cardTitle">قائمة القطع</div>
          <div class="cardDesc">يمكن تعديل الكلفة/السعر/المتوفر/الحد الأدنى</div>
        </div>
        <div style="min-width:320px">
          <input class="input" id="invnSearch" placeholder="بحث: اسم، SKU، باركود..." />
        </div>
      </div>
      <div id="invnTable"></div>
    </div>
  `;

  const render = (filter="")=>{
    const f = filter.trim().toLowerCase();
    const data = !f ? rows : rows.filter(x=>{
      const t = [x.name,x.sku,x.barcode,x.brand,x.location].join(" ").toLowerCase();
      return t.includes(f);
    });

    $("#invnTable").innerHTML = tableHTML({
      columns:[
        { label:"الصنف", render:r=> `<b>${escapeHtml(r.name||"")}</b><div class="smallMuted">SKU: ${escapeHtml(r.sku||"")}</div>` },
        { label:"المتوفر", render:r=>{
          const s = Number(r.stock||0), m = Number(r.minStock||0);
          const cls = s<=m ? "pill warn" : "pill";
          return `<span class="${cls}">${escapeHtml(String(s))}</span><div class="smallMuted">Min: ${escapeHtml(String(m))}</div>`;
        }},
        { label:"كلفة/بيع", render:r=> `${money(r.cost||0, State.settings.currency)}<div class="smallMuted">${money(r.price||0, State.settings.currency)}</div>`},
        { label:"الموقع", render:r=> `${escapeHtml(r.location||"")}<div class="smallMuted">${escapeHtml(r.brand||"")}</div>`},
        { label:"إجراء", render:r=> `
          <div class="btnRow">
            <button class="btn small ghost" data-edit="${r.id}">تعديل</button>
            <button class="btn small danger" data-del="${r.id}">حذف</button>
          </div>
        `}
      ],
      rows:data
    });

    $$("button[data-edit]").forEach(b=> b.onclick = ()=> openInventoryEditor(rows.find(x=>x.id===b.dataset.edit)));
    $$("button[data-del]").forEach(b=> b.onclick = async ()=>{
      if(!await safeConfirm("حذف الصنف؟")) return;
      const before = rows.find(x=>x.id===b.dataset.del) || null;
      await del("inventoryItems", b.dataset.del);
      await audit("delete","inventoryItems", b.dataset.del, before, null);
      toast("تم الحذف","تم حذف الصنف.");
      renderInventory();
    });
  };

  render();
  $("#invnSearch").oninput = (e)=> render(e.target.value);
}

function openInventoryEditor(existing=null){
  const data = existing ? JSON.parse(JSON.stringify(existing)) : {
    name:"", sku:"", barcode:"", brand:"", unit:"قطعة",
    cost:0, price:0, stock:0, minStock:0, location:""
  };

  modal({
    title: existing ? `تعديل صنف: ${existing.name||existing.id}` : "إضافة صنف",
    bodyHTML: `
      <div class="row">
        <div class="col-6"><label>الاسم</label><input class="input" id="name" value="${escapeHtml(data.name)}"/></div>
        <div class="col-3"><label>SKU</label><input class="input" id="sku" value="${escapeHtml(data.sku||"")}"/></div>
        <div class="col-3"><label>باركود</label><input class="input" id="barcode" value="${escapeHtml(data.barcode||"")}"/></div>

        <div class="col-4"><label>العلامة</label><input class="input" id="brand" value="${escapeHtml(data.brand||"")}"/></div>
        <div class="col-4"><label>الوحدة</label><input class="input" id="unit" value="${escapeHtml(data.unit||"قطعة")}"/></div>
        <div class="col-4"><label>الموقع</label><input class="input" id="location" value="${escapeHtml(data.location||"")}"/></div>

        <div class="col-3"><label>الكلفة</label><input class="input" id="cost" type="number" value="${escapeHtml(String(data.cost||0))}"/></div>
        <div class="col-3"><label>سعر البيع</label><input class="input" id="price" type="number" value="${escapeHtml(String(data.price||0))}"/></div>
        <div class="col-3"><label>المتوفر</label><input class="input" id="stock" type="number" value="${escapeHtml(String(data.stock||0))}"/></div>
        <div class="col-3"><label>حد أدنى</label><input class="input" id="minStock" type="number" value="${escapeHtml(String(data.minStock||0))}"/></div>
      </div>
    `,
    footerHTML: `
      <button class="btn primary" id="save">حفظ</button>
      <button class="btn ghost" data-x>إغلاق</button>
    `,
    onMount:(host, close)=>{
      $("#save", host).onclick = async ()=>{
        try{
          const payload = {
            name: $("#name", host).value.trim(),
            sku: $("#sku", host).value.trim(),
            barcode: $("#barcode", host).value.trim(),
            brand: $("#brand", host).value.trim(),
            unit: $("#unit", host).value.trim(),
            location: $("#location", host).value.trim(),
            cost: Number($("#cost", host).value||0),
            price: Number($("#price", host).value||0),
            stock: Number($("#stock", host).value||0),
            minStock: Number($("#minStock", host).value||0),
          };

          if(!existing){
            const id = await addCol("inventoryItems", payload);
            await audit("create","inventoryItems", id, null, payload);
            toast("تمت الإضافة", payload.name);
          }else{
            const before = existing;
            await upd("inventoryItems", existing.id, payload);
            await audit("update","inventoryItems", existing.id, before, payload);
            toast("تم التحديث", payload.name);
          }
          close();
          renderInventory();
        }catch(e){
          toast("خطأ", e.message);
        }
      };
    }
  });
}

/* =========================
   Suppliers
========================= */
async function renderSuppliers(){
  const outlet = $("#routeOutlet");
  outlet.innerHTML = pageLayout({
    title:"الموردين",
    subtitle:"إضافة/تعديل/حذف الموردين",
    actionsHTML: `
      <button class="btn primary" id="newSup">إضافة مورد</button>
      <button class="btn ghost" id="refreshSup">تحديث</button>
    `
  });
  $("#refreshSup").onclick = ()=> renderSuppliers();
  $("#newSup").onclick = ()=> openSupplierEditor();

  const body = $("#pageBody");
  body.innerHTML = `<div class="card"><div class="cardTitle">تحميل...</div></div>`;

  const rows = await listCol("suppliers", { orderArr:["updatedAt","desc"], lim: 400 });

  body.innerHTML = `
    <div class="card">
      <div class="cardHeader">
        <div><div class="cardTitle">قائمة الموردين</div><div class="cardDesc">تستخدم في المشتريات</div></div>
        <div style="min-width:320px"><input class="input" id="supSearch" placeholder="بحث..." /></div>
      </div>
      <div id="supTable"></div>
    </div>
  `;

  const render=(filter="")=>{
    const f = filter.trim().toLowerCase();
    const data = !f ? rows : rows.filter(x=> [x.name,x.phone,x.address].join(" ").toLowerCase().includes(f));
    $("#supTable").innerHTML = tableHTML({
      columns:[
        { label:"الاسم", render:r=> `<b>${escapeHtml(r.name||"")}</b>` },
        { label:"الهاتف", key:"phone" },
        { label:"العنوان", key:"address" },
        { label:"إجراء", render:r=> `
          <div class="btnRow">
            <button class="btn small ghost" data-edit="${r.id}">تعديل</button>
            <button class="btn small danger" data-del="${r.id}">حذف</button>
          </div>
        `}
      ],
      rows:data
    });

    $$("button[data-edit]").forEach(b=> b.onclick = ()=> openSupplierEditor(rows.find(x=>x.id===b.dataset.edit)));
    $$("button[data-del]").forEach(b=> b.onclick = async ()=>{
      if(!await safeConfirm("حذف المورد؟")) return;
      const before = rows.find(x=>x.id===b.dataset.del) || null;
      await del("suppliers", b.dataset.del);
      await audit("delete","suppliers", b.dataset.del, before, null);
      toast("تم الحذف","تم حذف المورد.");
      renderSuppliers();
    });
  };

  render();
  $("#supSearch").oninput = (e)=> render(e.target.value);
}

function openSupplierEditor(existing=null){
  const data = existing ? JSON.parse(JSON.stringify(existing)) : { name:"", phone:"", address:"" };
  modal({
    title: existing ? `تعديل مورد: ${existing.name}` : "إضافة مورد",
    bodyHTML: `
      <div class="row">
        <div class="col-6"><label>الاسم</label><input class="input" id="name" value="${escapeHtml(data.name||"")}"/></div>
        <div class="col-6"><label>الهاتف</label><input class="input" id="phone" value="${escapeHtml(data.phone||"")}"/></div>
        <div class="col-12"><label>العنوان</label><input class="input" id="address" value="${escapeHtml(data.address||"")}"/></div>
      </div>
    `,
    footerHTML: `<button class="btn primary" id="save">حفظ</button><button class="btn ghost" data-x>إغلاق</button>`,
    onMount:(host, close)=>{
      $("#save", host).onclick = async ()=>{
        try{
          const payload = {
            name: $("#name", host).value.trim(),
            phone: $("#phone", host).value.trim(),
            address: $("#address", host).value.trim(),
          };
          if(!existing){
            const id = await addCol("suppliers", payload);
            await audit("create","suppliers", id, null, payload);
            toast("تمت الإضافة", payload.name);
          }else{
            const before = existing;
            await upd("suppliers", existing.id, payload);
            await audit("update","suppliers", existing.id, before, payload);
            toast("تم التحديث", payload.name);
          }
          close();
          renderSuppliers();
        }catch(e){ toast("خطأ", e.message); }
      };
    }
  });
}

/* =========================
   Purchases (فاتورة شراء + تحديث مخزون)
========================= */
async function renderPurchases(){
  const outlet = $("#routeOutlet");
  outlet.innerHTML = pageLayout({
    title:"المشتريات",
    subtitle:"إضافة فاتورة شراء للمورد وتحديث المخزون",
    actionsHTML: `
      <button class="btn primary" id="newPO">فاتورة شراء جديدة</button>
      <button class="btn ghost" id="refreshPO">تحديث</button>
    `
  });
  $("#refreshPO").onclick = ()=> renderPurchases();
  $("#newPO").onclick = ()=> openPurchaseEditor();

  const body = $("#pageBody");
  body.innerHTML = `<div class="card"><div class="cardTitle">تحميل...</div></div>`;

  const rows = await listCol("purchaseOrders", { orderArr:["updatedAt","desc"], lim: 250 });

  body.innerHTML = `
    <div class="card">
      <div class="cardHeader">
        <div><div class="cardTitle">فواتير الشراء</div><div class="cardDesc">عند اعتماد الشراء يتم إضافة الكميات للمخزون</div></div>
      </div>
      <div id="poTable"></div>
    </div>
  `;

  $("#poTable").innerHTML = tableHTML({
    columns:[
      { label:"رقم", render:r=> `<b>${escapeHtml(r.poNo||r.id)}</b>` },
      { label:"المورد", render:r=> `${escapeHtml(r.supplierSnapshot?.name||"")}` },
      { label:"الحالة", render:r=> statusPill(r.status) },
      { label:"الإجمالي", render:r=> `<b>${money(r?.totals?.grandTotal||0, State.settings.currency)}</b>` },
      { label:"إجراء", render:r=> `
        <div class="btnRow">
          <button class="btn small ghost" data-edit="${r.id}">تعديل</button>
          <button class="btn small danger" data-del="${r.id}">حذف</button>
        </div>
      `}
    ],
    rows
  });

  $$("button[data-edit]").forEach(b=> b.onclick = ()=> openPurchaseEditor(rows.find(x=>x.id===b.dataset.edit)));
  $$("button[data-del]").forEach(b=> b.onclick = async ()=>{
    if(!await safeConfirm("حذف فاتورة الشراء؟")) return;
    const before = rows.find(x=>x.id===b.dataset.del)||null;
    await del("purchaseOrders", b.dataset.del);
    await audit("delete","purchaseOrders", b.dataset.del, before, null);
    toast("تم الحذف","تم حذف فاتورة الشراء.");
    renderPurchases();
  });
}

function openPurchaseEditor(existing=null){
  const data = existing ? JSON.parse(JSON.stringify(existing)) : {
    poNo:"", status:"draft",
    supplierId:"", supplierSnapshot:{},
    items: [], discount:0, taxRate:0, totals:{subTotal:0,discount:0,tax:0,grandTotal:0},
    notes:""
  };

  modal({
    title: existing ? `تعديل شراء: ${existing.poNo||existing.id}` : "فاتورة شراء جديدة",
    bodyHTML: `
      <div class="row">
        <div class="col-6">
          <label>المورد</label>
          <select class="input" id="supSel"></select>
        </div>
        <div class="col-3">
          <label>الحالة</label>
          <select class="input" id="st">
            ${["draft","posted"].map(s=>`<option ${(data.status===s)?"selected":""} value="${s}">${s}</option>`).join("")}
          </select>
        </div>
        <div class="col-3">
          <label>خصم</label>
          <input class="input" id="disc" type="number" value="${escapeHtml(String(data.discount||0))}"/>
        </div>

        <div class="col-12">
          <div class="card" style="padding:12px">
            <div class="cardHeader">
              <div>
                <div class="cardTitle">عناصر الشراء</div>
                <div class="cardDesc">العنصر مرتبط بالمخزون (إضافة كمية + تحديث كلفة)</div>
              </div>
              <div class="btnRow">
                <button class="btn small ghost" id="add">+ إضافة صنف</button>
              </div>
            </div>
            <div id="items"></div>
          </div>
        </div>

        <div class="col-12">
          <label>ملاحظات</label>
          <textarea class="input" id="notes">${escapeHtml(data.notes||"")}</textarea>
        </div>

        <div class="col-12">
          <div id="sum" class="pill ok" style="justify-content:space-between;width:100%"></div>
        </div>
      </div>
    `,
    footerHTML: `
      <button class="btn primary" id="save">حفظ</button>
      <button class="btn success" id="post">اعتماد (تحديث مخزون)</button>
      <button class="btn ghost" data-x>إغلاق</button>
    `,
    onMount: async (host, close)=>{
      const suppliers = await listCol("suppliers", { orderArr:["name","asc"], lim: 500 });
      const invItems = await listCol("inventoryItems", { orderArr:["name","asc"], lim: 800 });

      $("#supSel", host).innerHTML = `
        <option value="">— اختر مورد —</option>
        ${suppliers.map(s=>`<option ${(data.supplierId===s.id)?"selected":""} value="${s.id}">${escapeHtml(s.name||"")}</option>`).join("")}
      `;

      const refresh = ()=>{
        const wrap = $("#items", host);
        wrap.innerHTML = data.items.map((it,idx)=>`
          <div class="row" style="align-items:end;border:1px solid var(--line);border-radius:16px;padding:10px;margin-top:10px">
            <div class="col-7">
              <label>الصنف (مخزون)</label>
              <select class="input" data-k="inventoryItemId" data-i="${idx}">
                <option value="">— اختر —</option>
                ${invItems.map(x=>`<option ${(it.inventoryItemId===x.id)?"selected":""} value="${x.id}">${escapeHtml(x.name||"")} • متوفر:${escapeHtml(String(x.stock||0))}</option>`).join("")}
              </select>
            </div>
            <div class="col-2">
              <label>الكمية</label>
              <input class="input" data-k="qty" data-i="${idx}" type="number" value="${escapeHtml(String(it.qty||1))}"/>
            </div>
            <div class="col-3">
              <label>كلفة الوحدة</label>
              <input class="input" data-k="cost" data-i="${idx}" type="number" value="${escapeHtml(String(it.cost||0))}"/>
            </div>
            <div class="col-12">
              <button class="btn small danger" data-del="${idx}">حذف</button>
            </div>
          </div>
        `).join("") || `<div class="smallMuted">لا يوجد عناصر.</div>`;

        $$("button[data-del]", host).forEach(b=> b.onclick = ()=>{
          data.items.splice(Number(b.dataset.del), 1);
          refresh();
        });

        $$("input[data-k], select[data-k]", host).forEach(el=>{
          el.oninput = ()=>{
            const i = Number(el.dataset.i);
            const k = el.dataset.k;
            data.items[i][k] = (k==="qty"||k==="cost") ? Number(el.value||0) : el.value;
            refresh();
          };
        });

        const sub = data.items.reduce((s,it)=> s + (Number(it.qty||0)*Number(it.cost||0)), 0);
        const discount = Number($("#disc", host).value||0);
        const grand = Math.max(sub - discount, 0);
        data.discount = discount;
        data.totals = { subTotal: sub, discount, tax:0, grandTotal: grand };
        $("#sum", host).innerHTML = `<span>الإجمالي</span><span><b>${money(grand, State.settings.currency)}</b></span>`;
      };

      $("#add", host).onclick = ()=>{
        data.items.push({ inventoryItemId:"", qty:1, cost:0 });
        refresh();
      };
      refresh();

      async function saveOnly(){
        const supplierId = $("#supSel", host).value;
        const supplier = suppliers.find(s=>s.id===supplierId) || null;
        data.supplierId = supplierId;
        data.supplierSnapshot = supplier ? { name:supplier.name||"", phone:supplier.phone||"" } : {};
        data.status = $("#st", host).value;
        data.notes = $("#notes", host).value;

        if(!existing){
          data.poNo = await nextNumber("po");
          const id = await addCol("purchaseOrders", { ...data, createdBy: State.user?.uid || "" });
          await audit("create","purchaseOrders", id, null, data);
          toast("تم الحفظ", data.poNo);
        }else{
          const before = existing;
          await upd("purchaseOrders", existing.id, data);
          await audit("update","purchaseOrders", existing.id, before, data);
          toast("تم التحديث", data.poNo||existing.id);
        }
      }

      $("#save", host).onclick = async ()=>{
        try{
          await saveOnly();
          close();
          renderPurchases();
        }catch(e){ toast("خطأ", e.message); }
      };

      $("#post", host).onclick = async ()=>{
        try{
          // احفظ أولاً
          await saveOnly();

          // اعتماد = تحديث مخزون: +qty وتحديث cost (اختياري)
          const id = existing?.id ? existing.id : null;
          if(!id){
            toast("تنبيه","افتح الفاتورة بعد الحفظ واعتمدها.");
            close();
            return;
          }

          await runTransaction(db, async (tx)=>{
            for(const it of data.items){
              if(!it.inventoryItemId) continue;
              const ref = doc(db,"inventoryItems", it.inventoryItemId);
              const snap = await tx.get(ref);
              if(!snap.exists()) continue;
              const cur = snap.data();
              const newStock = Number(cur.stock||0) + Number(it.qty||0);
              tx.update(ref, {
                stock: newStock,
                cost: Number(it.cost||cur.cost||0),
                updatedAt: serverTimestamp()
              });
            }
            tx.update(doc(db,"purchaseOrders", id), { status:"posted", updatedAt: serverTimestamp() });
          });

          await audit("post","purchaseOrders", id, { status:data.status }, { status:"posted" });
          toast("تم الاعتماد","تم تحديث المخزون.");
          close();
          renderPurchases();
        }catch(e){ toast("خطأ", e.message); }
      };
    }
  });
}

/* =========================
   Customers & Vehicles
========================= */
async function renderCustomers(){
  const outlet = $("#routeOutlet");
  outlet.innerHTML = pageLayout({
    title:"الزبائن والسيارات",
    subtitle:"إدارة عامة — (لكن إنشاء الزبون/السيارة يحدث تلقائياً من أمر الشغل)",
    actionsHTML:`<button class="btn ghost" id="refreshC">تحديث</button>`
  });
  $("#refreshC").onclick = ()=> renderCustomers();

  const body = $("#pageBody");
  body.innerHTML = `<div class="card"><div class="cardTitle">تحميل...</div></div>`;

  const customers = await listCol("customers", { orderArr:["updatedAt","desc"], lim: 300 });

  body.innerHTML = `
    <div class="card">
      <div class="cardHeader">
        <div><div class="cardTitle">الزبائن</div><div class="cardDesc">يمكن تعديل الاسم/الهاتف</div></div>
        <div style="min-width:320px"><input class="input" id="cSearch" placeholder="بحث..." /></div>
      </div>
      <div id="cTable"></div>
    </div>
  `;

  const render=(filter="")=>{
    const f = filter.trim().toLowerCase();
    const data = !f ? customers : customers.filter(x=> [x.name,x.phone].join(" ").toLowerCase().includes(f));
    $("#cTable").innerHTML = tableHTML({
      columns:[
        { label:"الاسم", render:r=> `<b>${escapeHtml(r.name||"")}</b>` },
        { label:"الهاتف", key:"phone" },
        { label:"إجراء", render:r=> `
          <div class="btnRow">
            <button class="btn small ghost" data-edit="${r.id}">تعديل</button>
            <button class="btn small danger" data-del="${r.id}">حذف</button>
          </div>
        `}
      ],
      rows:data
    });

    $$("button[data-edit]").forEach(b=> b.onclick = ()=> openCustomerEditor(customers.find(x=>x.id===b.dataset.edit)));
    $$("button[data-del]").forEach(b=> b.onclick = async ()=>{
      if(!await safeConfirm("حذف الزبون؟")) return;
      const before = customers.find(x=>x.id===b.dataset.del)||null;
      await del("customers", b.dataset.del);
      await audit("delete","customers", b.dataset.del, before, null);
      toast("تم الحذف","تم حذف الزبون.");
      renderCustomers();
    });
  };

  render();
  $("#cSearch").oninput = (e)=> render(e.target.value);
}

function openCustomerEditor(existing){
  const data = JSON.parse(JSON.stringify(existing));
  modal({
    title:`تعديل زبون: ${data.name||data.id}`,
    bodyHTML: `
      <div class="row">
        <div class="col-6"><label>الاسم</label><input class="input" id="name" value="${escapeHtml(data.name||"")}"/></div>
        <div class="col-6"><label>الهاتف</label><input class="input" id="phone" value="${escapeHtml(data.phone||"")}"/></div>
      </div>
    `,
    footerHTML:`<button class="btn primary" id="save">حفظ</button><button class="btn ghost" data-x>إغلاق</button>`,
    onMount:(host, close)=>{
      $("#save", host).onclick = async ()=>{
        try{
          const payload = { name: $("#name", host).value.trim(), phone: $("#phone", host).value.trim() };
          await upd("customers", data.id, payload);
          await audit("update","customers", data.id, existing, payload);
          toast("تم الحفظ","تم تحديث الزبون.");
          close(); renderCustomers();
        }catch(e){ toast("خطأ", e.message); }
      };
    }
  });
}

/* =========================
   Reports (Basic)
========================= */
async function renderReports(){
  const outlet = $("#routeOutlet");
  outlet.innerHTML = pageLayout({
    title:"التقارير",
    subtitle:"مبيعات تقريبية + تنبيهات مخزون",
    actionsHTML:`<button class="btn ghost" id="refreshR">تحديث</button>`
  });
  $("#refreshR").onclick = ()=> renderReports();

  const body = $("#pageBody");
  body.innerHTML = `<div class="card"><div class="cardTitle">تحميل...</div></div>`;

  const invoices = await listCol("invoices", { orderArr:["updatedAt","desc"], lim: 200 });
  const invn = await listCol("inventoryItems", { orderArr:["updatedAt","desc"], lim: 600 });
  const sales = invoices.reduce((s,i)=> s + Number(i?.totals?.grandTotal||0), 0);
  const paid = invoices.filter(x=>x.status==="paid").reduce((s,i)=> s + Number(i?.totals?.grandTotal||0), 0);
  const low = invn.filter(x=> Number(x.stock||0) <= Number(x.minStock||0));

  body.innerHTML = `
    <div class="grid">
      <div class="card" style="grid-column:span 6">
        <div class="cardTitle">المبيعات</div>
        <div class="cardDesc">آخر 200 فاتورة</div>
        <hr/>
        <div class="pill ok" style="justify-content:space-between;width:100%">
          <span>إجمالي</span><span><b>${money(sales, State.settings.currency)}</b></span>
        </div>
        <div class="pill" style="justify-content:space-between;width:100%;margin-top:10px">
          <span>مدفوع (Paid)</span><span><b>${money(paid, State.settings.currency)}</b></span>
        </div>
        <div class="smallMuted" style="margin-top:10px">* تقرير مبسط — يمكن توسعته لاحقاً.</div>
      </div>

      <div class="card" style="grid-column:span 6">
        <div class="cardTitle">تنبيه المخزون</div>
        <div class="cardDesc">الأصناف تحت الحد الأدنى</div>
        <hr/>
        ${low.length ? `
          ${low.slice(0,20).map(x=>`
            <div class="pill warn" style="justify-content:space-between;width:100%;margin-top:10px">
              <span>${escapeHtml(x.name||"")}</span>
              <span>${escapeHtml(String(x.stock||0))} / Min:${escapeHtml(String(x.minStock||0))}</span>
            </div>
          `).join("")}
        ` : `<div class="smallMuted">لا توجد تنبيهات ✅</div>`}
      </div>
    </div>
  `;
}

/* =========================
   Templates Manager (Admin)
========================= */
async function renderTemplates(){
  if(!requireAdmin()) return;
  const outlet = $("#routeOutlet");
  outlet.innerHTML = pageLayout({
    title:"قوالب الفواتير",
    subtitle:"محرر HTML/CSS + معاينة مباشرة + اختيار الافتراضي",
    actionsHTML: `
      <button class="btn primary" id="newTpl">قالب جديد</button>
      <button class="btn ghost" id="refreshTpl">تحديث</button>
    `
  });
  $("#refreshTpl").onclick = ()=> bootstrap(true);
  $("#newTpl").onclick = ()=> openTemplateEditor();

  const body = $("#pageBody");
  const rows = await listCol("invoiceTemplates", { orderArr:["name","asc"], lim: 300 });

  body.innerHTML = `
    <div class="card">
      <div class="cardHeader">
        <div><div class="cardTitle">القوالب</div><div class="cardDesc">استخدم {{ }} للحقول و {{#items}} للقائمة</div></div>
      </div>
      <div id="tplTable"></div>
    </div>
  `;

  $("#tplTable").innerHTML = tableHTML({
    columns:[
      { label:"الاسم", render:r=> `<b>${escapeHtml(r.name||r.id)}</b><div class="smallMuted">${escapeHtml(r.id)}</div>` },
      { label:"Built-in", render:r=> r.builtIn ? `<span class="pill ok">نعم</span>` : `<span class="pill">لا</span>` },
      { label:"إجراء", render:r=> `
        <div class="btnRow">
          <button class="btn small ghost" data-edit="${r.id}">تعديل</button>
          <button class="btn small danger" data-del="${r.id}">حذف</button>
        </div>
      `}
    ],
    rows
  });

  $$("button[data-edit]").forEach(b=> b.onclick = ()=> openTemplateEditor(rows.find(x=>x.id===b.dataset.edit)));
  $$("button[data-del]").forEach(b=> b.onclick = async ()=>{
    const t = rows.find(x=>x.id===b.dataset.del);
    if(t?.builtIn){
      toast("ممنوع","لا يمكن حذف القوالب المدمجة.");
      return;
    }
    if(!await safeConfirm("حذف القالب؟")) return;
    await del("invoiceTemplates", b.dataset.del);
    await audit("delete","invoiceTemplates", b.dataset.del, t, null);
    toast("تم الحذف","تم حذف القالب.");
    bootstrap(true);
  });
}

function openTemplateEditor(existing=null){
  if(!requireAdmin()) return;

  const data = existing ? JSON.parse(JSON.stringify(existing)) : {
    id: "tpl_" + uid().slice(0,8),
    name:"قالب جديد",
    html: DEFAULT_TEMPLATES[0].html,
    css: DEFAULT_TEMPLATES[0].css,
    builtIn:false
  };

  modal({
    title: existing ? `تعديل قالب: ${data.name}` : "قالب جديد",
    bodyHTML: `
      <div class="row">
        <div class="col-4">
          <label>Template ID</label>
          <input class="input" id="tid" value="${escapeHtml(data.id)}" ${existing ? "disabled" : ""}/>
        </div>
        <div class="col-8">
          <label>الاسم</label>
          <input class="input" id="tname" value="${escapeHtml(data.name)}"/>
        </div>

        <div class="col-6">
          <label>CSS</label>
          <textarea class="input" id="tcss" style="min-height:260px">${escapeHtml(data.css||"")}</textarea>
        </div>
        <div class="col-6">
          <label>HTML</label>
          <textarea class="input" id="thtml" style="min-height:260px">${escapeHtml(data.html||"")}</textarea>
        </div>

        <div class="col-12">
          <div class="card" style="padding:12px">
            <div class="cardHeader">
              <div><div class="cardTitle">معاينة</div><div class="cardDesc">عناصر تجريبية</div></div>
            </div>
            <div id="prev" style="background:#fff;color:#111;border-radius:16px;padding:10px"></div>
          </div>
        </div>

        <div class="col-12 smallMuted">
          مفاتيح جاهزة: {{invoiceNo}}, {{date}}, {{customerName}}, {{customerPhone}}, {{plate}}, {{carModel}}, {{carYear}}, {{km}}, {{subTotal}}, {{discount}}, {{tax}}, {{grandTotal}}, {{notes}}
          <br/>قائمة العناصر: {{#items}} ... {{/items}} وبداخلها: {{type}}, {{name}}, {{qty}}, {{price}}, {{lineTotal}}
        </div>
      </div>
    `,
    footerHTML: `
      <button class="btn primary" id="save">حفظ</button>
      <button class="btn success" id="setDefault">تعيين كافتراضي</button>
      <button class="btn ghost" data-x>إغلاق</button>
    `,
    onMount:(host, close)=>{
      const sample = {
        workshopName: State.settings.workshopName || "RPM",
        invoiceNo: "INV-2026-000001",
        date: nowISO(),
        customerName: "مثال زبون",
        customerPhone: "07xxxxxxxxx",
        plate: "بغداد 12345",
        carModel: "Camry",
        carYear: "2020",
        km: "120000",
        items:[
          { type:"خدمة", name:"تبديل دهن", qty:"1", price:"10000", lineTotal:"10000" },
          { type:"قطعة", name:"فلتر زيت", qty:"1", price:"5000", lineTotal:"5000" },
        ],
        subTotal:"15000", discount:"0", tax:"0", grandTotal:"15000", notes:"ملاحظة تجريبية"
      };

      const renderPrev = ()=>{
        const html = $("#thtml", host).value;
        const css = $("#tcss", host).value;
        $("#prev", host).innerHTML = `<style>${css}</style>${renderTemplate(html, sample)}`;
      };

      $("#thtml", host).oninput = renderPrev;
      $("#tcss", host).oninput = renderPrev;
      renderPrev();

      $("#save", host).onclick = async ()=>{
        try{
          const id = existing ? data.id : $("#tid", host).value.trim();
          const payload = {
            name: $("#tname", host).value.trim(),
            html: $("#thtml", host).value,
            css: $("#tcss", host).value,
            builtIn: !!existing?.builtIn
          };
          await setDocId("invoiceTemplates", id, payload, true);
          await audit(existing ? "update":"create", "invoiceTemplates", id, existing||null, payload);
          toast("تم الحفظ", payload.name);
          close();
          bootstrap(true);
        }catch(e){ toast("خطأ", e.message); }
      };

      $("#setDefault", host).onclick = async ()=>{
        try{
          const id = existing ? data.id : $("#tid", host).value.trim();
          await upd("settings","app", { defaultInvoiceTemplateId: id });
          await audit("update","settings","app", null, { defaultInvoiceTemplateId:id });
          toast("تم", "تم تعيين القالب الافتراضي.");
          close();
          bootstrap(true);
        }catch(e){ toast("خطأ", e.message); }
      };
    }
  });
}

/* =========================
   Custom Pages Builder (Admin)
   - إنشاء صفحات (HTML/CSS) بدون تعديل الملفات الأساسية
========================= */
async function renderPagesManager(){
  if(!requireAdmin()) return;

  const outlet = $("#routeOutlet");
  outlet.innerHTML = pageLayout({
    title:"صفحات إضافية",
    subtitle:"أنشئ صفحات مخصصة للأدمن أو عامة — بدون تعديل الكود لاحقاً",
    actionsHTML: `
      <button class="btn primary" id="newPage">صفحة جديدة</button>
      <button class="btn ghost" id="refreshP">تحديث</button>
    `
  });
  $("#refreshP").onclick = ()=> bootstrap(true);
  $("#newPage").onclick = ()=> openPageEditor();

  const body = $("#pageBody");
  const rows = await listCol("customPages", { orderArr:["title","asc"], lim: 300 });

  body.innerHTML = `
    <div class="card">
      <div class="cardHeader">
        <div><div class="cardTitle">الصفحات</div><div class="cardDesc">تظهر تلقائياً في القائمة الجانبية</div></div>
      </div>
      <div id="pTable"></div>
    </div>
  `;

  $("#pTable").innerHTML = tableHTML({
    columns:[
      { label:"العنوان", render:r=> `<b>${escapeHtml(r.title||"")}</b><div class="smallMuted">slug: ${escapeHtml(r.slug||"")}</div>` },
      { label:"الظهور", render:r=> `<span class="pill">${escapeHtml(r.visibility||"admin")}</span>` },
      { label:"إجراء", render:r=> `
        <div class="btnRow">
          <button class="btn small ghost" data-edit="${r.id}">تعديل</button>
          <button class="btn small danger" data-del="${r.id}">حذف</button>
        </div>
      `}
    ],
    rows
  });

  $$("button[data-edit]").forEach(b=> b.onclick = ()=> openPageEditor(rows.find(x=>x.id===b.dataset.edit)));
  $$("button[data-del]").forEach(b=> b.onclick = async ()=>{
    if(!await safeConfirm("حذف الصفحة؟")) return;
    const before = rows.find(x=>x.id===b.dataset.del)||null;
    await del("customPages", b.dataset.del);
    await audit("delete","customPages", b.dataset.del, before, null);
    toast("تم الحذف","تم حذف الصفحة.");
    bootstrap(true);
  });
}

function openPageEditor(existing=null){
  if(!requireAdmin()) return;

  const data = existing ? JSON.parse(JSON.stringify(existing)) : {
    title:"صفحة جديدة",
    slug:"page-" + uid().slice(0,6),
    visibility:"admin",
    css:`body{font-family:Tahoma,Arial;direction:rtl;padding:18px}`,
    html:`<h2>صفحة جديدة</h2><p>اكتب المحتوى هنا.</p>`
  };

  modal({
    title: existing ? `تعديل صفحة: ${data.title}` : "صفحة جديدة",
    bodyHTML: `
      <div class="row">
        <div class="col-6"><label>العنوان</label><input class="input" id="t" value="${escapeHtml(data.title)}"/></div>
        <div class="col-6"><label>Slug (رابط)</label><input class="input" id="s" value="${escapeHtml(data.slug)}" ${existing ? "disabled":""}/></div>
        <div class="col-6">
          <label>الظهور</label>
          <select class="input" id="v">
            ${["admin","public"].map(x=>`<option ${(data.visibility===x)?"selected":""} value="${x}">${x}</option>`).join("")}
          </select>
        </div>
        <div class="col-6 smallMuted" style="padding-top:34px">
          تظهر في القائمة تلقائياً بعد الحفظ.
        </div>

        <div class="col-6"><label>CSS</label><textarea class="input" id="css" style="min-height:260px">${escapeHtml(data.css||"")}</textarea></div>
        <div class="col-6"><label>HTML</label><textarea class="input" id="html" style="min-height:260px">${escapeHtml(data.html||"")}</textarea></div>

        <div class="col-12">
          <div class="card" style="padding:12px">
            <div class="cardTitle">معاينة</div>
            <div id="prev" style="background:#fff;color:#111;border-radius:16px;padding:10px"></div>
          </div>
        </div>
      </div>
    `,
    footerHTML: `
      <button class="btn primary" id="save">حفظ</button>
      <button class="btn ghost" data-x>إغلاق</button>
    `,
    onMount:(host, close)=>{
      const renderPrev = ()=>{
        $("#prev", host).innerHTML = `<style>${$("#css", host).value}</style>${$("#html", host).value}`;
      };
      $("#css", host).oninput = renderPrev;
      $("#html", host).oninput = renderPrev;
      renderPrev();

      $("#save", host).onclick = async ()=>{
        try{
          const title = $("#t", host).value.trim();
          const slug = existing ? data.slug : $("#s", host).value.trim();
          const payload = {
            title,
            slug,
            visibility: $("#v", host).value,
            css: $("#css", host).value,
            html: $("#html", host).value,
          };

          if(!existing){
            // id = slug لضمان uniqueness
            await setDoc(doc(db,"customPages", slug), payload, { merge:true });
            await audit("create","customPages", slug, null, payload);
            toast("تمت الإضافة", title);
          }else{
            const before = existing;
            await upd("customPages", existing.id, payload);
            await audit("update","customPages", existing.id, before, payload);
            toast("تم التحديث", title);
          }

          close();
          bootstrap(true);
        }catch(e){ toast("خطأ", e.message); }
      };
    }
  });
}

async function renderCustomPage(slug){
  const outlet = $("#routeOutlet");
  const p = (State.customPages||[]).find(x=>x.slug===slug || x.id===slug);

  if(!p){
    outlet.innerHTML = pageLayout({ title:"غير موجود", subtitle:"الصفحة غير موجودة" });
    $("#pageBody").innerHTML = `<div class="card"><div class="cardTitle">لا توجد صفحة بهذا الرابط.</div></div>`;
    return;
  }

  // إذا كانت admin only
  if((p.visibility||"admin")==="admin" && State.role!=="admin"){
    outlet.innerHTML = pageLayout({ title:"ممنوع", subtitle:"هذه الصفحة للأدمن فقط" });
    $("#pageBody").innerHTML = `<div class="card"><div class="cardTitle">صلاحية غير كافية</div></div>`;
    return;
  }

  outlet.innerHTML = pageLayout({
    title: p.title || "صفحة",
    subtitle: "صفحة مخصصة",
    actionsHTML: State.role==="admin" ? `<a class="btn ghost" href="#/pages">إدارة الصفحات</a>` : ``
  });

  $("#pageBody").innerHTML = `
    <div class="card">
      <div style="background:#fff;color:#111;border-radius:16px;padding:10px">
        <style>${p.css||""}</style>
        ${p.html||""}
      </div>
    </div>
  `;
}

/* =========================
   Users & Roles (Admin)
========================= */
async function renderUsers(){
  if(!requireAdmin()) return;
  const outlet = $("#routeOutlet");
  outlet.innerHTML = pageLayout({
    title:"المستخدمين والصلاحيات",
    subtitle:"Admin / staff — تفعيل/تعطيل",
    actionsHTML:`<button class="btn ghost" id="refreshU">تحديث</button>`
  });
  $("#refreshU").onclick = ()=> renderUsers();

  const body = $("#pageBody");
  const rows = await listCol("users", { orderArr:["updatedAt","desc"], lim: 300 });

  body.innerHTML = `
    <div class="card">
      <div class="cardHeader">
        <div><div class="cardTitle">المستخدمين</div><div class="cardDesc">غير الدور من هنا</div></div>
      </div>
      <div id="uTable"></div>
    </div>
  `;

  $("#uTable").innerHTML = tableHTML({
    columns:[
      { label:"Email", render:r=> `<b>${escapeHtml(r.email||"")}</b><div class="smallMuted">${escapeHtml(r.uid||r.id)}</div>` },
      { label:"الاسم", key:"name" },
      { label:"الدور", render:r=> `<span class="pill">${escapeHtml(r.role||"staff")}</span>` },
      { label:"الحالة", render:r=> r.isActive===false ? `<span class="pill bad">موقوف</span>` : `<span class="pill ok">فعال</span>` },
      { label:"إجراء", render:r=> `
        <div class="btnRow">
          <button class="btn small ghost" data-role="${r.id}">تغيير دور</button>
          <button class="btn small danger" data-toggle="${r.id}">${r.isActive===false?"تفعيل":"تعطيل"}</button>
        </div>
      `}
    ],
    rows
  });

  $$("button[data-role]").forEach(b=> b.onclick = ()=>{
    const u = rows.find(x=>x.id===b.dataset.role);
    modal({
      title:`تغيير دور: ${u.email}`,
      bodyHTML: `
        <label>الدور</label>
        <select class="input" id="roleSel">
          ${["admin","staff"].map(x=>`<option ${(u.role===x)?"selected":""} value="${x}">${x}</option>`).join("")}
        </select>
      `,
      footerHTML:`<button class="btn primary" id="save">حفظ</button><button class="btn ghost" data-x>إغلاق</button>`,
      onMount:(host, close)=>{
        $("#save", host).onclick = async ()=>{
          const role = $("#roleSel", host).value;
          await upd("users", u.id, { role });
          await audit("update","users", u.id, u, { role });
          toast("تم", "تم تغيير الدور.");
          close(); renderUsers();
        };
      }
    });
  });

  $$("button[data-toggle]").forEach(b=> b.onclick = async ()=>{
    const u = rows.find(x=>x.id===b.dataset.toggle);
    const newState = !(u.isActive===false);
    await upd("users", u.id, { isActive: !newState });
    await audit("update","users", u.id, u, { isActive: !newState });
    toast("تم", "تم تحديث الحالة.");
    renderUsers();
  });
}

/* =========================
   Audit Log (Admin)
========================= */
async function renderAudit(){
  if(!requireAdmin()) return;
  const outlet = $("#routeOutlet");
  outlet.innerHTML = pageLayout({
    title:"سجل التدقيق",
    subtitle:"يوثق إنشاء/تعديل/حذف",
    actionsHTML:`<button class="btn ghost" id="refreshA">تحديث</button>`
  });
  $("#refreshA").onclick = ()=> renderAudit();

  const body = $("#pageBody");
  const rows = await listCol("auditLogs", { orderArr:["at","desc"], lim: 300 });

  body.innerHTML = `
    <div class="card">
      <div class="cardHeader">
        <div><div class="cardTitle">آخر 300 عملية</div><div class="cardDesc">مفيد جداً للأدمن</div></div>
      </div>
      <div id="aTable"></div>
    </div>
  `;

  $("#aTable").innerHTML = tableHTML({
    columns:[
      { label:"الوقت", render:r=> `<b>${escapeHtml(r.at?.toDate ? r.at.toDate().toLocaleString("ar-IQ") : "")}</b>` },
      { label:"الإجراء", key:"action" },
      { label:"الكيان", render:r=> `${escapeHtml(r.entity||"")}<div class="smallMuted">${escapeHtml(r.entityId||"")}</div>` },
      { label:"بواسطة", render:r=> `${escapeHtml(r.email||"")}<div class="smallMuted">${escapeHtml(r.by||"")}</div>` },
    ],
    rows
  });
}

/* =========================
   Settings (Admin)
========================= */
async function renderSettings(){
  if(!requireAdmin()) return;
  const outlet = $("#routeOutlet");
  outlet.innerHTML = pageLayout({
    title:"الإعدادات",
    subtitle:"اسم الورشة + ضريبة + ترقيم + سياسة خصم المخزون",
    actionsHTML:`<button class="btn primary" id="saveS">حفظ</button>`
  });

  const body = $("#pageBody");
  const s = State.settings || { ...DEFAULT_SETTINGS };

  body.innerHTML = `
    <div class="card">
      <div class="cardTitle">إعدادات عامة</div>
      <div class="row">
        <div class="col-6"><label>اسم الورشة</label><input class="input" id="wsName" value="${escapeHtml(s.workshopName||"")}"/></div>
        <div class="col-3"><label>الهاتف</label><input class="input" id="wsPhone" value="${escapeHtml(s.phone||"")}"/></div>
        <div class="col-3"><label>العملة</label><input class="input" id="cur" value="${escapeHtml(s.currency||"IQD")}"/></div>
        <div class="col-12"><label>العنوان</label><input class="input" id="addr" value="${escapeHtml(s.address||"")}"/></div>
      </div>
      <hr/>
      <div class="cardTitle">الضرائب والترقيم</div>
      <div class="row">
        <div class="col-3"><label>ضريبة (%)</label><input class="input" id="tax" type="number" value="${escapeHtml(String(s.taxRate||0))}"/></div>
        <div class="col-3"><label>بادئة الفاتورة</label><input class="input" id="invP" value="${escapeHtml(s.invoicePrefix||"INV")}"/></div>
        <div class="col-3"><label>بادئة أمر الشغل</label><input class="input" id="woP" value="${escapeHtml(s.woPrefix||"WO")}"/></div>
        <div class="col-3"><label>عدد الخانات</label><input class="input" id="w" type="number" value="${escapeHtml(String(s.numberWidth||6))}"/></div>
      </div>
      <hr/>
      <div class="cardTitle">سياسة المخزون</div>
      <div class="row">
        <div class="col-6">
          <label>متى يتم خصم المخزون؟</label>
          <select class="input" id="policy">
            <option ${(s.stockConsumePolicy==="invoice_create")?"selected":""} value="invoice_create">عند إنشاء الفاتورة</option>
            <option ${(s.stockConsumePolicy==="invoice_paid")?"selected":""} value="invoice_paid">عند دفع الفاتورة (Paid)</option>
          </select>
        </div>
        <div class="col-6">
          <label>القالب الافتراضي</label>
          <select class="input" id="defTpl">
            ${State.templates.map(t=>`<option ${(s.defaultInvoiceTemplateId===t.id)?"selected":""} value="${t.id}">${escapeHtml(t.name||t.id)}</option>`).join("")}
          </select>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="cardTitle">ملاحظة</div>
      <div class="smallMuted">
        يفضل ربط عناصر "القطع" بالمخزون داخل الفاتورة حتى يتم الخصم بدقة.
      </div>
    </div>
  `;

  $("#saveS").onclick = async ()=>{
    try{
      const payload = {
        workshopName: $("#wsName").value.trim(),
        phone: $("#wsPhone").value.trim(),
        address: $("#addr").value.trim(),
        currency: $("#cur").value.trim(),
        taxRate: Number($("#tax").value||0),
        invoicePrefix: $("#invP").value.trim(),
        woPrefix: $("#woP").value.trim(),
        numberWidth: Number($("#w").value||6),
        stockConsumePolicy: $("#policy").value,
        defaultInvoiceTemplateId: $("#defTpl").value
      };
      await upd("settings","app", payload);
      await audit("update","settings","app", State.settings, payload);
      toast("تم الحفظ","تم تحديث الإعدادات.");
      await bootstrap(true);
    }catch(e){ toast("خطأ", e.message); }
  };
}

/* =========================
   Firestore Rules (مقترح) — ضعها في Firebase Console > Firestore Rules
   (اختياري لكن مهم للأمان)
========================= */
/*
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn(){ return request.auth != null; }
    function isAdmin(){
      return signedIn() &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == "admin";
    }
    function isStaff(){
      return signedIn() &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.isActive != false;
    }

    match /settings/{doc} { allow read: if isStaff(); allow write: if isAdmin(); }
    match /users/{uid} { allow read: if isAdmin(); allow write: if isAdmin(); }

    match /{col}/{id} {
      allow read: if isStaff();
      allow write: if isStaff(); // يمكن تشديدها حسب الحاجة
    }
  }
}
*/

/* =========================
   App Start
========================= */
onAuthStateChanged(auth, async (user)=>{
  State.user = user || null;

  if(!user){
    State.role = "guest";
    State.profile = null;
    State.settings = null;
    State.templates = [];
    State.customPages = [];
    loginUI();
    return;
  }

  // منع مستخدم معطل
  try{
    const prof = await loadProfile(user.uid);
    if(prof?.isActive === false){
      toast("الحساب معطل", "راجع الأدمن.");
      await signOut(auth);
      return;
    }
  }catch(e){ /* ignore */ }

  await bootstrap();

  window.addEventListener("hashchange", route);
  if(!location.hash) location.hash = "#/dashboard";
});
