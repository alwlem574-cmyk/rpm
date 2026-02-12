// app.js (نسخة جديدة نظيفة — بدون تكرار el() وبدون أخطاء return/appendChild)
// ==========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  createUserWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* ---------- Firebase Config ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyC0p4cqNHuqZs9_gNuKLl7nEY0MqRXbf_A",
  authDomain: "rpm574.firebaseapp.com",
  databaseURL: "https://rpm574-default-rtdb.firebaseio.com",
  projectId: "rpm574",
  storageBucket: "rpm574.firebasestorage.app",
  messagingSenderId: "150918603525",
  appId: "1:150918603525:web:fe1d0fbe5c4505936c4d6c",
};

const APP = {
  name: "RPM",
  subtitle: "Workshop ERP",
  currency: "IQD",
  version: "2026.02.12",
};

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

/* ---------- State ---------- */
const state = {
  app: null,
  auth: null,
  db: null,

  user: null,      // Firebase user
  profile: null,   // users/{uid}
  settings: null,  // settings/app
  ui: null,        // uiConfig/app

  unsub: [],
};

/* ---------- DOM Helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * el(tag, attrs, children)
 * - يدعم children: Node | string | number | boolean | null | array (متداخل)
 * - يتجاهل null/undefined/false
 * - يحوّل النصوص إلى TextNode
 */
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);

  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v || "";
    else if (k === "html") n.innerHTML = v ?? "";
    else if (k === "style") n.style.cssText = v ?? "";
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, String(v));
  }

  const flat = (x) => Array.isArray(x) ? x.flat(Infinity) : [x];
  for (const c of flat(children)) {
    if (c === null || c === undefined || c === false) continue;
    if (c instanceof Node) n.appendChild(c);
    else n.appendChild(document.createTextNode(String(c)));
  }

  return n;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Toast ---------- */
function toast(title, msg = "", type = "ok") {
  const host = $("#toastHost");
  if (!host) return;

  const t = el("div", { class: `toast ${type}` }, [
    el("div", { class: "t" }, [title]),
    msg ? el("div", { class: "s" }, [msg]) : null,
  ]);

  host.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

/* ---------- Modal ---------- */
function openModal(title, bodyNode, actions = []) {
  const host = $("#modalHost");
  if (!host) return { close() {} };

  host.classList.remove("hidden");
  host.innerHTML = "";

  const close = () => {
    host.classList.add("hidden");
    host.innerHTML = "";
  };

  host.addEventListener("click", (e) => {
    if (e.target === host) close();
  }, { once: true });

  const head = el("div", { class: "modalHead" }, [
    el("b", {}, [title]),
    el("div", { class: "actions" }, [
      ...actions.filter(Boolean),
      el("button", { class: "btn ghost", onclick: close }, ["إغلاق"]),
    ]),
  ]);

  const modal = el("div", { class: "modal" }, [
    head,
    el("div", { class: "modalBody" }, [bodyNode]),
  ]);

  host.appendChild(modal);
  return { close };
}

/* ---------- Format ---------- */
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
function s(x) { return (x ?? "").toString(); }

/* ---------- Tiny Template Engine ---------- */
function renderTemplate(tpl, data) {
  if (!tpl) return "";

  tpl = tpl.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, inner) => {
    const arr = data?.[key];
    if (!Array.isArray(arr)) return "";
    return arr.map((it) => renderTemplate(inner, { ...data, ...it })).join("");
  });

  tpl = tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = data?.[key];
    return v === undefined || v === null ? "" : String(v);
  });

  return tpl;
}

/* ---------- Roles & Permissions ---------- */
const ROLE_MATRIX = {
  admin:   { readAll:true, writeAll:true, delete:true, manageUsers:true, manageSettings:true, manageUI:true },
  manager: { readAll:true, writeAll:true, delete:false, manageUsers:false, manageSettings:false, manageUI:false },
  tech:    { readAll:false, writeAll:false, delete:false, techOrders:true },
  viewer:  { readAll:true, writeAll:false, delete:false },
};

function hasPerm(profile, perm) {
  if (!profile) return false;
  const role = profile.role || "viewer";
  const base = ROLE_MATRIX[role] || ROLE_MATRIX.viewer;
  const overrides = profile.permissions || {};
  if (overrides[perm] === true) return true;
  if (overrides[perm] === false) return false;
  return !!base[perm];
}

/* ---------- Firestore Safe Helpers ---------- */
function clearLive() {
  for (const u of state.unsub) { try { u(); } catch {} }
  state.unsub = [];
}

async function safeGetDocs(q) {
  try { return await getDocs(q); }
  catch (e) { throw e; }
}

function safeListen(q, onOk, onErr) {
  const unsub = onSnapshot(q, onOk, onErr);
  state.unsub.push(unsub);
  return unsub;
}

