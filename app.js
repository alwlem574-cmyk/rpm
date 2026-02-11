/*  نظام الوليم RPM - نسخة Vanilla (HTML/CSS/JS)
    - Firebase Auth + Firestore
    - Roles: admin / staff / viewer
    - Modules: Dashboard, Check-in, Orders, Customers, Vehicles, Oil, Inventory, Invoices, Employees, Reports, Backup, Settings, Admin
    ملاحظة: فعّلي Firestore + Auth Email/Password داخل Firebase
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, limit, serverTimestamp, getDocs, writeBatch
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

/* ====== 1) ضع إعدادات مشروعك هنا ====== */
const firebaseConfig = {
  apiKey: "AIzaSyC0p4cqNHuqZs9_gNuKLl7nEY0MqRXbf_A",
  authDomain: "rpm574.firebaseapp.com",
  databaseURL: "https://rpm574-default-rtdb.firebaseio.com",
  projectId: "rpm574",
  storageBucket: "rpm574.firebasestorage.app",
  messagingSenderId: "150918603525",
  appId: "1:150918603525:web:fe1d0fbe5c4505936c4d6c"
};
/* ==================================== */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---------- Helpers ----------
const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const fmtDate = (d) => new Intl.DateTimeFormat("ar-IQ", {dateStyle:"medium"}).format(d);
const fmtTime = (d) => new Intl.DateTimeFormat("ar-IQ", {timeStyle:"short"}).format(d);
const fmtMoney = (n) => (Number(n||0)).toLocaleString("ar-IQ") + " د.ع";
const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);
const todayISO = () => new Date().toISOString().slice(0,10);
const inRange = (iso, from, to) => (!from || iso>=from) && (!to || iso<=to);

function toast(msg, type=""){
  const el = $("#toast");
  el.classList.remove("hidden");
  el.textContent = msg;
  if(type==="bad") el.style.borderColor="rgba(251,113,133,.55)";
  else if(type==="good") el.style.borderColor="rgba(52,211,153,.55)";
  else el.style.borderColor="rgba(255,255,255,.12)";
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=>el.classList.add("hidden"), 2600);
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, (c)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}

// ---------- Auth + Roles ----------
let CURRENT_USER = null;
let CURRENT_ROLE = "viewer"; // default least privilege
let SETTINGS = { shopName:"نظام الوليم", phone:"", address:"", invoicePrefix:"INV-", vatPercent:0 };

async function getUserRole(uid){
  const snap = await getDoc(doc(db, "users", uid));
  if(!snap.exists()) return "viewer";
  return (snap.data().role || "viewer");
}

function can(required){
  const order = { viewer:0, staff:1, admin:2 };
  return order[CURRENT_ROLE] >= order[required];
}

function requireRole(required){
  if(!can(required)){
    toast("ليس لديك صلاحية للوصول", "bad");
    location.hash = "#/dashboard";
    return false;
  }
  return true;
}

// ---------- Firestore Collections (names stable) ----------
const C = {
  settings: () => doc(db, "meta", "settings"),
  users: () => collection(db, "users"),
  customers: () => collection(db, "customers"),
  vehicles: () => collection(db, "vehicles"),
  employees: () => collection(db, "employees"),
  inventory: () => collection(db, "inventory"),
  checkins: () => collection(db, "checkins"),
  orders: () => collection(db, "orders"),
  invoices: () => collection(db, "invoices"),
  counters: () => doc(db, "meta", "counters"),
};

// ---------- UI Shell ----------
const authScreen = $("#authScreen");
const appShell = $("#appShell");
const view = $("#view");
const pageTitle = $("#pageTitle");
const userBadge = $("#userBadge");
const todayBadge = $("#todayBadge");
const sidebar = $("#sidebar");
const globalSearch = $("#globalSearch");

function setActiveNav(route){
  $$(".nav-item").forEach(a=>{
    a.classList.toggle("active", a.dataset.route===route);
  });
  $$(".tab").forEach(a=>{
    a.classList.toggle("active", a.dataset.route===route);
  });
}

function showAuth(){
  authScreen.classList.remove("hidden");
  appShell.classList.add("hidden");
}
function showApp(){
  authScreen.classList.add("hidden");
  appShell.classList.remove("hidden");
}

// ---------- Settings load ----------
async function loadSettings(){
  const snap = await getDoc(C.settings());
  if(snap.exists()){
    SETTINGS = { ...SETTINGS, ...snap.data() };
  }else{
    await setDoc(C.settings(), SETTINGS, {merge:true});
  }
}

async function ensureCounters(){
  const snap = await getDoc(C.counters());
  if(!snap.exists()){
    await setDoc(C.counters(), { orderNo: 1000, invoiceNo: 1000 }, {merge:true});
  }
}

async function nextCounter(field){
  const ref = C.counters();
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  const next = Number(data[field]||0) + 1;
  await setDoc(ref, { [field]: next }, {merge:true});
  return next;
}

// ---------- Bootstrap first admin ----------
async function bootstrapFirstAdmin(){
  if(!CURRENT_USER){
    toast("سجلي دخول أولاً ثم اضغطي", "bad");
    return;
  }
  const uref = doc(db, "users", CURRENT_USER.uid);
  const snap = await getDoc(uref);
  if(snap.exists() && snap.data().role){
    toast("تمت التهيئة مسبقاً", "good");
    return;
  }
  // If no other admin exists, make this user admin.
  const qAdmins = query(C.users(), where("role","==","admin"), limit(1));
  const admins = await getDocs(qAdmins);
  if(!admins.empty){
    toast("يوجد أدمن بالفعل. راجعي الأدمن الحالي.", "bad");
    return;
  }
  await setDoc(uref, {
    email: CURRENT_USER.email || "",
    name: CURRENT_USER.displayName || "",
    role: "admin",
    createdAt: serverTimestamp()
  }, {merge:true});
  CURRENT_ROLE = "admin";
  toast("تم تعيينك أدمن ✅", "good");
  route();
}

// ---------- Seed demo data ----------
async function seedDemo(){
  if(!requireRole("admin")) return;
  const batch = writeBatch(db);
  const now = new Date();
  const custs = [
    { name:"أحمد", phone:"0770xxxxxxx", city:"بغداد" },
    { name:"محمد", phone:"0780xxxxxxx", city:"بغداد" },
    { name:"حسن", phone:"0790xxxxxxx", city:"البصرة" },
  ];
  const custRefs = custs.map(c => doc(C.customers()));
  custRefs.forEach((r,i)=> batch.set(r, { ...custs[i], createdAt: serverTimestamp() }));

  const vehicles = [
    { plate:"بغداد 12345", model:"تويوتا كورولا", year:2015, color:"أبيض", customerId: custRefs[0].id },
    { plate:"بغداد 67890", model:"هونداي النترا", year:2018, color:"أسود", customerId: custRefs[1].id },
  ];
  const vRefs = vehicles.map(v=>doc(C.vehicles()));
  vRefs.forEach((r,i)=> batch.set(r, { ...vehicles[i], createdAt: serverTimestamp() }));

  const inv = [
    { name:"فلتر زيت", sku:"OF-01", unit:"قطعة", buy:4000, sell:7000, qty:12, min:3 },
    { name:"دهن 5W30 (4L)", sku:"OIL-5W30", unit:"علبة", buy:18000, sell:25000, qty:8, min:2 },
    { name:"فحمات أمامي", sku:"BRK-F", unit:"طقم", buy:22000, sell:32000, qty:5, min:2 },
  ];
  inv.forEach(p => batch.set(doc(C.inventory()), { ...p, createdAt: serverTimestamp() }));

  await batch.commit();
  toast("تمت إضافة بيانات تجريبية", "good");
}

// ---------- Global search ----------
let LAST_SEARCH = "";
globalSearch.addEventListener("input", ()=>{
  LAST_SEARCH = globalSearch.value.trim();
  // re-render current route to apply filter
  route();
});

// ---------- Responsive sidebar ----------
$("#btnMenu").addEventListener("click", ()=> sidebar.classList.toggle("open"));
window.addEventListener("hashchange", ()=> sidebar.classList.remove("open"));

// ---------- Modal ----------
const modal = $("#modal");
$("#btnNew").addEventListener("click", ()=> modal.classList.remove("hidden"));
$("#modalClose").addEventListener("click", ()=> modal.classList.add("hidden"));
modal.addEventListener("click", (e)=>{ if(e.target===modal) modal.classList.add("hidden"); });
$$("[data-quick]").forEach(b=>{
  b.addEventListener("click", ()=>{
    const r = b.dataset.quick;
    modal.classList.add("hidden");
    if(r==="checkin") location.hash = "#/checkin?new=1";
    if(r==="oil") location.hash = "#/oil?new=1";
    if(r==="customer") location.hash = "#/customers?new=1";
    if(r==="vehicle") location.hash = "#/vehicles?new=1";
    if(r==="employee") location.hash = "#/employees?new=1";
    if(r==="part") location.hash = "#/inventory?new=1";
  })
});

// ---------- Logout ----------
$("#btnLogout").addEventListener("click", async ()=>{
  await signOut(auth);
  toast("تم تسجيل الخروج");
});

// ---------- Login ----------
$("#btnLoginDemo").addEventListener("click", ()=>{
  $("#loginEmail").value = "admin@example.com";
  $("#loginPass").value = "12345678";
});

$("#btnLogin").addEventListener("click", async ()=>{
  const email = $("#loginEmail").value.trim();
  const pass = $("#loginPass").value;
  if(!email || !pass) return toast("أدخلي البريد وكلمة المرور", "bad");
  try{
    await signInWithEmailAndPassword(auth, email, pass);
  }catch(err){
    console.error(err);
    toast("فشل الدخول: تأكدي من البيانات أو فعلي Auth", "bad");
  }
});

$("#btnBootstrapAdmin").addEventListener("click", bootstrapFirstAdmin);
$("#btnSeed").addEventListener("click", seedDemo);

// ---------- Tabs "more" route shortcut ----------
$$(".tab").forEach(a=>{
  a.addEventListener("click", ()=>{ /* active handled by router */ });
});

// ---------- Data caches ----------
let CACHE = {
  customers: new Map(),
  vehicles: new Map(),
  employees: new Map(),
  inventory: new Map(),
};

