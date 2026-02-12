/* RPM — Workshop ERP (Firestore-first) — Clean Rebuild 2026-02-12
   - Hash Router (GitHub Pages)
   - Auth + Roles + Overrides
   - Orders + Auto-create Customer & Car
   - Oil Change fast flow + car KM update
   - Invoices CRUD + Templates CRUD + Print
   - Admin: Users (create via secondary auth), Employees, Departments, Settings, Custom Pages (CMS)
*/

/* ---------- Firebase (Module imports) ---------- */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  sendPasswordResetEmail, signOut, createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs,
  setDoc, addDoc, updateDoc, deleteDoc,
  serverTimestamp, query, where, orderBy, limit,
  onSnapshot, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* ---------- Firebase Config ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyC0p4cqNHuqZs9_gNuKLl7nEY0MqRXbf_A",
  authDomain: "rpm574.firebaseapp.com",
  databaseURL: "https://rpm574-default-rtdb.firebaseio.com",
  projectId: "rpm574",
  storageBucket: "rpm574.firebasestorage.app",
  messagingSenderId: "150918603525",
  appId: "1:150918603525:web:fe1d0fbe5c4505936c4d6c"
};

const APP = {
  name: "RPM",
  subtitle: "Workshop ERP",
  currency: "IQD",
  version: "2026.02.12-rebuild"
};

/* ---------- Collections ---------- */
const C = {
  cars: "cars",
  customers: "customers",
  departments: "departments",
  employees: "employees",
  invoiceTemplates: "invoiceTemplates",
  invoices: "invoices",
  meta: "meta",
  orders: "orders",
  settings: "settings",
  uiConfig: "uiConfig",
  users: "users",
};

/* ---------- DOM Helpers (robust) ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const el = (tag, attrs = {}, children = []) => {
  const n = document.createElement(tag);

  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v ?? "";
    else if (k === "html") n.innerHTML = v ?? "";
    else if (k === "style") n.style.cssText = v ?? "";
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }

  const flatten = (arr) => {
    if (!Array.isArray(arr)) return [arr];
    if (arr.flat) return arr.flat(Infinity);
    // fallback
    const out = [];
    (function rec(a){
      for (const x of a) Array.isArray(x) ? rec(x) : out.push(x);
    })(arr);
    return out;
  };

  const list = flatten(children);
  for (const c of list) {
    if (c === null || c === undefined || c === false) continue;
    if (c instanceof Node) n.appendChild(c);
    else n.appendChild(document.createTextNode(String(c)));
  }
  return n;
};

/* ---------- Toast ---------- */
const toastHost = () => $("#toastHost");
function toast(title, msg = "", type = "ok") {
  const t = el("div", { class: `toast ${type}` }, [
    el("div", { class: "t" }, [title]),
    msg ? el("div", { class: "s" }, [msg]) : el("div")
  ]);
  toastHost()?.appendChild(t);
  setTimeout(() => t.remove(), 4500);
}

/* ---------- Modal ---------- */
const modalHost = () => $("#modalHost");
function openModal(title, bodyNode, actions = []) {
  const host = modalHost();
  host.classList.remove("hidden");
  host.innerHTML = "";

  const close = () => {
    host.classList.add("hidden");
    host.innerHTML = "";
  };

  host.addEventListener("click", (e) => {
    if (e.target === host) close();
  });

  const head = el("div", { class: "modalHead" }, [
    el("b", {}, [title]),
    el("div", { class: "actions" }, [
      ...actions,
      el("button", { class: "btn ghost", onclick: close }, ["إغلاق"])
    ])
  ]);

  const modal = el("div", { class: "modal" }, [
    head,
    el("div", { class: "modalBody" }, [bodyNode]),
  ]);

  host.appendChild(modal);
  return { close };
}