/* ---------- Defaults Seeder ---------- */
async function ensureDefaults() {
  // settings/app
  const sRef = doc(state.db, C.settings, "app");
  const sSnap = await getDoc(sRef);
  if (!sSnap.exists()) {
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
  if (!uSnap.exists()) {
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
        { slug:"ui", title:"الصفحات + القائمة", icon:"🧱", roles:["admin"] },
        { slug:"settings", title:"الإعدادات", icon:"⚙️", roles:["admin"] },
      ],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // invoice counter
  const mRef = doc(state.db, C.meta, "invoiceCounter");
  const mSnap = await getDoc(mRef);
  if (!mSnap.exists()) {
    await setDoc(mRef, { next: 1, updatedAt: serverTimestamp() });
  }

  // default template
  const tQ = query(collection(state.db, C.invoiceTemplates), limit(1));
  const tS = await getDocs(tQ);
  if (tS.empty) {
    await addDoc(collection(state.db, C.invoiceTemplates), {
      name: "فاتورة — افتراضي فخم",
      css: `
        body{ font-family: Tahoma, Arial; direction:rtl; padding:20px; color:#0b1220; }
        .head{display:flex; justify-content:space-between; align-items:flex-start; gap:14px;}
        .logo{font-weight:900; font-size:20px;}
        .meta{font-size:12px; color:#475569; text-align:left;}
        .panel{border:1px solid #e5e7eb; border-radius:12px; padding:12px; margin-top:12px;}
        .grid{display:grid; grid-template-columns:1fr 1fr; gap:12px;}
        h2{margin:0 0 4px 0;}
        table{width:100%; border-collapse:collapse; margin-top:12px;}
        th,td{border-bottom:1px solid #e5e7eb; padding:10px; text-align:right;}
        th{background:#f8fafc; font-size:12px; color:#334155;}
        .tot{display:flex; justify-content:flex-end; gap:16px; margin-top:12px; font-weight:700;}
        .mut{color:#64748b; font-size:12px}
      `,
      html: `
        <div class="head">
          <div>
            <div class="logo">{{workshopName}}</div>
            <div class="mut">{{workshopPhone}} • {{workshopAddress}}</div>
          </div>
          <div class="meta">
            <div>رقم: <b>{{invoiceNo}}</b></div>
            <div>التاريخ: {{date}}</div>
            <div class="mut">الخدمة: {{serviceTitle}}</div>
          </div>
        </div>

        <div class="panel grid">
          <div>
            <div class="mut">الزبون</div>
            <div><b>{{customerName}}</b></div>
            <div class="mut">{{customerPhone}}</div>
          </div>
          <div>
            <div class="mut">السيارة</div>
            <div>اللوحة: <b>{{plate}}</b></div>
            <div class="mut">{{carModel}} • {{year}}</div>
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
      `,
      isDefault: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }
}

async function loadBootstrap() {
  await ensureDefaults();

  const sSnap = await getDoc(doc(state.db, C.settings, "app"));
  state.settings = sSnap.exists() ? { id:sSnap.id, ...sSnap.data() } : null;

  const uiSnap = await getDoc(doc(state.db, C.uiConfig, "app"));
  state.ui = uiSnap.exists() ? { id:uiSnap.id, ...uiSnap.data() } : null;
}

/* ---------- Invoice No (transaction) ---------- */
async function nextInvoiceNo() {
  const settings = state.settings || {};
  const prefix = settings.invoicePrefix || "RPM-";
  const pad = Number(settings.invoicePadding || 6);

  const counterRef = doc(state.db, C.meta, "invoiceCounter");
  const invoiceNo = await runTransaction(state.db, async (tx) => {
    const snap = await tx.get(counterRef);
    const next = snap.exists() ? Number(snap.data().next || 1) : 1;
    const no = prefix + String(next).padStart(pad, "0");
    tx.set(counterRef, { next: next + 1, updatedAt: serverTimestamp() }, { merge: true });
    return no;
  });

  return invoiceNo;
}

/* ---------- Ensure Customer & Car (يدعم حقولك الحالية) ---------- */
async function ensureCustomerAndCar({ customerName, customerPhone, plate, model, year }) {
  const name = s(customerName).trim();
  const phone = s(customerPhone).trim();
  const carPlate = s(plate).trim();
  const carModel = s(model).trim();
  const carYear = year ? Number(year) : null;

  if (!name || !phone) throw new Error("اسم الزبون ورقم الهاتف مطلوبين");
  if (!carPlate) throw new Error("لوحة السيارة مطلوبة");

  // customer by phone
  let customerId = null;
  {
    const q1 = query(collection(state.db, C.customers), where("phone", "==", phone), limit(1));
    const s1 = await getDocs(q1);
    if (!s1.empty) {
      const d = s1.docs[0];
      customerId = d.id;
      const curName = s(d.data().name || d.data().customerName);
      if (curName !== name) {
        await updateDoc(doc(state.db, C.customers, customerId), { name, updatedAt: serverTimestamp() });
      }
    } else {
      const ref = await addDoc(collection(state.db, C.customers), {
        name,
        phone,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      customerId = ref.id;
    }
  }

  // car by plate
  let carId = null;
  {
    const q2 = query(collection(state.db, C.cars), where("plate", "==", carPlate), limit(1));
    const s2 = await getDocs(q2);
    if (!s2.empty) {
      const d = s2.docs[0];
      carId = d.id;
      await updateDoc(doc(state.db, C.cars, carId), {
        customerId,
        customerName: name,
        customerPhone: phone,
        model: carModel || d.data().model || "",
        year: carYear || d.data().year || null,
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

/* ---------- Router ---------- */
function route() {
  const h = (location.hash || "#/dashboard").replace("#/", "");
  const [slug, id] = h.split("/");
  return { slug: slug || "dashboard", id: id || null };
}
function navTo(slug, id=null) {
  location.hash = `#/${slug}${id ? "/" + id : ""}`;
}

/* ---------- Auth UI ---------- */
function renderAuth() {
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
    if (!v) return toast("اكتبي البريد أولاً", "", "warn");
    try{
      await sendPasswordResetEmail(state.auth, v);
      toast("تم الإرسال", "تحققي من بريدك", "ok");
    }catch(e){
      toast("تعذر الإرسال", e?.message || "", "bad");
    }
  }}, ["نسيت كلمة المرور"]);

  const card = el("div", { class:"authCard" }, [
    el("div", { class:"authHead" }, [
      el("div", { class:"badgeLogo" }, ["RPM"]),
      el("div", {}, [
        el("b", {}, ["تسجيل الدخول"]),
        el("span", {}, ["نظام إدارة ورشة صيانة سيارات"]),
      ]),
    ]),
    el("div", { class:"field" }, [el("label", {}, ["البريد الإلكتروني"]), email]),
    el("div", { class:"field" }, [el("label", {}, ["كلمة المرور"]), pass]),
    el("div", { class:"actions" }, [btnLogin, btnReset]),
    el("hr", { class:"hr" }),
    el("div", { class:"muted small" }, [
      "إذا هذا أول دخول: أنشئي المستخدم من Firebase Auth Console ثم عيّني دوره كـ admin داخل users/{uid}.",
    ]),
  ]);

  root.appendChild(el("div", { class:"authWrap" }, [card]));
}

/* ---------- Shell ---------- */
function canSeeNavItem(item) {
  const role = state.profile?.role || "viewer";
  const roles = item.roles || ["admin","manager","tech","viewer"];
  return roles.includes(role);
}

function refreshActiveNav() {
  const { slug } = route();
  $$(".nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#/${slug}`));
}

function setPageHeader(title, sub="") {
  $("#pageTitle").textContent = title;
  $("#pageSub").textContent = sub;
}

function renderShell() {
  const root = $("#app");
  root.innerHTML = "";

  const sidebar = el("aside", { class:"sidebar", id:"sidebar" });
  const main = el("main", { class:"main" });
  root.appendChild(el("div", { class:"shell" }, [sidebar, main]));

  const brand = el("div", { class:"brand" }, [
    el("div", { class:"brandLeft" }, [
      el("div", { class:"brandBadge" }, ["RPM"]),
      el("div", {}, [
        el("div", { class:"brandTitle" }, [state.ui?.brandName || APP.name]),
        el("div", { class:"brandSub" }, [APP.subtitle + " • " + APP.version]),
      ]),
    ]),
    el("button", { class:"btn ghost", onclick: () => sidebar.classList.remove("open") }, ["✕"]),
  ]);
  sidebar.appendChild(brand);

  const nav = el("nav", { class:"nav" });
  sidebar.appendChild(nav);

  const items = (state.ui?.nav || []).filter(canSeeNavItem);
  for (const it of items) {
    nav.appendChild(el("a", {
      href: `#/${it.slug}`,
      onclick: () => { if (window.innerWidth <= 980) sidebar.classList.remove("open"); },
    }, [
      el("span", {}, [`${it.icon || "•"} ${it.title}`]),
      it.tag ? el("span", { class:"tag" }, [it.tag]) : null,
    ]));
  }

  sidebar.appendChild(el("div", { class:"sideFoot" }, [
    el("div", { class:"userLine" }, [
      el("div", { class:"userMeta" }, [
        el("b", {}, [state.user?.email || ""]),
        el("span", {}, [`الدور: ${state.profile?.role || "viewer"}`]),
      ]),
      el("div", { class:"actions", style:"margin-top:10px" }, [
        el("button", { class:"btn ghost", onclick: () => signOut(state.auth) }, ["خروج"]),
      ]),
    ]),
  ]));

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
      ]),
    ]),
  ]);

  main.appendChild(topbar);
  main.appendChild(el("div", { id:"page" }));

  refreshActiveNav();
  renderRoute();
}

/* ---------- Components ---------- */
function statusBadge(sv) {
  const s2 = sv || "open";
  const map = {
    open: { t:"مفتوح", c:"warn" },
    inProgress: { t:"قيد العمل", c:"warn" },
    done: { t:"مكتمل", c:"ok" },
    cancelled: { t:"ملغي", c:"bad" },
  };
  const m = map[s2] || { t:s2, c:"" };
  return el("span", { class:`badge ${m.c}` }, [m.t]);
}

function invoiceStatusBadge(sv) {
  const s2 = sv || "issued";
  const map = {
    draft: { t:"مسودة", c:"" },
    issued: { t:"صادرة", c:"warn" },
    paid: { t:"مدفوعة", c:"ok" },
    cancelled: { t:"ملغاة", c:"bad" },
  };
  const m = map[s2] || { t:s2, c:"" };
  return el("span", { class:`badge ${m.c}` }, [m.t]);
}

/* ---------- Dashboard ---------- */
async function pageDashboard() {
  setPageHeader("لوحة التحكم", "ملخص سريع");

  const wrap = el("div", { class:"grid cols3" });

  const kpiCard = el("div", { class:"card" }, [
    el("h3", {}, ["مؤشرات"]),
    el("div", { class:"muted small" }, ["آخر بيانات من Firestore"]),
    el("hr", { class:"hr" }),
    el("div", { class:"grid cols3" }, [
      el("div", { class:"kpi" }, [el("div", { class:"n", id:"k1" }, ["..."]), el("div", { class:"l" }, ["أوامر"])]),
      el("div", { class:"kpi" }, [el("div", { class:"n", id:"k2" }, ["..."]), el("div", { class:"l" }, ["فواتير"])]),
      el("div", { class:"kpi" }, [el("div", { class:"n", id:"k3" }, ["..."]), el("div", { class:"l" }, ["إيراد"])]),
    ]),
  ]);

  const quick = el("div", { class:"card" }, [
    el("h3", {}, ["إجراءات سريعة"]),
    el("div", { class:"actions" }, [
      el("button", { class:"btn primary", onclick: () => navTo("orders") }, ["أوامر الشغل"]),
      el("button", { class:"btn ok", onclick: () => navTo("oil") }, ["تبديل دهن"]),
      el("button", { class:"btn", onclick: () => navTo("invoices") }, ["الفواتير"]),
      hasPerm(state.profile, "manageUsers") ? el("button", { class:"btn", onclick: () => navTo("users") }, ["الصلاحيات"]) : null,
    ]),
  ]);

  const live = el("div", { class:"card", style:"grid-column: span 1 / auto" }, [
    el("h3", {}, ["آخر أوامر الشغل"]),
    el("div", { class:"muted small" }, ["مباشر — آخر 20"]),
    el("div", { class:"muted", style:"margin-top:10px" }, ["جارِ التحميل…"]),
  ]);

  wrap.appendChild(kpiCard);
  wrap.appendChild(quick);
  wrap.appendChild(live);

  // Live orders
  clearLive();
  const listHost = live.lastChild;
  const q1 = query(collection(state.db, C.orders), orderBy("createdAt","desc"), limit(20));
  safeListen(q1, (snap) => {
    const rows = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    listHost.innerHTML = "";
    listHost.appendChild(renderOrdersTable(rows, { compact:true }));
  }, (err) => {
    listHost.innerHTML = "";
    listHost.appendChild(el("div", { class:"muted" }, ["فشل القراءة: ", err?.message || String(err)]));
  });

  // KPIs
  try{
    const invQ = query(collection(state.db, C.invoices), orderBy("createdAt","desc"), limit(80));
    const ordQ = query(collection(state.db, C.orders), orderBy("createdAt","desc"), limit(80));
    const [invS, ordS] = await Promise.all([getDocs(invQ), getDocs(ordQ)]);
    const invCount = invS.size;
    const ordCount = ordS.size;
    const revenue = invS.docs.reduce((a,d)=>a + Number(d.data().total||0), 0);

    $("#k1").textContent = String(ordCount);
    $("#k2").textContent = String(invCount);
    $("#k3").textContent = revenue.toLocaleString("ar-IQ") + " " + APP.currency;
  }catch{}

  return wrap;
}

/* ---------- Orders ---------- */
function renderOrdersTable(rows, opts={}) {
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
    el("tbody"),
  ]);

  const tb = tbl.querySelector("tbody");
  if (!rows.length) {
    tb.appendChild(el("tr", {}, [el("td", { colspan:"5", style:"text-align:center; color:rgba(234,240,255,.7)" }, ["لا يوجد بيانات"])]));
    return tbl;
  }

  for (const r of rows) {
    const car = r.carPlate || r.plate || "-";
    const model = r.carModel || r.model || "";
    tb.appendChild(el("tr", {}, [
      el("td", {}, [fmtDate(r.createdAt)]),
      el("td", {}, [
        el("b", {}, [r.customerName || "-"]),
        el("div", { class:"small" }, [r.customerPhone || ""]),
      ]),
      el("td", {}, [`${car}${model ? " — " + model : ""}`]),
      el("td", {}, [statusBadge(r.status)]),
      el("td", {}, [
        el("div", { class:"actions" }, [
          el("button", { class:"btn", onclick: () => onOpen(r.id) }, ["فتح"]),
          (!compact && hasPerm(state.profile, "delete")) ? el("button", { class:"btn bad", onclick: () => deleteOrder(r.id) }, ["حذف"]) : null,
        ]),
      ]),
    ]));
  }

  return tbl;
}

async function pageOrders() {
  setPageHeader("أوامر الشغل", "إنشاء/تعديل + ربط الزبون والسيارة تلقائياً");

  const host = el("div", { class:"grid", style:"gap:14px" });

  const top = el("div", { class:"card" }, [
    el("h3", {}, ["قائمة أوامر الشغل"]),
    el("div", { class:"muted small" }, ["بحث سريع + إنشاء أمر"]),
    el("hr", { class:"hr" }),
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
  const btnReload = el("button", { class:"btn ghost" }, ["تحديث"]);

  top.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field" }, [el("label", {}, ["بحث"]), search]),
    el("div", { class:"field" }, [el("label", {}, ["الحالة"]), status]),
  ]));
  top.appendChild(el("div", { class:"actions" }, [btnNew, btnReload]));

  const box = el("div", { class:"card" }, [el("div", { class:"muted" }, ["جارِ التحميل…"])]);

  host.appendChild(top);
  host.appendChild(box);

  let cached = [];

  async function load() {
    box.innerHTML = "";
    box.appendChild(el("div", { class:"muted" }, ["جارِ التحميل…"]));
    try{
      const q1 = query(collection(state.db, C.orders), orderBy("createdAt","desc"), limit(200));
      const s1 = await safeGetDocs(q1);
      cached = s1.docs.map(d => ({ id:d.id, ...d.data() }));
      render();
    }catch(e){
      box.innerHTML = "";
      box.appendChild(el("div", { class:"muted" }, ["فشل التحميل: ", e?.message || String(e)]));
    }
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const st = status.value;

    let rows = cached;
    if (st) rows = rows.filter(x => (x.status || "open") === st);
    if (q) {
      rows = rows.filter(x => {
        const all = `${x.customerName||""} ${x.customerPhone||""} ${x.carPlate||x.plate||""} ${x.carModel||x.model||""}`.toLowerCase();
        return all.includes(q);
      });
    }

    box.innerHTML = "";
    box.appendChild(renderOrdersTable(rows, { onOpen: (id)=>openOrderEditor(id) }));
  }

  btnReload.onclick = load;
  search.addEventListener("input", render);
  status.addEventListener("change", render);

  await load();
  return host;
}