// subscribe core lists for fast UX
function subscribeCore(){
  onSnapshot(query(C.customers(), orderBy("createdAt","desc"), limit(200)), (snap)=>{
    CACHE.customers.clear();
    snap.forEach(d=> CACHE.customers.set(d.id, {id:d.id, ...d.data()}));
  });
  onSnapshot(query(C.vehicles(), orderBy("createdAt","desc"), limit(200)), (snap)=>{
    CACHE.vehicles.clear();
    snap.forEach(d=> CACHE.vehicles.set(d.id, {id:d.id, ...d.data()}));
  });
  onSnapshot(query(C.employees(), orderBy("createdAt","desc"), limit(200)), (snap)=>{
    CACHE.employees.clear();
    snap.forEach(d=> CACHE.employees.set(d.id, {id:d.id, ...d.data()}));
  });
  onSnapshot(query(C.inventory(), orderBy("createdAt","desc"), limit(300)), (snap)=>{
    CACHE.inventory.clear();
    snap.forEach(d=> CACHE.inventory.set(d.id, {id:d.id, ...d.data()}));
  });
}

// ---------- UI builders ----------
function viewHeader(title, subtitle=""){
  pageTitle.textContent = title;
  todayBadge.textContent = subtitle || fmtDate(new Date());
  return `<div class="row-actions" style="justify-content:space-between;align-items:flex-end;">
    <div>
      <div class="section-title">${escapeHtml(title)}</div>
      <div class="small">${escapeHtml(subtitle || "")}</div>
    </div>
  </div>`;
}

function pillStatus(s){
  const cls = s==="open" ? "open" : s==="progress" ? "progress" : s==="parts" ? "parts" : s==="done" ? "done" : "off";
  const txt = s==="open" ? "مفتوح" : s==="progress" ? "قيد العمل" : s==="parts" ? "بانتظار قطع" : s==="done" ? "مكتمل" : "—";
  return `<span class="pill ${cls}">${txt}</span>`;
}

function matchSearch(text){
  const q = (LAST_SEARCH||"").toLowerCase();
  if(!q) return true;
  return String(text||"").toLowerCase().includes(q);
}

// ---------- Forms ----------
function formRow(label, inputHtml){
  return `<div class="col">
    <div class="small">${escapeHtml(label)}</div>
    ${inputHtml}
  </div>`;
}

function input(name, value="", type="text", placeholder=""){
  return `<input class="input" name="${escapeHtml(name)}" type="${type}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" />`;
}

function select(name, options, value=""){
  const opts = options.map(o=>{
    const v = typeof o==="string" ? o : o.value;
    const t = typeof o==="string" ? o : o.label;
    const sel = v==value ? "selected" : "";
    return `<option value="${escapeHtml(v)}" ${sel}>${escapeHtml(t)}</option>`;
  }).join("");
  return `<select class="input" name="${escapeHtml(name)}">${opts}</select>`;
}

function textarea(name, value="", placeholder=""){
  return `<textarea class="input" name="${escapeHtml(name)}" rows="3" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>`;
}

function getFormData(form){
  const fd = new FormData(form);
  const obj = {};
  for(const [k,v] of fd.entries()) obj[k]=v;
  return obj;
}

// ---------- Print invoice ----------
function openPrint(html){
  const w = window.open("", "_blank");
  if(!w) return toast("منع المتصفح نافذة الطباعة", "bad");
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}

function invoiceHtml(inv, items){
  const shop = SETTINGS.shopName || "الورشة";
  const phone = SETTINGS.phone || "";
  const addr = SETTINGS.address || "";
  const vat = Number(SETTINGS.vatPercent||0);

  const subTotal = items.reduce((s,it)=> s + Number(it.qty||0)*Number(it.price||0), 0);
  const vatVal = subTotal * (vat/100);
  const total = subTotal + vatVal - Number(inv.discount||0);

  const rows = items.map((it,i)=>`
    <tr>
      <td>${i+1}</td>
      <td>${escapeHtml(it.name||"")}</td>
      <td>${escapeHtml(it.unit||"")}</td>
      <td>${escapeHtml(it.qty||0)}</td>
      <td>${fmtMoney(it.price||0)}</td>
      <td>${fmtMoney(Number(it.qty||0)*Number(it.price||0))}</td>
    </tr>`).join("");

  return `<!doctype html><html lang="ar" dir="rtl"><head>
    <meta charset="utf-8" />
    <title>فاتورة</title>
    <style>${stylesForPrint()}</style>
  </head>
  <body>
    <div class="print-wrap">
      <div class="print-header">
        <div>
          <div class="print-brand">${escapeHtml(shop)}</div>
          <div class="print-sub">${escapeHtml(addr)}<br/>${escapeHtml(phone)}</div>
        </div>
        <div>
          <div><b>فاتورة:</b> ${escapeHtml(inv.code||inv.id||"")}</div>
          <div><b>تاريخ:</b> ${escapeHtml(inv.date||todayISO())}</div>
        </div>
      </div>

      <div class="print-grid">
        <div><b>الزبون:</b> ${escapeHtml(inv.customerName||"")}</div>
        <div><b>السيارة:</b> ${escapeHtml(inv.vehicleLabel||"")}</div>
        <div><b>الهاتف:</b> ${escapeHtml(inv.customerPhone||"")}</div>
        <div><b>المسؤول:</b> ${escapeHtml(inv.createdByEmail||"")}</div>
      </div>

      <div class="print-box">
        <table class="print-table">
          <thead><tr>
            <th>#</th><th>الوصف</th><th>الوحدة</th><th>الكمية</th><th>سعر</th><th>المجموع</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>

        <div class="print-foot">
          <div><b>ملاحظات:</b> ${escapeHtml(inv.note||"")}</div>
          <div style="min-width:240px">
            <div class="kv"><span>الإجمالي الفرعي</span><b>${fmtMoney(subTotal)}</b></div>
            <div class="kv"><span>الضريبة (${vat}%)</span><b>${fmtMoney(vatVal)}</b></div>
            <div class="kv"><span>خصم</span><b>${fmtMoney(inv.discount||0)}</b></div>
            <div class="hr"></div>
            <div class="kv"><span>الإجمالي</span><b>${fmtMoney(total)}</b></div>
          </div>
        </div>
      </div>
    </div>
  </body></html>`;
}

function stylesForPrint(){
  // minimal print css (copied from styles.css section)
  return `
  body{font-family: Arial, "Noto Sans Arabic", sans-serif; direction:rtl}
  .print-wrap{padding:18px}
  .print-header{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
  .print-brand{font-weight:900;font-size:18px}
  .print-sub{font-size:12px;color:#333}
  .print-grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-top:12px}
  .print-box{margin-top:12px;border:1px solid #ddd;border-radius:12px;padding:12px}
  .print-table{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px}
  .print-table th,.print-table td{border:1px solid #ddd;padding:8px;text-align:right}
  .print-foot{display:flex;justify-content:space-between;gap:10px;margin-top:10px;font-size:12px}
  .hr{height:1px;background:#ddd;margin:12px 0}
  .kv{display:flex;justify-content:space-between;gap:10px}
  `;
}

// ---------- CRUD wrappers ----------
async function createDoc(col, data){
  data.createdAt = serverTimestamp();
  data.updatedAt = serverTimestamp();
  data.createdBy = CURRENT_USER?.uid || "";
  data.createdByEmail = CURRENT_USER?.email || "";
  const ref = await addDoc(col, data);
  return ref.id;
}
async function updateDocSafe(ref, data){
  data.updatedAt = serverTimestamp();
  await updateDoc(ref, data);
}
async function deleteDocSafe(ref){
  await deleteDoc(ref);
}

// ---------- Route Views (Part 1) ----------
async function renderDashboard(){
  view.innerHTML = viewHeader("لوحة التحكم", fmtDate(new Date()));

  const today = todayISO();
  const qOrders = query(C.orders(), orderBy("createdAt","desc"), limit(50));
  const qInvoices = query(C.invoices(), orderBy("createdAt","desc"), limit(50));

  const [ordersSnap, invSnap] = await Promise.all([getDocs(qOrders), getDocs(qInvoices)]);

  const orders = [];
  ordersSnap.forEach(d=> orders.push({id:d.id, ...d.data()}));
  const invoices = [];
  invSnap.forEach(d=> invoices.push({id:d.id, ...d.data()}));

  const open = orders.filter(o=> o.status!=="done");
  const doneToday = orders.filter(o=> o.status==="done" && (o.doneDate||"").slice(0,10)===today);
  const invToday = invoices.filter(i=> (i.date||"").slice(0,10)===today);
  const salesToday = invToday.reduce((s,i)=> s+Number(i.total||0), 0);

  const lowStock = Array.from(CACHE.inventory.values()).filter(p=> Number(p.qty||0) <= Number(p.min||0));

  view.innerHTML += `
    <div class="cards">
      <div class="card"><div class="card-title">أوامر مفتوحة</div><div class="card-value">${open.length}</div></div>
      <div class="card"><div class="card-title">مكتمل اليوم</div><div class="card-value">${doneToday.length}</div></div>
      <div class="card"><div class="card-title">فواتير اليوم</div><div class="card-value">${invToday.length}</div></div>
      <div class="card"><div class="card-title">مبيعات اليوم</div><div class="card-value">${fmtMoney(salesToday)}</div></div>
    </div>

    <div class="row" style="margin-top:12px;">
      <div class="card subcard">
        <div class="section-title">أحدث أوامر الشغل</div>
        <div class="small">آخر 8</div>
        <div class="hr"></div>
        ${orders.slice(0,8).map(o=> orderRow(o)).join("") || `<div class="notice">لا توجد بيانات</div>`}
      </div>
      <div class="card subcard">
        <div class="section-title">مخزون منخفض</div>
        <div class="small">تنبيه</div>
        <div class="hr"></div>
        ${lowStock.slice(0,10).map(p=> `<div class="kv"><span>${escapeHtml(p.name||"")}</span><b>${escapeHtml(p.qty||0)}</b></div>`).join("") || `<div class="notice">لا يوجد نقص</div>`}
      </div>
    </div>
  `;
}

function orderRow(o){
  const cust = o.customerName || (CACHE.customers.get(o.customerId||"")?.name || "");
  const veh = o.vehicleLabel || (CACHE.vehicles.get(o.vehicleId||"")?.plate || "");
  const line = `${escapeHtml(o.code||o.id||"")} — ${escapeHtml(cust)} — ${escapeHtml(veh)}`;
  return `<div class="kv" style="margin:8px 0;">
    <span>${line}</span>
    <span>${pillStatus(o.status||"open")}</span>
  </div>`;
}