/* ---------- Format Helpers ---------- */
function tsToDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string") return new Date(v);
  if (typeof v === "number") return new Date(v);
  if (typeof v === "object" && typeof v.toDate === "function") return v.toDate();
  return null;
}
function fmtDate(v) {
  const d = tsToDate(v);
  if (!d) return "-";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fmtMoney(n) {
  const x = Number(n || 0);
  return x.toLocaleString("ar-IQ") + " " + APP.currency;
}
function safeStr(x){ return (x ?? "").toString(); }

/* ---------- Permissions ---------- */
const ROLE_MATRIX = {
  admin:   { readAll: true, writeAll: true, manageUsers: true, manageSettings: true, delete: true },
  manager: { readAll: true, writeAll: true, manageUsers: false, manageSettings: false, delete: false },
  tech:    { readAll: false, writeAll: false, techOrders: true, delete: false },
  viewer:  { readAll: true, writeAll: false, delete: false },
};
const PERM_KEYS = ["readAll","writeAll","manageUsers","manageSettings","techOrders","delete"];

function hasPerm(profile, perm) {
  if (!profile) return false;
  const role = profile.role || "viewer";
  const base = ROLE_MATRIX[role] || ROLE_MATRIX.viewer;
  const overrides = profile.permissions || {};
  if (overrides[perm] === true) return true;
  if (overrides[perm] === false) return false;
  return !!base[perm];
}

/* ---------- App State ---------- */
const state = {
  app: null,
  auth: null,
  auth2: null,         // secondary auth for creating users (no logout for admin)
  db: null,
  user: null,
  profile: null,
  settings: null,
  uiApp: null,
  unsub: [],
};

function clearLive(){
  for (const u of state.unsub) { try{ u(); }catch{} }
  state.unsub = [];
}

/* ---------- Router ---------- */
function route() {
  const h = (location.hash || "#/dashboard").replace("#/", "");
  const [slug, id] = h.split("/");
  return { slug: slug || "dashboard", id: id || null };
}
function navTo(slug, id=null){
  location.hash = `#/${slug}${id ? "/" + id : ""}`;
}

/* ---------- Firestore Seeds / Bootstrap ---------- */
async function ensureDefaults(){
  // settings/app
  const sRef = doc(state.db, C.settings, "app");
  const sSnap = await getDoc(sRef);
  if (!sSnap.exists()){
    await setDoc(sRef, {
      workshopName: "RPM",
      workshopPhone: "",
      workshopAddress: "",
      invoicePrefix: "RPM-",
      invoicePadding: 6,
      taxPercent: 0,
      defaultTemplateId: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // uiConfig/app
  const uRef = doc(state.db, C.uiConfig, "app");
  const uSnap = await getDoc(uRef);
  if (!uSnap.exists()){
    await setDoc(uRef, {
      brandName: "RPM",
      nav: [
        { slug:"dashboard", title:"لوحة التحكم", icon:"📊", roles:["admin","manager","tech","viewer"] },
        { slug:"orders", title:"أوامر الشغل", icon:"🧾", roles:["admin","manager","tech"] },
        { slug:"oil", title:"تبديل دهن", icon:"🛢️", roles:["admin","manager","tech"] },
        { slug:"invoices", title:"الفواتير", icon:"🧾", roles:["admin","manager"] },
        { slug:"templates", title:"قوالب الفواتير", icon:"🧩", roles:["admin","manager"] },
        { slug:"customers", title:"الزبائن", icon:"👤", roles:["admin","manager","tech"] },
        { slug:"cars", title:"السيارات", icon:"🚗", roles:["admin","manager","tech"] },
        { slug:"employees", title:"الموظفون", icon:"👷", roles:["admin","manager"] },
        { slug:"departments", title:"الأقسام", icon:"🏷️", roles:["admin","manager"] },
        { slug:"users", title:"صلاحيات المستخدمين", icon:"🛡️", roles:["admin"] },
        { slug:"ui", title:"صفحات مخصّصة", icon:"🧱", roles:["admin"] },
        { slug:"settings", title:"الإعدادات", icon:"⚙️", roles:["admin"] },
      ],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // meta invoice counter
  const mRef = doc(state.db, C.meta, "invoiceCounter");
  const mSnap = await getDoc(mRef);
  if (!mSnap.exists()){
    await setDoc(mRef, { next: 1, updatedAt: serverTimestamp() });
  }

  // default invoice template if none
  const tQ = query(collection(state.db, C.invoiceTemplates), limit(1));
  const tS = await getDocs(tQ);
  if (tS.empty){
    await addDoc(collection(state.db, C.invoiceTemplates), {
      name: "فاتورة — افتراضي (فخم)",
      css: `
        body{ font-family: Tahoma, Arial; direction: rtl; padding:18px; }
        .head{ display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
        .brand{ font-size:20px; font-weight:800; }
        .meta{ font-size:12px; color:#555; text-align:left; }
        hr{ margin:10px 0; border:0; border-top:1px solid #ddd;}
        .grid{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .box{ border:1px solid #eee; border-radius:14px; padding:10px; }
        .box h3{ margin:0 0 6px 0; font-size:13px; }
        table{ width:100%; border-collapse:collapse; margin-top:12px; }
        th,td{ border:1px solid #eee; padding:8px; text-align:right; }
        th{ background:#f7f7f7; }
        .tot{ margin-top:10px; display:flex; justify-content:flex-end; gap:18px; font-weight:700; }
        .foot{ margin-top:12px; font-size:12px; color:#666; }
      `,
      html: `
        <div class="head">
          <div>
            <div class="brand">{{workshopName}}</div>
            <div style="font-size:12px;color:#555">{{workshopPhone}} — {{workshopAddress}}</div>
            <div style="margin-top:6px;font-weight:700">فاتورة خدمة — {{serviceTitle}}</div>
          </div>
          <div class="meta">
            رقم: <b>{{invoiceNo}}</b><br/>
            التاريخ: {{date}}
          </div>
        </div>
        <hr/>
        <div class="grid">
          <div class="box">
            <h3>الزبون</h3>
            <div>الاسم: <b>{{customerName}}</b></div>
            <div>الهاتف: {{customerPhone}}</div>
          </div>
          <div class="box">
            <h3>السيارة</h3>
            <div>اللوحة: <b>{{plate}}</b></div>
            <div>الموديل: {{carModel}}</div>
            <div>السنة: {{year}}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr><th>الوصف</th><th>الكمية</th><th>السعر</th><th>المجموع</th></tr>
          </thead>
          <tbody>
            {{#items}}
              <tr>
                <td>{{desc}}</td>
                <td>{{qty}}</td>
                <td>{{priceFmt}}</td>
                <td>{{lineTotalFmt}}</td>
              </tr>
            {{/items}}
          </tbody>
        </table>

        <div class="tot">
          <div>الإجمالي: <b>{{totalFmt}}</b></div>
        </div>
        <div class="foot">شكراً لزيارتكم — RPM</div>
      `,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      isDefault: true,
    });
  }
}

async function loadBootstrapData(){
  await ensureDefaults();

  const sSnap = await getDoc(doc(state.db, C.settings, "app"));
  state.settings = sSnap.exists() ? { id:sSnap.id, ...sSnap.data() } : null;

  const uSnap = await getDoc(doc(state.db, C.uiConfig, "app"));
  state.uiApp = uSnap.exists() ? { id:uSnap.id, ...uSnap.data() } : null;
}

/* ---------- User Profile ---------- */
async function loadProfile(uid, email){
  const ref = doc(state.db, C.users, uid);
  const s = await getDoc(ref);
  if (s.exists()) return { id:s.id, ...s.data() };

  // create minimal profile (needs rules allow create own doc)
  await setDoc(ref, {
    email: email || "",
    role: "viewer",
    permissions: {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge:true });

  return { id:uid, email: email || "", role:"viewer", permissions:{} };
}

/* ---------- Invoice No (transaction) ---------- */
async function nextInvoiceNo(){
  const prefix = state.settings?.invoicePrefix || "RPM-";
  const pad = Number(state.settings?.invoicePadding || 6);

  const counterRef = doc(state.db, C.meta, "invoiceCounter");
  const invoiceNo = await runTransaction(state.db, async (tx) => {
    const snap = await tx.get(counterRef);
    const next = snap.exists() ? Number(snap.data().next || 1) : 1;
    const no = prefix + String(next).padStart(pad, "0");
    tx.set(counterRef, { next: next + 1, updatedAt: serverTimestamp() }, { merge:true });
    return no;
  });
  return invoiceNo;
}

/* ---------- Auto-create Customer & Car ---------- */
async function ensureCustomerAndCar({ customerName, customerPhone, plate, model, year }){
  const name = safeStr(customerName).trim();
  const phone = safeStr(customerPhone).trim();
  const carPlate = safeStr(plate).trim();
  const carModel = safeStr(model).trim();
  const carYear = year ? Number(year) : null;

  if (!name || !phone) throw new Error("اسم الزبون والهاتف مطلوبين");
  if (!carPlate) throw new Error("لوحة السيارة مطلوبة");

  // customer by phone
  let customerId = null;
  {
    const q1 = query(collection(state.db, C.customers), where("phone","==", phone), limit(1));
    const s1 = await getDocs(q1);
    if (!s1.empty){
      customerId = s1.docs[0].id;
      const cur = s1.docs[0].data();
      const curName = safeStr(cur.name || cur.customerName);
      if (curName !== name){
        await updateDoc(doc(state.db, C.customers, customerId), { name, updatedAt: serverTimestamp() });
      }
    } else {
      const ref = await addDoc(collection(state.db, C.customers), {
        name, phone, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      customerId = ref.id;
    }
  }

  // car by plate
  let carId = null;
  {
    const q2 = query(collection(state.db, C.cars), where("plate","==", carPlate), limit(1));
    const s2 = await getDocs(q2);
    if (!s2.empty){
      carId = s2.docs[0].id;
      const cur = s2.docs[0].data();
      await updateDoc(doc(state.db, C.cars, carId), {
        customerId,
        customerName: name,
        customerPhone: phone,
        model: carModel || cur.model || "",
        year: carYear ?? cur.year ?? null,
        updatedAt: serverTimestamp(),
      });
    } else {
      const ref = await addDoc(collection(state.db, C.cars), {
        customerId,
        customerName: name,
        customerPhone: phone,
        plate: carPlate,
        model: carModel,
        year: carYear,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      carId = ref.id;
    }
  }

  return { customerId, carId };
}

/* ---------- Tiny Template Engine ---------- */
function renderTemplate(tpl, data){
  if (!tpl) return "";
  tpl = tpl.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, inner) => {
    const arr = data?.[key];
    if (!Array.isArray(arr)) return "";
    return arr.map(item => renderTemplate(inner, { ...data, ...item })).join("");
  });
  tpl = tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = data?.[key];
    return (v === undefined || v === null) ? "" : String(v);
  });
  return tpl;
}

/* ---------- UI: Auth ---------- */
function renderAuth(){
  const root = $("#app");
  root.innerHTML = "";

  const email = el("input", { class:"input", type:"email", placeholder:"البريد الإلكتروني" });
  const pass  = el("input", { class:"input", type:"password", placeholder:"كلمة المرور" });

  const btnLogin = el("button", { class:"btn primary", onclick: async () => {
    try{
      btnLogin.disabled = true;
      await signInWithEmailAndPassword(state.auth, email.value.trim(), pass.value);
      toast("تم تسجيل الدخول", "أهلاً بك", "ok");
    }catch(e){
      toast("فشل تسجيل الدخول", e?.message || "تحقق من البيانات", "bad");
    }finally{
      btnLogin.disabled = false;
    }
  }}, ["تسجيل الدخول"]);

  const btnReset = el("button", { class:"btn ghost", onclick: async () => {
    const v = email.value.trim();
    if (!v) return toast("اكتب البريد أولاً", "", "warn");
    try{
      await sendPasswordResetEmail(state.auth, v);
      toast("تم إرسال رابط إعادة التعيين", "تحقق من بريدك", "ok");
    }catch(e){
      toast("تعذر الإرسال", e?.message || "", "bad");
    }
  }}, ["نسيت كلمة المرور"]);

  const card = el("div", { class:"authCard" }, [
    el("div", { class:"authHead" }, [
      el("div", { class:"badgeLogo" }, ["RPM"]),
      el("div", {}, [
        el("b", {}, ["تسجيل الدخول"]),
        el("div", { class:"muted", style:"margin-top:4px" }, ["نظام إدارة ورشة صيانة سيارات — فخم وسريع"])
      ])
    ]),
    el("div", { class:"grid", style:"gap:10px" }, [
      el("div", { class:"field w12" }, [el("label", {}, ["البريد الإلكتروني"]), email]),
      el("div", { class:"field w12" }, [el("label", {}, ["كلمة المرور"]), pass]),
      el("div", { class:"actions" }, [btnLogin, btnReset]),
      el("hr", { class:"hr" }),
      el("div", { class:"muted" }, [
        "ملاحظة للأدمن: أول مرة خلي users/{uid}.role = admin من Firestore Console."
      ])
    ])
  ]);

  root.appendChild(el("div", { class:"authWrap" }, [card]));
}

/* ---------- UI: Shell ---------- */
function canSeeNavItem(item){
  const role = state.profile?.role || "viewer";
  const roles = item.roles || ["admin","manager","tech","viewer"];
  return roles.includes(role);
}

function refreshActiveNav(){
  const { slug, id } = route();
  $$(".nav a").forEach(a => {
    const href = a.getAttribute("href");
    a.classList.toggle("active", href === `#/${slug}${id ? "/" + id : ""}` || href === `#/${slug}`);
  });
}

function setPageHeader(title, sub=""){
  $("#pageTitle").textContent = title;
  $("#pageSub").textContent = sub;
}

function renderShell(){
  const root = $("#app");
  root.innerHTML = "";

  const sidebar = el("aside", { class:"sidebar", id:"sidebar" });
  const main = el("main", { class:"main" });
  root.appendChild(el("div", { class:"shell" }, [sidebar, main]));

  const brand = el("div", { class:"brand" }, [
    el("div", { class:"brandLeft" }, [
      el("div", { class:"brandBadge" }, ["RPM"]),
      el("div", {}, [
        el("div", { class:"brandTitle" }, [state.uiApp?.brandName || APP.name]),
        el("div", { class:"brandSub" }, [APP.subtitle]),
      ])
    ]),
    el("button", { class:"btn ghost", onclick: () => sidebar.classList.remove("open") }, ["✕"])
  ]);
  sidebar.appendChild(brand);

  const nav = el("nav", { class:"nav" });
  sidebar.appendChild(nav);

  // Build nav from uiConfig/app (supports custom page links)
  const items = (state.uiApp?.nav || []).filter(canSeeNavItem);
  for (const it of items){
    const href = it.href
      ? it.href
      : it.slug?.startsWith("page:")
        ? `#/page/${it.slug.split(":")[1]}`
        : `#/${it.slug}`;

    nav.appendChild(el("a", {
      href,
      onclick: () => { if (window.innerWidth <= 980) sidebar.classList.remove("open"); }
    }, [
      el("span", {}, [`${it.icon || "•"} ${it.title || it.slug}`]),
      it.tag ? el("span", { class:"tag" }, [it.tag]) : el("span")
    ]));
  }

  const userLine = el("div", { class:"userLine" }, [
    el("div", { class:"userMeta" }, [
      el("b", {}, [state.user?.email || ""]),
      el("span", {}, [`الدور: ${state.profile?.role || "viewer"}`]),
      el("span", {}, [`الإصدار: ${APP.version}`]),
    ]),
    el("div", { class:"actions", style:"margin-top:10px" }, [
      el("button", { class:"btn ghost", onclick: () => signOut(state.auth) }, ["خروج"])
    ])
  ]);
  sidebar.appendChild(el("div", { class:"sideFoot" }, [userLine]));

  const topbar = el("div", { class:"topbar" }, [
    el("div", { class:"topbarRow" }, [
      el("div", {}, [
        el("div", { class:"hTitle", id:"pageTitle" }, ["..."]),
        el("div", { class:"hSub", id:"pageSub" }, [""]),
      ]),
      el("div", { class:"actions" }, [
        el("button", { class:"btn ghost", onclick: () => sidebar.classList.add("open") }, ["☰"]),
        el("button", { class:"btn primary", onclick: () => navTo("orders") }, ["+ أمر شغل"]),
        el("button", { class:"btn ok", onclick: () => navTo("oil") }, ["+ تبديل دهن"]),
      ])
    ])
  ]);

  main.appendChild(topbar);
  main.appendChild(el("div", { id:"page" }));

  refreshActiveNav();
  renderRoute();
}

/* =========================================================
   Pages
========================================================= */

function statusBadge(s){
  const v = s || "open";
  const map = {
    open: { t:"مفتوح", c:"warn" },
    inProgress: { t:"قيد العمل", c:"warn" },
    done: { t:"مكتمل", c:"ok" },
    cancelled: { t:"ملغي", c:"bad" },
  };
  const m = map[v] || { t:v, c:"" };
  return el("span", { class:`badge ${m.c}` }, [m.t]);
}

/* ---------- Dashboard ---------- */
async function pageDashboard(){
  setPageHeader("لوحة التحكم", "ملخص مباشر للورشة");

  const wrap = el("div", { class:"grid cols3" });

  const cardKpis = el("div", { class:"card" }, [
    el("h3", {}, ["مؤشرات سريعة"]),
    el("div", { class:"muted" }, ["آخر عناصر (عرض سريع)"]),
    el("hr", { class:"hr" }),
    el("div", { class:"grid cols3" }, [
      kpiBox("أوامر شغل", "..."),
      kpiBox("فواتير", "..."),
      kpiBox("إيراد", "..."),
    ])
  ]);

  const cardQuick = el("div", { class:"card" }, [
    el("h3", {}, ["إجراءات"]),
    el("div", { class:"actions" }, [
      el("button", { class:"btn primary", onclick: () => navTo("orders") }, ["أوامر الشغل"]),
      el("button", { class:"btn ok", onclick: () => navTo("oil") }, ["تبديل دهن"]),
      el("button", { class:"btn", onclick: () => navTo("invoices") }, ["الفواتير"]),
      hasPerm(state.profile, "manageUsers") ? el("button", { class:"btn", onclick: () => navTo("users") }, ["صلاحيات المستخدمين"]) : el("span"),
    ])
  ]);

  const cardLive = el("div", { class:"card" }, [
    el("h3", {}, ["أحدث أوامر الشغل"]),
    el("div", { class:"muted" }, ["Live — آخر 20"]),
    el("div", { class:"muted", style:"margin-top:10px" }, ["جارِ التحميل…"])
  ]);

  wrap.appendChild(cardKpis);
  wrap.appendChild(cardQuick);
  wrap.appendChild(cardLive);

  // live orders
  clearLive();
  const host = cardLive.lastChild;
  const q1 = query(collection(state.db, C.orders), orderBy("createdAt","desc"), limit(20));
  const unsub = onSnapshot(q1, (snap) => {
    host.innerHTML = "";
    const rows = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    host.appendChild(renderOrdersTable(rows, { compact:true }));
  }, (err) => {
    host.innerHTML = "";
    host.appendChild(el("div", { class:"muted" }, ["فشل قراءة: ", String(err?.message || err)]));
  });
  state.unsub.push(unsub);

  // quick KPI (one-shot)
  try{
    const invQ = query(collection(state.db, C.invoices), orderBy("createdAt","desc"), limit(80));
    const ordQ = query(collection(state.db, C.orders), orderBy("createdAt","desc"), limit(80));
    const [invS, ordS] = await Promise.all([getDocs(invQ), getDocs(ordQ)]);
    const revenue = invS.docs.reduce((a,d)=>a+Number(d.data().total||0),0);

    const kpis = $$(".kpi .n", cardKpis);
    if (kpis[0]) kpis[0].textContent = String(ordS.size);
    if (kpis[1]) kpis[1].textContent = String(invS.size);
    if (kpis[2]) kpis[2].textContent = revenue.toLocaleString("ar-IQ") + " " + APP.currency;
  }catch{}

  return wrap;
}

function kpiBox(label, value){
  return el("div", { class:"kpi" }, [
    el("div", { class:"n" }, [value]),
    el("div", { class:"l" }, [label]),
  ]);
}

/* ---------- Orders ---------- */
function renderOrdersTable(rows, opts={}){
  const compact = !!opts.compact;
  const onOpen = opts.onOpen || ((id)=>openOrderEditor(id));

  const tbl = el("table", { class:"table" }, [
    el("thead", {}, [el("tr", {}, [
      el("th", {}, ["التاريخ"]),
      el("th", {}, ["الزبون"]),
      el("th", {}, ["السيارة"]),
      el("th", {}, ["الحالة"]),
      el("th", {}, ["إجراءات"]),
    ])]),
    el("tbody")
  ]);
  const tb = tbl.querySelector("tbody");

  if (!rows.length){
    tb.appendChild(el("tr", {}, [el("td", { colspan:"5", style:"text-align:center; color:rgba(234,240,255,.7)" }, ["لا يوجد بيانات"])]));
    return tbl;
  }

  for (const r of rows){
    const car = r.carPlate || r.plate || "-";
    const model = r.carModel || r.model || "";
    const carTxt = `${car}${model ? " — "+model : ""}`;

    tb.appendChild(el("tr", {}, [
      el("td", {}, [fmtDate(r.createdAt)]),
      el("td", {}, [
        el("div", {}, [el("b", {}, [r.customerName || "-"])]),
        el("div", { class:"muted", style:"font-size:12px" }, [r.customerPhone || ""])
      ]),
      el("td", {}, [carTxt]),
      el("td", {}, [statusBadge(r.status)]),
      el("td", {}, [el("div", { class:"actions" }, [
        el("button", { class:"btn", onclick: () => onOpen(r.id) }, ["فتح"]),
        (!compact && hasPerm(state.profile,"delete")) ? el("button", { class:"btn bad", onclick: () => deleteOrder(r.id) }, ["حذف"]) : el("span")
      ])]),
    ]));
  }
  return tbl;
}

async function pageOrders(){
  setPageHeader("أوامر الشغل", "إنشاء / تعديل / متابعة");

  const host = el("div", { class:"grid", style:"gap:16px" });

  const top = el("div", { class:"card" }, [
    el("h3", {}, ["قائمة أوامر الشغل"]),
    el("div", { class:"muted" }, ["بحث سريع + إنشاء أمر جديد"]),
    el("hr", { class:"hr" })
  ]);

  const search = el("input", { class:"input", placeholder:"بحث: اسم/هاتف/لوحة/موديل…" });
  const status = el("select", {}, [
    el("option", { value:"" }, ["كل الحالات"]),
    el("option", { value:"open" }, ["مفتوح"]),
    el("option", { value:"inProgress" }, ["قيد العمل"]),
    el("option", { value:"done" }, ["مكتمل"]),
    el("option", { value:"cancelled" }, ["ملغي"]),
  ]);

  const btnNew = el("button", { class:"btn primary", onclick: () => openOrderEditor(null) }, ["+ أمر شغل جديد"]);
  const btnRefresh = el("button", { class:"btn ghost" }, ["تحديث"]);

  top.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field w6" }, [el("label", {}, ["بحث"]), search]),
    el("div", { class:"field w6" }, [el("label", {}, ["الحالة"]), status]),
    el("div", { class:"field w12" }, [el("div", { class:"actions" }, [btnNew, btnRefresh])]),
  ]));

  const box = el("div", { class:"card" }, [el("div", { class:"muted" }, ["جارِ التحميل…"])]);
  host.appendChild(top);
  host.appendChild(box);

  async function load(){
    box.innerHTML = "";
    box.appendChild(el("div", { class:"muted" }, ["جارِ التحميل…"]));
    try{
      const q1 = query(collection(state.db, C.orders), orderBy("createdAt","desc"), limit(200));
      const s1 = await getDocs(q1);
      const rows = s1.docs.map(d=>({ id:d.id, ...d.data() }));
      render(rows);
    }catch(e){
      box.innerHTML = "";
      box.appendChild(el("div", { class:"muted" }, ["فشل التحميل: ", String(e?.message||e)]));
    }
  }

  function render(rows){
    const q = search.value.trim().toLowerCase();
    const st = status.value;

    let filtered = rows;
    if (st) filtered = filtered.filter(x => (x.status || "open") === st);
    if (q){
      filtered = filtered.filter(x => {
        const s = `${x.customerName||""} ${x.customerPhone||""} ${x.carPlate||x.plate||""} ${x.carModel||x.model||""}`.toLowerCase();
        return s.includes(q);
      });
    }

    box.innerHTML = "";
    box.appendChild(renderOrdersTable(filtered, { onOpen: (id)=>openOrderEditor(id) }));
  }

  btnRefresh.onclick = load;
  search.addEventListener("input", load);
  status.addEventListener("change", load);

  await load();
  return host;
}

async function deleteOrder(id){
  if (!confirm("تأكيد حذف أمر الشغل؟")) return;
  try{
    await deleteDoc(doc(state.db, C.orders, id));
    toast("تم الحذف", "أمر شغل", "ok");
    renderRoute();
  }catch(e){
    toast("تعذر الحذف", e?.message||"", "bad");
  }
}

/* ---------- Order Editor (single page for customer+car) ---------- */
async function openOrderEditor(orderId=null){
  const isNew = !orderId;
  const data = isNew ? {
    status:"open",
    customerName:"",
    customerPhone:"",
    carPlate:"",
    carModel:"",
    carYear:"",
    notes:"",
    services:[],
    parts:[]
  } : await (async()=>{
    const s = await getDoc(doc(state.db, C.orders, orderId));
    return s.exists() ? { id:s.id, ...s.data() } : null;
  })();

  if (!data) return toast("غير موجود", "لم يتم العثور على أمر الشغل", "warn");

  const fName  = el("input", { class:"input", value: data.customerName || "" });
  const fPhone = el("input", { class:"input", value: data.customerPhone || "" });

  const fPlate = el("input", { class:"input", value: data.carPlate || data.plate || "" });
  const fModel = el("input", { class:"input", value: data.carModel || data.model || "" });
  const fYear  = el("input", { class:"input", type:"number", value: data.carYear || data.year || "" });

  const fStatus = el("select", {}, [
    el("option", { value:"open" }, ["مفتوح"]),
    el("option", { value:"inProgress" }, ["قيد العمل"]),
    el("option", { value:"done" }, ["مكتمل"]),
    el("option", { value:"cancelled" }, ["ملغي"]),
  ]);
  fStatus.value = data.status || "open";

  const fNotes = el("textarea", {}, [data.notes || ""]);

  // services
  const sName = el("input", { class:"input", placeholder:"خدمة (مثال: صيانة فرامل)" });
  const sPrice = el("input", { class:"input", type:"number", placeholder:"سعر الخدمة" });
  const servicesBox = el("div");

  function renderServices(){
    servicesBox.innerHTML = "";
    const list = data.services || [];
    if (!list.length) return servicesBox.appendChild(el("div", { class:"muted" }, ["لا توجد خدمات بعد."]));
    const t = el("table", { class:"table" }, [
      el("thead", {}, [el("tr", {}, [el("th", {}, ["الخدمة"]), el("th", {}, ["السعر"]), el("th", {}, [""])])]),
      el("tbody")
    ]);
    const tb = t.querySelector("tbody");
    list.forEach((x,i)=>{
      tb.appendChild(el("tr", {}, [
        el("td", {}, [x.name || ""]),
        el("td", {}, [fmtMoney(x.price||0)]),
        el("td", {}, [el("button", { class:"btn bad", onclick:()=>{list.splice(i,1); renderServices(); renderParts(); refreshTotal();}}, ["حذف"])])
      ]));
    });
    servicesBox.appendChild(t);
  }

  // parts
  const pName = el("input", { class:"input", placeholder:"قطعة / وصف" });
  const pQty  = el("input", { class:"input", type:"number", value:"1", placeholder:"الكمية" });
  const pPrice= el("input", { class:"input", type:"number", placeholder:"السعر" });
  const partsBox = el("div");

  function renderParts(){
    partsBox.innerHTML = "";
    const list = data.parts || [];
    if (!list.length) return partsBox.appendChild(el("div", { class:"muted" }, ["لا توجد قطع بعد."]));
    const t = el("table", { class:"table" }, [
      el("thead", {}, [el("tr", {}, [el("th", {}, ["القطعة"]), el("th", {}, ["كمية"]), el("th", {}, ["سعر"]), el("th", {}, [""])])]),
      el("tbody")
    ]);
    const tb = t.querySelector("tbody");
    list.forEach((x,i)=>{
      tb.appendChild(el("tr", {}, [
        el("td", {}, [x.name || ""]),
        el("td", {}, [String(x.qty||1)]),
        el("td", {}, [fmtMoney(x.price||0)]),
        el("td", {}, [el("button", { class:"btn bad", onclick:()=>{list.splice(i,1); renderParts(); refreshTotal();}}, ["حذف"])])
      ]));
    });
    partsBox.appendChild(t);
  }

  const btnAddService = el("button", { class:"btn", onclick:()=>{
    const n = sName.value.trim();
    const p = Number(sPrice.value||0);
    if (!n) return;
    data.services = data.services || [];
    data.services.push({ name:n, price:p });
    sName.value=""; sPrice.value="";
    renderServices();
    refreshTotal();
  }}, ["إضافة خدمة"]);

  const btnAddPart = el("button", { class:"btn", onclick:()=>{
    const n = pName.value.trim();
    const q = Number(pQty.value||1);
    const p = Number(pPrice.value||0);
    if (!n) return;
    data.parts = data.parts || [];
    data.parts.push({ name:n, qty:q, price:p });
    pName.value=""; pQty.value="1"; pPrice.value="";
    renderParts();
    refreshTotal();
  }}, ["إضافة قطعة"]);

  function calcTotal(){
    const s = (data.services||[]).reduce((a,x)=>a+Number(x.price||0),0);
    const p = (data.parts||[]).reduce((a,x)=>a+(Number(x.price||0)*Number(x.qty||1)),0);
    return s+p;
  }

  const totalCard = el("div", { class:"card" }, [
    el("h3", {}, ["المجموع التقريبي"]),
    el("div", { class:"kpi" }, [
      el("div", { class:"n", id:"orderTotal" }, [fmtMoney(calcTotal())]),
      el("div", { class:"l" }, ["خدمات + قطع"])
    ])
  ]);
  function refreshTotal(){
    $("#orderTotal", totalCard).textContent = fmtMoney(calcTotal());
  }

  renderServices();
  renderParts();
  refreshTotal();

  const body = el("div", { class:"grid", style:"gap:14px" }, [
    el("div", { class:"card" }, [
      el("h3", {}, ["بيانات الزبون والسيارة (صفحة واحدة)"]),
      el("div", { class:"row" }, [
        el("div", { class:"field w6" }, [el("label", {}, ["اسم الزبون"]), fName]),
        el("div", { class:"field w6" }, [el("label", {}, ["الهاتف"]), fPhone]),
      ]),
      el("div", { class:"row" }, [
        el("div", { class:"field w4" }, [el("label", {}, ["اللوحة"]), fPlate]),
        el("div", { class:"field w4" }, [el("label", {}, ["الموديل"]), fModel]),
        el("div", { class:"field w4" }, [el("label", {}, ["السنة"]), fYear]),
      ]),
      el("div", { class:"row" }, [
        el("div", { class:"field w6" }, [el("label", {}, ["الحالة"]), fStatus]),
      ]),
      el("div", { class:"field w12" }, [el("label", {}, ["ملاحظات"]), fNotes]),
    ]),

    el("div", { class:"card" }, [
      el("h3", {}, ["الخدمات"]),
      el("div", { class:"row" }, [
        el("div", { class:"field w6" }, [el("label", {}, ["خدمة"]), sName]),
        el("div", { class:"field w6" }, [el("label", {}, ["سعر"]), sPrice]),
        el("div", { class:"field w12" }, [el("div", { class:"actions" }, [btnAddService])]),
      ]),
      servicesBox
    ]),

    el("div", { class:"card" }, [
      el("h3", {}, ["القطع / قطع الغيار"]),
      el("div", { class:"row" }, [
        el("div", { class:"field w6" }, [el("label", {}, ["الوصف"]), pName]),
        el("div", { class:"field w3" }, [el("label", {}, ["الكمية"]), pQty]),
        el("div", { class:"field w3" }, [el("label", {}, ["السعر"]), pPrice]),
        el("div", { class:"field w12" }, [el("div", { class:"actions" }, [btnAddPart])]),
      ]),
      partsBox
    ]),

    totalCard
  ]);

  const btnSave = el("button", { class:"btn primary", onclick: async ()=>{
    try{
      btnSave.disabled = true;

      const { customerId, carId } = await ensureCustomerAndCar({
        customerName: fName.value,
        customerPhone: fPhone.value,
        plate: fPlate.value,
        model: fModel.value,
        year: fYear.value,
      });

      const payload = {
        status: fStatus.value,
        customerId,
        customerName: fName.value.trim(),
        customerPhone: fPhone.value.trim(),
        carId,
        carPlate: fPlate.value.trim(),
        carModel: fModel.value.trim(),
        carYear: fYear.value ? Number(fYear.value) : null,
        notes: fNotes.value,
        services: data.services || [],
        parts: data.parts || [],
        totalEstimate: calcTotal(),
        updatedAt: serverTimestamp(),
      };

      if (isNew){
        payload.createdAt = serverTimestamp();
        const ref = await addDoc(collection(state.db, C.orders), payload);
        toast("تم الإنشاء", "أمر شغل جديد", "ok");
        renderRoute();
        openOrderEditor(ref.id);
      } else {
        await updateDoc(doc(state.db, C.orders, orderId), payload);
        toast("تم الحفظ", "تم تحديث أمر الشغل", "ok");
        renderRoute();
      }
    }catch(e){
      toast("فشل الحفظ", e?.message || String(e), "bad");
    }finally{
      btnSave.disabled = false;
    }
  }}, ["حفظ"]);

  const btnInvoice = el("button", { class:"btn ok", onclick: async ()=>{
    if (isNew) return toast("احفظ أولاً", "لازم إنشاء أمر الشغل قبل الفاتورة", "warn");
    try{
      const invId = await createInvoiceFromOrder(orderId);
      toast("تم إنشاء فاتورة", "جاهزة للتعديل والطباعة", "ok");
      navTo("invoices", invId);
    }catch(e){
      toast("تعذر إنشاء فاتورة", e?.message||"", "bad");
    }
  }}, ["إنشاء فاتورة"]);

  openModal(isNew ? "أمر شغل جديد" : "تعديل أمر شغل", body, [btnSave, btnInvoice]);
}

/* ---------- Oil Change ---------- */
async function pageOil(){
  setPageHeader("تبديل دهن", "واجهة سريعة — أمر + فاتورة + تحديث KM");

  const box = el("div", { class:"grid cols2" });

  const left = el("div", { class:"card" }, [el("h3", {}, ["بيانات الزبون والسيارة"])]);
  const cName = el("input", { class:"input", placeholder:"اسم الزبون" });
  const cPhone= el("input", { class:"input", placeholder:"الهاتف" });
  const plate = el("input", { class:"input", placeholder:"اللوحة" });
  const model = el("input", { class:"input", placeholder:"الموديل" });
  const year  = el("input", { class:"input", type:"number", placeholder:"السنة" });

  left.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field w6" }, [el("label", {}, ["الاسم"]), cName]),
    el("div", { class:"field w6" }, [el("label", {}, ["الهاتف"]), cPhone]),
  ]));
  left.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field w4" }, [el("label", {}, ["اللوحة"]), plate]),
    el("div", { class:"field w4" }, [el("label", {}, ["الموديل"]), model]),
    el("div", { class:"field w4" }, [el("label", {}, ["السنة"]), year]),
  ]));

  const right = el("div", { class:"card" }, [el("h3", {}, ["تفاصيل الدهن"])]);
  const oilBrand = el("input", { class:"input", placeholder:"ماركة الدهن" });
  const oilVisc  = el("input", { class:"input", placeholder:"اللزوجة (مثال: 5W-30)" });
  const oilQty   = el("input", { class:"input", type:"number", value:"4", placeholder:"الكمية (لتر)" });
  const oilPrice = el("input", { class:"input", type:"number", placeholder:"سعر الدهن" });

  const filtName = el("input", { class:"input", placeholder:"فلتر (اختياري)" });
  const filtPrice= el("input", { class:"input", type:"number", placeholder:"سعر الفلتر" });

  const kmNow  = el("input", { class:"input", type:"number", placeholder:"KM الحالي" });
  const kmNext = el("input", { class:"input", type:"number", placeholder:"KM القادم" });

  const notes = el("textarea", {}, [""]);

  right.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field w6" }, [el("label", {}, ["ماركة"]), oilBrand]),
    el("div", { class:"field w6" }, [el("label", {}, ["اللزوجة"]), oilVisc]),
  ]));
  right.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field w6" }, [el("label", {}, ["الكمية"]), oilQty]),
    el("div", { class:"field w6" }, [el("label", {}, ["سعر الدهن"]), oilPrice]),
  ]));
  right.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field w6" }, [el("label", {}, ["فلتر"]), filtName]),
    el("div", { class:"field w6" }, [el("label", {}, ["سعر الفلتر"]), filtPrice]),
  ]));
  right.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field w6" }, [el("label", {}, ["KM الحالي"]), kmNow]),
    el("div", { class:"field w6" }, [el("label", {}, ["KM القادم"]), kmNext]),
  ]));
  right.appendChild(el("div", { class:"field w12" }, [el("label", {}, ["ملاحظات"]), notes]));

  const preview = el("div", { class:"card" }, [
    el("h3", {}, ["المجموع"]),
    el("div", { class:"kpi" }, [
      el("div", { class:"n", id:"oilTotal" }, [fmtMoney(0)]),
      el("div", { class:"l" }, ["دهن + فلتر"])
    ]),
    el("div", { class:"muted", style:"margin-top:8px" }, ["تنشئ أمر شغل + فاتورة مباشرة"])
  ]);

  function oilTotal(){
    return Number(oilPrice.value||0) + Number(filtPrice.value||0);
  }
  function refreshOil(){
    $("#oilTotal", preview).textContent = fmtMoney(oilTotal());
  }
  [oilPrice, filtPrice].forEach(i=>i.addEventListener("input", refreshOil));
  refreshOil();

  const btnCreate = el("button", { class:"btn primary", onclick: async ()=>{
    try{
      btnCreate.disabled = true;

      const { customerId, carId } = await ensureCustomerAndCar({
        customerName: cName.value,
        customerPhone: cPhone.value,
        plate: plate.value,
        model: model.value,
        year: year.value,
      });

      const services = [{ name:"تبديل دهن", price: Number(oilPrice.value||0) }];
      const parts = [];
      if (filtName.value.trim()){
        parts.push({ name:`فلتر: ${filtName.value.trim()}`, qty:1, price: Number(filtPrice.value||0) });
      }

      const orderPayload = {
        status: "done",
        type: "oilChange",
        customerId,
        customerName: cName.value.trim(),
        customerPhone: cPhone.value.trim(),
        carId,
        carPlate: plate.value.trim(),
        carModel: model.value.trim(),
        carYear: year.value ? Number(year.value) : null,
        oil: {
          brand: oilBrand.value.trim(),
          viscosity: oilVisc.value.trim(),
          qty: Number(oilQty.value||0),
          kmNow: kmNow.value ? Number(kmNow.value) : null,
          kmNext: kmNext.value ? Number(kmNext.value) : null,
        },
        notes: notes.value,
        services,
        parts,
        totalEstimate: oilTotal(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const orderRef = await addDoc(collection(state.db, C.orders), orderPayload);

      // update car KM oil info
      try{
        await updateDoc(doc(state.db, C.cars, carId), {
          lastOilChangeAt: serverTimestamp(),
          lastOilKm: kmNow.value ? Number(kmNow.value) : null,
          nextOilKm: kmNext.value ? Number(kmNext.value) : null,
          oilBrand: oilBrand.value.trim(),
          oilViscosity: oilVisc.value.trim(),
          updatedAt: serverTimestamp(),
        });
      }catch{}

      const invId = await createInvoiceFromOrder(orderRef.id, { serviceTitle:"تبديل دهن" });
      toast("تمت العملية", "أمر + فاتورة", "ok");
      navTo("invoices", invId);

    }catch(e){
      toast("فشل", e?.message || String(e), "bad");
    }finally{
      btnCreate.disabled = false;
    }
  }}, ["إنشاء أمر + فاتورة"]);

  preview.appendChild(el("div", { class:"actions", style:"margin-top:12px" }, [btnCreate]));

  box.appendChild(left);
  box.appendChild(right);
  box.appendChild(preview);
  box.appendChild(el("div", { class:"card" }, [
    el("h3", {}, ["تنبيه"]),
    el("div", { class:"muted" }, [
      "هاي الصفحة سريعة جداً للورشة. بعدها تقدرين تعدلين الفاتورة من صفحة الفواتير."
    ])
  ]));

  return box;
}

/* ---------- Create Invoice from Order ---------- */
async function createInvoiceFromOrder(orderId, extra={}){
  const oSnap = await getDoc(doc(state.db, C.orders, orderId));
  if (!oSnap.exists()) throw new Error("أمر الشغل غير موجود");
  const order = { id:oSnap.id, ...oSnap.data() };

  const invoiceNo = await nextInvoiceNo();

  // pick template
  let templateId = state.settings?.defaultTemplateId || "";
  if (!templateId){
    const tq = query(collection(state.db, C.invoiceTemplates), orderBy("createdAt","desc"), limit(1));
    const ts = await getDocs(tq);
    if (!ts.empty) templateId = ts.docs[0].id;
  }

  const items = [];
  (order.services || []).forEach(s => items.push({ desc: s.name || "خدمة", qty: 1, price: Number(s.price||0) }));
  (order.parts || []).forEach(p => items.push({ desc: p.name || "قطعة", qty: Number(p.qty||1), price: Number(p.price||0) }));

  const subtotal = items.reduce((a,i)=>a + (Number(i.qty||1)*Number(i.price||0)), 0);
  const taxPercent = Number(state.settings?.taxPercent || 0);
  const tax = subtotal * (taxPercent/100);
  const total = subtotal + tax;

  const payload = {
    invoiceNo,
    status: "issued",
    date: fmtDate(new Date()),
    orderId: order.id,
    customerId: order.customerId || "",
    customerName: order.customerName || "",
    customerPhone: order.customerPhone || "",
    carId: order.carId || "",
    plate: order.carPlate || order.plate || "",
    carModel: order.carModel || order.model || "",
    year: order.carYear || order.year || "",
    items,
    subtotal,
    taxPercent,
    tax,
    total,
    templateId,
    serviceTitle: extra.serviceTitle || (order.type === "oilChange" ? "تبديل دهن" : "خدمات ورشة"),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const ref = await addDoc(collection(state.db, C.invoices), payload);
  return ref.id;
}

/* ---------- Invoices ---------- */
async function pageInvoices(){
  setPageHeader("الفواتير", "تعديل / معاينة / طباعة / حذف");

  const host = el("div", { class:"grid", style:"gap:16px" });

  const top = el("div", { class:"card" }, [
    el("h3", {}, ["قائمة الفواتير"]),
    el("div", { class:"muted" }, ["بحث سريع + تعديل فخم + طباعة بالقالب"]),
    el("hr", { class:"hr" }),
  ]);

  const search = el("input", { class:"input", placeholder:"بحث: رقم/اسم/هاتف/لوحة…" });
  const btnRefresh = el("button", { class:"btn ghost" }, ["تحديث"]);

  top.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field w6" }, [el("label", {}, ["بحث"]), search]),
    el("div", { class:"field w6" }, [el("div", { class:"actions", style:"margin-top:18px" }, [btnRefresh])]),
  ]));

  const box = el("div", { class:"card" }, [el("div", { class:"muted" }, ["جارِ التحميل…"])]);
  host.appendChild(top);
  host.appendChild(box);

  async function load(){
    box.innerHTML = "";
    box.appendChild(el("div", { class:"muted" }, ["جارِ التحميل…"]));
    try{
      const q1 = query(collection(state.db, C.invoices), orderBy("createdAt","desc"), limit(220));
      const s1 = await getDocs(q1);
      const rows = s1.docs.map(d=>({ id:d.id, ...d.data() }));
      render(rows);
    }catch(e){
      box.innerHTML = "";
      box.appendChild(el("div", { class:"muted" }, ["فشل التحميل: ", String(e?.message||e)]));
    }
  }

  function render(rows){
    const q = search.value.trim().toLowerCase();
    const filtered = q ? rows.filter(x => (`${x.invoiceNo||""} ${x.customerName||""} ${x.customerPhone||""} ${x.plate||""}`.toLowerCase().includes(q))) : rows;

    const tbl = el("table", { class:"table" }, [
      el("thead", {}, [el("tr", {}, [
        el("th", {}, ["التاريخ"]),
        el("th", {}, ["رقم"]),
        el("th", {}, ["الزبون"]),
        el("th", {}, ["السيارة"]),
        el("th", {}, ["المجموع"]),
        el("th", {}, ["إجراءات"]),
      ])]),
      el("tbody")
    ]);
    const tb = tbl.querySelector("tbody");

    if (!filtered.length){
      tb.appendChild(el("tr", {}, [el("td", { colspan:"6", style:"text-align:center; color:rgba(234,240,255,.7)" }, ["لا يوجد بيانات"])]));
    } else {
      for (const r of filtered){
        tb.appendChild(el("tr", {}, [
          el("td", {}, [r.date || fmtDate(r.createdAt)]),
          el("td", {}, [el("b", {}, [r.invoiceNo || "-"])]),
          el("td", {}, [
            el("div", {}, [el("b", {}, [r.customerName || "-"])]),
            el("div", { class:"muted", style:"font-size:12px" }, [r.customerPhone || ""])
          ]),
          el("td", {}, [`${r.plate||"-"} ${r.carModel ? "— "+r.carModel : ""}`]),
          el("td", {}, [fmtMoney(r.total||0)]),
          el("td", {}, [el("div", { class:"actions" }, [
            el("button", { class:"btn", onclick:()=>openInvoiceEditor(r.id) }, ["تعديل"]),
            el("button", { class:"btn ok", onclick:()=>printInvoice(r.id) }, ["طباعة"]),
            hasPerm(state.profile,"delete") ? el("button", { class:"btn bad", onclick:()=>deleteInvoice(r.id) }, ["حذف"]) : el("span")
          ])])
        ]));
      }
    }

    box.innerHTML = "";
    box.appendChild(tbl);
  }

  btnRefresh.onclick = load;
  search.addEventListener("input", load);
  await load();
  return host;
}