async function deleteOrder(id) {
  if (!confirm("تأكيد حذف أمر الشغل؟")) return;
  try{
    await deleteDoc(doc(state.db, C.orders, id));
    toast("تم الحذف", "أمر الشغل", "ok");
    renderRoute();
  }catch(e){
    toast("تعذر الحذف", e?.message || "", "bad");
  }
}

async function openOrderEditor(orderId=null) {
  const isNew = !orderId;

  const data = isNew ? {
    status:"open",
    customerName:"",
    customerPhone:"",
    plate:"",
    model:"",
    year:"",
    notes:"",
    services:[],
    parts:[],
  } : await (async()=>{
    const s = await getDoc(doc(state.db, C.orders, orderId));
    return s.exists() ? { id:s.id, ...s.data() } : null;
  })();

  if (!data) return toast("غير موجود", "أمر الشغل غير موجود", "warn");

  const fName = el("input", { class:"input", value: data.customerName || "" });
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

  // خدمات
  const serviceName = el("input", { class:"input", placeholder:"اسم الخدمة" });
  const servicePrice= el("input", { class:"input", type:"number", placeholder:"سعر الخدمة" });
  const servicesBox = el("div");
  const btnAddService = el("button", { class:"btn", onclick: () => {
    const n = serviceName.value.trim();
    const p = Number(servicePrice.value||0);
    if (!n) return;
    data.services.push({ name:n, price:p });
    serviceName.value=""; servicePrice.value="";
    renderServices();
    refreshTotal();
  }}, ["إضافة خدمة"]);

  function renderServices() {
    servicesBox.innerHTML = "";
    if (!data.services.length) return servicesBox.appendChild(el("div", { class:"muted small" }, ["لا توجد خدمات بعد."]));

    const t = el("table", { class:"table" }, [
      el("thead", {}, [el("tr", {}, [el("th", {}, ["الخدمة"]), el("th", {}, ["السعر"]), el("th", {}, [""])])]),
      el("tbody"),
    ]);
    const tb = t.querySelector("tbody");
    data.services.forEach((sv, i) => {
      tb.appendChild(el("tr", {}, [
        el("td", {}, [sv.name]),
        el("td", {}, [fmtMoney(sv.price||0)]),
        el("td", {}, [el("button", { class:"btn bad", onclick: ()=>{ data.services.splice(i,1); renderServices(); refreshTotal(); } }, ["حذف"])]),
      ]));
    });
    servicesBox.appendChild(t);
  }

  // قطع
  const partName = el("input", { class:"input", placeholder:"قطعة / وصف" });
  const partQty  = el("input", { class:"input", type:"number", placeholder:"الكمية", value:"1" });
  const partPrice= el("input", { class:"input", type:"number", placeholder:"السعر" });
  const partsBox = el("div");
  const btnAddPart = el("button", { class:"btn", onclick: () => {
    const n = partName.value.trim();
    const q = Number(partQty.value||1);
    const p = Number(partPrice.value||0);
    if (!n) return;
    data.parts.push({ name:n, qty:q, price:p });
    partName.value=""; partQty.value="1"; partPrice.value="";
    renderParts();
    refreshTotal();
  }}, ["إضافة قطعة"]);

  function renderParts() {
    partsBox.innerHTML = "";
    if (!data.parts.length) return partsBox.appendChild(el("div", { class:"muted small" }, ["لا توجد قطع بعد."]));

    const t = el("table", { class:"table" }, [
      el("thead", {}, [el("tr", {}, [el("th", {}, ["القطعة"]), el("th", {}, ["كمية"]), el("th", {}, ["سعر"]), el("th", {}, [""])])]),
      el("tbody"),
    ]);
    const tb = t.querySelector("tbody");
    data.parts.forEach((pt, i) => {
      tb.appendChild(el("tr", {}, [
        el("td", {}, [pt.name]),
        el("td", {}, [String(pt.qty||1)]),
        el("td", {}, [fmtMoney(pt.price||0)]),
        el("td", {}, [el("button", { class:"btn bad", onclick: ()=>{ data.parts.splice(i,1); renderParts(); refreshTotal(); } }, ["حذف"])]),
      ]));
    });
    partsBox.appendChild(t);
  }

  const calcTotal = () => {
    const sv = data.services.reduce((a,x)=>a+Number(x.price||0),0);
    const pt = data.parts.reduce((a,x)=>a + Number(x.qty||1)*Number(x.price||0),0);
    return sv+pt;
  };

  const totalKpi = el("div", { class:"kpi" }, [
    el("div", { class:"n", id:"tSum" }, [fmtMoney(calcTotal())]),
    el("div", { class:"l" }, ["خدمات + قطع"]),
  ]);
  function refreshTotal() { $("#tSum", totalKpi).textContent = fmtMoney(calcTotal()); }

  renderServices();
  renderParts();

  const body = el("div", { class:"grid", style:"gap:14px" }, [
    el("div", { class:"card" }, [
      el("h3", {}, ["الزبون والسيارة (صفحة واحدة)"]),
      el("div", { class:"row" }, [
        el("div", { class:"field" }, [el("label", {}, ["اسم الزبون"]), fName]),
        el("div", { class:"field" }, [el("label", {}, ["الهاتف"]), fPhone]),
      ]),
      el("div", { class:"row" }, [
        el("div", { class:"field" }, [el("label", {}, ["اللوحة"]), fPlate]),
        el("div", { class:"field" }, [el("label", {}, ["الموديل"]), fModel]),
        el("div", { class:"field" }, [el("label", {}, ["السنة"]), fYear]),
      ]),
      el("div", { class:"row" }, [
        el("div", { class:"field" }, [el("label", {}, ["الحالة"]), fStatus]),
      ]),
      el("div", { class:"field" }, [el("label", {}, ["ملاحظات"]), fNotes]),
    ]),

    el("div", { class:"card" }, [
      el("h3", {}, ["الخدمات"]),
      el("div", { class:"row" }, [
        el("div", { class:"field" }, [el("label", {}, ["خدمة"]), serviceName]),
        el("div", { class:"field" }, [el("label", {}, ["سعر"]), servicePrice]),
      ]),
      el("div", { class:"actions" }, [btnAddService]),
      el("div", { style:"margin-top:10px" }, [servicesBox]),
    ]),

    el("div", { class:"card" }, [
      el("h3", {}, ["القطع / قطع الغيار"]),
      el("div", { class:"row" }, [
        el("div", { class:"field" }, [el("label", {}, ["الوصف"]), partName]),
        el("div", { class:"field" }, [el("label", {}, ["الكمية"]), partQty]),
        el("div", { class:"field" }, [el("label", {}, ["السعر"]), partPrice]),
      ]),
      el("div", { class:"actions" }, [btnAddPart]),
      el("div", { style:"margin-top:10px" }, [partsBox]),
    ]),

    el("div", { class:"card" }, [
      el("h3", {}, ["المجموع"]),
      totalKpi,
    ]),
  ]);

  const btnSave = el("button", { class:"btn primary", onclick: async () => {
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
        services: data.services,
        parts: data.parts,
        totalEstimate: calcTotal(),
        updatedAt: serverTimestamp(),
      };

      if (isNew) {
        payload.createdAt = serverTimestamp();
        const ref = await addDoc(collection(state.db, C.orders), payload);
        toast("تم الإنشاء", "أمر شغل جديد", "ok");
        navTo("orders"); // يرجع للقائمة
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

  const btnInvoice = el("button", { class:"btn ok", onclick: async () => {
    if (isNew) return toast("احفظ أولاً", "لازم إنشاء أمر الشغل قبل الفاتورة", "warn");
    try{
      const invId = await createInvoiceFromOrder(orderId);
      toast("تم إنشاء فاتورة", "جاهزة للتعديل والطباعة", "ok");
      navTo("invoices");
      openInvoiceEditor(invId);
    }catch(e){
      toast("تعذر إنشاء فاتورة", e?.message || "", "bad");
    }
  }}, ["إنشاء فاتورة"]);

  openModal(isNew ? "أمر شغل جديد" : "تعديل أمر شغل", body, [btnSave, btnInvoice]);
}

/* ---------- Oil Change (واجهة سريعة) ---------- */
async function pageOil() {
  setPageHeader("تبديل دهن", "أمر شغل + فاتورة مباشرة");

  const cName  = el("input", { class:"input", placeholder:"اسم الزبون" });
  const cPhone = el("input", { class:"input", placeholder:"الهاتف" });

  const plate = el("input", { class:"input", placeholder:"اللوحة" });
  const model = el("input", { class:"input", placeholder:"الموديل" });
  const year  = el("input", { class:"input", type:"number", placeholder:"السنة" });

  const oilBrand = el("input", { class:"input", placeholder:"ماركة الدهن" });
  const oilVisc  = el("input", { class:"input", placeholder:"اللزوجة (مثال 5W-30)" });
  const oilQty   = el("input", { class:"input", type:"number", value:"4", placeholder:"كم لتر" });
  const oilPrice = el("input", { class:"input", type:"number", placeholder:"سعر الدهن" });

  const filterName  = el("input", { class:"input", placeholder:"فلتر (اختياري)" });
  const filterPrice = el("input", { class:"input", type:"number", placeholder:"سعر الفلتر" });

  const kmNow  = el("input", { class:"input", type:"number", placeholder:"KM الحالي" });
  const kmNext = el("input", { class:"input", type:"number", placeholder:"KM القادم" });
  const notes  = el("textarea", {}, [""]);

  const totalBox = el("div", { class:"kpi" }, [
    el("div", { class:"n", id:"oilSum" }, [fmtMoney(0)]),
    el("div", { class:"l" }, ["المجموع"]),
  ]);
  const calc = () => Number(oilPrice.value||0) + Number(filterPrice.value||0);
  const refresh = () => $("#oilSum", totalBox).textContent = fmtMoney(calc());
  oilPrice.addEventListener("input", refresh);
  filterPrice.addEventListener("input", refresh);
  refresh();

  const btnCreate = el("button", { class:"btn primary", onclick: async () => {
    try{
      btnCreate.disabled = true;

      const { customerId, carId } = await ensureCustomerAndCar({
        customerName: cName.value,
        customerPhone: cPhone.value,
        plate: plate.value,
        model: model.value,
        year: year.value,
      });

      const services = [{ name:"تبديل دهن", price:Number(oilPrice.value||0) }];
      const parts = [];
      if (filterName.value.trim()) parts.push({ name:`فلتر: ${filterName.value.trim()}`, qty:1, price:Number(filterPrice.value||0) });

      const orderPayload = {
        type:"oilChange",
        status:"done",
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
        totalEstimate: calc(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const oRef = await addDoc(collection(state.db, C.orders), orderPayload);

      // تحديث السيارة بمعلومة الدهن (اختياري)
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

      const invId = await createInvoiceFromOrder(oRef.id, { serviceTitle:"تبديل دهن" });
      toast("تمت العملية", "أمر شغل + فاتورة", "ok");
      navTo("invoices");
      openInvoiceEditor(invId);

    }catch(e){
      toast("فشل", e?.message || String(e), "bad");
    }finally{
      btnCreate.disabled = false;
    }
  }}, ["إنشاء أمر + فاتورة"]);

  return el("div", { class:"grid cols2" }, [
    el("div", { class:"card" }, [
      el("h3", {}, ["بيانات الزبون والسيارة"]),
      el("div", { class:"row" }, [
        el("div", { class:"field" }, [el("label", {}, ["الاسم"]), cName]),
        el("div", { class:"field" }, [el("label", {}, ["الهاتف"]), cPhone]),
      ]),
      el("div", { class:"row" }, [
        el("div", { class:"field" }, [el("label", {}, ["اللوحة"]), plate]),
        el("div", { class:"field" }, [el("label", {}, ["الموديل"]), model]),
        el("div", { class:"field" }, [el("label", {}, ["السنة"]), year]),
      ]),
    ]),
    el("div", { class:"card" }, [
      el("h3", {}, ["تفاصيل تبديل الدهن"]),
      el("div", { class:"row" }, [
        el("div", { class:"field" }, [el("label", {}, ["الماركة"]), oilBrand]),
        el("div", { class:"field" }, [el("label", {}, ["اللزوجة"]), oilVisc]),
      ]),
      el("div", { class:"row" }, [
        el("div", { class:"field" }, [el("label", {}, ["كمية (لتر)"]), oilQty]),
        el("div", { class:"field" }, [el("label", {}, ["سعر الدهن"]), oilPrice]),
      ]),
      el("div", { class:"row" }, [
        el("div", { class:"field" }, [el("label", {}, ["فلتر"]), filterName]),
        el("div", { class:"field" }, [el("label", {}, ["سعر الفلتر"]), filterPrice]),
      ]),
      el("div", { class:"row" }, [
        el("div", { class:"field" }, [el("label", {}, ["KM الحالي"]), kmNow]),
        el("div", { class:"field" }, [el("label", {}, ["KM القادم"]), kmNext]),
      ]),
      el("div", { class:"field" }, [el("label", {}, ["ملاحظات"]), notes]),
      el("hr", { class:"hr" }),
      totalBox,
      el("div", { class:"actions", style:"margin-top:10px" }, [btnCreate]),
    ]),
  ]);
}

/* ---------- Create Invoice From Order ---------- */
async function createInvoiceFromOrder(orderId, extra={}) {
  const oSnap = await getDoc(doc(state.db, C.orders, orderId));
  if (!oSnap.exists()) throw new Error("أمر الشغل غير موجود");
  const order = { id:oSnap.id, ...oSnap.data() };

  const invoiceNo = await nextInvoiceNo();

  // template
  let templateId = state.settings?.defaultTemplateId || "";
  if (!templateId) {
    const tq = query(collection(state.db, C.invoiceTemplates), orderBy("createdAt","desc"), limit(1));
    const ts = await getDocs(tq);
    if (!ts.empty) templateId = ts.docs[0].id;
  }

  const items = [];
  (order.services||[]).forEach(sv => items.push({ desc:sv.name||"خدمة", qty:1, price:Number(sv.price||0) }));
  (order.parts||[]).forEach(pt => items.push({ desc:pt.name||"قطعة", qty:Number(pt.qty||1), price:Number(pt.price||0) }));

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

/* ---------- Invoices (قائمة + تحرير فخم + معاينة) ---------- */
async function pageInvoices() {
  setPageHeader("الفواتير", "تعديل + معاينة + طباعة + حذف");

  const host = el("div", { class:"grid", style:"gap:14px" });

  const search = el("input", { class:"input", placeholder:"بحث: رقم/اسم/هاتف/لوحة…" });
  const btnReload = el("button", { class:"btn ghost" }, ["تحديث"]);

  const top = el("div", { class:"card" }, [
    el("h3", {}, ["قائمة الفواتير"]),
    el("div", { class:"muted small" }, ["أفضل تعديل من “تعديل” ثم “معاينة/طباعة”"]),
    el("hr", { class:"hr" }),
    el("div", { class:"row" }, [
      el("div", { class:"field" }, [el("label", {}, ["بحث"]), search]),
      el("div", { class:"actions", style:"align-items:flex-end; padding-top:18px" }, [btnReload]),
    ]),
  ]);

  const box = el("div", { class:"card" }, [el("div", { class:"muted" }, ["جارِ التحميل…"])]);

  host.appendChild(top);
  host.appendChild(box);

  let cached = [];

  async function load() {
    box.innerHTML = "";
    box.appendChild(el("div", { class:"muted" }, ["جارِ التحميل…"]));
    try{
      const q1 = query(collection(state.db, C.invoices), orderBy("createdAt","desc"), limit(250));
      const s1 = await getDocs(q1);
      cached = s1.docs.map(d => ({ id:d.id, ...d.data() }));
      render();
    }catch(e){
      box.innerHTML = "";
      box.appendChild(el("div", { class:"muted" }, ["فشل التحميل: ", e?.message || String(e)]));
    }
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const rows = q ? cached.filter(x => {
      const all = `${x.invoiceNo||""} ${x.customerName||""} ${x.customerPhone||""} ${x.plate||""}`.toLowerCase();
      return all.includes(q);
    }) : cached;

    const tbl = el("table", { class:"table" }, [
      el("thead", {}, [el("tr", {}, [
        el("th", {}, ["التاريخ"]),
        el("th", {}, ["رقم"]),
        el("th", {}, ["الزبون"]),
        el("th", {}, ["السيارة"]),
        el("th", {}, ["الحالة"]),
        el("th", {}, ["المجموع"]),
        el("th", {}, ["إجراءات"]),
      ])]),
      el("tbody"),
    ]);

    const tb = tbl.querySelector("tbody");
    if (!rows.length) {
      tb.appendChild(el("tr", {}, [el("td", { colspan:"7", style:"text-align:center; color:rgba(234,240,255,.7)" }, ["لا يوجد بيانات"])]));
    } else {
      rows.forEach(r => {
        tb.appendChild(el("tr", {}, [
          el("td", {}, [r.date || fmtDate(r.createdAt)]),
          el("td", {}, [el("b", {}, [r.invoiceNo || "-"])]),
          el("td", {}, [
            el("b", {}, [r.customerName || "-"]),
            el("div", { class:"small" }, [r.customerPhone || ""]),
          ]),
          el("td", {}, [`${r.plate||"-"} ${r.carModel ? "— "+r.carModel : ""}`]),
          el("td", {}, [invoiceStatusBadge(r.status)]),
          el("td", {}, [fmtMoney(r.total||0)]),
          el("td", {}, [
            el("div", { class:"actions" }, [
              el("button", { class:"btn", onclick: () => openInvoiceEditor(r.id) }, ["تعديل"]),
              el("button", { class:"btn ok", onclick: () => printInvoice(r.id) }, ["طباعة"]),
              hasPerm(state.profile, "delete") ? el("button", { class:"btn bad", onclick: () => deleteInvoice(r.id) }, ["حذف"]) : null,
            ]),
          ]),
        ]));
      });
    }

    box.innerHTML = "";
    box.appendChild(tbl);
  }

  btnReload.onclick = load;
  search.addEventListener("input", render);

  await load();
  return host;
}

async function deleteInvoice(id) {
  if (!confirm("تأكيد حذف الفاتورة؟")) return;
  try{
    await deleteDoc(doc(state.db, C.invoices, id));
    toast("تم الحذف", "فاتورة", "ok");
    renderRoute();
  }catch(e){
    toast("تعذر الحذف", e?.message || "", "bad");
  }
}

async function openInvoiceEditor(id) {
  const sInv = await getDoc(doc(state.db, C.invoices, id));
  if (!sInv.exists()) return toast("غير موجود", "الفاتورة غير موجودة", "warn");
  const inv = { id:sInv.id, ...sInv.data() };
  inv.items = inv.items || [];

  const fNo = el("input", { class:"input", value: inv.invoiceNo || "", disabled:true });
  const fDate = el("input", { class:"input", value: inv.date || fmtDate(inv.createdAt) });

  const fStatus = el("select", {}, [
    el("option", { value:"draft" }, ["مسودة"]),
    el("option", { value:"issued" }, ["صادرة"]),
    el("option", { value:"paid" }, ["مدفوعة"]),
    el("option", { value:"cancelled" }, ["ملغاة"]),
  ]);
  fStatus.value = inv.status || "issued";

  const fName = el("input", { class:"input", value: inv.customerName || "" });
  const fPhone = el("input", { class:"input", value: inv.customerPhone || "" });
  const fPlate = el("input", { class:"input", value: inv.plate || "" });
  const fModel = el("input", { class:"input", value: inv.carModel || "" });
  const fYear  = el("input", { class:"input", type:"number", value: inv.year || "" });

  const fTax = el("input", { class:"input", type:"number", value: inv.taxPercent ?? (state.settings?.taxPercent || 0) });

  // templates
  const tplSel = el("select");
  const tplDocs = await getDocs(query(collection(state.db, C.invoiceTemplates), orderBy("createdAt","desc"), limit(80)));
  tplSel.appendChild(el("option", { value:"" }, ["(بدون قالب)"]));
  tplDocs.docs.forEach(d => tplSel.appendChild(el("option", { value:d.id }, [d.data().name || d.id])));
  tplSel.value = inv.templateId || "";

  const itemsHost = el("div");
  const previewFrame = el("iframe", { style:"width:100%; height:520px; border:1px solid rgba(255,255,255,.12); border-radius:16px; background:#fff;" });

  function recalc() {
    const subtotal = inv.items.reduce((a,i)=>a + (Number(i.qty||1)*Number(i.price||0)), 0);
    const taxPercent = Number(fTax.value||0);
    const tax = subtotal*(taxPercent/100);
    inv.subtotal = subtotal;
    inv.taxPercent = taxPercent;
    inv.tax = tax;
    inv.total = subtotal + tax;
  }

  function renderItems() {
    recalc();
    itemsHost.innerHTML = "";

    const t = el("table", { class:"table" }, [
      el("thead", {}, [el("tr", {}, [
        el("th", {}, ["الوصف"]),
        el("th", {}, ["كمية"]),
        el("th", {}, ["سعر"]),
        el("th", {}, [""]),
      ])]),
      el("tbody"),
    ]);

    const tb = t.querySelector("tbody");
    if (!inv.items.length) {
      tb.appendChild(el("tr", {}, [el("td", { colspan:"4", style:"text-align:center; color:rgba(234,240,255,.7)" }, ["لا توجد عناصر"])]));
    } else {
      inv.items.forEach((it, idx) => {
        const d = el("input", { class:"input", value: it.desc || "" });
        const q = el("input", { class:"input", type:"number", value: it.qty ?? 1 });
        const p = el("input", { class:"input", type:"number", value: it.price ?? 0 });

        const sync = () => {
          it.desc = d.value;
          it.qty = Number(q.value||1);
          it.price= Number(p.value||0);
          renderItems();
          refreshPreview();
        };
        [d,q,p].forEach(x => x.addEventListener("change", sync));

        tb.appendChild(el("tr", {}, [
          el("td", {}, [d]),
          el("td", {}, [q]),
          el("td", {}, [p]),
          el("td", {}, [el("button", { class:"btn bad", onclick: ()=>{ inv.items.splice(idx,1); renderItems(); refreshPreview(); } }, ["حذف"])]),
        ]));
      });
    }

    itemsHost.appendChild(t);
    itemsHost.appendChild(el("div", { class:"actions", style:"margin-top:10px" }, [
      el("button", { class:"btn", onclick: ()=>{ inv.items.push({ desc:"", qty:1, price:0 }); renderItems(); refreshPreview(); } }, ["+ إضافة سطر"]),
      el("span", { class:"badge" }, [`Subtotal: ${fmtMoney(inv.subtotal||0)}`]),
      el("span", { class:"badge" }, [`Tax(${inv.taxPercent||0}%): ${fmtMoney(inv.tax||0)}`]),
      el("span", { class:"badge ok" }, [`Total: ${fmtMoney(inv.total||0)}`]),
    ]));
  }

  async function refreshPreview() {
    recalc();

    // load template
    let tpl = null;
    if (tplSel.value) {
      const t = await getDoc(doc(state.db, C.invoiceTemplates, tplSel.value));
      if (t.exists()) tpl = { id:t.id, ...t.data() };
    }
    if (!tpl) {
      // fallback: first template
      if (!tplDocs.empty) tpl = { id: tplDocs.docs[0].id, ...tplDocs.docs[0].data() };
    }
    if (!tpl) return;

    const items = inv.items.map(it => {
      const qty = Number(it.qty||1);
      const price = Number(it.price||0);
      return {
        desc: it.desc || "",
        qty,
        priceFmt: fmtMoney(price),
        lineTotalFmt: fmtMoney(qty*price),
      };
    });

    const data = {
      workshopName: state.settings?.workshopName || "RPM",
      workshopPhone: state.settings?.workshopPhone || "",
      workshopAddress: state.settings?.workshopAddress || "",
      invoiceNo: inv.invoiceNo || "",
      date: fDate.value,
      serviceTitle: inv.serviceTitle || "خدمات ورشة",
      customerName: fName.value.trim(),
      customerPhone: fPhone.value.trim(),
      plate: fPlate.value.trim(),
      carModel: fModel.value.trim(),
      year: fYear.value,
      items,
      totalFmt: fmtMoney(inv.total||0),
    };

    previewFrame.srcdoc = `
      <!doctype html>
      <html lang="ar" dir="rtl">
      <head><meta charset="utf-8"/><style>${tpl.css||""}</style></head>
      <body>${renderTemplate(tpl.html||"", data)}</body>
      </html>
    `;
  }

  renderItems();
  await refreshPreview();

  const body = el("div", { class:"grid cols2", style:"gap:14px" }, [
    el("div", { class:"card" }, [
      el("h3", {}, ["بيانات الفاتورة"]),
      el("div", { class:"row" }, [
        el("div", { class:"field" }, [el("label", {}, ["رقم"]), fNo]),
        el("div", { class:"field" }, [el("label", {}, ["التاريخ"]), fDate]),
      ]),
      el("div", { class:"row" }, [
        el("div", { class:"field" }, [el("label", {}, ["الحالة"]), fStatus]),
        el("div", { class:"field" }, [el("label", {}, ["Tax %"]), fTax]),
      ]),
      el("hr", { class:"hr" }),
      el("div", { class:"row" }, [
        el("div", { class:"field" }, [el("label", {}, ["الاسم"]), fName]),
        el("div", { class:"field" }, [el("label", {}, ["الهاتف"]), fPhone]),
      ]),
      el("div", { class:"row" }, [
        el("div", { class:"field" }, [el("label", {}, ["اللوحة"]), fPlate]),
        el("div", { class:"field" }, [el("label", {}, ["الموديل"]), fModel]),
      ]),
      el("div", { class:"field" }, [el("label", {}, ["السنة"]), fYear]),
      el("div", { class:"field" }, [el("label", {}, ["قالب"]), tplSel]),
      el("hr", { class:"hr" }),
      el("h3", {}, ["العناصر"]),
      itemsHost,
    ]),
    el("div", { class:"card" }, [
      el("h3", {}, ["المعاينة"]),
      el("div", { class:"muted small" }, ["المعاينة تتحدث مع التعديل (قد تتأخر ثانية)"]),
      el("hr", { class:"hr" }),
      previewFrame,
    ]),
  ]);

  [fDate, fName, fPhone, fPlate, fModel, fYear, fTax, tplSel].forEach(x => x.addEventListener("change", refreshPreview));
  fStatus.addEventListener("change", refreshPreview);

  const btnSave = el("button", { class:"btn primary", onclick: async () => {
    try{
      btnSave.disabled = true;
      recalc();

      await updateDoc(doc(state.db, C.invoices, id), {
        date: fDate.value,
        status: fStatus.value,
        customerName: fName.value.trim(),
        customerPhone: fPhone.value.trim(),
        plate: fPlate.value.trim(),
        carModel: fModel.value.trim(),
        year: fYear.value ? Number(fYear.value) : "",
        taxPercent: Number(fTax.value||0),
        items: inv.items,
        subtotal: inv.subtotal,
        tax: inv.tax,
        total: inv.total,
        templateId: tplSel.value,
        updatedAt: serverTimestamp(),
      });

      toast("تم الحفظ", "الفاتورة تحدّثت", "ok");
      renderRoute();
    }catch(e){
      toast("فشل الحفظ", e?.message || String(e), "bad");
    }finally{
      btnSave.disabled = false;
    }
  }}, ["حفظ"]);

  const btnPrint = el("button", { class:"btn ok", onclick: () => printInvoice(id) }, ["طباعة"]);
  openModal("تعديل فاتورة", body, [btnSave, btnPrint]);
}

async function printInvoice(invoiceId) {
  try{
    const sInv = await getDoc(doc(state.db, C.invoices, invoiceId));
    if (!sInv.exists()) return toast("غير موجود", "الفاتورة غير موجودة", "warn");
    const inv = { id:sInv.id, ...sInv.data() };

    let tpl = null;
    if (inv.templateId) {
      const t = await getDoc(doc(state.db, C.invoiceTemplates, inv.templateId));
      if (t.exists()) tpl = { id:t.id, ...t.data() };
    }
    if (!tpl) {
      const ss = await getDocs(query(collection(state.db, C.invoiceTemplates), limit(1)));
      if (!ss.empty) tpl = { id:ss.docs[0].id, ...ss.docs[0].data() };
    }
    if (!tpl) throw new Error("لا يوجد قالب فواتير");

    const items = (inv.items||[]).map(it => {
      const qty = Number(it.qty||1);
      const price = Number(it.price||0);
      return { desc: it.desc||"", qty, priceFmt: fmtMoney(price), lineTotalFmt: fmtMoney(qty*price) };
    });

    const data = {
      workshopName: state.settings?.workshopName || "RPM",
      workshopPhone: state.settings?.workshopPhone || "",
      workshopAddress: state.settings?.workshopAddress || "",
      invoiceNo: inv.invoiceNo || "",
      date: inv.date || fmtDate(inv.createdAt),
      serviceTitle: inv.serviceTitle || "خدمات ورشة",
      customerName: inv.customerName || "",
      customerPhone: inv.customerPhone || "",
      plate: inv.plate || "",
      carModel: inv.carModel || "",
      year: inv.year || "",
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

    const iframe = el("iframe", { style:"width:100%; height:80vh; border:1px solid rgba(255,255,255,.12); border-radius:16px; background:#fff;" });
    openModal("معاينة الطباعة", el("div", {}, [iframe]), [
      el("button", { class:"btn ok", onclick: () => iframe.contentWindow?.print() }, ["طباعة الآن"]),
    ]);
    iframe.srcdoc = html;

  }catch(e){
    toast("تعذر الطباعة", e?.message || String(e), "bad");
  }
}

/* ---------- Templates (CRUD) ---------- */
async function pageTemplates() {
  setPageHeader("قوالب الفواتير", "إنشاء/تعديل/حذف + معاينة");

  const host = el("div", { class:"grid cols2" });

  const listBox = el("div", { class:"card" }, [
    el("h3", {}, ["القوالب"]),
    el("div", { class:"muted small" }, ["اضغطي تحميل ثم عدلي واحفظي"]),
    el("hr", { class:"hr" }),
  ]);

  const editorBox = el("div", { class:"card" }, [
    el("h3", {}, ["المحرر"]),
    el("div", { class:"muted small" }, ["يدعم {{var}} و {{#items}}...{{/items}}"]),
    el("hr", { class:"hr" }),
  ]);

  host.appendChild(listBox);
  host.appendChild(editorBox);

  const tplList = el("div", { class:"muted" }, ["جارِ التحميل…"]);
  listBox.appendChild(tplList);

  const name = el("input", { class:"input", placeholder:"اسم القالب" });
  const css  = el("textarea", {}, [""]);
  const html = el("textarea", {}, [""]);
  const preview = el("iframe", { style:"width:100%; height:360px; border:1px solid rgba(255,255,255,.12); border-radius:16px; background:#fff;" });

  const cur = { id:null };

  function sampleData() {
    return {
      workshopName: state.settings?.workshopName || "RPM",
      workshopPhone: state.settings?.workshopPhone || "",
      workshopAddress: state.settings?.workshopAddress || "",
      invoiceNo: "RPM-000123",
      date: fmtDate(new Date()),
      customerName: "علي حسن رشيد",
      customerPhone: "0770xxxxxxx",
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

  function refreshPreview() {
    preview.srcdoc = `
      <!doctype html><html lang="ar" dir="rtl">
      <head><meta charset="utf-8"/><style>${css.value}</style></head>
      <body>${renderTemplate(html.value, sampleData())}</body></html>
    `;
  }

  [name, css, html].forEach(x => x.addEventListener("input", refreshPreview));

  editorBox.appendChild(el("div", { class:"field" }, [el("label", {}, ["اسم القالب"]), name]));
  editorBox.appendChild(el("div", { class:"field" }, [el("label", {}, ["CSS"]), css]));
  editorBox.appendChild(el("div", { class:"field" }, [el("label", {}, ["HTML"]), html]));

  const btnSave = el("button", { class:"btn primary", onclick: async () => {
    try{
      if (!name.value.trim()) return toast("اسم القالب مطلوب", "", "warn");
      btnSave.disabled = true;

      if (!cur.id) {
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
      toast("فشل", e?.message || String(e), "bad");
    }finally{
      btnSave.disabled = false;
    }
  }}, ["حفظ"]);

  const btnNew = el("button", { class:"btn", onclick: () => {
    cur.id=null;
    name.value=""; css.value=""; html.value="";
    refreshPreview();
  }}, ["قالب جديد"]);

  const btnDel = hasPerm(state.profile, "delete") ? el("button", { class:"btn bad", onclick: async () => {
    if (!cur.id) return;
    if (!confirm("حذف القالب؟")) return;
    try{
      await deleteDoc(doc(state.db, C.invoiceTemplates, cur.id));
      toast("تم الحذف", "قالب", "ok");
      cur.id=null;
      name.value=""; css.value=""; html.value="";
      refreshPreview();
      await loadList();
    }catch(e){
      toast("تعذر الحذف", e?.message || "", "bad");
    }
  }}, ["حذف"]) : null;

  editorBox.appendChild(el("div", { class:"actions" }, [btnSave, btnNew, btnDel]));
  editorBox.appendChild(el("hr", { class:"hr" }));
  editorBox.appendChild(el("h3", {}, ["المعاينة"]));
  editorBox.appendChild(preview);

  async function loadList() {
    tplList.innerHTML = "";
    const s1 = await getDocs(query(collection(state.db, C.invoiceTemplates), orderBy("createdAt","desc"), limit(80)));
    if (s1.empty) return tplList.appendChild(el("div", { class:"muted" }, ["لا توجد قوالب."]));

    s1.docs.forEach(d => {
      const t = d.data();
      tplList.appendChild(el("div", { class:"card", style:"margin-bottom:10px" }, [
        el("b", {}, [t.name || d.id]),
        el("div", { class:"small" }, [d.id]),
        el("div", { class:"actions", style:"margin-top:8px" }, [
          el("button", { class:"btn", onclick: () => {
            cur.id = d.id;
            name.value = t.name || "";
            css.value = t.css || "";
            html.value = t.html || "";
            refreshPreview();
            toast("تم التحميل", "القالب في المحرر", "ok");
          }}, ["تحميل"]),
        ]),
      ]));
    });
  }

  refreshPreview();
  await loadList();
  return host;
}

/* ---------- Customers / Cars / Employees / Departments (CRUD خفيف) ---------- */
async function pageCustomers() {
  setPageHeader("الزبائن", "CRUD كامل");

  const host = el("div", { class:"grid", style:"gap:14px" });
  const search = el("input", { class:"input", placeholder:"بحث: اسم أو هاتف…" });
  const btnAdd = el("button", { class:"btn primary", onclick: ()=>openCustomerEditor(null) }, ["+ زبون"]);
  const btnReload = el("button", { class:"btn ghost" }, ["تحديث"]);

  const top = el("div", { class:"card" }, [
    el("h3", {}, ["قائمة الزبائن"]),
    el("div", { class:"row" }, [
      el("div", { class:"field" }, [el("label", {}, ["بحث"]), search]),
      el("div", { class:"actions", style:"align-items:flex-end; padding-top:18px" }, [btnAdd, btnReload]),
    ]),
  ]);

  const box = el("div", { class:"card" }, [el("div", { class:"muted" }, ["جارِ التحميل…"])]);

  host.appendChild(top);
  host.appendChild(box);

  let cached = [];

  async function load() {
    box.innerHTML = "";
    box.appendChild(el("div", { class:"muted" }, ["جارِ التحميل…"]));
    try{
      const s1 = await getDocs(query(collection(state.db, C.customers), orderBy("createdAt","desc"), limit(250)));
      cached = s1.docs.map(d => ({ id:d.id, ...d.data() }));
      render();
    }catch(e){
      box.innerHTML = "";
      box.appendChild(el("div", { class:"muted" }, ["فشل: ", e?.message || String(e)]));
    }
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const rows = q ? cached.filter(x => (`${x.name||x.customerName||""} ${x.phone||x.customerPhone||""}`.toLowerCase().includes(q))) : cached;

    const tbl = el("table", { class:"table" }, [
      el("thead", {}, [el("tr", {}, [
        el("th", {}, ["الاسم"]),
        el("th", {}, ["الهاتف"]),
        el("th", {}, ["تاريخ"]),
        el("th", {}, ["إجراءات"]),
      ])]),
      el("tbody"),
    ]);

    const tb = tbl.querySelector("tbody");
    if (!rows.length) tb.appendChild(el("tr", {}, [el("td", { colspan:"4", style:"text-align:center; color:rgba(234,240,255,.7)" }, ["لا يوجد بيانات"])]));
    else {
      rows.forEach(r => {
        tb.appendChild(el("tr", {}, [
          el("td", {}, [el("b", {}, [r.name || r.customerName || "-"])]),
          el("td", {}, [r.phone || r.customerPhone || "-"]),
          el("td", {}, [fmtDate(r.createdAt)]),
          el("td", {}, [
            el("div", { class:"actions" }, [
              el("button", { class:"btn", onclick: ()=>openCustomerEditor(r) }, ["تعديل"]),
              hasPerm(state.profile, "delete") ? el("button", { class:"btn bad", onclick: ()=>deleteCustomer(r.id) }, ["حذف"]) : null,
            ]),
          ]),
        ]));
      });
    }

    box.innerHTML = "";
    box.appendChild(tbl);
  }

  btnReload.onclick = load;
  search.addEventListener("input", render);

  await load();
  return host;
}

function openCustomerEditor(row=null) {
  const isNew = !row;
  const name = el("input", { class:"input", value: row?.name || row?.customerName || "" });
  const phone= el("input", { class:"input", value: row?.phone || row?.customerPhone || "" });

  const body = el("div", { class:"grid" }, [
    el("div", { class:"card" }, [
      el("h3", {}, [isNew ? "زبون جديد" : "تعديل زبون"]),
      el("div", { class:"field" }, [el("label", {}, ["الاسم"]), name]),
      el("div", { class:"field" }, [el("label", {}, ["الهاتف"]), phone]),
    ]),
  ]);

  const btnSave = el("button", { class:"btn primary", onclick: async () => {
    try{
      if (!name.value.trim() || !phone.value.trim()) return toast("الاسم والهاتف مطلوبين", "", "warn");
      btnSave.disabled = true;
      if (isNew) {
        await addDoc(collection(state.db, C.customers), { name:name.value.trim(), phone:phone.value.trim(), createdAt:serverTimestamp(), updatedAt:serverTimestamp() });
      } else {
        await updateDoc(doc(state.db, C.customers, row.id), { name:name.value.trim(), phone:phone.value.trim(), updatedAt:serverTimestamp() });
      }
      toast("تم الحفظ", "", "ok");
      renderRoute();
    }catch(e){
      toast("فشل", e?.message || String(e), "bad");
    }finally{
      btnSave.disabled = false;
    }
  }}, ["حفظ"]);

  openModal("الزبائن", body, [btnSave]);
}

async function deleteCustomer(id) {
  if (!confirm("حذف الزبون؟")) return;
  try{
    await deleteDoc(doc(state.db, C.customers, id));
    toast("تم الحذف", "", "ok");
    renderRoute();
  }catch(e){
    toast("تعذر الحذف", e?.message || "", "bad");
  }
}

async function pageCars() {
  setPageHeader("السيارات", "CRUD + ربط بالزبون");

  const host = el("div", { class:"grid", style:"gap:14px" });
  const search = el("input", { class:"input", placeholder:"بحث: لوحة/موديل/زبون…" });
  const btnReload = el("button", { class:"btn ghost" }, ["تحديث"]);

  const top = el("div", { class:"card" }, [
    el("h3", {}, ["قائمة السيارات"]),
    el("div", { class:"row" }, [
      el("div", { class:"field" }, [el("label", {}, ["بحث"]), search]),
      el("div", { class:"actions", style:"align-items:flex-end; padding-top:18px" }, [btnReload]),
    ]),
  ]);

  const box = el("div", { class:"card" }, [el("div", { class:"muted" }, ["جارِ التحميل…"])]);

  host.appendChild(top);
  host.appendChild(box);

  let cached = [];

  async function load() {
    box.innerHTML = "";
    box.appendChild(el("div", { class:"muted" }, ["جارِ التحميل…"]));
    try{
      const s1 = await getDocs(query(collection(state.db, C.cars), orderBy("createdAt","desc"), limit(250)));
      cached = s1.docs.map(d => ({ id:d.id, ...d.data() }));
      render();
    }catch(e){
      box.innerHTML = "";
      box.appendChild(el("div", { class:"muted" }, ["فشل: ", e?.message || String(e)]));
    }
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const rows = q ? cached.filter(x => (`${x.plate||""} ${x.model||""} ${x.customerName||""}`.toLowerCase().includes(q))) : cached;

    const tbl = el("table", { class:"table" }, [
      el("thead", {}, [el("tr", {}, [
        el("th", {}, ["اللوحة"]),
        el("th", {}, ["الموديل"]),
        el("th", {}, ["السنة"]),
        el("th", {}, ["الزبون"]),
        el("th", {}, ["KM القادم"]),
      ])]),
      el("tbody"),
    ]);

    const tb = tbl.querySelector("tbody");
    if (!rows.length) tb.appendChild(el("tr", {}, [el("td", { colspan:"5", style:"text-align:center; color:rgba(234,240,255,.7)" }, ["لا يوجد بيانات"])]));
    else {
      rows.forEach(r => {
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

  btnReload.onclick = load;
  search.addEventListener("input", render);

  await load();
  return host;
}

/* ---------- Employees / Departments CRUD (سريع) ---------- */
async function crudPageSimple({ title, sub, colName, fields }) {
  setPageHeader(title, sub);

  const host = el("div", { class:"grid", style:"gap:14px" });
  const search = el("input", { class:"input", placeholder:"بحث…" });
  const btnAdd = el("button", { class:"btn primary" }, ["+ إضافة"]);
  const btnReload = el("button", { class:"btn ghost" }, ["تحديث"]);

  const top = el("div", { class:"card" }, [
    el("h3", {}, [title]),
    el("div", { class:"row" }, [
      el("div", { class:"field" }, [el("label", {}, ["بحث"]), search]),
      el("div", { class:"actions", style:"align-items:flex-end; padding-top:18px" }, [btnAdd, btnReload]),
    ]),
  ]);

  const box = el("div", { class:"card" }, [el("div", { class:"muted" }, ["جارِ التحميل…"])]);

  host.appendChild(top);
  host.appendChild(box);

  let cached = [];

  async function load() {
    box.innerHTML = "";
    box.appendChild(el("div", { class:"muted" }, ["جارِ التحميل…"]));
    try{
      const s1 = await getDocs(query(collection(state.db, colName), orderBy("createdAt","desc"), limit(250)));
      cached = s1.docs.map(d => ({ id:d.id, ...d.data() }));
      render();
    }catch(e){
      box.innerHTML = "";
      box.appendChild(el("div", { class:"muted" }, ["فشل: ", e?.message || String(e)]));
    }
  }

  function render() {
    const q = search.value.trim().toLowerCase();
    const rows = q ? cached.filter(x => JSON.stringify(x).toLowerCase().includes(q)) : cached;

    const tbl = el("table", { class:"table" }, [
      el("thead", {}, [el("tr", {}, [
        ...fields.map(f => el("th", {}, [f.label])),
        el("th", {}, ["إجراءات"]),
      ])]),
      el("tbody"),
    ]);

    const tb = tbl.querySelector("tbody");
    if (!rows.length) tb.appendChild(el("tr", {}, [el("td", { colspan:String(fields.length+1), style:"text-align:center; color:rgba(234,240,255,.7)" }, ["لا يوجد بيانات"])]));
    else {
      rows.forEach(r => {
        tb.appendChild(el("tr", {}, [
          ...fields.map(f => el("td", {}, [r[f.key] ?? "-"])),
          el("td", {}, [
            el("div", { class:"actions" }, [
              el("button", { class:"btn", onclick: ()=>openEditor(r) }, ["تعديل"]),
              hasPerm(state.profile, "delete") ? el("button", { class:"btn bad", onclick: ()=>del(r.id) }, ["حذف"]) : null,
            ]),
          ]),
        ]));
      });
    }

    box.innerHTML = "";
    box.appendChild(tbl);
  }

  function openEditor(row=null) {
    const isNew = !row;
    const inputs = {};
    const form = el("div", { class:"grid" }, [
      el("div", { class:"card" }, [
        el("h3", {}, [isNew ? "إضافة" : "تعديل"]),
        ...fields.map(f => {
          const inp = el("input", { class:"input", value: row?.[f.key] ?? "" });
          inputs[f.key] = inp;
          return el("div", { class:"field" }, [el("label", {}, [f.label]), inp]);
        }),
      ]),
    ]);

    const btnSave = el("button", { class:"btn primary", onclick: async () => {
      try{
        btnSave.disabled = true;
        const payload = {};
        fields.forEach(f => payload[f.key] = inputs[f.key].value.trim());
        payload.updatedAt = serverTimestamp();

        if (isNew) {
          payload.createdAt = serverTimestamp();
          await addDoc(collection(state.db, colName), payload);
        } else {
          await updateDoc(doc(state.db, colName, row.id), payload);
        }

        toast("تم الحفظ", "", "ok");
        renderRoute();
      }catch(e){
        toast("فشل", e?.message || "", "bad");
      }finally{
        btnSave.disabled = false;
      }
    }}, ["حفظ"]);

    openModal(title, form, [btnSave]);
  }

  async function del(id) {
    if (!confirm("تأكيد الحذف؟")) return;
    try{
      await deleteDoc(doc(state.db, colName, id));
      toast("تم الحذف", "", "ok");
      renderRoute();
    }catch(e){
      toast("تعذر الحذف", e?.message || "", "bad");
    }
  }

  btnAdd.onclick = ()=>openEditor(null);
  btnReload.onclick = load;
  search.addEventListener("input", render);

  await load();
  return host;
}

async function pageEmployees() {
  return await crudPageSimple({
    title:"الموظفون",
    sub:"إدارة الموظفين (CRUD)",
    colName:C.employees,
    fields:[
      { key:"name", label:"الاسم" },
      { key:"phone", label:"الهاتف" },
      { key:"role", label:"الوظيفة" },
    ],
  });
}
async function pageDepartments() {
  return await crudPageSimple({
    title:"الأقسام",
    sub:"إدارة الأقسام (CRUD)",
    colName:C.departments,
    fields:[
      { key:"name", label:"اسم القسم" },
      { key:"note", label:"ملاحظة" },
    ],
  });
}

/* ---------- Users (Admin) ---------- */
async function pageUsers() {
  if (!hasPerm(state.profile, "manageUsers")) {
    setPageHeader("ممنوع", "لا تملكين صلاحية إدارة المستخدمين");
    return el("div", { class:"card" }, [el("div", { class:"muted" }, ["لا يوجد صلاحية."])]);
  }

  setPageHeader("صلاحيات المستخدمين", "تغيير الدور + صلاحيات خاصة");

  const host = el("div", { class:"grid cols2" });

  const left = el("div", { class:"card" }, [
    el("h3", {}, ["إنشاء مستخدم (Auth)"]),
    el("div", { class:"muted small" }, ["إذا واجهتي مشاكل، أنشئيه من Firebase Console ثم عدلي دوره هنا"]),
    el("hr", { class:"hr" }),
  ]);

  const email = el("input", { class:"input", placeholder:"email@example.com" });
  const pass  = el("input", { class:"input", type:"password", placeholder:"كلمة مرور" });
  const role  = el("select", {}, [
    el("option", { value:"viewer" }, ["viewer"]),
    el("option", { value:"tech" }, ["tech"]),
    el("option", { value:"manager" }, ["manager"]),
    el("option", { value:"admin" }, ["admin"]),
  ]);

  const btnCreate = el("button", { class:"btn primary", onclick: async () => {
    try{
      if (!email.value.trim() || !pass.value) return toast("أكملي البيانات", "", "warn");
      btnCreate.disabled = true;

      // ملاحظة: هذا قد يبدّل جلسة الدخول حسب إعدادات Auth في بعض الحالات.
      const cred = await createUserWithEmailAndPassword(state.auth, email.value.trim(), pass.value);
      const uid = cred.user.uid;

      await setDoc(doc(state.db, C.users, uid), {
        email: email.value.trim(),
        role: role.value,
        permissions: {},
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      toast("تم إنشاء المستخدم", "تم إنشاء حساب + ملف صلاحيات", "ok");
      toast("تنبيه", "قد تحتاجين لإعادة تسجيل دخول الأدمن إذا تبدلت الجلسة", "warn");
      renderRoute();
    }catch(e){
      toast("فشل الإنشاء", e?.message || String(e), "bad");
    }finally{
      btnCreate.disabled = false;
    }
  }}, ["إنشاء"]);

  left.appendChild(el("div", { class:"field" }, [el("label", {}, ["Email"]), email]));
  left.appendChild(el("div", { class:"field" }, [el("label", {}, ["Password"]), pass]));
  left.appendChild(el("div", { class:"field" }, [el("label", {}, ["Role"]), role]));
  left.appendChild(el("div", { class:"actions" }, [btnCreate]));

  const right = el("div", { class:"card" }, [
    el("h3", {}, ["قائمة users"]),
    el("div", { class:"muted small" }, ["تعديل الدور + الصلاحيات الخاصة"]),
    el("hr", { class:"hr" }),
  ]);
  const list = el("div", { class:"muted" }, ["جارِ التحميل…"]);
  right.appendChild(list);

  async function load() {
    list.innerHTML = "";
    const s1 = await getDocs(query(collection(state.db, C.users), orderBy("createdAt","desc"), limit(250)));
    if (s1.empty) return list.appendChild(el("div", { class:"muted" }, ["لا يوجد مستخدمين."]));

    s1.docs.forEach(d => {
      const u = d.data();
      const sel = el("select", {}, [
        el("option", { value:"viewer" }, ["viewer"]),
        el("option", { value:"tech" }, ["tech"]),
        el("option", { value:"manager" }, ["manager"]),
        el("option", { value:"admin" }, ["admin"]),
      ]);
      sel.value = u.role || "viewer";

      // permissions toggles
      const perms = u.permissions || {};
      const permKeys = ["delete","manageUsers","manageSettings","manageUI","techOrders","readAll","writeAll"];
      const boxes = permKeys.map(k => {
        const cb = el("input", { type:"checkbox" });
        cb.checked = perms[k] === true;
        return el("label", { style:"display:flex; gap:8px; align-items:center; font-size:12px; color:rgba(234,240,255,.8)" }, [
          cb, ` ${k}`
        ]);
      });

      const btnSave = el("button", { class:"btn", onclick: async () => {
        try{
          const newPerms = {};
          permKeys.forEach((k,i)=>{
            const checked = boxes[i].querySelector("input").checked;
            // نخليها true إذا مؤشرة، وإذا غير مؤشرة ما نخزن شيء (حتى يرجع للـ role base)
            if (checked) newPerms[k] = true;
          });

          await updateDoc(doc(state.db, C.users, d.id), {
            role: sel.value,
            permissions: newPerms,
            updatedAt: serverTimestamp(),
          });
          toast("تم الحفظ", u.email || d.id, "ok");
        }catch(e){
          toast("فشل", e?.message || "", "bad");
        }
      }}, ["حفظ"]);

      list.appendChild(el("div", { class:"card", style:"margin-bottom:10px" }, [
        el("b", {}, [u.email || d.id]),
        el("div", { class:"small" }, [`uid: ${d.id}`]),
        el("div", { class:"row", style:"margin-top:10px" }, [
          el("div", { class:"field" }, [el("label", {}, ["Role"]), sel]),
          el("div", { class:"field" }, [el("label", {}, ["صلاحيات خاصة (True فقط)"]), el("div", { class:"grid", style:"gap:6px" }, boxes)]),
        ]),
        el("div", { class:"actions", style:"margin-top:10px" }, [btnSave]),
      ]));
    });
  }

  await load();
  host.appendChild(left);
  host.appendChild(right);
  return host;
}

/* ---------- Settings (Admin) ---------- */
async function pageSettings() {
  if (!hasPerm(state.profile, "manageSettings")) {
    setPageHeader("ممنوع", "لا تملكين صلاحية الإعدادات");
    return el("div", { class:"card" }, [el("div", { class:"muted" }, ["لا يوجد صلاحية."])]);
  }

  setPageHeader("الإعدادات", "اسم الورشة + ترقيم الفواتير + ضريبة");

  const s0 = state.settings || {};
  const name = el("input", { class:"input", value: s0.workshopName || "" });
  const phone= el("input", { class:"input", value: s0.workshopPhone || "" });
  const addr = el("input", { class:"input", value: s0.workshopAddress || "" });

  const prefix = el("input", { class:"input", value: s0.invoicePrefix || "RPM-" });
  const padding= el("input", { class:"input", type:"number", value: s0.invoicePadding || 6 });
  const tax    = el("input", { class:"input", type:"number", value: s0.taxPercent || 0 });

  const btnSave = el("button", { class:"btn primary", onclick: async () => {
    try{
      btnSave.disabled = true;
      await setDoc(doc(state.db, C.settings, "app"), {
        workshopName: name.value.trim(),
        workshopPhone: phone.value.trim(),
        workshopAddress: addr.value.trim(),
        invoicePrefix: prefix.value.trim(),
        invoicePadding: Number(padding.value||6),
        taxPercent: Number(tax.value||0),
        updatedAt: serverTimestamp(),
      }, { merge:true });

      toast("تم الحفظ", "", "ok");
      await loadBootstrap();
      renderRoute();
    }catch(e){
      toast("فشل", e?.message || String(e), "bad");
    }finally{
      btnSave.disabled = false;
    }
  }}, ["حفظ"]);

  const btnSeed = el("button", { class:"btn", onclick: async () => {
    try{
      await ensureDefaults();
      toast("تمت تهيئة الافتراضيات", "", "ok");
      await loadBootstrap();
      renderRoute();
    }catch(e){
      toast("فشل", e?.message || String(e), "bad");
    }
  }}, ["تهيئة افتراضيات"]);

  return el("div", { class:"grid", style:"gap:14px" }, [
    el("div", { class:"actions" }, [btnSave, btnSeed]),
    el("div", { class:"grid cols2" }, [
      el("div", { class:"card" }, [
        el("h3", {}, ["بيانات الورشة"]),
        el("div", { class:"field" }, [el("label", {}, ["الاسم"]), name]),
        el("div", { class:"field" }, [el("label", {}, ["الهاتف"]), phone]),
        el("div", { class:"field" }, [el("label", {}, ["العنوان"]), addr]),
      ]),
      el("div", { class:"card" }, [
        el("h3", {}, ["الفواتير"]),
        el("div", { class:"field" }, [el("label", {}, ["Prefix"]), prefix]),
        el("div", { class:"field" }, [el("label", {}, ["Padding"]), padding]),
        el("div", { class:"field" }, [el("label", {}, ["Tax %"]), tax]),
      ]),
    ]),
  ]);
}

/* ---------- UI Pages + Nav Editor (Admin) ---------- */
async function pageUI() {
  if (!hasPerm(state.profile, "manageSettings") && !hasPerm(state.profile, "manageUI")) {
    setPageHeader("ممنوع", "لا تملكين صلاحية الصفحات");
    return el("div", { class:"card" }, [el("div", { class:"muted" }, ["لا يوجد صلاحية."])]);
  }

  setPageHeader("الصفحات + القائمة", "إنشاء صفحات + تعديل عناصر القائمة بدون تعديل الملفات");

  const host = el("div", { class:"grid cols2" });

  // create custom page
  const slug = el("input", { class:"input", placeholder:"slug مثال: offers" });
  const title= el("input", { class:"input", placeholder:"عنوان الصفحة" });
  const html = el("textarea", {}, ["<h2>مرحبا</h2><p>هذه صفحة مخصصة.</p>"]);

  const btnCreatePage = el("button", { class:"btn primary", onclick: async () => {
    try{
      if (!slug.value.trim() || !title.value.trim()) return toast("slug والعنوان مطلوبين", "", "warn");
      btnCreatePage.disabled = true;
      const id = "page_" + slug.value.trim().toLowerCase();
      await setDoc(doc(state.db, C.uiConfig, id), {
        kind:"page",
        slug: slug.value.trim().toLowerCase(),
        title: title.value.trim(),
        type:"html",
        html: html.value,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge:true });

      toast("تم حفظ الصفحة", "", "ok");
      navTo("page", slug.value.trim().toLowerCase());
    }catch(e){
      toast("فشل", e?.message || String(e), "bad");
    }finally{
      btnCreatePage.disabled = false;
    }
  }}, ["حفظ الصفحة"]);

  const left = el("div", { class:"card" }, [
    el("h3", {}, ["إنشاء صفحة مخصصة"]),
    el("div", { class:"field" }, [el("label", {}, ["Slug"]), slug]),
    el("div", { class:"field" }, [el("label", {}, ["Title"]), title]),
    el("div", { class:"field" }, [el("label", {}, ["HTML"]), html]),
    el("div", { class:"actions" }, [btnCreatePage]),
    el("hr", { class:"hr" }),
    el("h3", {}, ["تعديل القائمة (Nav)"]),
    el("div", { class:"muted small" }, ["تضيفي صفحة مخصصة للقائمة بدون لمس الملفات"]),
  ]);

  // nav editor
  const navBox = el("div", { class:"grid", style:"gap:10px" });
  left.appendChild(navBox);

  function navRow(item, idx) {
    const t = el("input", { class:"input", value:item.title || "" });
    const ic= el("input", { class:"input", value:item.icon || "" });
    const sl= el("input", { class:"input", value:item.slug || "" });
    const roles = el("input", { class:"input", value:(item.roles||[]).join(",") , placeholder:"admin,manager,tech,viewer" });

    const btnUp = el("button", { class:"btn ghost", onclick: ()=>move(idx, -1) }, ["↑"]);
    const btnDn = el("button", { class:"btn ghost", onclick: ()=>move(idx, +1) }, ["↓"]);
    const btnDel= el("button", { class:"btn bad", onclick: ()=>remove(idx) }, ["حذف"]);

    return el("div", { class:"card" }, [
      el("div", { class:"row" }, [
        el("div", { class:"field" }, [el("label", {}, ["Title"]), t]),
        el("div", { class:"field" }, [el("label", {}, ["Icon"]), ic]),
      ]),
      el("div", { class:"row" }, [
        el("div", { class:"field" }, [el("label", {}, ["Slug"]), sl]),
        el("div", { class:"field" }, [el("label", {}, ["Roles (comma)"]), roles]),
      ]),
      el("div", { class:"actions" }, [
        btnUp, btnDn, btnDel,
        el("button", { class:"btn", onclick: ()=>saveRow(idx, { title:t.value, icon:ic.value, slug:sl.value, roles:roles.value }) }, ["تطبيق"]),
      ]),
    ]);
  }

  function renderNavEditor() {
    navBox.innerHTML = "";
    const nav = (state.ui?.nav || []);
    nav.forEach((it, idx) => navBox.appendChild(navRow(it, idx)));

    navBox.appendChild(el("div", { class:"actions" }, [
      el("button", { class:"btn", onclick: ()=>addNavItem() }, ["+ إضافة عنصر للقائمة"]),
      el("button", { class:"btn primary", onclick: ()=>saveNavToFirestore() }, ["حفظ القائمة بالكامل"]),
    ]));
  }

  function addNavItem() {
    state.ui.nav = state.ui.nav || [];
    state.ui.nav.push({ slug:"page/offers", title:"صفحة جديدة", icon:"🧩", roles:["admin","manager","tech","viewer"] });
    renderNavEditor();
  }

  function saveRow(idx, v) {
    const roles = v.roles.split(",").map(x=>x.trim()).filter(Boolean);
    state.ui.nav[idx] = { ...state.ui.nav[idx], title:v.title.trim(), icon:v.icon.trim(), slug:v.slug.trim(), roles };
    renderNavEditor();
  }

  function move(idx, dir) {
    const nav = state.ui.nav || [];
    const j = idx + dir;
    if (j < 0 || j >= nav.length) return;
    const tmp = nav[idx];
    nav[idx] = nav[j];
    nav[j] = tmp;
    renderNavEditor();
  }

  function remove(idx) {
    state.ui.nav.splice(idx, 1);
    renderNavEditor();
  }

  async function saveNavToFirestore() {
    try{
      await setDoc(doc(state.db, C.uiConfig, "app"), {
        nav: state.ui.nav || [],
        updatedAt: serverTimestamp(),
      }, { merge:true });
      toast("تم حفظ القائمة", "", "ok");
      await loadBootstrap();
      renderShell(); // يعيد بناء القائمة
    }catch(e){
      toast("فشل", e?.message || "", "bad");
    }
  }

  const right = el("div", { class:"card" }, [
    el("h3", {}, ["الصفحات الموجودة"]),
    el("div", { class:"muted small" }, ["تفتح عبر: #/page/<slug>"]),
    el("hr", { class:"hr" }),
  ]);
  const pagesList = el("div", { class:"muted" }, ["جارِ التحميل…"]);
  right.appendChild(pagesList);

  async function loadPages() {
    pagesList.innerHTML = "";
    const s1 = await getDocs(query(collection(state.db, C.uiConfig), where("kind","==","page"), limit(120)));
    if (s1.empty) return pagesList.appendChild(el("div", { class:"muted" }, ["لا توجد صفحات."]));
    s1.docs.forEach(d => {
      const p = d.data();
      pagesList.appendChild(el("div", { class:"card", style:"margin-bottom:10px" }, [
        el("b", {}, [p.title || p.slug || d.id]),
        el("div", { class:"small" }, [`slug: ${p.slug}`]),
        el("div", { class:"actions", style:"margin-top:8px" }, [
          el("button", { class:"btn", onclick: ()=>navTo("page", p.slug) }, ["فتح"]),
          hasPerm(state.profile, "delete") ? el("button", { class:"btn bad", onclick: async ()=>{
            if (!confirm("حذف الصفحة؟")) return;
            await deleteDoc(doc(state.db, C.uiConfig, d.id));
            toast("تم الحذف", "", "ok");
            loadPages();
          }}, ["حذف"]) : null,
        ]),
      ]));
    });
  }

  // اجلب ui الحالية
  if (!state.ui) await loadBootstrap();
  renderNavEditor();
  await loadPages();

  host.appendChild(left);
  host.appendChild(right);
  return host;
}

async function pageCustom(slug) {
  setPageHeader("صفحة مخصصة", slug);

  const id = "page_" + slug;
  const s1 = await getDoc(doc(state.db, C.uiConfig, id));
  if (!s1.exists()) {
    return el("div", { class:"card" }, [
      el("h3", {}, ["غير موجودة"]),
      el("div", { class:"muted" }, ["لا توجد صفحة بهذا الـ slug."]),
    ]);
  }
  const p = s1.data();
  setPageHeader(p.title || "صفحة", p.slug || "");
  return el("div", { class:"card" }, [el("div", { html: p.html || "" })]);
}

/* ---------- Route Renderer ---------- */
async function renderRoute() {
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
    else if (slug === "invoices") page.appendChild(await pageInvoices());
    else if (slug === "templates") page.appendChild(await pageTemplates());
    else if (slug === "customers") page.appendChild(await pageCustomers());
    else if (slug === "cars") page.appendChild(await pageCars());
    else if (slug === "employees") page.appendChild(await pageEmployees());
    else if (slug === "departments") page.appendChild(await pageDepartments());
    else if (slug === "users") page.appendChild(await pageUsers());
    else if (slug === "ui") page.appendChild(await pageUI());
    else if (slug === "settings") page.appendChild(await pageSettings());
    else if (slug === "page") page.appendChild(await pageCustom(id || ""));
    else {
      setPageHeader("غير معروف", slug);
      page.appendChild(el("div", { class:"card" }, [el("div", { class:"muted" }, ["الصفحة غير موجودة."])]));
    }
  }catch(e){
    page.innerHTML = "";
    page.appendChild(el("div", { class:"card" }, [
      el("h3", {}, ["حصل خطأ"]),
      el("div", { class:"muted" }, [e?.message || String(e)]),
      el("hr", { class:"hr" }),
      el("div", { class:"muted small" }, ["إذا الخطأ Permission Denied: راجعي Firestore Rules والصلاحيات."]),
    ]));
  }
}

/* ---------- Profile Loader ---------- */
async function loadProfile(uid, email) {
  const ref = doc(state.db, C.users, uid);
  const s1 = await getDoc(ref);
  if (s1.exists()) return { id:s1.id, ...s1.data() };

  // إذا ما موجود: ننشئ Viewer افتراضي
  await setDoc(ref, {
    email: email || "",
    role: "viewer",
    permissions: {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge:true });

  return { id: uid, email: email || "", role:"viewer", permissions:{} };
}

/* ---------- Init ---------- */
async function init() {
  state.app = initializeApp(firebaseConfig);
  state.auth = getAuth(state.app);
  state.db = getFirestore(state.app);

  onAuthStateChanged(state.auth, async (user) => {
    state.user = user || null;
    state.profile = null;
    clearLive();

    if (!user) {
      renderAuth();
      return;
    }

    try{
      await loadBootstrap();
      state.profile = await loadProfile(user.uid, user.email);
      renderShell();
      toast("أهلاً", `تم تسجيل الدخول: ${user.email}`, "ok");
    }catch(e){
      toast("خطأ", e?.message || String(e), "bad");
      renderAuth();
    }
  });

  window.addEventListener("hashchange", () => {
    if (state.user) {
      refreshActiveNav();
      renderRoute();
    }
  });
}

init();