async function renderCheckin(params){
  if(!requireRole("staff")) return;
  const isNew = params.get("new")==="1";
  view.innerHTML = viewHeader("الاستقبال", "فتح حالة استقبال وربط زبون + سيارة");

  const customers = Array.from(CACHE.customers.values());
  const vehicles = Array.from(CACHE.vehicles.values());

  view.innerHTML += `
    <div class="card">
      <div class="section-title">استقبال جديد</div>
      <div class="small">اختاري زبون وسيارة ثم اكتب الملاحظات</div>
      <div class="hr"></div>
      <form id="fCheckin" class="grid3">
        ${formRow("الزبون", select("customerId",
          [{value:"",label:"— اختاري —"}, ...customers.map(c=>({value:c.id,label:`${c.name} (${c.phone||""})`}))],
          ""))}
        ${formRow("السيارة", select("vehicleId",
          [{value:"",label:"— اختاري —"}, ...vehicles.map(v=>({value:v.id,label:`${v.plate} - ${v.model||""}`}))],
          ""))}
        ${formRow("ملاحظات", textarea("note","", "مثال: صوت بالمحرك/فحص فرامل/..." ))}
        <div class="row-actions" style="grid-column:1/-1;justify-content:flex-start;">
          <button class="btn btn-primary" type="submit">حفظ استقبال</button>
        </div>
      </form>
      <div class="notice" style="margin-top:12px;">بعد الاستقبال، أنشئي أمر شغل من صفحة "أوامر الشغل".</div>
    </div>

    <div class="card subcard" style="margin-top:12px;">
      <div class="section-title">آخر الاستقبالات</div>
      <div class="small">آخر 20</div>
      <div class="hr"></div>
      <div id="checkinList" class="notice">... تحميل</div>
    </div>
  `;

  $("#fCheckin").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const data = getFormData(e.target);
    if(!data.customerId || !data.vehicleId) return toast("اختاري زبون وسيارة", "bad");

    const c = CACHE.customers.get(data.customerId);
    const v = CACHE.vehicles.get(data.vehicleId);
    await createDoc(C.checkins(), {
      customerId:data.customerId,
      customerName:c?.name||"",
      customerPhone:c?.phone||"",
      vehicleId:data.vehicleId,
      vehicleLabel:`${v?.plate||""} - ${v?.model||""}`,
      note:data.note||"",
      date: todayISO(),
      status:"open"
    });
    toast("تم حفظ الاستقبال", "good");
    e.target.reset();
  });

  onSnapshot(query(C.checkins(), orderBy("createdAt","desc"), limit(20)), (snap)=>{
    const rows=[];
    snap.forEach(d=> rows.push({id:d.id, ...d.data()}));
    const html = rows
      .filter(r => matchSearch(`${r.customerName} ${r.vehicleLabel} ${r.note} ${r.date}`))
      .map(r=> `<div class="kv" style="margin:8px 0;">
        <span><b>${escapeHtml(r.customerName||"")}</b> — ${escapeHtml(r.vehicleLabel||"")}<div class="small">${escapeHtml(r.note||"")}</div></span>
        <span class="small">${escapeHtml(r.date||"")}</span>
      </div>`).join("") || `<div class="notice">لا توجد بيانات</div>`;
    $("#checkinList").outerHTML = `<div id="checkinList">${html}</div>`;
  });
}