async function deleteInvoice(id){
  if (!confirm("تأكيد حذف الفاتورة؟")) return;
  try{
    await deleteDoc(doc(state.db, C.invoices, id));
    toast("تم الحذف", "فاتورة", "ok");
    renderRoute();
  }catch(e){
    toast("تعذر الحذف", e?.message||"", "bad");
  }
}

/* ---------- Invoice Editor + Print ---------- */
async function openInvoiceEditor(id){
  const s = await getDoc(doc(state.db, C.invoices, id));
  if (!s.exists()) return toast("غير موجود", "الفاتورة غير موجودة", "warn");
  const inv = { id:s.id, ...s.data() };
  inv.items = inv.items || [];

  const fNo = el("input", { class:"input", value: inv.invoiceNo || "", disabled:true });
  const fDate = el("input", { class:"input", value: inv.date || fmtDate(inv.createdAt) });
  const fName = el("input", { class:"input", value: inv.customerName || "" });
  const fPhone= el("input", { class:"input", value: inv.customerPhone || "" });
  const fPlate= el("input", { class:"input", value: inv.plate || "" });
  const fModel= el("input", { class:"input", value: inv.carModel || "" });
  const fYear = el("input", { class:"input", type:"number", value: inv.year || "" });

  const fTax = el("input", { class:"input", type:"number", value: inv.taxPercent ?? state.settings?.taxPercent ?? 0 });

  // template dropdown
  const tplSel = el("select");
  {
    tplSel.appendChild(el("option", { value:"" }, ["(بدون قالب)"]));
    const qs = query(collection(state.db, C.invoiceTemplates), orderBy("createdAt","desc"), limit(80));
    const ss = await getDocs(qs);
    ss.docs.forEach(d => tplSel.appendChild(el("option", { value:d.id }, [d.data().name || d.id])));
    tplSel.value = inv.templateId || "";
  }

  const itemsHost = el("div");
  const totalsLine = el("div", { class:"actions", style:"margin-top:10px" });

  function recalc(){
    const subtotal = inv.items.reduce((a,i)=>a + (Number(i.qty||1)*Number(i.price||0)), 0);
    const taxPercent = Number(fTax.value||0);
    const tax = subtotal * (taxPercent/100);
    inv.subtotal = subtotal;
    inv.taxPercent = taxPercent;
    inv.tax = tax;
    inv.total = subtotal + tax;
  }

  function renderItems(){
    recalc();
    itemsHost.innerHTML = "";

    const t = el("table", { class:"table" }, [
      el("thead", {}, [el("tr", {}, [
        el("th", {}, ["الوصف"]),
        el("th", {}, ["كمية"]),
        el("th", {}, ["سعر"]),
        el("th", {}, [""]),
      ])]),
      el("tbody")
    ]);
    const tb = t.querySelector("tbody");

    if (!inv.items.length){
      tb.appendChild(el("tr", {}, [el("td", { colspan:"4", style:"text-align:center; color:rgba(234,240,255,.7)" }, ["لا توجد عناصر"])]));
    } else {
      inv.items.forEach((it, idx)=>{
        const d = el("input", { class:"input", value: it.desc || "" });
        const q = el("input", { class:"input", type:"number", value: it.qty ?? 1 });
        const p = el("input", { class:"input", type:"number", value: it.price ?? 0 });

        const sync = () => {
          it.desc = d.value;
          it.qty = Number(q.value||1);
          it.price = Number(p.value||0);
          renderItems();
        };
        [d,q,p].forEach(x=>x.addEventListener("change", sync));

        tb.appendChild(el("tr", {}, [
          el("td", {}, [d]),
          el("td", {}, [q]),
          el("td", {}, [p]),
          el("td", {}, [
            el("button", { class:"btn bad", onclick:()=>{inv.items.splice(idx,1); renderItems();} }, ["حذف"])
          ])
        ]));
      });
    }

    itemsHost.appendChild(t);

    totalsLine.innerHTML = "";
    totalsLine.appendChild(el("button", { class:"btn", onclick:()=>{inv.items.push({ desc:"", qty:1, price:0 }); renderItems();} }, ["+ إضافة سطر"]));
    totalsLine.appendChild(el("span", { class:"badge" }, [`Subtotal: ${fmtMoney(inv.subtotal||0)}`]));
    totalsLine.appendChild(el("span", { class:"badge" }, [`Tax(${inv.taxPercent||0}%): ${fmtMoney(inv.tax||0)}`]));
    totalsLine.appendChild(el("span", { class:"badge ok" }, [`Total: ${fmtMoney(inv.total||0)}`]));
  }

  fTax.addEventListener("input", renderItems);
  renderItems();

  const body = el("div", { class:"grid", style:"gap:14px" }, [
    el("div", { class:"card" }, [
      el("h3", {}, ["معلومات الفاتورة"]),
      el("div", { class:"row" }, [
        el("div", { class:"field w6" }, [el("label", {}, ["رقم الفاتورة"]), fNo]),
        el("div", { class:"field w6" }, [el("label", {}, ["التاريخ"]), fDate]),
      ]),
      el("div", { class:"row" }, [
        el("div", { class:"field w6" }, [el("label", {}, ["الاسم"]), fName]),
        el("div", { class:"field w6" }, [el("label", {}, ["الهاتف"]), fPhone]),
      ]),
      el("div", { class:"row" }, [
        el("div", { class:"field w4" }, [el("label", {}, ["اللوحة"]), fPlate]),
        el("div", { class:"field w4" }, [el("label", {}, ["الموديل"]), fModel]),
        el("div", { class:"field w4" }, [el("label", {}, ["السنة"]), fYear]),
      ]),
      el("div", { class:"row" }, [
        el("div", { class:"field w6" }, [el("label", {}, ["قالب الطباعة"]), tplSel]),
        el("div", { class:"field w6" }, [el("label", {}, ["Tax %"]), fTax]),
      ])
    ]),
    el("div", { class:"card" }, [
      el("h3", {}, ["عناصر الفاتورة"]),
      itemsHost,
      totalsLine
    ]),
  ]);

  const btnSave = el("button", { class:"btn primary", onclick: async ()=>{
    try{
      btnSave.disabled = true;
      recalc();
      await updateDoc(doc(state.db, C.invoices, id), {
        date: fDate.value,
        customerName: fName.value.trim(),
        customerPhone: fPhone.value.trim(),
        plate: fPlate.value.trim(),
        carModel: fModel.value.trim(),
        year: fYear.value ? Number(fYear.value) : "",
        items: inv.items,
        subtotal: inv.subtotal,
        taxPercent: inv.taxPercent,
        tax: inv.tax,
        total: inv.total,
        templateId: tplSel.value,
        updatedAt: serverTimestamp(),
      });
      toast("تم الحفظ", "الفاتورة تحدّثت", "ok");
      renderRoute();
    }catch(e){
      toast("فشل الحفظ", e?.message||String(e), "bad");
    }finally{
      btnSave.disabled = false;
    }
  }}, ["حفظ"]);

  const btnPrint = el("button", { class:"btn ok", onclick:()=>printInvoice(id) }, ["طباعة"]);
  openModal("تعديل فاتورة", body, [btnSave, btnPrint]);
}

async function printInvoice(invoiceId){
  try{
    const s = await getDoc(doc(state.db, C.invoices, invoiceId));
    if (!s.exists()) return toast("غير موجود", "الفاتورة غير موجودة", "warn");
    const inv = { id:s.id, ...s.data() };

    let tpl = null;
    if (inv.templateId){
      const t = await getDoc(doc(state.db, C.invoiceTemplates, inv.templateId));
      if (t.exists()) tpl = { id:t.id, ...t.data() };
    }
    if (!tpl){
      const qs = query(collection(state.db, C.invoiceTemplates), limit(1));
      const ss = await getDocs(qs);
      if (!ss.empty) tpl = { id:ss.docs[0].id, ...ss.docs[0].data() };
    }
    if (!tpl) throw new Error("لا يوجد قالب فواتير");

    const items = (inv.items||[]).map(it=>{
      const qty = Number(it.qty||1);
      const price = Number(it.price||0);
      return {
        desc: it.desc || "",
        qty,
        price,
        priceFmt: fmtMoney(price),
        lineTotalFmt: fmtMoney(qty*price),
      };
    });

    const data = {
      workshopName: state.settings?.workshopName || "RPM",
      workshopPhone: state.settings?.workshopPhone || "",
      workshopAddress: state.settings?.workshopAddress || "",
      invoiceNo: inv.invoiceNo || "",
      date: inv.date || fmtDate(inv.createdAt),
      customerName: inv.customerName || "",
      customerPhone: inv.customerPhone || "",
      plate: inv.plate || "",
      carModel: inv.carModel || "",
      year: inv.year || "",
      serviceTitle: inv.serviceTitle || "خدمات ورشة",
      items,
      totalFmt: fmtMoney(inv.total || 0),
    };

    const html = `
      <!doctype html>
      <html lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
        <title>${inv.invoiceNo || "Invoice"}</title>
        <style>${tpl.css || ""}</style>
      </head>
      <body>
        ${renderTemplate(tpl.html || "", data)}
        <script>window.onload=()=>setTimeout(()=>window.print(),250);</script>
      </body>
      </html>
    `;

    const iframe = el("iframe", { style:"width:100%; height:78vh; border:1px solid rgba(255,255,255,.12); border-radius:18px; background:#fff;" });
    openModal("معاينة الطباعة", el("div", {}, [iframe]), [
      el("button", { class:"btn ok", onclick:()=>iframe.contentWindow?.print() }, ["طباعة الآن"])
    ]);
    iframe.srcdoc = html;

  }catch(e){
    toast("تعذر الطباعة", e?.message||String(e), "bad");
  }
}