// ---------- Orders ----------
async function renderOrders(params){
  if(!requireRole("staff")) return;
  view.innerHTML = viewHeader("أوامر الشغل", "إدارة الحالات من فتح إلى إكمال");

  view.innerHTML += `
    <div class="card">
      <div class="row-actions" style="justify-content:space-between;">
        <div>
          <div class="section-title">القائمة</div>
          <div class="small">البحث يعمل على الاسم/السيارة/الكود/الحالة</div>
        </div>
        <div class="row-actions">
          <button id="btnNewOrder" class="btn btn-primary">+ أمر جديد</button>
          <select id="statusFilter" class="input" style="width:180px;">
            <option value="">كل الحالات</option>
            <option value="open">مفتوح</option>
            <option value="progress">قيد العمل</option>
            <option value="parts">بانتظار قطع</option>
            <option value="done">مكتمل</option>
          </select>
        </div>
      </div>
      <div class="hr"></div>
      <div id="ordersList" class="notice">... تحميل</div>
    </div>

    <div id="orderEditor" class="card subcard hidden" style="margin-top:12px;"></div>
  `;

  $("#btnNewOrder").addEventListener("click", ()=> openOrderEditor(null));
  $("#statusFilter").addEventListener("change", ()=> route());

  const statusF = $("#statusFilter").value;

  onSnapshot(query(C.orders(), orderBy("createdAt","desc"), limit(200)), (snap)=>{
    const rows=[];
    snap.forEach(d=> rows.push({id:d.id, ...d.data()}));

    const filtered = rows.filter(o=>{
      const f = $("#statusFilter")?.value || statusF || "";
      if(f && (o.status||"")!==f) return false;
      return matchSearch(`${o.code} ${o.customerName} ${o.vehicleLabel} ${o.status} ${o.problem} ${o.note}`);
    });

    const html = `
      <table class="table">
        <thead>
          <tr><th>الكود</th><th>الزبون</th><th>السيارة</th><th>الحالة</th><th>آخر تحديث</th><th></th></tr>
        </thead>
        <tbody>
          ${filtered.map(o=>`
            <tr class="tr">
              <td><b>${escapeHtml(o.code||o.id||"")}</b></td>
              <td>${escapeHtml(o.customerName||"")}</td>
              <td>${escapeHtml(o.vehicleLabel||"")}</td>
              <td>${pillStatus(o.status||"open")}</td>
              <td class="small">${escapeHtml((o.updatedAt?.toDate?.() ? fmtDate(o.updatedAt.toDate())+" "+fmtTime(o.updatedAt.toDate()) : ""))}</td>
              <td><button class="btn btn-soft" data-edit="${o.id}">فتح</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      ${filtered.length? "" : `<div class="notice">لا توجد نتائج</div>`}
    `;

    $("#ordersList").outerHTML = `<div id="ordersList">${html}</div>`;

    $$("[data-edit]").forEach(b=> b.addEventListener("click", ()=>{
      const id = b.dataset.edit;
      const obj = rows.find(x=>x.id===id);
      openOrderEditor(obj);
    }));
  });

  async function openOrderEditor(order){
    const box = $("#orderEditor");
    box.classList.remove("hidden");

    const customers = Array.from(CACHE.customers.values());
    const vehicles = Array.from(CACHE.vehicles.values());
    const employees = Array.from(CACHE.employees.values());

    if(!order){
      box.innerHTML = `
        <div class="section-title">أمر جديد</div>
        <div class="small">اختاري زبون/سيارة ووصفي المشكلة</div>
        <div class="hr"></div>
        <form id="fOrderNew" class="grid3">
          ${formRow("الزبون", select("customerId",
            [{value:"",label:"— اختاري —"}, ...customers.map(c=>({value:c.id,label:`${c.name} (${c.phone||""})`}))],
            ""))}
          ${formRow("السيارة", select("vehicleId",
            [{value:"",label:"— اختاري —"}, ...vehicles.map(v=>({value:v.id,label:`${v.plate} - ${v.model||""}`}))],
            ""))}
          ${formRow("الحالة", select("status", [{value:"open",label:"مفتوح"},{value:"progress",label:"قيد العمل"},{value:"parts",label:"بانتظار قطع"},{value:"done",label:"مكتمل"}], "open"))}
          ${formRow("المسؤول", select("assignedTo",
            [{value:"",label:"— اختاري —"}, ...employees.map(e=>({value:e.id,label:`${e.name} (${e.role||""})`}))],
            ""))}
          <div class="col" style="grid-column:1/-1">
            <div class="small">المشكلة</div>
            ${textarea("problem","","مثال: تبديل فحمات/تصليح عطل كهرباء/..." )}
          </div>
          <div class="col" style="grid-column:1/-1">
            <div class="small">ملاحظات</div>
            ${textarea("note","")}
          </div>
          <div class="row-actions" style="grid-column:1/-1;">
            <button class="btn btn-primary" type="submit">حفظ</button>
            <button class="btn btn-soft" type="button" id="btnCancelNew">إلغاء</button>
          </div>
        </form>
      `;
      $("#btnCancelNew").addEventListener("click", ()=> box.classList.add("hidden"));
      $("#fOrderNew").addEventListener("submit", async (e)=>{
        e.preventDefault();
        const data = getFormData(e.target);
        if(!data.customerId || !data.vehicleId) return toast("اختاري زبون وسيارة", "bad");

        const c = CACHE.customers.get(data.customerId);
        const v = CACHE.vehicles.get(data.vehicleId);
        const no = await nextCounter("orderNo");
        const code = `WO-${no}`;

        const id = await createDoc(C.orders(), {
          code,
          customerId:data.customerId,
          customerName:c?.name||"",
          customerPhone:c?.phone||"",
          vehicleId:data.vehicleId,
          vehicleLabel:`${v?.plate||""} - ${v?.model||""}`,
          status: data.status || "open",
          assignedTo: data.assignedTo || "",
          problem: data.problem||"",
          note: data.note||"",
          parts: [],
          labor: [],
          doneDate: ""
        });
        toast("تم إنشاء أمر الشغل", "good");
        box.classList.add("hidden");
        location.hash = "#/orders";
      });
      return;
    }

    // existing order editor
    const parts = Array.isArray(order.parts) ? order.parts : [];
    const labor = Array.isArray(order.labor) ? order.labor : [];

    box.innerHTML = `
      <div class="row-actions" style="justify-content:space-between;align-items:flex-end;">
        <div>
          <div class="section-title">تعديل: ${escapeHtml(order.code||order.id||"")}</div>
          <div class="small">${escapeHtml(order.customerName||"")} — ${escapeHtml(order.vehicleLabel||"")}</div>
        </div>
        <div class="row-actions">
          <button id="btnMakeInvoice" class="btn btn-primary">تحويل إلى فاتورة</button>
          <button id="btnCloseEditor" class="btn btn-soft">إغلاق</button>
        </div>
      </div>
      <div class="hr"></div>

      <form id="fOrderEdit" class="grid3">
        ${formRow("الحالة", select("status", [
          {value:"open",label:"مفتوح"},
          {value:"progress",label:"قيد العمل"},
          {value:"parts",label:"بانتظار قطع"},
          {value:"done",label:"مكتمل"}
        ], order.status||"open"))}

        ${formRow("المسؤول", select("assignedTo",
          [{value:"",label:"—"} ,...employees.map(e=>({value:e.id,label:`${e.name} (${e.role||""})`}))],
          order.assignedTo||""))}

        <div class="col" style="grid-column:1/-1">
          <div class="small">المشكلة</div>
          ${textarea("problem", order.problem||"")}
        </div>
        <div class="col" style="grid-column:1/-1">
          <div class="small">ملاحظات</div>
          ${textarea("note", order.note||"")}
        </div>

        <div class="col" style="grid-column:1/-1">
          <div class="section-title">القطع المستخدمة</div>
          <div class="small">يتم خصمها من المخزون عند حفظ الفاتورة (أو عند التخصيص اختياريًا)</div>
          <div class="hr"></div>

          <div class="row-actions">
            <select id="partSel" class="input" style="min-width:260px">
              <option value="">— اختيار قطعة —</option>
              ${Array.from(CACHE.inventory.values()).map(p=>`<option value="${p.id}">${escapeHtml(p.name)} (متوفر: ${p.qty||0})</option>`).join("")}
            </select>
            <input id="partQty" class="input" style="width:120px" type="number" min="1" value="1" />
            <input id="partPrice" class="input" style="width:160px" type="number" min="0" value="0" placeholder="السعر" />
            <button id="btnAddPart" class="btn btn-soft" type="button">إضافة</button>
          </div>

          <div id="partsList" style="margin-top:10px;"></div>
        </div>

        <div class="col" style="grid-column:1/-1">
          <div class="section-title">الأجور</div>
          <div class="hr"></div>
          <div class="row-actions">
            <input id="laborName" class="input" style="min-width:260px" placeholder="مثال: أجرة تصليح" />
            <input id="laborPrice" class="input" style="width:160px" type="number" min="0" value="0" placeholder="المبلغ" />
            <button id="btnAddLabor" class="btn btn-soft" type="button">إضافة</button>
          </div>
          <div id="laborList" style="margin-top:10px;"></div>
        </div>

        <div class="row-actions" style="grid-column:1/-1;">
          <button class="btn btn-primary" type="submit">حفظ</button>
          <button id="btnDeleteOrder" class="btn btn-danger" type="button">حذف</button>
        </div>
      </form>
    `;

    const ref = doc(db, "orders", order.id);

    function renderParts(){
      const total = parts.reduce((s,it)=> s+Number(it.qty||0)*Number(it.price||0),0);
      $("#partsList").innerHTML = `
        <table class="table">
          <thead><tr><th>القطعة</th><th>الكمية</th><th>السعر</th><th>المجموع</th><th></th></tr></thead>
          <tbody>
            ${parts.map((it,idx)=>`
              <tr class="tr">
                <td>${escapeHtml(it.name||"")}</td>
                <td>${escapeHtml(it.qty||0)}</td>
                <td>${fmtMoney(it.price||0)}</td>
                <td>${fmtMoney(Number(it.qty||0)*Number(it.price||0))}</td>
                <td><button class="btn btn-soft" data-rmp="${idx}">حذف</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div class="kv"><span>مجموع القطع</span><b>${fmtMoney(total)}</b></div>
      `;
      $$("[data-rmp]").forEach(b=> b.addEventListener("click", ()=>{
        const i = Number(b.dataset.rmp);
        parts.splice(i,1);
        renderParts();
      }));
    }

    function renderLabor(){
      const total = labor.reduce((s,it)=> s+Number(it.price||0),0);
      $("#laborList").innerHTML = `
        <table class="table">
          <thead><tr><th>الوصف</th><th>المبلغ</th><th></th></tr></thead>
          <tbody>
            ${labor.map((it,idx)=>`
              <tr class="tr">
                <td>${escapeHtml(it.name||"")}</td>
                <td>${fmtMoney(it.price||0)}</td>
                <td><button class="btn btn-soft" data-rml="${idx}">حذف</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
        <div class="kv"><span>مجموع الأجور</span><b>${fmtMoney(total)}</b></div>
      `;
      $$("[data-rml]").forEach(b=> b.addEventListener("click", ()=>{
        const i = Number(b.dataset.rml);
        labor.splice(i,1);
        renderLabor();
      }));
    }

    renderParts(); renderLabor();

    $("#btnAddPart").addEventListener("click", ()=>{
      const pid = $("#partSel").value;
      const qty = Number($("#partQty").value||0);
      const price = Number($("#partPrice").value||0);
      if(!pid || qty<=0) return toast("اختاري قطعة وكمية", "bad");
      const p = CACHE.inventory.get(pid);
      parts.push({
        partId: pid,
        name: p?.name||"",
        unit: p?.unit||"",
        qty,
        price: price || Number(p?.sell||0)
      });
      renderParts();
    });

    $("#btnAddLabor").addEventListener("click", ()=>{
      const name = $("#laborName").value.trim();
      const price = Number($("#laborPrice").value||0);
      if(!name || price<=0) return toast("أدخلي وصف ومبلغ", "bad");
      labor.push({name, price});
      $("#laborName").value=""; $("#laborPrice").value="0";
      renderLabor();
    });

    $("#btnCloseEditor").addEventListener("click", ()=> box.classList.add("hidden"));

    $("#fOrderEdit").addEventListener("submit", async (e)=>{
      e.preventDefault();
      const data = getFormData(e.target);
      const newStatus = data.status || "open";
      const doneDate = newStatus==="done" ? (order.doneDate || new Date().toISOString()) : "";

      await updateDocSafe(ref, {
        status: newStatus,
        assignedTo: data.assignedTo||"",
        problem: data.problem||"",
        note: data.note||"",
        parts,
        labor,
        doneDate
      });
      toast("تم الحفظ", "good");
      if(newStatus==="done") toast("تم إكمال الأمر", "good");
      box.classList.add("hidden");
    });

    $("#btnDeleteOrder").addEventListener("click", async ()=>{
      if(!can("admin")) return toast("الحذف للأدمن فقط", "bad");
      if(!confirm("حذف أمر الشغل؟")) return;
      await deleteDocSafe(ref);
      toast("تم الحذف", "good");
      box.classList.add("hidden");
    });

    $("#btnMakeInvoice").addEventListener("click", ()=> createInvoiceFromOrder(order, parts, labor));
  }
}

// ---------- Invoices from order ----------
async function createInvoiceFromOrder(order, parts, labor){
  if(!requireRole("staff")) return;

  // compute totals
  const partsTotal = parts.reduce((s,it)=> s+Number(it.qty||0)*Number(it.price||0), 0);
  const laborTotal = labor.reduce((s,it)=> s+Number(it.price||0), 0);
  const subTotal = partsTotal + laborTotal;
  const vat = Number(SETTINGS.vatPercent||0);
  const vatVal = subTotal*(vat/100);
  const discount = 0;
  const total = subTotal + vatVal - discount;

  // Build items list
  const items = [
    ...parts.map(p=>({ type:"part", name:p.name, unit:p.unit||"قطعة", qty:Number(p.qty||0), price:Number(p.price||0), partId:p.partId||"" })),
    ...labor.map(l=>({ type:"labor", name:l.name, unit:"خدمة", qty:1, price:Number(l.price||0) }))
  ];

  // Save invoice
  const invNo = await nextCounter("invoiceNo");
  const code = `${SETTINGS.invoicePrefix||"INV-"}${invNo}`;
  const invId = await createDoc(C.invoices(), {
    code,
    orderId: order.id,
    customerId: order.customerId||"",
    customerName: order.customerName||"",
    customerPhone: order.customerPhone||"",
    vehicleId: order.vehicleId||"",
    vehicleLabel: order.vehicleLabel||"",
    date: todayISO(),
    items,
    subTotal,
    vatPercent: vat,
    vatValue: vatVal,
    discount,
    total,
    note: order.note||""
  });

  // Optional: mark order done when invoiced
  await updateDocSafe(doc(db,"orders",order.id), { status:"done", doneDate: new Date().toISOString() });

  // Deduct inventory for parts
  await deductInventoryForInvoice(items);

  toast("تم إنشاء الفاتورة ✅", "good");
  location.hash = "#/invoices?open="+invId;
}

async function deductInventoryForInvoice(items){
  // only parts affect inventory
  const parts = items.filter(i=> i.type==="part" && i.partId);
  if(!parts.length) return;
  const batch = writeBatch(db);
  for(const it of parts){
    const ref = doc(db, "inventory", it.partId);
    const snap = await getDoc(ref);
    if(!snap.exists()) continue;
    const cur = Number(snap.data().qty||0);
    const next = cur - Number(it.qty||0);
    batch.update(ref, { qty: next });
  }
  await batch.commit();
}

// ---------- Customers ----------
async function renderCustomers(params){
  if(!requireRole("staff")) return;
  const isNew = params.get("new")==="1";
  view.innerHTML = viewHeader("الزباين", "إضافة/تعديل بيانات الزبون");

  view.innerHTML += `
    <div class="row">
      <div class="card">
        <div class="row-actions" style="justify-content:space-between;">
          <div>
            <div class="section-title">القائمة</div>
            <div class="small">ابحثي بالاسم/الهاتف/المدينة</div>
          </div>
          <button id="btnNewCust" class="btn btn-primary">+ زبون</button>
        </div>
        <div class="hr"></div>
        <div id="custList" class="notice">... تحميل</div>
      </div>

      <div id="custEditor" class="card subcard hidden"></div>
    </div>
  `;

  $("#btnNewCust").addEventListener("click", ()=> openCustEditor(null));

  onSnapshot(query(C.customers(), orderBy("createdAt","desc"), limit(400)), (snap)=>{
    const rows=[];
    snap.forEach(d=> rows.push({id:d.id, ...d.data()}));
    const filtered = rows.filter(c => matchSearch(`${c.name} ${c.phone} ${c.city}`));

    $("#custList").outerHTML = `<div id="custList">
      ${filtered.map(c=>`
        <div class="kv" style="margin:10px 0;">
          <span><b>${escapeHtml(c.name||"")}</b><div class="small">${escapeHtml(c.phone||"")} — ${escapeHtml(c.city||"")}</div></span>
          <button class="btn btn-soft" data-ce="${c.id}">فتح</button>
        </div>
      `).join("") || `<div class="notice">لا توجد نتائج</div>`}
    </div>`;

    $$("[data-ce]").forEach(b=> b.addEventListener("click", ()=>{
      const obj = rows.find(x=>x.id===b.dataset.ce);
      openCustEditor(obj);
    }));

    if(isNew) openCustEditor(null);
  });

  function openCustEditor(cust){
    const box = $("#custEditor");
    box.classList.remove("hidden");
    if(!cust){
      box.innerHTML = `
        <div class="section-title">زبون جديد</div>
        <div class="hr"></div>
        <form id="fCustNew" class="grid3">
          ${formRow("الاسم", input("name","","text","اسم الزبون"))}
          ${formRow("الهاتف", input("phone","","text","07xxxxxxxxx"))}
          ${formRow("المدينة", input("city","","text","بغداد"))}
          <div class="row-actions" style="grid-column:1/-1;">
            <button class="btn btn-primary" type="submit">حفظ</button>
            <button id="btnCancel" class="btn btn-soft" type="button">إغلاق</button>
          </div>
        </form>
      `;
      $("#btnCancel").addEventListener("click", ()=> box.classList.add("hidden"));
      $("#fCustNew").addEventListener("submit", async (e)=>{
        e.preventDefault();
        const data = getFormData(e.target);
        if(!data.name) return toast("أدخلي الاسم", "bad");
        await createDoc(C.customers(), {
          name: data.name,
          phone: data.phone||"",
          city: data.city||""
        });
        toast("تم حفظ الزبون", "good");
        box.classList.add("hidden");
      });
      return;
    }

    box.innerHTML = `
      <div class="section-title">تعديل زبون</div>
      <div class="small">${escapeHtml(cust.name||"")}</div>
      <div class="hr"></div>
      <form id="fCustEdit" class="grid3">
        ${formRow("الاسم", input("name", cust.name||""))}
        ${formRow("الهاتف", input("phone", cust.phone||""))}
        ${formRow("المدينة", input("city", cust.city||""))}
        <div class="row-actions" style="grid-column:1/-1;">
          <button class="btn btn-primary" type="submit">حفظ</button>
          <button id="btnDel" class="btn btn-danger" type="button">حذف</button>
          <button id="btnClose" class="btn btn-soft" type="button">إغلاق</button>
        </div>
      </form>
    `;
    $("#btnClose").addEventListener("click", ()=> box.classList.add("hidden"));
    $("#fCustEdit").addEventListener("submit", async (e)=>{
      e.preventDefault();
      const data = getFormData(e.target);
      await updateDocSafe(doc(db,"customers",cust.id), {
        name:data.name||"", phone:data.phone||"", city:data.city||""
      });
      toast("تم التحديث", "good");
      box.classList.add("hidden");
    });
    $("#btnDel").addEventListener("click", async ()=>{
      if(!can("admin")) return toast("الحذف للأدمن فقط", "bad");
      if(!confirm("حذف الزبون؟")) return;
      await deleteDocSafe(doc(db,"customers",cust.id));
      toast("تم الحذف", "good");
      box.classList.add("hidden");
    });
  }
}


// ---------- Vehicles ----------
async function renderVehicles(params){
  if(!requireRole("staff")) return;
  const isNew = params.get("new")==="1";
  view.innerHTML = viewHeader("السيارات", "ربط سيارة بزبون");

  view.innerHTML += `
    <div class="row">
      <div class="card">
        <div class="row-actions" style="justify-content:space-between;">
          <div>
            <div class="section-title">القائمة</div>
            <div class="small">بحث بالرقم/الموديل/الزبون</div>
          </div>
          <button id="btnNewVeh" class="btn btn-primary">+ سيارة</button>
        </div>
        <div class="hr"></div>
        <div id="vehList" class="notice">... تحميل</div>
      </div>

      <div id="vehEditor" class="card subcard hidden"></div>
    </div>
  `;

  $("#btnNewVeh").addEventListener("click", ()=> openVehEditor(null));

  onSnapshot(query(C.vehicles(), orderBy("createdAt","desc"), limit(500)), (snap)=>{
    const rows=[];
    snap.forEach(d=> rows.push({id:d.id, ...d.data()}));
    const filtered = rows.filter(v=>{
      const cust = CACHE.customers.get(v.customerId||"");
      const label = `${v.plate} ${v.model} ${v.year||""} ${cust?.name||""}`;
      return matchSearch(label);
    });

    $("#vehList").outerHTML = `<div id="vehList">
      ${filtered.map(v=>{
        const c = CACHE.customers.get(v.customerId||"");
        return `
          <div class="kv" style="margin:10px 0;">
            <span><b>${escapeHtml(v.plate||"")}</b> — ${escapeHtml(v.model||"")} (${escapeHtml(v.year||"")})
              <div class="small">${escapeHtml(c?.name||"")} — ${escapeHtml(v.color||"")}</div>
            </span>
            <button class="btn btn-soft" data-ve="${v.id}">فتح</button>
          </div>
        `;
      }).join("") || `<div class="notice">لا توجد نتائج</div>`}
    </div>`;

    $$("[data-ve]").forEach(b=> b.addEventListener("click", ()=>{
      const obj = rows.find(x=>x.id===b.dataset.ve);
      openVehEditor(obj);
    }));

    if(isNew) openVehEditor(null);
  });

  function openVehEditor(veh){
    const box = $("#vehEditor");
    box.classList.remove("hidden");
    const customers = Array.from(CACHE.customers.values());

    if(!veh){
      box.innerHTML = `
        <div class="section-title">سيارة جديدة</div>
        <div class="hr"></div>
        <form id="fVehNew" class="grid3">
          ${formRow("الزبون", select("customerId",
            [{value:"",label:"— اختاري —"}, ...customers.map(c=>({value:c.id,label:`${c.name} (${c.phone||""})`}))],
            ""))}
          ${formRow("رقم السيارة", input("plate","","text","مثال: بغداد 12345"))}
          ${formRow("الموديل", input("model","","text","تويوتا/كيا/..."))}
          ${formRow("السنة", input("year","","number","2018"))}
          ${formRow("اللون", input("color","","text","أبيض"))}
          <div class="row-actions" style="grid-column:1/-1;">
            <button class="btn btn-primary" type="submit">حفظ</button>
            <button id="btnCancel" class="btn btn-soft" type="button">إغلاق</button>
          </div>
        </form>
      `;
      $("#btnCancel").addEventListener("click", ()=> box.classList.add("hidden"));
      $("#fVehNew").addEventListener("submit", async (e)=>{
        e.preventDefault();
        const data = getFormData(e.target);
        if(!data.customerId || !data.plate) return toast("اختاري زبون واكتبي رقم السيارة", "bad");
        await createDoc(C.vehicles(), {
          customerId: data.customerId,
          plate: data.plate,
          model: data.model||"",
          year: Number(data.year||0)||"",
          color: data.color||""
        });
        toast("تم حفظ السيارة", "good");
        box.classList.add("hidden");
      });
      return;
    }

    box.innerHTML = `
      <div class="section-title">تعديل سيارة</div>
      <div class="small">${escapeHtml(veh.plate||"")} — ${escapeHtml(veh.model||"")}</div>
      <div class="hr"></div>
      <form id="fVehEdit" class="grid3">
        ${formRow("الزبون", select("customerId",
          [{value:"",label:"—"} ,...customers.map(c=>({value:c.id,label:`${c.name} (${c.phone||""})`}))],
          veh.customerId||""))}
        ${formRow("رقم السيارة", input("plate",veh.plate||""))}
        ${formRow("الموديل", input("model",veh.model||""))}
        ${formRow("السنة", input("year",veh.year||"","number"))}
        ${formRow("اللون", input("color",veh.color||""))}
        <div class="row-actions" style="grid-column:1/-1;">
          <button class="btn btn-primary" type="submit">حفظ</button>
          <button id="btnDel" class="btn btn-danger" type="button">حذف</button>
          <button id="btnClose" class="btn btn-soft" type="button">إغلاق</button>
        </div>
      </form>
    `;
    $("#btnClose").addEventListener("click", ()=> box.classList.add("hidden"));
    $("#fVehEdit").addEventListener("submit", async (e)=>{
      e.preventDefault();
      const data = getFormData(e.target);
      await updateDocSafe(doc(db,"vehicles",veh.id), {
        customerId:data.customerId||"",
        plate:data.plate||"",
        model:data.model||"",
        year: Number(data.year||0)||"",
        color: data.color||""
      });
      toast("تم التحديث", "good");
      box.classList.add("hidden");
    });
    $("#btnDel").addEventListener("click", async ()=>{
      if(!can("admin")) return toast("الحذف للأدمن فقط", "bad");
      if(!confirm("حذف السيارة؟")) return;
      await deleteDocSafe(doc(db,"vehicles",veh.id));
      toast("تم الحذف", "good");
      box.classList.add("hidden");
    });
  }
}

// ---------- Oil Change ----------
async function renderOil(params){
  if(!requireRole("staff")) return;
  const isNew = params.get("new")==="1";
  view.innerHTML = viewHeader("تبديل دهن", "سجل سريع لتبديل الدهن ويمكن تحويله إلى فاتورة");
  const customers = Array.from(CACHE.customers.values());
  const vehicles = Array.from(CACHE.vehicles.values());
  const oils = Array.from(CACHE.inventory.values()).filter(p => (p.sku||"").toLowerCase().includes("oil") || (p.name||"").includes("دهن"));

  view.innerHTML += `
    <div class="card">
      <div class="section-title">سجل تبديل دهن</div>
      <div class="small">اختاري زبون وسيارة ونوع الدهن + الفلتر</div>
      <div class="hr"></div>
      <form id="fOil" class="grid3">
        ${formRow("الزبون", select("customerId", [{value:"",label:"—"} ,...customers.map(c=>({value:c.id,label:`${c.name} (${c.phone||""})`}))], ""))}
        ${formRow("السيارة", select("vehicleId", [{value:"",label:"—"} ,...vehicles.map(v=>({value:v.id,label:`${v.plate} - ${v.model||""}`}))], ""))}
        ${formRow("الدهن", select("oilPartId", [{value:"",label:"—"} ,...oils.map(p=>({value:p.id,label:`${p.name} (متوفر:${p.qty||0})`}))], ""))}
        ${formRow("كمية (علب)", input("oilQty","1","number"))}
        ${formRow("فلتر زيت؟", select("filter", [{value:"no",label:"لا"},{value:"yes",label:"نعم"}], "yes"))}
        ${formRow("سعر الخدمة", input("price","0","number","يمكن تركه 0 ليحسب من سعر الدهن"))}
        <div class="col" style="grid-column:1/-1">
          <div class="small">ملاحظات</div>
          ${textarea("note","")}
        </div>
        <div class="row-actions" style="grid-column:1/-1;">
          <button class="btn btn-primary" type="submit">حفظ + فاتورة</button>
        </div>
      </form>
      <div class="notice" style="margin-top:12px;">سيتم خصم الدهن من المخزون تلقائيًا عند الحفظ.</div>
    </div>
  `;

  $("#fOil").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const data = getFormData(e.target);
    if(!data.customerId || !data.vehicleId || !data.oilPartId) return toast("اختاري زبون/سيارة/دهن", "bad");

    const c = CACHE.customers.get(data.customerId);
    const v = CACHE.vehicles.get(data.vehicleId);
    const p = CACHE.inventory.get(data.oilPartId);
    const qty = Number(data.oilQty||0);
    const base = Number(data.price||0) || (Number(p?.sell||0)*qty);

    // create an invoice directly (oil as part + labor)
    const items = [
      { type:"part", name:p?.name||"دهن", unit:p?.unit||"علبة", qty, price:Number(p?.sell||0), partId:p?.id||"" },
      ...(data.filter==="yes" ? [{ type:"labor", name:"تبديل فلتر", unit:"خدمة", qty:1, price:5000 }] : []),
      { type:"labor", name:"أجرة تبديل دهن", unit:"خدمة", qty:1, price: Math.max(0, base - Number(p?.sell||0)*qty) }
    ].filter(it => Number(it.price||0) > 0);

    const partsTotal = items.filter(i=>i.type==="part").reduce((s,it)=> s+Number(it.qty||0)*Number(it.price||0), 0);
    const laborTotal = items.filter(i=>i.type==="labor").reduce((s,it)=> s+Number(it.price||0), 0);
    const subTotal = partsTotal + laborTotal;
    const vat = Number(SETTINGS.vatPercent||0);
    const vatVal = subTotal*(vat/100);
    const discount = 0;
    const total = subTotal + vatVal - discount;

    const invNo = await nextCounter("invoiceNo");
    const code = `${SETTINGS.invoicePrefix||"INV-"}${invNo}`;
    const invId = await createDoc(C.invoices(), {
      code,
      orderId: "",
      customerId: data.customerId,
      customerName: c?.name||"",
      customerPhone: c?.phone||"",
      vehicleId: data.vehicleId,
      vehicleLabel: `${v?.plate||""} - ${v?.model||""}`,
      date: todayISO(),
      items,
      subTotal,
      vatPercent: vat,
      vatValue: vatVal,
      discount,
      total,
      note: data.note||""
    });

    await deductInventoryForInvoice(items);
    toast("تم حفظ فاتورة تبديل الدهن", "good");
    location.hash = "#/invoices?open="+invId;
  });
}

// ---------- Inventory ----------
async function renderInventory(params){
  if(!requireRole("staff")) return;
  const isNew = params.get("new")==="1";
  view.innerHTML = viewHeader("المخزون", "إضافة قطع + ضبط الكميات والأسعار");

  view.innerHTML += `
    <div class="row">
      <div class="card">
        <div class="row-actions" style="justify-content:space-between;">
          <div>
            <div class="section-title">القائمة</div>
            <div class="small">بحث بالاسم/sku</div>
          </div>
          <button id="btnNewPart" class="btn btn-primary">+ قطعة</button>
        </div>
        <div class="hr"></div>
        <div id="invList" class="notice">... تحميل</div>
      </div>

      <div id="invEditor" class="card subcard hidden"></div>
    </div>
  `;

  $("#btnNewPart").addEventListener("click", ()=> openInvEditor(null));

  onSnapshot(query(C.inventory(), orderBy("createdAt","desc"), limit(800)), (snap)=>{
    const rows=[];
    snap.forEach(d=> rows.push({id:d.id, ...d.data()}));
    const filtered = rows.filter(p => matchSearch(`${p.name} ${p.sku}`));

    $("#invList").outerHTML = `<div id="invList">
      <table class="table">
        <thead><tr><th>القطعة</th><th>SKU</th><th>متوفر</th><th>بيع</th><th>حد أدنى</th><th></th></tr></thead>
        <tbody>
          ${filtered.map(p=>`
            <tr class="tr">
              <td><b>${escapeHtml(p.name||"")}</b><div class="small">${escapeHtml(p.unit||"")}</div></td>
              <td class="small">${escapeHtml(p.sku||"")}</td>
              <td>${escapeHtml(p.qty||0)}</td>
              <td>${fmtMoney(p.sell||0)}</td>
              <td>${escapeHtml(p.min||0)}</td>
              <td><button class="btn btn-soft" data-ie="${p.id}">فتح</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      ${filtered.length? "" : `<div class="notice">لا توجد نتائج</div>`}
    </div>`;

    $$("[data-ie]").forEach(b=> b.addEventListener("click", ()=>{
      const obj = rows.find(x=>x.id===b.dataset.ie);
      openInvEditor(obj);
    }));

    if(isNew) openInvEditor(null);
  });

  function openInvEditor(p){
    const box = $("#invEditor");
    box.classList.remove("hidden");
    if(!p){
      box.innerHTML = `
        <div class="section-title">قطعة جديدة</div>
        <div class="hr"></div>
        <form id="fInvNew" class="grid3">
          ${formRow("الاسم", input("name","","text","فلتر/فحمات/..."))}
          ${formRow("SKU", input("sku","","text","رمز اختياري"))}
          ${formRow("الوحدة", input("unit","قطعة"))}
          ${formRow("سعر الشراء", input("buy","0","number"))}
          ${formRow("سعر البيع", input("sell","0","number"))}
          ${formRow("الكمية", input("qty","0","number"))}
          ${formRow("حد أدنى", input("min","0","number"))}
          <div class="row-actions" style="grid-column:1/-1;">
            <button class="btn btn-primary" type="submit">حفظ</button>
            <button id="btnClose" class="btn btn-soft" type="button">إغلاق</button>
          </div>
        </form>
      `;
      $("#btnClose").addEventListener("click", ()=> box.classList.add("hidden"));
      $("#fInvNew").addEventListener("submit", async (e)=>{
        e.preventDefault();
        const data = getFormData(e.target);
        if(!data.name) return toast("أدخلي الاسم", "bad");
        await createDoc(C.inventory(), {
          name:data.name, sku:data.sku||"", unit:data.unit||"قطعة",
          buy:Number(data.buy||0), sell:Number(data.sell||0),
          qty:Number(data.qty||0), min:Number(data.min||0)
        });
        toast("تم حفظ القطعة", "good");
        box.classList.add("hidden");
      });
      return;
    }

    box.innerHTML = `
      <div class="section-title">تعديل قطعة</div>
      <div class="small">${escapeHtml(p.name||"")}</div>
      <div class="hr"></div>
      <form id="fInvEdit" class="grid3">
        ${formRow("الاسم", input("name",p.name||""))}
        ${formRow("SKU", input("sku",p.sku||""))}
        ${formRow("الوحدة", input("unit",p.unit||"قطعة"))}
        ${formRow("سعر الشراء", input("buy",p.buy||0,"number"))}
        ${formRow("سعر البيع", input("sell",p.sell||0,"number"))}
        ${formRow("الكمية", input("qty",p.qty||0,"number"))}
        ${formRow("حد أدنى", input("min",p.min||0,"number"))}
        <div class="row-actions" style="grid-column:1/-1;">
          <button class="btn btn-primary" type="submit">حفظ</button>
          <button id="btnDel" class="btn btn-danger" type="button">حذف</button>
          <button id="btnClose" class="btn btn-soft" type="button">إغلاق</button>
        </div>
      </form>
    `;
    $("#btnClose").addEventListener("click", ()=> box.classList.add("hidden"));
    $("#fInvEdit").addEventListener("submit", async (e)=>{
      e.preventDefault();
      const data = getFormData(e.target);
      await updateDocSafe(doc(db,"inventory",p.id), {
        name:data.name||"", sku:data.sku||"", unit:data.unit||"قطعة",
        buy:Number(data.buy||0), sell:Number(data.sell||0),
        qty:Number(data.qty||0), min:Number(data.min||0)
      });
      toast("تم التحديث", "good");
      box.classList.add("hidden");
    });
    $("#btnDel").addEventListener("click", async ()=>{
      if(!can("admin")) return toast("الحذف للأدمن فقط", "bad");
      if(!confirm("حذف القطعة؟")) return;
      await deleteDocSafe(doc(db,"inventory",p.id));
      toast("تم الحذف", "good");
      box.classList.add("hidden");
    });
  }
}

// ---------- Invoices ----------
async function renderInvoices(params){
  if(!requireRole("staff")) return;
  view.innerHTML = viewHeader("الفواتير", "عرض/طباعة الفواتير وتفاصيلها");

  view.innerHTML += `
    <div class="row">
      <div class="card">
        <div class="row-actions" style="justify-content:space-between;">
          <div>
            <div class="section-title">القائمة</div>
            <div class="small">بحث بالكود/الزبون/السيارة</div>
          </div>
          <button id="btnNewInvoice" class="btn btn-primary">+ فاتورة يدوية</button>
        </div>
        <div class="hr"></div>
        <div id="invList2" class="notice">... تحميل</div>
      </div>

      <div id="invEditor2" class="card subcard hidden"></div>
    </div>
  `;

  $("#btnNewInvoice").addEventListener("click", ()=> openInvoiceEditor(null));

  onSnapshot(query(C.invoices(), orderBy("createdAt","desc"), limit(400)), (snap)=>{
    const rows=[];
    snap.forEach(d=> rows.push({id:d.id, ...d.data()}));
    const filtered = rows.filter(i=> matchSearch(`${i.code} ${i.customerName} ${i.vehicleLabel}`));

    $("#invList2").outerHTML = `<div id="invList2">
      ${filtered.map(i=>`
        <div class="kv" style="margin:10px 0;">
          <span><b>${escapeHtml(i.code||i.id||"")}</b>
            <div class="small">${escapeHtml(i.customerName||"")} — ${escapeHtml(i.vehicleLabel||"")} — ${escapeHtml(i.date||"")}</div>
          </span>
          <div class="row-actions">
            <b>${fmtMoney(i.total||0)}</b>
            <button class="btn btn-soft" data-inv="${i.id}">فتح</button>
          </div>
        </div>
      `).join("") || `<div class="notice">لا توجد نتائج</div>`}
    </div>`;

    $$("[data-inv]").forEach(b=> b.addEventListener("click", ()=>{
      const obj = rows.find(x=>x.id===b.dataset.inv);
      openInvoiceEditor(obj);
    }));

    const openId = params.get("open");
    if(openId){
      const obj = rows.find(x=>x.id===openId);
      if(obj) openInvoiceEditor(obj);
    }
  });

  async function openInvoiceEditor(inv){
    const box = $("#invEditor2");
    box.classList.remove("hidden");

    const customers = Array.from(CACHE.customers.values());
    const vehicles = Array.from(CACHE.vehicles.values());

    if(!inv){
      box.innerHTML = `
        <div class="section-title">فاتورة يدوية</div>
        <div class="small">أضيفي عناصر (قطع/خدمات) ثم حفظ</div>
        <div class="hr"></div>
        <form id="fInvManual" class="grid3">
          ${formRow("الزبون", select("customerId", [{value:"",label:"—"} ,...customers.map(c=>({value:c.id,label:`${c.name} (${c.phone||""})`}))], ""))}
          ${formRow("السيارة", select("vehicleId", [{value:"",label:"—"} ,...vehicles.map(v=>({value:v.id,label:`${v.plate} - ${v.model||""}`}))], ""))}
          ${formRow("خصم", input("discount","0","number"))}
          <div class="col" style="grid-column:1/-1">
            <div class="small">ملاحظة</div>
            ${textarea("note","")}
          </div>

          <div class="col" style="grid-column:1/-1">
            <div class="section-title">العناصر</div>
            <div class="hr"></div>
            <div class="row-actions">
              <select id="manualType" class="input" style="width:160px">
                <option value="part">قطعة</option>
                <option value="labor">خدمة</option>
              </select>
              <select id="manualPart" class="input" style="min-width:260px">
                <option value="">— اختيار قطعة —</option>
                ${Array.from(CACHE.inventory.values()).map(p=>`<option value="${p.id}">${escapeHtml(p.name)} (متوفر:${p.qty||0})</option>`).join("")}
              </select>
              <input id="manualName" class="input" style="min-width:220px" placeholder="وصف" />
              <input id="manualQty" class="input" style="width:120px" type="number" min="1" value="1" />
              <input id="manualPrice" class="input" style="width:160px" type="number" min="0" value="0" />
              <button id="btnAddItem" class="btn btn-soft" type="button">إضافة</button>
            </div>
            <div id="manualItems" style="margin-top:10px;"></div>
          </div>

          <div class="row-actions" style="grid-column:1/-1;">
            <button class="btn btn-primary" type="submit">حفظ</button>
            <button id="btnClose" class="btn btn-soft" type="button">إغلاق</button>
          </div>
        </form>
      `;

      const items = [];
      const renderItems = ()=>{
        const partsTotal = items.filter(i=>i.type==="part").reduce((s,it)=> s+Number(it.qty||0)*Number(it.price||0),0);
        const laborTotal = items.filter(i=>i.type==="labor").reduce((s,it)=> s+Number(it.qty||0)*Number(it.price||0),0);
        $("#manualItems").innerHTML = `
          <table class="table">
            <thead><tr><th>النوع</th><th>الوصف</th><th>كمية</th><th>سعر</th><th>المجموع</th><th></th></tr></thead>
            <tbody>
              ${items.map((it,idx)=>`
                <tr class="tr">
                  <td class="small">${it.type==="part"?"قطعة":"خدمة"}</td>
                  <td>${escapeHtml(it.name||"")}</td>
                  <td>${escapeHtml(it.qty||0)}</td>
                  <td>${fmtMoney(it.price||0)}</td>
                  <td>${fmtMoney(Number(it.qty||0)*Number(it.price||0))}</td>
                  <td><button class="btn btn-soft" data-mi="${idx}">حذف</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
          <div class="kv"><span>مجموع القطع</span><b>${fmtMoney(partsTotal)}</b></div>
          <div class="kv"><span>مجموع الخدمات</span><b>${fmtMoney(laborTotal)}</b></div>
        `;
        $$("[data-mi]").forEach(b=> b.addEventListener("click", ()=>{
          items.splice(Number(b.dataset.mi),1);
          renderItems();
        }));
      };

      $("#btnAddItem").addEventListener("click", ()=>{
        const type = $("#manualType").value;
        const partId = $("#manualPart").value;
        const qty = Number($("#manualQty").value||0);
        const price = Number($("#manualPrice").value||0);
        let name = $("#manualName").value.trim();

        if(type==="part"){
          if(!partId) return toast("اختاري قطعة", "bad");
          const p = CACHE.inventory.get(partId);
          name = name || (p?.name||"");
          items.push({ type, partId, name, unit:p?.unit||"قطعة", qty, price: price || Number(p?.sell||0) });
        }else{
          if(!name) return toast("أدخلي وصف خدمة", "bad");
          items.push({ type, partId:"", name, unit:"خدمة", qty: qty||1, price });
        }
        renderItems();
      });

      $("#btnClose").addEventListener("click", ()=> box.classList.add("hidden"));

      $("#fInvManual").addEventListener("submit", async (e)=>{
        e.preventDefault();
        const data = getFormData(e.target);
        if(!data.customerId || !data.vehicleId) return toast("اختاري زبون وسيارة", "bad");
        if(!items.length) return toast("أضيفي عناصر للفاتورة", "bad");

        const c = CACHE.customers.get(data.customerId);
        const v = CACHE.vehicles.get(data.vehicleId);

        const partsTotal = items.filter(i=>i.type==="part").reduce((s,it)=> s+Number(it.qty||0)*Number(it.price||0),0);
        const laborTotal = items.filter(i=>i.type==="labor").reduce((s,it)=> s+Number(it.qty||0)*Number(it.price||0),0);
        const subTotal = partsTotal + laborTotal;
        const vat = Number(SETTINGS.vatPercent||0);
        const vatVal = subTotal*(vat/100);
        const discount = Number(data.discount||0);
        const total = subTotal + vatVal - discount;

        const invNo = await nextCounter("invoiceNo");
        const code = `${SETTINGS.invoicePrefix||"INV-"}${invNo}`;
        const invId = await createDoc(C.invoices(), {
          code,
          orderId:"",
          customerId:data.customerId,
          customerName:c?.name||"",
          customerPhone:c?.phone||"",
          vehicleId:data.vehicleId,
          vehicleLabel:`${v?.plate||""} - ${v?.model||""}`,
          date: todayISO(),
          items,
          subTotal,
          vatPercent: vat,
          vatValue: vatVal,
          discount,
          total,
          note:data.note||""
        });

        await deductInventoryForInvoice(items.map(it=>({
          type: it.type==="part"?"part":"labor",
          name: it.name, unit: it.unit||"",
          qty: Number(it.qty||0), price: Number(it.price||0),
          partId: it.partId||it.partId||""
        })));

        toast("تم حفظ الفاتورة", "good");
        box.classList.add("hidden");
        location.hash = "#/invoices?open="+invId;
      });

      renderItems();
      return;
    }

    // show invoice details
    const items = Array.isArray(inv.items) ? inv.items : [];
    const partsTotal = items.filter(i=>i.type==="part").reduce((s,it)=> s+Number(it.qty||0)*Number(it.price||0),0);
    const laborTotal = items.filter(i=>i.type==="labor").reduce((s,it)=> s+Number(it.qty||0)*Number(it.price||0),0);

    box.innerHTML = `
      <div class="row-actions" style="justify-content:space-between;align-items:flex-end;">
        <div>
          <div class="section-title">فاتورة: ${escapeHtml(inv.code||inv.id||"")}</div>
          <div class="small">${escapeHtml(inv.customerName||"")} — ${escapeHtml(inv.vehicleLabel||"")} — ${escapeHtml(inv.date||"")}</div>
        </div>
        <div class="row-actions">
          <button id="btnPrintInv" class="btn btn-primary">طباعة</button>
          <button id="btnClose" class="btn btn-soft">إغلاق</button>
        </div>
      </div>
      <div class="hr"></div>

      <div class="kv"><span>مجموع القطع</span><b>${fmtMoney(partsTotal)}</b></div>
      <div class="kv"><span>مجموع الخدمات</span><b>${fmtMoney(laborTotal)}</b></div>
      <div class="kv"><span>الإجمالي</span><b>${fmtMoney(inv.total||0)}</b></div>

      <div class="hr"></div>
      <table class="table">
        <thead><tr><th>النوع</th><th>الوصف</th><th>كمية</th><th>سعر</th><th>المجموع</th></tr></thead>
        <tbody>
          ${items.map(it=>`
            <tr class="tr">
              <td class="small">${it.type==="part"?"قطعة":"خدمة"}</td>
              <td>${escapeHtml(it.name||"")}</td>
              <td>${escapeHtml(it.qty||0)}</td>
              <td>${fmtMoney(it.price||0)}</td>
              <td>${fmtMoney(Number(it.qty||0)*Number(it.price||0))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>

      <div class="hr"></div>
      <div class="notice">${escapeHtml(inv.note||"")}</div>
    `;

    $("#btnClose").addEventListener("click", ()=> box.classList.add("hidden"));
    $("#btnPrintInv").addEventListener("click", ()=>{
      openPrint(invoiceHtml(inv, items));
    });
  }
}

// ---------- Employees ----------
async function renderEmployees(params){
  if(!requireRole("admin")) return;
  const isNew = params.get("new")==="1";
  view.innerHTML = viewHeader("الموظفين", "إدارة أسماء وأدوار الموظفين (للتعيين على أوامر الشغل)");

  view.innerHTML += `
    <div class="row">
      <div class="card">
        <div class="row-actions" style="justify-content:space-between;">
          <div>
            <div class="section-title">القائمة</div>
            <div class="small">بحث بالاسم/الدور</div>
          </div>
          <button id="btnNewEmp" class="btn btn-primary">+ موظف</button>
        </div>
        <div class="hr"></div>
        <div id="empList" class="notice">... تحميل</div>
      </div>
      <div id="empEditor" class="card subcard hidden"></div>
    </div>
  `;

  $("#btnNewEmp").addEventListener("click", ()=> openEmpEditor(null));

  onSnapshot(query(C.employees(), orderBy("createdAt","desc"), limit(400)), (snap)=>{
    const rows=[]; snap.forEach(d=> rows.push({id:d.id, ...d.data()}));
    const filtered = rows.filter(e => matchSearch(`${e.name} ${e.role}`));

    $("#empList").outerHTML = `<div id="empList">
      ${filtered.map(e=>`
        <div class="kv" style="margin:10px 0;">
          <span><b>${escapeHtml(e.name||"")}</b><div class="small">${escapeHtml(e.role||"")}</div></span>
          <button class="btn btn-soft" data-ee="${e.id}">فتح</button>
        </div>
      `).join("") || `<div class="notice">لا توجد نتائج</div>`}
    </div>`;

    $$("[data-ee]").forEach(b=> b.addEventListener("click", ()=>{
      const obj = rows.find(x=>x.id===b.dataset.ee);
      openEmpEditor(obj);
    }));
    if(isNew) openEmpEditor(null);
  });

  function openEmpEditor(emp){
    const box = $("#empEditor");
    box.classList.remove("hidden");
    if(!emp){
      box.innerHTML = `
        <div class="section-title">موظف جديد</div>
        <div class="hr"></div>
        <form id="fEmpNew" class="grid3">
          ${formRow("الاسم", input("name","","text","اسم"))}
          ${formRow("الدور", input("role","","text","ميكانيكي/كهربائي/..."))}
          <div class="row-actions" style="grid-column:1/-1;">
            <button class="btn btn-primary" type="submit">حفظ</button>
            <button id="btnClose" class="btn btn-soft" type="button">إغلاق</button>
          </div>
        </form>
      `;
      $("#btnClose").addEventListener("click", ()=> box.classList.add("hidden"));
      $("#fEmpNew").addEventListener("submit", async (e)=>{
        e.preventDefault();
        const data = getFormData(e.target);
        if(!data.name) return toast("أدخلي الاسم", "bad");
        await createDoc(C.employees(), { name:data.name, role:data.role||"" });
        toast("تم حفظ الموظف", "good");
        box.classList.add("hidden");
      });
      return;
    }

    box.innerHTML = `
      <div class="section-title">تعديل موظف</div>
      <div class="small">${escapeHtml(emp.name||"")}</div>
      <div class="hr"></div>
      <form id="fEmpEdit" class="grid3">
        ${formRow("الاسم", input("name",emp.name||""))}
        ${formRow("الدور", input("role",emp.role||""))}
        <div class="row-actions" style="grid-column:1/-1;">
          <button class="btn btn-primary" type="submit">حفظ</button>
          <button id="btnDel" class="btn btn-danger" type="button">حذف</button>
          <button id="btnClose" class="btn btn-soft" type="button">إغلاق</button>
        </div>
      </form>
    `;
    $("#btnClose").addEventListener("click", ()=> box.classList.add("hidden"));
    $("#fEmpEdit").addEventListener("submit", async (e)=>{
      e.preventDefault();
      const data = getFormData(e.target);
      await updateDocSafe(doc(db,"employees",emp.id), { name:data.name||"", role:data.role||"" });
      toast("تم التحديث", "good");
      box.classList.add("hidden");
    });
    $("#btnDel").addEventListener("click", async ()=>{
      if(!confirm("حذف الموظف؟")) return;
      await deleteDocSafe(doc(db,"employees",emp.id));
      toast("تم الحذف", "good");
      box.classList.add("hidden");
    });
  }
}

// ---------- Reports ----------
async function renderReports(params){
  if(!requireRole("admin")) return;
  view.innerHTML = viewHeader("التقارير", "تقارير يومية/فترة (مبسطة)");

  view.innerHTML += `
    <div class="card">
      <div class="section-title">تقرير المبيعات</div>
      <div class="small">اختاري فترة</div>
      <div class="hr"></div>
      <form id="fRep" class="row">
        ${formRow("من", input("from", todayISO(),"date"))}
        ${formRow("إلى", input("to", todayISO(),"date"))}
        <div class="row-actions" style="grid-column:1/-1;">
          <button class="btn btn-primary" type="submit">عرض</button>
        </div>
      </form>
      <div id="repOut" class="notice" style="margin-top:12px;">—</div>
    </div>
  `;

  $("#fRep").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const data = getFormData(e.target);
    const from = data.from||""; const to = data.to||"";
    const snap = await getDocs(query(C.invoices(), orderBy("date","desc"), limit(800)));
    const rows=[]; snap.forEach(d=> rows.push({id:d.id, ...d.data()}));
    const within = rows.filter(i=> inRange((i.date||"").slice(0,10), from, to));
    const total = within.reduce((s,i)=> s+Number(i.total||0), 0);
    $("#repOut").textContent = `عدد الفواتير: ${within.length} — المجموع: ${fmtMoney(total)}`;
  });
}

// ---------- Backup (Export JSON) ----------
async function renderBackup(params){
  if(!requireRole("admin")) return;
  view.innerHTML = viewHeader("نسخ احتياطي", "تصدير/استيراد JSON بسيط (يدوي)");

  view.innerHTML += `
    <div class="card">
      <div class="section-title">تصدير</div>
      <div class="small">ينتج ملف JSON يمكن حفظه محليًا</div>
      <div class="hr"></div>
      <div class="row-actions">
        <button id="btnExport" class="btn btn-primary">تصدير الآن</button>
        <button id="btnImportHelp" class="btn btn-soft">إرشادات الاستيراد</button>
      </div>
      <pre id="backupOut" class="notice" style="margin-top:12px;white-space:pre-wrap;max-height:320px;overflow:auto;"></pre>
    </div>
  `;

  $("#btnImportHelp").addEventListener("click", ()=>{
    toast("الاستيراد غير مفعّل تلقائيًا لتفادي الأخطاء. إذا تريدينه أضيفه لك.", "good");
  });

  $("#btnExport").addEventListener("click", async ()=>{
    const cols = ["customers","vehicles","employees","inventory","checkins","orders","invoices","users"];
    const out = {};
    for(const name of cols){
      const snap = await getDocs(query(collection(db,name), limit(2000)));
      out[name] = [];
      snap.forEach(d=> out[name].push({id:d.id, ...d.data()}));
    }
    out.meta = { exportedAt: new Date().toISOString(), settings: SETTINGS };
    const jsonStr = JSON.stringify(out, null, 2);
    $("#backupOut").textContent = jsonStr;

    // download
    const blob = new Blob([jsonStr], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rpm-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// ---------- Settings ----------
async function renderSettings(params){
  if(!requireRole("admin")) return;
  view.innerHTML = viewHeader("إعدادات الفاتورة", "الاسم/الهاتف/العنوان/الضريبة/بادئة الفاتورة");

  view.innerHTML += `
    <div class="card">
      <div class="section-title">الإعدادات</div>
      <div class="hr"></div>
      <form id="fSettings" class="grid3">
        ${formRow("اسم الورشة", input("shopName", SETTINGS.shopName||""))}
        ${formRow("الهاتف", input("phone", SETTINGS.phone||""))}
        ${formRow("بادئة الفاتورة", input("invoicePrefix", SETTINGS.invoicePrefix||"INV-"))}
        <div class="col" style="grid-column:1/-1">
          <div class="small">العنوان</div>
          ${textarea("address", SETTINGS.address||"")}
        </div>
        ${formRow("ضريبة %", input("vatPercent", SETTINGS.vatPercent||0,"number"))}
        <div class="row-actions" style="grid-column:1/-1;">
          <button class="btn btn-primary" type="submit">حفظ</button>
        </div>
      </form>
    </div>
  `;

  $("#fSettings").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const data = getFormData(e.target);
    SETTINGS = {
      shopName: data.shopName||"",
      phone: data.phone||"",
      address: data.address||"",
      invoicePrefix: data.invoicePrefix||"INV-",
      vatPercent: Number(data.vatPercent||0)
    };
    await setDoc(C.settings(), SETTINGS, {merge:true});
    toast("تم حفظ الإعدادات", "good");
  });
}

// ---------- Admin panel (users/roles) ----------
async function renderAdmin(params){
  if(!requireRole("admin")) return;
  view.innerHTML = viewHeader("لوحة الأدمن", "تحديد صلاحيات المستخدمين (حسب UID)");

  view.innerHTML += `
    <div class="card">
      <div class="section-title">المستخدمون</div>
      <div class="small">قم بإضافة وثيقة في users/{uid} أو استخدم نموذج التعديل أدناه</div>
      <div class="hr"></div>

      <form id="fUserRole" class="grid3">
        ${formRow("UID", input("uid","","text","UID من Firebase Auth"))}
        ${formRow("Email", input("email","","text","اختياري"))}
        ${formRow("Role", select("role", [{value:"viewer",label:"viewer"},{value:"staff",label:"staff"},{value:"admin",label:"admin"}], "staff"))}
        <div class="row-actions" style="grid-column:1/-1;">
          <button class="btn btn-primary" type="submit">حفظ الدور</button>
        </div>
      </form>

      <div class="hr"></div>
      <div id="usersList" class="notice">... تحميل</div>
    </div>
  `;

  $("#fUserRole").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const data = getFormData(e.target);
    if(!data.uid) return toast("أدخلي UID", "bad");
    await setDoc(doc(db,"users",data.uid), { email:data.email||"", role:data.role||"viewer", updatedAt: serverTimestamp() }, {merge:true});
    toast("تم حفظ الدور", "good");
    e.target.reset();
  });

  onSnapshot(query(C.users(), limit(200)), (snap)=>{
    const rows=[]; snap.forEach(d=> rows.push({id:d.id, ...d.data()}));
    $("#usersList").outerHTML = `<div id="usersList">
      ${rows.map(u=>`
        <div class="kv" style="margin:10px 0;">
          <span><b>${escapeHtml(u.email||"—")}</b><div class="small">UID: ${escapeHtml(u.id)} — Role: ${escapeHtml(u.role||"viewer")}</div></span>
        </div>
      `).join("") || `<div class="notice">لا يوجد مستخدمون</div>`}
    </div>`;
  });
}

// ---------- Router ----------
const routes = {
  "dashboard": renderDashboard,
  "checkin": renderCheckin,
  "orders": renderOrders,
  "customers": renderCustomers,
  "vehicles": renderVehicles,
  "oil": renderOil,
  "inventory": renderInventory,
  "invoices": renderInvoices,
  "employees": renderEmployees,
  "reports": renderReports,
  "backup": renderBackup,
  "settings": renderSettings,
  "admin": renderAdmin
};

function parseHash(){
  const raw = (location.hash || "#/dashboard").slice(2);
  const [path, qs] = raw.split("?");
  const params = new URLSearchParams(qs||"");
  return { path: path || "dashboard", params };
}

async function route(){
  const {path, params} = parseHash();
  setActiveNav(path);
  const fn = routes[path] || renderDashboard;
  try{
    await fn(params);
  }catch(err){
    console.error(err);
    view.innerHTML = `<div class="notice">حدث خطأ: ${escapeHtml(err.message||String(err))}</div>`;
  }
}

// ---------- Init ----------
onAuthStateChanged(auth, async (user)=>{
  CURRENT_USER = user;
  if(!user){
    showAuth();
    return;
  }
  showApp();
  userBadge.textContent = user.email || user.uid;

  await loadSettings();
  await ensureCounters();
  CURRENT_ROLE = await getUserRole(user.uid);

  // hide admin-only nav
  $$(".nav-item").forEach(a=>{
    if(a.dataset.route==="admin" || a.dataset.route==="employees" || a.dataset.route==="reports" || a.dataset.route==="backup" || a.dataset.route==="settings"){
      a.style.display = can("admin") ? "" : "none";
    }
  });

  subscribeCore();
  route();
});

window.route = route;
window.addEventListener("hashchange", route);
route();