/* ---------- Templates ---------- */
async function pageTemplates(){
  setPageHeader("قوالب الفواتير", "إنشاء/تعديل/حذف + معاينة مباشرة");

  const host = el("div", { class:"grid cols2" });
  const listBox = el("div", { class:"card" }, [
    el("h3", {}, ["القوالب"]),
    el("div", { class:"muted" }, ["قائمة القوالب"]),
    el("hr", { class:"hr" }),
    el("div", { class:"muted" }, ["جارِ التحميل…"])
  ]);

  const editorBox = el("div", { class:"card" }, [
    el("h3", {}, ["المحرر"]),
    el("div", { class:"muted" }, ["HTML + CSS — يدعم {{var}} و {{#items}}"]),
    el("hr", { class:"hr" }),
  ]);

  host.appendChild(listBox);
  host.appendChild(editorBox);

  const tplListHost = listBox.lastChild;

  const cur = { id:null };
  const name = el("input", { class:"input", placeholder:"اسم القالب" });
  const css  = el("textarea");
  const html = el("textarea");
  const preview = el("iframe", { style:"width:100%; height:360px; border:1px solid rgba(255,255,255,.12); border-radius:18px; background:#fff;" });

  function sampleData(){
    return {
      workshopName: state.settings?.workshopName || "RPM",
      workshopPhone: state.settings?.workshopPhone || "",
      workshopAddress: state.settings?.workshopAddress || "",
      invoiceNo: "RPM-000123",
      date: fmtDate(new Date()),
      customerName: "احمد هشام توفيق",
      customerPhone: "0771xxxxxxx",
      plate: "ك13-----",
      carModel: "سوناتا 2",
      year: "1994",
      serviceTitle: "تبديل دهن",
      items: [
        { desc:"دهن 5W-30", qty:1, priceFmt: fmtMoney(35000), lineTotalFmt: fmtMoney(35000) },
        { desc:"فلتر", qty:1, priceFmt: fmtMoney(5000), lineTotalFmt: fmtMoney(5000) },
      ],
      totalFmt: fmtMoney(40000),
    };
  }

  function refreshPreview(){
    const docHtml = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><style>${css.value||""}</style></head>
      <body>${renderTemplate(html.value||"", sampleData())}</body></html>`;
    preview.srcdoc = docHtml;
  }

  [name, css, html].forEach(x=>x.addEventListener("input", refreshPreview));

  editorBox.appendChild(el("div", { class:"field w12" }, [el("label", {}, ["اسم القالب"]), name]));
  editorBox.appendChild(el("div", { class:"field w12" }, [el("label", {}, ["CSS"]), css]));
  editorBox.appendChild(el("div", { class:"field w12" }, [el("label", {}, ["HTML"]), html]));

  const btnSave = el("button", { class:"btn primary", onclick: async ()=>{
    try{
      if (!name.value.trim()) return toast("اسم القالب مطلوب", "", "warn");

      if (!cur.id){
        const ref = await addDoc(collection(state.db, C.invoiceTemplates), {
          name: name.value.trim(),
          css: css.value,
          html: html.value,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        cur.id = ref.id;
        toast("تم الإنشاء", "قالب جديد", "ok");
      } else {
        await updateDoc(doc(state.db, C.invoiceTemplates, cur.id), {
          name: name.value.trim(),
          css: css.value,
          html: html.value,
          updatedAt: serverTimestamp(),
        });
        toast("تم الحفظ", "تم تحديث القالب", "ok");
      }
      await loadList();
    }catch(e){
      toast("فشل", e?.message||String(e), "bad");
    }
  }}, ["حفظ"]);

  const btnNew = el("button", { class:"btn", onclick: ()=>{
    cur.id = null;
    name.value = "";
    css.value = "";
    html.value = "";
    refreshPreview();
  }}, ["قالب جديد"]);

  const btnDelete = el("button", { class:"btn bad", onclick: async ()=>{
    if (!cur.id) return;
    if (!confirm("حذف القالب؟")) return;
    try{
      await deleteDoc(doc(state.db, C.invoiceTemplates, cur.id));
      cur.id=null;
      name.value=""; css.value=""; html.value="";
      refreshPreview();
      toast("تم الحذف", "", "ok");
      await loadList();
    }catch(e){
      toast("تعذر الحذف", e?.message||"", "bad");
    }
  }}, ["حذف"]);

  editorBox.appendChild(el("div", { class:"actions", style:"margin-top:10px" }, [
    btnSave, btnNew, hasPerm(state.profile,"delete") ? btnDelete : el("span")
  ]));
  editorBox.appendChild(el("hr", { class:"hr" }));
  editorBox.appendChild(el("h3", {}, ["المعاينة"]));
  editorBox.appendChild(preview);

  async function loadList(){
    tplListHost.innerHTML = "";
    tplListHost.appendChild(el("div", { class:"muted" }, ["جارِ التحميل…"]));

    const q1 = query(collection(state.db, C.invoiceTemplates), orderBy("createdAt","desc"), limit(100));
    const s1 = await getDocs(q1);

    tplListHost.innerHTML = "";
    if (s1.empty) return tplListHost.appendChild(el("div", { class:"muted" }, ["لا توجد قوالب."]));

    s1.docs.forEach(d=>{
      const t = d.data();
      tplListHost.appendChild(el("div", { class:"card", style:"margin-bottom:10px" }, [
        el("b", {}, [t.name || d.id]),
        el("div", { class:"muted", style:"font-size:12px" }, [d.id]),
        el("div", { class:"actions", style:"margin-top:8px" }, [
          el("button", { class:"btn", onclick: ()=>{
            cur.id = d.id;
            name.value = t.name || "";
            css.value  = t.css || "";
            html.value = t.html || "";
            refreshPreview();
            toast("تم التحميل", "القالب في المحرر", "ok");
          }}, ["تحميل"])
        ])
      ]));
    });
  }

  refreshPreview();
  await loadList();
  return host;
}

/* ---------- Customers ---------- */
async function pageCustomers(){
  setPageHeader("الزبائن", "إضافة / تعديل / حذف");

  const host = el("div", { class:"grid", style:"gap:16px" });

  const top = el("div", { class:"card" }, [
    el("h3", {}, ["قائمة الزبائن"]),
    el("div", { class:"muted" }, ["بحث + إدارة"]),
    el("hr", { class:"hr" }),
  ]);

  const search = el("input", { class:"input", placeholder:"بحث: اسم أو هاتف…" });
  const btnAdd = el("button", { class:"btn primary", onclick:()=>openCustomerEditor(null) }, ["+ زبون"]);
  const btnRefresh = el("button", { class:"btn ghost" }, ["تحديث"]);

  top.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field w6" }, [el("label", {}, ["بحث"]), search]),
    el("div", { class:"field w6" }, [el("div", { class:"actions", style:"margin-top:18px" }, [btnAdd, btnRefresh])]),
  ]));

  const box = el("div", { class:"card" }, [el("div", { class:"muted" }, ["جارِ التحميل…"])]);
  host.appendChild(top);
  host.appendChild(box);

  async function load(){
    box.innerHTML = "";
    box.appendChild(el("div", { class:"muted" }, ["جارِ التحميل…"]));
    try{
      const q1 = query(collection(state.db, C.customers), orderBy("createdAt","desc"), limit(300));
      const s1 = await getDocs(q1);
      const rows = s1.docs.map(d=>({ id:d.id, ...d.data() }));
      render(rows);
    }catch(e){
      box.innerHTML = "";
      box.appendChild(el("div", { class:"muted" }, ["فشل: ", String(e?.message||e)]));
    }
  }

  function render(rows){
    const q = search.value.trim().toLowerCase();
    const filtered = q ? rows.filter(x => (`${x.name||""} ${x.phone||""}`.toLowerCase().includes(q))) : rows;

    const tbl = el("table", { class:"table" }, [
      el("thead", {}, [el("tr", {}, [
        el("th", {}, ["الاسم"]),
        el("th", {}, ["الهاتف"]),
        el("th", {}, ["تاريخ"]),
        el("th", {}, ["إجراءات"]),
      ])]),
      el("tbody")
    ]);
    const tb = tbl.querySelector("tbody");

    if (!filtered.length){
      tb.appendChild(el("tr", {}, [el("td", { colspan:"4", style:"text-align:center; color:rgba(234,240,255,.7)" }, ["لا يوجد بيانات"])]));
    } else {
      filtered.forEach(r=>{
        tb.appendChild(el("tr", {}, [
          el("td", {}, [el("b", {}, [r.name || "-"])]),
          el("td", {}, [r.phone || "-"]),
          el("td", {}, [fmtDate(r.createdAt)]),
          el("td", {}, [el("div", { class:"actions" }, [
            el("button", { class:"btn", onclick:()=>openCustomerEditor(r) }, ["تعديل"]),
            hasPerm(state.profile,"delete") ? el("button", { class:"btn bad", onclick:()=>deleteCustomer(r.id) }, ["حذف"]) : el("span")
          ])])
        ]));
      });
    }

    box.innerHTML = "";
    box.appendChild(tbl);
  }

  btnRefresh.onclick = load;
  search.addEventListener("input", load);
  await load();
  return host;
}

function openCustomerEditor(row){
  const isNew = !row;
  const name = el("input", { class:"input", value: row?.name || "" });
  const phone= el("input", { class:"input", value: row?.phone || "" });

  const body = el("div", { class:"grid", style:"gap:12px" }, [
    el("div", { class:"card" }, [
      el("h3", {}, [isNew ? "زبون جديد" : "تعديل زبون"]),
      el("div", { class:"field w12" }, [el("label", {}, ["الاسم"]), name]),
      el("div", { class:"field w12" }, [el("label", {}, ["الهاتف"]), phone]),
    ])
  ]);

  const btnSave = el("button", { class:"btn primary", onclick: async ()=>{
    try{
      if (!name.value.trim() || !phone.value.trim()) return toast("الاسم والهاتف مطلوبين", "", "warn");
      btnSave.disabled = true;

      if (isNew){
        await addDoc(collection(state.db, C.customers), {
          name: name.value.trim(),
          phone: phone.value.trim(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(state.db, C.customers, row.id), {
          name: name.value.trim(),
          phone: phone.value.trim(),
          updatedAt: serverTimestamp(),
        });
      }

      toast("تم الحفظ", "", "ok");
      renderRoute();
    }catch(e){
      toast("فشل", e?.message||String(e), "bad");
    }finally{
      btnSave.disabled = false;
    }
  }}, ["حفظ"]);

  openModal("الزبائن", body, [btnSave]);
}

async function deleteCustomer(id){
  if (!confirm("حذف الزبون؟")) return;
  try{
    await deleteDoc(doc(state.db, C.customers, id));
    toast("تم الحذف", "", "ok");
    renderRoute();
  }catch(e){
    toast("تعذر الحذف", e?.message||"", "bad");
  }
}

/* ---------- Cars ---------- */
async function pageCars(){
  setPageHeader("السيارات", "عرض سيارات + معلومات الدهن");

  const host = el("div", { class:"grid", style:"gap:16px" });

  const top = el("div", { class:"card" }, [
    el("h3", {}, ["قائمة السيارات"]),
    el("div", { class:"muted" }, ["بحث سريع: لوحة/موديل/زبون"]),
    el("hr", { class:"hr" }),
  ]);

  const search = el("input", { class:"input", placeholder:"بحث…" });
  const btnRefresh = el("button", { class:"btn ghost" }, ["تحديث"]);

  top.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field w6" }, [el("label", {}, ["بحث"]), search]),
    el("div", { class:"field w6" }, [el("div", { class:"actions", style:"margin-top:18px" }, [btnRefresh])]),
  ]));

  const box = el("div", { class:"card" }, [el("div", { class:"muted" }, ["جارِ التحميل…"])]);
  host.appendChild(top);
  host.appendChild(box);

  async function load(){
    box.innerHTML = "";
    box.appendChild(el("div", { class:"muted" }, ["جارِ التحميل…"]));
    try{
      const q1 = query(collection(state.db, C.cars), orderBy("createdAt","desc"), limit(350));
      const s1 = await getDocs(q1);
      const rows = s1.docs.map(d=>({ id:d.id, ...d.data() }));
      render(rows);
    }catch(e){
      box.innerHTML = "";
      box.appendChild(el("div", { class:"muted" }, ["فشل: ", String(e?.message||e)]));
    }
  }

  function render(rows){
    const q = search.value.trim().toLowerCase();
    const filtered = q ? rows.filter(x => (`${x.plate||""} ${x.model||""} ${x.customerName||""}`.toLowerCase().includes(q))) : rows;

    const tbl = el("table", { class:"table" }, [
      el("thead", {}, [el("tr", {}, [
        el("th", {}, ["اللوحة"]),
        el("th", {}, ["الموديل"]),
        el("th", {}, ["السنة"]),
        el("th", {}, ["الزبون"]),
        el("th", {}, ["دهن (KM القادم)"]),
      ])]),
      el("tbody")
    ]);
    const tb = tbl.querySelector("tbody");

    if (!filtered.length){
      tb.appendChild(el("tr", {}, [el("td", { colspan:"5", style:"text-align:center; color:rgba(234,240,255,.7)" }, ["لا يوجد بيانات"])]));
    } else {
      filtered.forEach(r=>{
        tb.appendChild(el("tr", {}, [
          el("td", {}, [el("b", {}, [r.plate || "-"])]),
          el("td", {}, [r.model || "-"]),
          el("td", {}, [r.year ? String(r.year) : "-"]),
          el("td", {}, [r.customerName || "-"]),
          el("td", {}, [r.nextOilKm ? String(r.nextOilKm) : "-"]),
        ]));
      });
    }

    box.innerHTML = "";
    box.appendChild(tbl);
  }

  btnRefresh.onclick = load;
  search.addEventListener("input", load);
  await load();
  return host;
}

/* ---------- Employees & Departments (CRUD) ---------- */
async function pageEmployees(){
  setPageHeader("الموظفون", "CRUD كامل");
  return crudPage({
    title:"الموظفون",
    col:C.employees,
    fields:[
      { key:"name", label:"الاسم" },
      { key:"phone", label:"الهاتف" },
      { key:"role", label:"الوظيفة/الدور" },
      { key:"notes", label:"ملاحظات", type:"textarea" },
    ],
    canWrite: hasPerm(state.profile,"writeAll"),
    canDelete: hasPerm(state.profile,"delete"),
    searchKeys:["name","phone","role"],
  });
}
async function pageDepartments(){
  setPageHeader("الأقسام", "CRUD كامل");
  return crudPage({
    title:"الأقسام",
    col:C.departments,
    fields:[
      { key:"name", label:"اسم القسم" },
      { key:"desc", label:"الوصف", type:"textarea" },
    ],
    canWrite: hasPerm(state.profile,"writeAll"),
    canDelete: hasPerm(state.profile,"delete"),
    searchKeys:["name","desc"],
  });
}

/* Generic CRUD page for employees/departments */
async function crudPage(cfg){
  const host = el("div", { class:"grid", style:"gap:16px" });
  const top = el("div", { class:"card" }, [
    el("h3", {}, [cfg.title]),
    el("div", { class:"muted" }, ["إضافة / تعديل / حذف"]),
    el("hr", { class:"hr" }),
  ]);

  const search = el("input", { class:"input", placeholder:"بحث…" });
  const btnAdd = el("button", { class:"btn primary", onclick:()=>openCrudEditor(cfg, null) }, ["+ إضافة"]);
  const btnRefresh = el("button", { class:"btn ghost" }, ["تحديث"]);

  top.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field w6" }, [el("label", {}, ["بحث"]), search]),
    el("div", { class:"field w6" }, [el("div", { class:"actions", style:"margin-top:18px" }, [
      cfg.canWrite ? btnAdd : el("span"),
      btnRefresh
    ])]),
  ]));

  const box = el("div", { class:"card" }, [el("div", { class:"muted" }, ["جارِ التحميل…"])]);
  host.appendChild(top);
  host.appendChild(box);

  async function load(){
    box.innerHTML = "";
    box.appendChild(el("div", { class:"muted" }, ["جارِ التحميل…"]));
    try{
      const q1 = query(collection(state.db, cfg.col), orderBy("createdAt","desc"), limit(400));
      const s1 = await getDocs(q1);
      const rows = s1.docs.map(d=>({ id:d.id, ...d.data() }));
      render(rows);
    }catch(e){
      box.innerHTML = "";
      box.appendChild(el("div", { class:"muted" }, ["فشل: ", String(e?.message||e)]));
    }
  }

  function render(rows){
    const q = search.value.trim().toLowerCase();
    const filtered = q ? rows.filter(r=>{
      const blob = cfg.searchKeys.map(k=>safeStr(r[k])).join(" ").toLowerCase();
      return blob.includes(q);
    }) : rows;

    const tbl = el("table", { class:"table" }, [
      el("thead", {}, [el("tr", {}, [
        ...cfg.fields.filter(f=>f.type!=="textarea").slice(0,3).map(f=>el("th", {}, [f.label])),
        el("th", {}, ["تاريخ"]),
        el("th", {}, ["إجراءات"]),
      ])]),
      el("tbody")
    ]);
    const tb = tbl.querySelector("tbody");

    if (!filtered.length){
      tb.appendChild(el("tr", {}, [el("td", { colspan:"5", style:"text-align:center; color:rgba(234,240,255,.7)" }, ["لا يوجد بيانات"])]));
    } else {
      filtered.forEach(r=>{
        const cols = cfg.fields.filter(f=>f.type!=="textarea").slice(0,3).map(f => el("td", {}, [safeStr(r[f.key]) || "-"]));
        tb.appendChild(el("tr", {}, [
          ...cols,
          el("td", {}, [fmtDate(r.createdAt)]),
          el("td", {}, [el("div", { class:"actions" }, [
            cfg.canWrite ? el("button", { class:"btn", onclick:()=>openCrudEditor(cfg, r) }, ["تعديل"]) : el("span"),
            (cfg.canDelete) ? el("button", { class:"btn bad", onclick:()=>deleteCrud(cfg, r.id) }, ["حذف"]) : el("span")
          ])])
        ]));
      });
    }

    box.innerHTML = "";
    box.appendChild(tbl);
  }

  btnRefresh.onclick = load;
  search.addEventListener("input", load);

  await load();
  return host;
}

function openCrudEditor(cfg, row){
  if (!cfg.canWrite) return toast("ممنوع", "لا توجد صلاحية", "warn");
  const isNew = !row;
  const inputs = {};
  const form = el("div", { class:"grid", style:"gap:12px" }, [
    el("div", { class:"card" }, [
      el("h3", {}, [isNew ? `إضافة ${cfg.title}` : `تعديل ${cfg.title}`]),
    ])
  ]);

  const card = form.firstChild;
  cfg.fields.forEach(f=>{
    const input = (f.type === "textarea")
      ? el("textarea", {}, [safeStr(row?.[f.key])])
      : el("input", { class:"input", value: safeStr(row?.[f.key]) });

    inputs[f.key] = input;
    card.appendChild(el("div", { class:"field w12" }, [el("label", {}, [f.label]), input]));
  });

  const btnSave = el("button", { class:"btn primary", onclick: async ()=>{
    try{
      btnSave.disabled = true;
      const payload = {};
      cfg.fields.forEach(f => payload[f.key] = (f.type==="textarea") ? inputs[f.key].value : inputs[f.key].value.trim());
      payload.updatedAt = serverTimestamp();

      if (isNew){
        payload.createdAt = serverTimestamp();
        await addDoc(collection(state.db, cfg.col), payload);
      } else {
        await updateDoc(doc(state.db, cfg.col, row.id), payload);
      }
      toast("تم الحفظ", "", "ok");
      renderRoute();
    }catch(e){
      toast("فشل", e?.message||String(e), "bad");
    }finally{
      btnSave.disabled = false;
    }
  }}, ["حفظ"]);

  openModal(cfg.title, form, [btnSave]);
}

async function deleteCrud(cfg, id){
  if (!confirm("تأكيد الحذف؟")) return;
  try{
    await deleteDoc(doc(state.db, cfg.col, id));
    toast("تم الحذف", "", "ok");
    renderRoute();
  }catch(e){
    toast("تعذر الحذف", e?.message||"", "bad");
  }
}

/* ---------- Users (Admin) ---------- */
async function pageUsers(){
  if (!hasPerm(state.profile,"manageUsers")){
    setPageHeader("ممنوع", "لا توجد صلاحية إدارة المستخدمين");
    return el("div", { class:"card" }, [el("div", { class:"muted" }, ["لا توجد صلاحية."])]);
  }

  setPageHeader("صلاحيات المستخدمين", "إنشاء مستخدم + تعديل الدور + Overrides");

  const host = el("div", { class:"grid cols2" });

  // create
  const left = el("div", { class:"card" }, [
    el("h3", {}, ["إنشاء مستخدم"]),
    el("div", { class:"muted" }, ["ينشئ Auth + يكتب users/{uid} بدون ما يطلع الأدمن"]),
    el("hr", { class:"hr" }),
  ]);
  const email = el("input", { class:"input", placeholder:"email@example.com" });
  const pass  = el("input", { class:"input", type:"password", placeholder:"كلمة مرور" });
  const role  = el("select", {}, ["viewer","tech","manager","admin"].map(r=>el("option",{value:r},[r])));

  left.appendChild(el("div", { class:"field w12" }, [el("label", {}, ["Email"]), email]));
  left.appendChild(el("div", { class:"field w12" }, [el("label", {}, ["Password"]), pass]));
  left.appendChild(el("div", { class:"field w12" }, [el("label", {}, ["Role"]), role]));

  const btnCreate = el("button", { class:"btn primary", onclick: async ()=>{
    try{
      btnCreate.disabled = true;
      if (!email.value.trim() || !pass.value) return toast("أكملي البيانات", "", "warn");

      const cred = await createUserWithEmailAndPassword(state.auth2, email.value.trim(), pass.value);
      const uid = cred.user.uid;

      await setDoc(doc(state.db, C.users, uid), {
        email: email.value.trim(),
        role: role.value,
        permissions: {},
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge:true });

      toast("تم إنشاء المستخدم", "تم تسجيل الدور في Firestore", "ok");
      email.value=""; pass.value="";
      await loadList();
    }catch(e){
      toast("فشل", e?.message||String(e), "bad");
    }finally{
      btnCreate.disabled = false;
    }
  }}, ["إنشاء"]);

  left.appendChild(el("div", { class:"actions" }, [btnCreate]));
  left.appendChild(el("div", { class:"muted", style:"margin-top:10px" }, [
    "ملاحظة: إنشاء المستخدم يحتاج إعدادات Auth صحيحة و Rules تسمح للأدمن يكتب users."
  ]));

  // list & edit
  const right = el("div", { class:"card" }, [
    el("h3", {}, ["قائمة المستخدمين"]),
    el("div", { class:"muted" }, ["تعديل الدور والصلاحيات"]),
    el("hr", { class:"hr" }),
  ]);
  const list = el("div", { class:"muted" }, ["جارِ التحميل…"]);
  right.appendChild(list);

  async function loadList(){
    list.innerHTML = "";
    list.appendChild(el("div", { class:"muted" }, ["جارِ التحميل…"]));
    try{
      const q1 = query(collection(state.db, C.users), orderBy("createdAt","desc"), limit(250));
      const s1 = await getDocs(q1);

      list.innerHTML = "";
      if (s1.empty) return list.appendChild(el("div", { class:"muted" }, ["لا يوجد مستخدمين داخل users."]));

      s1.docs.forEach(d=>{
        const u = d.data();
        const sel = el("select", {}, ["viewer","tech","manager","admin"].map(r=>el("option",{value:r},[r])));
        sel.value = u.role || "viewer";

        const perms = u.permissions || {};
        const permUI = el("div", { class:"grid", style:"gap:8px; margin-top:10px" }, [
          el("div", { class:"muted", style:"font-size:12px" }, ["Overrides (تشغيل/إيقاف)"])
        ]);

        const checks = {};
        PERM_KEYS.forEach(k=>{
          const cb = el("input", { type:"checkbox" });
          cb.checked = perms[k] === true; // true override only (false override via uncheck + set false if needed)
          checks[k]=cb;
          permUI.appendChild(el("div", { class:"badge" }, [
            cb,
            el("span", {}, [k])
          ]));
        });

        const btnSave = el("button", { class:"btn", onclick: async ()=>{
          try{
            const nextPerms = { ...(u.permissions||{}) };
            PERM_KEYS.forEach(k=>{
              // If checked => true override
              // If not checked => remove override (clean)
              if (checks[k].checked) nextPerms[k] = true;
              else { if (nextPerms[k] === true) delete nextPerms[k]; }
            });

            await updateDoc(doc(state.db, C.users, d.id), {
              role: sel.value,
              permissions: nextPerms,
              updatedAt: serverTimestamp(),
            });
            toast("تم تحديث المستخدم", u.email || d.id, "ok");
          }catch(e){
            toast("فشل", e?.message||"", "bad");
          }
        }}, ["حفظ"]);

        list.appendChild(el("div", { class:"card", style:"margin-bottom:10px" }, [
          el("div", { style:"display:flex; justify-content:space-between; gap:10px; align-items:center" }, [
            el("div", {}, [
              el("b", {}, [u.email || d.id]),
              el("div", { class:"muted", style:"font-size:12px" }, [`uid: ${d.id}`]),
            ]),
            el("div", { class:"actions" }, [sel, btnSave]),
          ]),
          permUI
        ]));
      });

    }catch(e){
      list.innerHTML = "";
      list.appendChild(el("div", { class:"muted" }, ["فشل التحميل: ", String(e?.message||e)]));
    }
  }

  await loadList();
  host.appendChild(left);
  host.appendChild(right);
  return host;
}

/* ---------- Settings ---------- */
async function pageSettings(){
  if (!hasPerm(state.profile,"manageSettings")){
    setPageHeader("ممنوع", "لا توجد صلاحية الإعدادات");
    return el("div", { class:"card" }, [el("div", { class:"muted" }, ["لا توجد صلاحية."])]);
  }

  setPageHeader("الإعدادات", "اسم الورشة + ترقيم + ضريبة + قالب افتراضي");

  const s = state.settings || {};
  const name = el("input", { class:"input", value: s.workshopName || "" });
  const phone= el("input", { class:"input", value: s.workshopPhone || "" });
  const addr = el("input", { class:"input", value: s.workshopAddress || "" });

  const prefix = el("input", { class:"input", value: s.invoicePrefix || "RPM-" });
  const padding= el("input", { class:"input", type:"number", value: s.invoicePadding || 6 });
  const tax    = el("input", { class:"input", type:"number", value: s.taxPercent || 0 });

  // default template
  const tplSel = el("select");
  tplSel.appendChild(el("option", { value:"" }, ["(اختر قالب افتراضي)"]));
  {
    const qs = query(collection(state.db, C.invoiceTemplates), orderBy("createdAt","desc"), limit(100));
    const ss = await getDocs(qs);
    ss.docs.forEach(d => tplSel.appendChild(el("option",{value:d.id},[d.data().name || d.id])));
    tplSel.value = s.defaultTemplateId || "";
  }

  const box = el("div", { class:"grid cols2" }, [
    el("div", { class:"card" }, [
      el("h3", {}, ["بيانات الورشة"]),
      el("div", { class:"field w12" }, [el("label", {}, ["الاسم"]), name]),
      el("div", { class:"field w12" }, [el("label", {}, ["الهاتف"]), phone]),
      el("div", { class:"field w12" }, [el("label", {}, ["العنوان"]), addr]),
    ]),
    el("div", { class:"card" }, [
      el("h3", {}, ["الفواتير"]),
      el("div", { class:"field w12" }, [el("label", {}, ["Prefix"]), prefix]),
      el("div", { class:"field w12" }, [el("label", {}, ["Padding"]), padding]),
      el("div", { class:"field w12" }, [el("label", {}, ["Tax %"]), tax]),
      el("div", { class:"field w12" }, [el("label", {}, ["القالب الافتراضي"]), tplSel]),
    ]),
  ]);

  const btnSave = el("button", { class:"btn primary", onclick: async ()=>{
    try{
      btnSave.disabled = true;
      await setDoc(doc(state.db, C.settings, "app"), {
        workshopName: name.value.trim(),
        workshopPhone: phone.value.trim(),
        workshopAddress: addr.value.trim(),
        invoicePrefix: prefix.value.trim(),
        invoicePadding: Number(padding.value||6),
        taxPercent: Number(tax.value||0),
        defaultTemplateId: tplSel.value,
        updatedAt: serverTimestamp(),
      }, { merge:true });

      toast("تم حفظ الإعدادات", "", "ok");
      await loadBootstrapData();
      renderRoute();
    }catch(e){
      toast("فشل", e?.message||String(e), "bad");
    }finally{
      btnSave.disabled = false;
    }
  }}, ["حفظ"]);

  const btnSeed = el("button", { class:"btn", onclick: async ()=>{
    try{
      await ensureDefaults();
      toast("تمت التهيئة", "settings/uiConfig/meta/templates", "ok");
      await loadBootstrapData();
      renderRoute();
    }catch(e){
      toast("فشل", e?.message||String(e), "bad");
    }
  }}, ["تهيئة افتراضيات"]);

  return el("div", {}, [
    el("div", { class:"actions", style:"margin-bottom:12px" }, [btnSave, btnSeed]),
    box
  ]);
}

/* ---------- Custom Pages (CMS) ---------- */
async function pageUI(){
  if (!hasPerm(state.profile,"manageSettings")){
    setPageHeader("ممنوع", "لا توجد صلاحية صفحات مخصصة");
    return el("div", { class:"card" }, [el("div", { class:"muted" }, ["لا توجد صلاحية."])]);
  }

  setPageHeader("صفحات مخصّصة", "إنشاء صفحة + نشرها في السايدبار بدون تعديل الكود");

  const host = el("div", { class:"grid cols2" });

  const left = el("div", { class:"card" }, [
    el("h3", {}, ["إنشاء / تعديل صفحة"]),
    el("div", { class:"muted" }, ["تُحفظ داخل uiConfig/page_<slug>"]),
    el("hr", { class:"hr" }),
  ]);

  const slug = el("input", { class:"input", placeholder:"slug مثال: offers" });
  const title= el("input", { class:"input", placeholder:"عنوان الصفحة" });
  const html = el("textarea", {}, ["<h2>مرحبا</h2><p>هذه صفحة مخصصة.</p>"]);
  const pinToNav = el("input", { type:"checkbox" });

  left.appendChild(el("div", { class:"field w12" }, [el("label", {}, ["Slug"]), slug]));
  left.appendChild(el("div", { class:"field w12" }, [el("label", {}, ["Title"]), title]));
  left.appendChild(el("div", { class:"field w12" }, [el("label", {}, ["HTML"]), html]));
  left.appendChild(el("div", { class:"badge" }, [pinToNav, "إضافة للسايدبار (للأدمن/المدير)"]));

  const btnSave = el("button", { class:"btn primary", onclick: async ()=>{
    try{
      const s = slug.value.trim().toLowerCase();
      const t = title.value.trim();
      if (!s || !t) return toast("slug والعنوان مطلوبين", "", "warn");

      const id = "page_" + s;
      await setDoc(doc(state.db, C.uiConfig, id), {
        kind:"page",
        slug:s,
        title:t,
        type:"html",
        html: html.value,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      }, { merge:true });

      if (pinToNav.checked){
        const uiRef = doc(state.db, C.uiConfig, "app");
        const uiSnap = await getDoc(uiRef);
        const ui = uiSnap.exists() ? uiSnap.data() : {};
        const nav = Array.isArray(ui.nav) ? ui.nav : [];
        const code = `page:${s}`;
        const exists = nav.some(x => x.slug === code);
        if (!exists){
          nav.push({ slug: code, title: t, icon:"🧾", roles:["admin","manager"] });
          await setDoc(uiRef, { nav, updatedAt: serverTimestamp() }, { merge:true });
        }
      }

      toast("تم الحفظ", "الصفحة جاهزة", "ok");
      await loadBootstrapData();
      renderShell();
      navTo("page", s);
    }catch(e){
      toast("فشل", e?.message||String(e), "bad");
    }
  }}, ["حفظ الصفحة"]);

  left.appendChild(el("div", { class:"actions" }, [btnSave]));

  const right = el("div", { class:"card" }, [
    el("h3", {}, ["الصفحات الموجودة"]),
    el("div", { class:"muted" }, ["تفتح عبر: #/page/<slug>"]),
    el("hr", { class:"hr" }),
  ]);

  const list = el("div", { class:"muted" }, ["جارِ التحميل…"]);
  right.appendChild(list);

  async function load(){
    list.innerHTML = "";
    try{
      const q1 = query(collection(state.db, C.uiConfig), where("kind","==","page"), limit(150));
      const s1 = await getDocs(q1);
      if (s1.empty) return list.appendChild(el("div", { class:"muted" }, ["لا توجد صفحات."]));

      s1.docs.forEach(d=>{
        const p = d.data();
        list.appendChild(el("div", { class:"card", style:"margin-bottom:10px" }, [
          el("b", {}, [p.title || p.slug || d.id]),
          el("div", { class:"muted", style:"font-size:12px" }, [`slug: ${p.slug}`]),
          el("div", { class:"actions", style:"margin-top:8px" }, [
            el("button", { class:"btn", onclick:()=>{
              slug.value = p.slug || "";
              title.value = p.title || "";
              html.value = p.html || "";
              toast("تم التحميل", "الصفحة في المحرر", "ok");
            }}, ["تحميل"]),
            el("button", { class:"btn", onclick:()=>navTo("page", p.slug) }, ["فتح"]),
            hasPerm(state.profile,"delete") ? el("button", { class:"btn bad", onclick: async ()=>{
              if (!confirm("حذف الصفحة؟")) return;
              await deleteDoc(doc(state.db, C.uiConfig, d.id));
              toast("تم الحذف", "", "ok");
              load();
            }}, ["حذف"]) : el("span")
          ])
        ]));
      });
    }catch(e){
      list.appendChild(el("div", { class:"muted" }, ["فشل: ", String(e?.message||e)]));
    }
  }

  await load();
  host.appendChild(left);
  host.appendChild(right);
  return host;
}

async function pageCustom(slug){
  setPageHeader("صفحة مخصصة", slug || "");
  const id = "page_" + (slug || "");
  const s = await getDoc(doc(state.db, C.uiConfig, id));
  if (!s.exists()){
    return el("div", { class:"card" }, [
      el("h3", {}, ["غير موجودة"]),
      el("div", { class:"muted" }, ["لا توجد صفحة بهذا الـ slug."]),
    ]);
  }
  const p = s.data();
  setPageHeader(p.title || "صفحة", p.slug || "");
  return el("div", { class:"card" }, [el("div", { html: p.html || "" })]);
}

/* ---------- Route Renderer ---------- */
async function renderRoute(){
  if (!state.user) return renderAuth();
  if (!state.profile) return;

  refreshActiveNav();
  const page = $("#page");
  page.innerHTML = "";

  const { slug, id } = route();

  try{
    if (slug === "dashboard") page.appendChild(await pageDashboard());
    else if (slug === "orders") page.appendChild(await pageOrders());
    else if (slug === "oil") page.appendChild(await pageOil());
    else if (slug === "invoices"){
      if (id) { await openInvoiceEditor(id); page.appendChild(await pageInvoices()); }
      else page.appendChild(await pageInvoices());
    }
    else if (slug === "templates") page.appendChild(await pageTemplates());
    else if (slug === "customers") page.appendChild(await pageCustomers());
    else if (slug === "cars") page.appendChild(await pageCars());
    else if (slug === "employees") page.appendChild(await pageEmployees());
    else if (slug === "departments") page.appendChild(await pageDepartments());
    else if (slug === "users") page.appendChild(await pageUsers());
    else if (slug === "settings") page.appendChild(await pageSettings());
    else if (slug === "ui") page.appendChild(await pageUI());
    else if (slug === "page") page.appendChild(await pageCustom(id || ""));
    else page.appendChild(el("div", { class:"card" }, [el("div", { class:"muted" }, ["الصفحة غير موجودة."])]));
  }catch(e){
    page.innerHTML = "";
    page.appendChild(el("div", { class:"card" }, [
      el("h3", {}, ["حصل خطأ"]),
      el("div", { class:"muted" }, [String(e?.message || e)]),
      el("hr", { class:"hr" }),
      el("div", { class:"muted" }, ["إذا الخطأ Permission Denied: راجعي Firestore Rules."])
    ]));
  }
}

/* ---------- Init ---------- */
async function init(){
  state.app = initializeApp(firebaseConfig);
  state.auth = getAuth(state.app);

  // Secondary app for creating users without switching admin session
  const app2 = initializeApp(firebaseConfig, "rpm-secondary");
  state.auth2 = getAuth(app2);

  state.db = getFirestore(state.app);

  onAuthStateChanged(state.auth, async (user)=>{
    state.user = user || null;
    state.profile = null;
    clearLive();

    if (!user){
      renderAuth();
      return;
    }

    try{
      await loadBootstrapData();
      state.profile = await loadProfile(user.uid, user.email);
      renderShell();
      toast("أهلاً", `تم تسجيل الدخول: ${user.email}`, "ok");
    }catch(e){
      toast("خطأ", e?.message || String(e), "bad");
      renderAuth();
    }
  });

  window.addEventListener("hashchange", ()=>{
    if (state.user){
      refreshActiveNav();
      renderRoute();
    }
  });
}

init();

/* =========================================================
   🔐 Firestore Rules (اقتراح قوي)
   =========================================================
   - أول مرة: أنشئي مستخدم أدمن وسوي users/{uid}.role=admin
   - بعدين كل شيء يشتغل.
----------------------------------------------------------
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function signedIn() { return request.auth != null; }
    function userDoc() { return get(/databases/$(database)/documents/users/$(request.auth.uid)); }
    function role() { return signedIn() && userDoc().exists() ? userDoc().data.role : 'viewer'; }
    function isAdmin() { return role() == 'admin'; }
    function isManager() { return role() == 'manager' || isAdmin(); }
    function isTech() { return role() == 'tech' || isManager(); }

    match /users/{uid} {
      allow read: if signedIn() && (isAdmin() || request.auth.uid == uid);
      // السماح للمستخدم ينشئ ملفه أول مرة
      allow create: if signedIn() && request.auth.uid == uid;
      allow update, delete: if isAdmin();
    }

    match /settings/{doc} { allow read: if signedIn(); allow write: if isAdmin(); }
    match /uiConfig/{doc} { allow read: if signedIn(); allow write: if isAdmin(); }
    match /meta/{doc}     { allow read: if signedIn(); allow write: if isAdmin(); }

    match /invoiceTemplates/{id} { allow read: if signedIn(); allow write: if isManager(); }
    match /invoices/{id} {
      allow read: if signedIn();
      allow write: if isManager();
      allow delete: if isAdmin();
    }

    match /orders/{id} {
      allow read: if signedIn();
      allow write: if isTech();
      allow delete: if isAdmin();
    }

    match /customers/{id} {
      allow read: if signedIn();
      allow write: if isTech();
      allow delete: if isAdmin();
    }

    match /cars/{id} {
      allow read: if signedIn();
      allow write: if isTech();
      allow delete: if isAdmin();
    }

    match /employees/{id} {
      allow read: if signedIn();
      allow write: if isManager();
      allow delete: if isAdmin();
    }

    match /departments/{id} {
      allow read: if signedIn();
      allow write: if isManager();
      allow delete: if isAdmin();
    }
  }
}
----------------------------------------------------------
*/
