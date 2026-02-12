/* RPM — Workshop ERP (Firestore-first)
   =========================================================
   ✅ Features:
   - SPA hash router (GitHub Pages friendly)
   - Auth (email/password)
   - Roles & Permissions (admin/manager/tech/viewer + custom overrides)
   - Orders (work orders) + Auto-create Customer & Car
   - Oil Change page (fast workflow) + update car KM next
   - Invoices CRUD + invoice numbering via meta/invoiceCounter (transaction)
   - Invoice Templates CRUD + live preview + print
   - Admin: Users, Employees, Departments, Settings, UI Pages (editable without touching code)
   - Reads/writes from Firestore collections you listed:
     cars, customers, departments, employees, invoiceTemplates, invoices,
     meta, orders, settings, uiConfig, users

   ⚠️ IMPORTANT:
   - Put your apiKey below.
   - Ensure Firestore rules allow according to roles (client-side checks are NOT enough).
*/

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  runTransaction,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* ---------- Firebase Config (fill apiKey!) ---------- */
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
  version: "2026.02.12",
};

/* ---------- DOM Helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const el = (tag, attrs = {}, children = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) n.setAttribute(k, v);
  }
  for (const c of (children || [])) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  return n;
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* ---------- Toast ---------- */
const toastHost = () => $("#toastHost");
function toast(title, msg = "", type = "ok") {
  const t = el("div", { class: `toast ${type}` }, [
    el("div", { class: "t" }, [title]),
    msg ? el("div", { class: "s" }, [msg]) : el("div")
  ]);
  toastHost()?.appendChild(t);
  setTimeout(() => t.remove(), 4200);
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

/* ---------- Format ---------- */
function tsToDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "string") return new Date(v);
  if (typeof v === "number") return new Date(v);
  if (typeof v === "object" && typeof v.toDate === "function") return v.toDate(); // Firestore Timestamp
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
function safeStr(x) { return (x ?? "").toString(); }

/* ---------- Tiny Template Engine (supports {{var}} + {{#items}}...{{/items}} ) ---------- */
function renderTemplate(tpl, data) {
  if (!tpl) return "";
  // loops
  tpl = tpl.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, inner) => {
    const arr = data?.[key];
    if (!Array.isArray(arr)) return "";
    return arr.map(item => renderTemplate(inner, { ...data, ...item })).join("");
  });

  // variables
  tpl = tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const v = data?.[key];
    return v === undefined || v === null ? "" : String(v);
  });

  return tpl;
}

/* ---------- Permissions ---------- */
const ROLE_MATRIX = {
  admin:   { readAll: true, writeAll: true, manageUsers: true, manageSettings: true, delete: true },
  manager: { readAll: true, writeAll: true, manageUsers: false, manageSettings: false, delete: false },
  tech:    { readAll: false, writeAll: false, techOrders: true, delete: false },
  viewer:  { readAll: true, writeAll: false, delete: false },
};

function hasPerm(userProfile, perm) {
  if (!userProfile) return false;
  const role = userProfile.role || "viewer";
  const base = ROLE_MATRIX[role] || ROLE_MATRIX.viewer;
  const overrides = userProfile.permissions || {};
  if (overrides[perm] === true) return true;
  if (overrides[perm] === false) return false;
  return !!base[perm];
}

/* ---------- App State ---------- */
const state = {
  app: null,
  auth: null,
  db: null,
  user: null,          // firebase user
  profile: null,       // users/{uid}
  settings: null,      // settings/app
  uiConfig: null,      // uiConfig/app
  unsub: [],
};

/* ---------- Firestore Access Layer ---------- */
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

async function getSettings() {
  const ref = doc(state.db, C.settings, "app");
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}
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
        { slug: "dashboard", title: "لوحة التحكم", icon: "📊", roles: ["admin","manager","tech","viewer"] },
        { slug: "orders", title: "أوامر الشغل", icon: "🧾", roles: ["admin","manager","tech"] },
        { slug: "oil", title: "تبديل دهن", icon: "🛢️", roles: ["admin","manager","tech"] },
        { slug: "invoices", title: "الفواتير", icon: "🧾", roles: ["admin","manager"] },
        { slug: "templates", title: "قوالب الفواتير", icon: "🧩", roles: ["admin","manager"] },
        { slug: "customers", title: "الزبائن", icon: "👤", roles: ["admin","manager","tech"] },
        { slug: "cars", title: "السيارات", icon: "🚗", roles: ["admin","manager","tech"] },
        { slug: "employees", title: "الموظفون", icon: "👷", roles: ["admin","manager"] },
        { slug: "departments", title: "الأقسام", icon: "🏷️", roles: ["admin","manager"] },
        { slug: "users", title: "صلاحيات المستخدمين", icon: "🛡️", roles: ["admin"] },
        { slug: "ui", title: "صفحات مخصّصة", icon: "🧱", roles: ["admin"] },
        { slug: "settings", title: "الإعدادات", icon: "⚙️", roles: ["admin"] },
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

  // default invoice template (only if none exists)
  const tQ = query(collection(state.db, C.invoiceTemplates), limit(1));
  const tS = await getDocs(tQ);
  if (tS.empty) {
    await addDoc(collection(state.db, C.invoiceTemplates), {
      name: "فاتورة — افتراضي",
      css: `
        body{ font-family: Tahoma, Arial; direction: rtl; padding:18px; }
        h2{ margin:0 0 6px 0; }
        hr{ margin:10px 0; }
        .grid{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .box h3{ margin:0 0 6px 0; font-size:14px; }
        table{ width:100%; border-collapse:collapse; margin-top:12px; }
        th,td{ border:1px solid #ddd; padding:8px; text-align:right; }
        th{ background:#f5f5f5; }
        .tot{ margin-top:10px; display:flex; justify-content:flex-end; gap:16px; }
      `,
      html: `
        <h2>فاتورة خدمة — {{serviceTitle}}</h2>
        <div style="color:#555; font-size:12px">رقم الفاتورة: <b>{{invoiceNo}}</b> • التاريخ: {{date}}</div>
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
          <div>المجموع: <b>{{totalFmt}}</b></div>
        </div>
      `,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      isDefault: true,
    });
  }
}

/* ---------- Invoice No generator (transaction) ---------- */
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

/* ---------- Ensure Customer & Car (auto-create) ---------- */
async function ensureCustomerAndCar({ customerName, customerPhone, plate, model, year }) {
  const name = safeStr(customerName).trim();
  const phone = safeStr(customerPhone).trim();
  const carPlate = safeStr(plate).trim();
  const carModel = safeStr(model).trim();
  const carYear = year ? Number(year) : null;

  if (!name || !phone) throw new Error("اسم الزبون ورقم الهاتف مطلوبين");
  if (!carPlate) throw new Error("لوحة السيارة مطلوبة");

  // Find / create customer by phone
  let customerId = null;
  {
    const q1 = query(collection(state.db, C.customers), where("phone", "==", phone), limit(1));
    const s1 = await getDocs(q1);
    if (!s1.empty) {
      const d = s1.docs[0];
      customerId = d.id;
      // keep name updated softly
      const curName = safeStr(d.data().name || d.data().customerName);
      if (curName !== name) await updateDoc(doc(state.db, C.customers, customerId), { name, updatedAt: serverTimestamp() });
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

  // Find / create car by plate (unique-ish)
  let carId = null;
  {
    const q2 = query(collection(state.db, C.cars), where("plate", "==", carPlate), limit(1));
    const s2 = await getDocs(q2);
    if (!s2.empty) {
      const d = s2.docs[0];
      carId = d.id;
      // merge update (don’t overwrite blindly)
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

/* ---------- UI: Router ---------- */
function route() {
  const h = (location.hash || "#/dashboard").replace("#/", "");
  const [slug, id] = h.split("/");
  return { slug: slug || "dashboard", id: id || null };
}
function navTo(slug, id = null) {
  location.hash = `#/${slug}${id ? "/" + id : ""}`;
}

/* ---------- Render: Auth ---------- */
function renderAuth() {
  const root = $("#app");
  root.innerHTML = "";

  const email = el("input", { class: "input", type: "email", placeholder: "البريد الإلكتروني" });
  const pass = el("input", { class: "input", type: "password", placeholder: "كلمة المرور" });

  const btnLogin = el("button", {
    class: "btn primary",
    onclick: async () => {
      try {
        btnLogin.disabled = true;
        await signInWithEmailAndPassword(state.auth, email.value.trim(), pass.value);
        toast("تم تسجيل الدخول", "أهلاً بك", "ok");
      } catch (e) {
        toast("فشل تسجيل الدخول", e?.message || "تحقق من البيانات", "bad");
      } finally {
        btnLogin.disabled = false;
      }
    }
  }, ["تسجيل الدخول"]);

  const btnReset = el("button", {
    class: "btn ghost",
    onclick: async () => {
      const v = email.value.trim();
      if (!v) return toast("اكتب البريد أولاً", "", "warn");
      try {
        await sendPasswordResetEmail(state.auth, v);
        toast("تم إرسال رابط إعادة التعيين", "تحقق من بريدك", "ok");
      } catch (e) {
        toast("تعذر الإرسال", e?.message || "", "bad");
      }
    }
  }, ["نسيت كلمة المرور"]);

  const card = el("div", { class: "authCard" }, [
    el("div", { class: "authHead" }, [
      el("div", { class: "badgeLogo" }, ["RPM"]),
      el("div", {}, [
        el("b", {}, ["تسجيل الدخول"]),
        el("span", {}, ["ورشـة صيانة سيارات — نظام إدارة شامل"])
      ])
    ]),
    el("div", { class: "field" }, [el("label", {}, ["البريد الإلكتروني"]), email]),
    el("div", { class: "field" }, [el("label", {}, ["كلمة المرور"]), pass]),
    el("div", { class: "actions" }, [btnLogin, btnReset]),
    el("hr", { class: "hr" }),
    el("div", { class: "muted" }, [
      "إذا أول مرة تستخدمين النظام: سجّلي مستخدم من Firebase Console أو فعّلي إنشاء مستخدم من الأدمن لاحقاً."
    ])
  ]);

  root.appendChild(el("div", { class: "authWrap" }, [card]));
}

/* ---------- Render: Shell ---------- */
function iconText(x) { return x || "•"; }

function canSeeNavItem(item) {
  const role = state.profile?.role || "viewer";
  const roles = item.roles || ["admin","manager","tech","viewer"];
  return roles.includes(role);
}

function renderShell() {
  const root = $("#app");
  root.innerHTML = "";

  const sidebar = el("aside", { class: "sidebar", id: "sidebar" }, []);
  const main = el("main", { class: "main" }, []);
  const shell = el("div", { class: "shell" }, [sidebar, main]);
  root.appendChild(shell);

  // Sidebar content
  const brand = el("div", { class: "brand" }, [
    el("div", { class: "brandLeft" }, [
      el("div", { class: "brandBadge" }, ["RPM"]),
      el("div", {}, [
        el("div", { class: "brandTitle" }, [state.uiConfig?.brandName || APP.name]),
        el("div", { class: "brandSub" }, [APP.subtitle]),
      ])
    ]),
    el("button", { class: "btn ghost", id: "btnCloseSide", onclick: () => sidebar.classList.remove("open") }, ["✕"])
  ]);
  sidebar.appendChild(brand);

  const nav = el("nav", { class: "nav", id: "nav" }, []);
  sidebar.appendChild(nav);

  const userLine = el("div", { class: "userLine" }, [
    el("div", { class: "userMeta" }, [
      el("b", {}, [state.user?.email || ""]),
      el("span", {}, [`الدور: ${state.profile?.role || "viewer"}`]),
    ]),
    el("button", { class: "btn ghost", onclick: () => signOut(state.auth) }, ["خروج"])
  ]);

  sidebar.appendChild(el("div", { class: "sideFoot" }, [userLine]));

  // Build nav
  const items = (state.uiConfig?.nav || []).filter(canSeeNavItem);
  for (const it of items) {
    const a = el("a", {
      href: `#/${it.slug}`,
      onclick: () => { if (window.innerWidth <= 980) sidebar.classList.remove("open"); }
    }, [
      el("span", {}, [`${iconText(it.icon)} ${it.title}`]),
      it.tag ? el("span", { class: "tag" }, [it.tag]) : el("span")
    ]);
    nav.appendChild(a);
  }

  // Mobile open
  const topbar = el("div", { class: "topbar" }, [
    el("div", { class: "topbarRow" }, [
      el("div", {}, [
        el("div", { class: "hTitle", id: "pageTitle" }, ["..."]),
        el("div", { class: "hSub", id: "pageSub" }, [""]),
      ]),
      el("div", { class: "actions" }, [
        el("button", { class: "btn ghost", onclick: () => sidebar.classList.add("open") }, ["☰"]),
        el("button", { class: "btn primary", onclick: () => navTo("orders") }, ["+ أمر شغل"]),
        el("button", { class: "btn ok", onclick: () => navTo("oil") }, ["+ تبديل دهن"]),
      ])
    ])
  ]);

  main.appendChild(topbar);
  main.appendChild(el("div", { id: "page" }, []));

  refreshActiveNav();
  renderRoute();
}

function refreshActiveNav() {
  const { slug } = route();
  $$(".nav a").forEach(a => a.classList.toggle("active", a.getAttribute("href") === `#/${slug}`));
}

/* ---------- Page Helpers ---------- */
function setPageHeader(title, sub = "") {
  $("#pageTitle").textContent = title;
  $("#pageSub").textContent = sub;
}

/* ---------- Live Queries (unsubscribe safe) ---------- */
function clearLive() {
  for (const u of state.unsub) try { u(); } catch {}
  state.unsub = [];
}

/* =========================================================
   PAGES
========================================================= */

async function pageDashboard() {
  setPageHeader("لوحة التحكم", "نظرة سريعة على الورشة");

  const wrap = el("div", { class: "grid cols3" }, []);

  const cardKpis = el("div", { class: "card" }, [
    el("h3", {}, ["مؤشرات اليوم"]),
    el("div", { class: "muted" }, ["آخر 24 ساعة (تقريباً)"]),
    el("hr", { class: "hr" }),
    el("div", { class: "grid cols3" }, [
      kpiBox("أوامر جديدة", "..."),
      kpiBox("فواتير", "..."),
      kpiBox("إيراد", "..."),
    ])
  ]);

  const cardQuick = el("div", { class: "card" }, [
    el("h3", {}, ["إجراءات سريعة"]),
    el("div", { class: "actions" }, [
      el("button", { class: "btn primary", onclick: () => navTo("orders") }, ["أوامر الشغل"]),
      el("button", { class: "btn ok", onclick: () => navTo("oil") }, ["تبديل دهن"]),
      el("button", { class: "btn", onclick: () => navTo("invoices") }, ["الفواتير"]),
      hasPerm(state.profile, "manageUsers")
        ? el("button", { class: "btn", onclick: () => navTo("users") }, ["صلاحيات المستخدمين"])
        : el("span"),
    ])
  ]);

  const cardLive = el("div", { class: "card" }, [
    el("h3", {}, ["أحدث أوامر الشغل"]),
    el("div", { class: "muted" }, ["عرض مباشر — آخر 20 أمر"]),
    el("div", { html: "<div class='muted'>جارِ التحميل…</div>" , style:"margin-top:10px;" })
  ]);

  wrap.appendChild(cardKpis);
  wrap.appendChild(cardQuick);
  wrap.appendChild(cardLive);

  // Live orders
  const listHost = cardLive.lastChild;
  clearLive();
  const q1 = query(collection(state.db, C.orders), orderBy("createdAt", "desc"), limit(20));
  const unsub = onSnapshot(q1, (snap) => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    listHost.innerHTML = "";
    listHost.appendChild(renderOrdersTable(rows, { compact: true }));
  }, (err) => {
    listHost.innerHTML = "";
    listHost.appendChild(el("div", { class:"muted" }, [
      "فشل قراءة البيانات. تأكد من Firestore Rules ووجود صلاحيات.",
      " ",
      String(err?.message || err)
    ]));
  });
  state.unsub.push(unsub);

  // KPI counts (simple getDocs)
  try {
    const invQ = query(collection(state.db, C.invoices), orderBy("createdAt","desc"), limit(50));
    const ordQ = query(collection(state.db, C.orders), orderBy("createdAt","desc"), limit(50));
    const [invS, ordS] = await Promise.all([getDocs(invQ), getDocs(ordQ)]);
    const invCount = invS.size;
    const ordCount = ordS.size;
    const revenue = invS.docs.reduce((a,d)=>a+Number(d.data().total||0),0);

    const kpis = $$(".kpi .n", cardKpis);
    if (kpis[0]) kpis[0].textContent = ordCount.toString();
    if (kpis[1]) kpis[1].textContent = invCount.toString();
    if (kpis[2]) kpis[2].textContent = (Number(revenue||0).toLocaleString("ar-IQ")) + " " + APP.currency;
  } catch (e) {
    // ignore
  }

  return wrap;
}
function kpiBox(label, value) {
  return el("div", { class:"kpi" }, [
    el("div", { class:"n" }, [value]),
    el("div", { class:"l" }, [label]),
  ]);
}

/* ---------- Orders Page ---------- */
async function pageOrders() {
  setPageHeader("أوامر الشغل", "إنشاء / تعديل / متابعة");

  const host = el("div", { class:"grid", style:"gap:16px" }, []);

  const top = el("div", { class:"card" }, [
    el("h3", {}, ["قائمة أوامر الشغل"]),
    el("div", { class:"muted" }, ["فلترة سريعة + إنشاء أمر جديد"]),
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

  const btnNew = el("button", { class:"btn primary", onclick: () => openOrderEditor() }, ["+ أمر شغل جديد"]);
  const btnRefresh = el("button", { class:"btn ghost", onclick: () => loadOnce() }, ["تحديث"]);

  top.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field" }, [el("label", {}, ["بحث"]), search]),
    el("div", { class:"field" }, [el("label", {}, ["الحالة"]), status]),
    el("div", { class:"actions", style:"align-items:flex-end; padding-top:18px" }, [btnNew, btnRefresh]),
  ]));

  const tableBox = el("div", { class:"card" }, [
    el("div", { class:"muted" }, ["جارِ التحميل…"]),
  ]);

  host.appendChild(top);
  host.appendChild(tableBox);

  async function loadOnce() {
    tableBox.innerHTML = "";
    tableBox.appendChild(el("div", { class:"muted" }, ["جارِ التحميل…"]));
    try {
      const q1 = query(collection(state.db, C.orders), orderBy("createdAt","desc"), limit(120));
      const s1 = await getDocs(q1);
      const rows = s1.docs.map(d => ({ id:d.id, ...d.data() }));
      render(rows);
    } catch (e) {
      tableBox.innerHTML = "";
      tableBox.appendChild(el("div", { class:"muted" }, ["فشل التحميل: ", String(e?.message || e)]));
    }
  }

  function render(rows) {
    const q = search.value.trim();
    const st = status.value;

    let filtered = rows;
    if (st) filtered = filtered.filter(x => (x.status || "open") === st);
    if (q) {
      filtered = filtered.filter(x => {
        const s = `${x.customerName||""} ${x.customerPhone||""} ${x.carPlate||x.plate||""} ${x.carModel||x.model||""}`.toLowerCase();
        return s.includes(q.toLowerCase());
      });
    }

    tableBox.innerHTML = "";
    tableBox.appendChild(renderOrdersTable(filtered, {
      onOpen: (id) => openOrderEditor(id)
    }));
  }

  search.addEventListener("input", () => loadOnce());
  status.addEventListener("change", () => loadOnce());

  await loadOnce();
  return host;
}

function statusBadge(s) {
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

function renderOrdersTable(rows, opts={}) {
  const onOpen = opts.onOpen || ((id)=>navTo("orders", id));
  const compact = !!opts.compact;

  const tbl = el("table", { class:"table" }, [
    el("thead", {}, [
      el("tr", {}, [
        el("th", {}, ["التاريخ"]),
        el("th", {}, ["الزبون"]),
        el("th", {}, ["السيارة"]),
        el("th", {}, ["الحالة"]),
        el("th", {}, ["إجراءات"]),
      ])
    ]),
    el("tbody")
  ]);

  const tb = tbl.querySelector("tbody");

  if (!rows.length) {
    tb.appendChild(el("tr", {}, [
      el("td", { colspan:"5", style:"text-align:center; color:rgba(234,240,255,.7)" }, ["لا يوجد بيانات"])
    ]));
    return tbl;
  }

  for (const r of rows) {
    const car = r.carPlate || r.plate || "-";
    const model = r.carModel || r.model || "";
    const c = `${car}${model ? " — " + model : ""}`;

    const actions = el("div", { class:"actions" }, [
      el("button", { class:"btn", onclick: () => onOpen(r.id) }, ["فتح"]),
      !compact && hasPerm(state.profile, "delete")
        ? el("button", { class:"btn bad", onclick: () => deleteOrder(r.id) }, ["حذف"])
        : el("span")
    ]);

    tb.appendChild(el("tr", {}, [
      el("td", {}, [fmtDate(r.createdAt)]),
      el("td", {}, [
        el("div", {}, [el("b", {}, [r.customerName || "-"])]),
        el("div", { class:"muted", style:"font-size:12px" }, [r.customerPhone || ""])
      ]),
      el("td", {}, [c]),
      el("td", {}, [statusBadge(r.status)]),
      el("td", {}, [actions]),
    ]));
  }
  return tbl;
}

async function deleteOrder(id) {
  if (!confirm("تأكيد حذف أمر الشغل؟")) return;
  try {
    await deleteDoc(doc(state.db, C.orders, id));
    toast("تم الحذف", "أمر الشغل", "ok");
    renderRoute();
  } catch (e) {
    toast("تعذر الحذف", e?.message || "", "bad");
  }
}

/* ---------- Order Editor ---------- */
async function openOrderEditor(orderId=null) {
  const isNew = !orderId;
  const data = isNew ? {
    type: "general",
    status: "open",
    customerName: "",
    customerPhone: "",
    plate: "",
    model: "",
    year: "",
    notes: "",
    services: [],
    parts: [],
  } : await (async ()=>{
    const s = await getDoc(doc(state.db, C.orders, orderId));
    return s.exists() ? { id:s.id, ...s.data() } : null;
  })();

  if (!data) return toast("غير موجود", "لم يتم العثور على أمر الشغل", "warn");

  const title = isNew ? "أمر شغل جديد" : "تعديل أمر شغل";

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

  // Services list (simple)
  const serviceName = el("input", { class:"input", placeholder:"اسم الخدمة (مثال: تصليح مكابح)" });
  const servicePrice = el("input", { class:"input", type:"number", placeholder:"سعر الخدمة" });
  const btnAddService = el("button", { class:"btn", onclick: () => {
    const n = serviceName.value.trim(); const p = Number(servicePrice.value||0);
    if (!n) return;
    data.services = data.services || [];
    data.services.push({ name:n, price:p });
    serviceName.value=""; servicePrice.value="";
    renderServices();
  }}, ["إضافة خدمة"]);

  const servicesBox = el("div", {}, []);
  function renderServices() {
    servicesBox.innerHTML = "";
    const list = (data.services || []);
    if (!list.length) {
      servicesBox.appendChild(el("div", { class:"muted" }, ["لا توجد خدمات بعد."]));
      return;
    }
    const t = el("table", { class:"table" }, [
      el("thead", {}, [el("tr", {}, [el("th", {}, ["الخدمة"]), el("th", {}, ["السعر"]), el("th", {}, [""])])]),
      el("tbody")
    ]);
    for (let i=0;i<list.length;i++){
      const s = list[i];
      t.querySelector("tbody").appendChild(el("tr", {}, [
        el("td", {}, [s.name]),
        el("td", {}, [fmtMoney(s.price||0)]),
        el("td", {}, [
          el("button", { class:"btn bad", onclick: () => { list.splice(i,1); renderServices(); }}, ["حذف"])
        ])
      ]));
    }
    servicesBox.appendChild(t);
  }

  // Parts list
  const partName = el("input", { class:"input", placeholder:"قطعة / وصف" });
  const partQty = el("input", { class:"input", type:"number", placeholder:"الكمية", value:"1" });
  const partPrice = el("input", { class:"input", type:"number", placeholder:"السعر" });
  const btnAddPart = el("button", { class:"btn", onclick: () => {
    const n = partName.value.trim(); const q = Number(partQty.value||1); const p=Number(partPrice.value||0);
    if (!n) return;
    data.parts = data.parts || [];
    data.parts.push({ name:n, qty:q, price:p });
    partName.value=""; partQty.value="1"; partPrice.value="";
    renderParts();
  }}, ["إضافة قطعة"]);

  const partsBox = el("div", {}, []);
  function renderParts() {
    partsBox.innerHTML = "";
    const list = (data.parts || []);
    if (!list.length) {
      partsBox.appendChild(el("div", { class:"muted" }, ["لا توجد قطع بعد."]));
      return;
    }
    const t = el("table", { class:"table" }, [
      el("thead", {}, [el("tr", {}, [el("th", {}, ["القطعة"]), el("th", {}, ["كمية"]), el("th", {}, ["سعر"]), el("th", {}, [""])])]),
      el("tbody")
    ]);
    for (let i=0;i<list.length;i++){
      const p = list[i];
      t.querySelector("tbody").appendChild(el("tr", {}, [
        el("td", {}, [p.name]),
        el("td", {}, [String(p.qty||1)]),
        el("td", {}, [fmtMoney(p.price||0)]),
        el("td", {}, [
          el("button", { class:"btn bad", onclick: () => { list.splice(i,1); renderParts(); }}, ["حذف"])
        ])
      ]));
    }
    partsBox.appendChild(t);
  }

  renderServices();
  renderParts();

  const calcTotal = () => {
    const s = (data.services||[]).reduce((a,x)=>a+Number(x.price||0),0);
    const p = (data.parts||[]).reduce((a,x)=>a+(Number(x.price||0)*Number(x.qty||1)),0);
    return s+p;
  };

  const totalBox = el("div", { class:"card" }, [
    el("h3", {}, ["المجموع التقريبي"]),
    el("div", { class:"kpi" }, [
      el("div", { class:"n", id:"orderTotal" }, [fmtMoney(calcTotal())]),
      el("div", { class:"l" }, ["خدمات + قطع"])
    ])
  ]);

  function refreshTotal(){
    $("#orderTotal", totalBox).textContent = fmtMoney(calcTotal());
  }

  const body = el("div", { class:"grid", style:"gap:14px" }, [
    el("div", { class:"card" }, [
      el("h3", {}, ["بيانات الزبون والسيارة (صفحة واحدة)"]),
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
        el("div", { class:"actions", style:"align-items:flex-end; padding-top:18px" }, [btnAddService]),
      ]),
      servicesBox
    ]),

    el("div", { class:"card" }, [
      el("h3", {}, ["القطع / قطع الغيار"]),
      el("div", { class:"row" }, [
        el("div", { class:"field" }, [el("label", {}, ["الوصف"]), partName]),
        el("div", { class:"field" }, [el("label", {}, ["الكمية"]), partQty]),
        el("div", { class:"field" }, [el("label", {}, ["السعر"]), partPrice]),
        el("div", { class:"actions", style:"align-items:flex-end; padding-top:18px" }, [btnAddPart]),
      ]),
      partsBox
    ]),

    totalBox
  ]);

  // auto total update
  const mo = new MutationObserver(refreshTotal);
  mo.observe(servicesBox, { childList:true, subtree:true });
  mo.observe(partsBox, { childList:true, subtree:true });

  const btnSave = el("button", { class:"btn primary", onclick: async () => {
    try {
      btnSave.disabled = true;

      // auto-create customer & car
      const { customerId, carId } = await ensureCustomerAndCar({
        customerName: fName.value,
        customerPhone: fPhone.value,
        plate: fPlate.value,
        model: fModel.value,
        year: fYear.value,
      });

      const payload = {
        type: data.type || "general",
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

      if (isNew) {
        payload.createdAt = serverTimestamp();
        const ref = await addDoc(collection(state.db, C.orders), payload);
        toast("تم الإنشاء", "أمر شغل جديد", "ok");
        renderRoute();
        navTo("orders", ref.id);
      } else {
        await updateDoc(doc(state.db, C.orders, orderId), payload);
        toast("تم الحفظ", "تم تحديث أمر الشغل", "ok");
        renderRoute();
      }
    } catch (e) {
      toast("فشل الحفظ", e?.message || String(e), "bad");
    } finally {
      btnSave.disabled = false;
    }
  }}, ["حفظ"]);

  const btnInvoice = el("button", { class:"btn ok", onclick: async () => {
    if (isNew) return toast("احفظ أولاً", "لازم إنشاء أمر الشغل قبل الفاتورة", "warn");
    try {
      const invId = await createInvoiceFromOrder(orderId);
      toast("تم إنشاء فاتورة", "جاهزة للتعديل والطباعة", "ok");
      navTo("invoices", invId);
    } catch (e) {
      toast("تعذر إنشاء فاتورة", e?.message || "", "bad");
    }
  }}, ["إنشاء فاتورة"]);

  const { close } = openModal(title, body, [btnSave, btnInvoice]);
  return { close };
}

/* ---------- Oil Change Page ---------- */
async function pageOil() {
  setPageHeader("تبديل دهن", "واجهة سريعة — أمر شغل + فاتورة");

  const box = el("div", { class:"grid cols2" }, []);

  const left = el("div", { class:"card" }, [
    el("h3", {}, ["بيانات الزبون والسيارة"]),
  ]);

  const cName = el("input", { class:"input", placeholder:"اسم الزبون" });
  const cPhone = el("input", { class:"input", placeholder:"الهاتف" });

  const plate = el("input", { class:"input", placeholder:"اللوحة (مثال: ك13...)" });
  const model = el("input", { class:"input", placeholder:"الموديل (مثال: سوناتا 2)" });
  const year  = el("input", { class:"input", type:"number", placeholder:"السنة" });

  left.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field" }, [el("label", {}, ["الاسم"]), cName]),
    el("div", { class:"field" }, [el("label", {}, ["الهاتف"]), cPhone]),
  ]));
  left.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field" }, [el("label", {}, ["اللوحة"]), plate]),
    el("div", { class:"field" }, [el("label", {}, ["الموديل"]), model]),
    el("div", { class:"field" }, [el("label", {}, ["السنة"]), year]),
  ]));

  const right = el("div", { class:"card" }, [
    el("h3", {}, ["تفاصيل تبديل الدهن"]),
  ]);

  const oilType = el("input", { class:"input", placeholder:"نوع/ماركة الدهن" });
  const oilVisc = el("input", { class:"input", placeholder:"اللزوجة (مثال: 5W-30)" });
  const oilQty  = el("input", { class:"input", type:"number", placeholder:"الكمية (لتر)", value:"4" });
  const oilPrice = el("input", { class:"input", type:"number", placeholder:"سعر الدهن" });

  const filter = el("input", { class:"input", placeholder:"فلتر (اختياري)" });
  const filterPrice = el("input", { class:"input", type:"number", placeholder:"سعر الفلتر" });

  const kmNow = el("input", { class:"input", type:"number", placeholder:"KM الحالي" });
  const kmNext = el("input", { class:"input", type:"number", placeholder:"KM القادم (مثال: +5000)" });

  const notes = el("textarea", {}, [""]);

  right.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field" }, [el("label", {}, ["نوع الدهن"]), oilType]),
    el("div", { class:"field" }, [el("label", {}, ["اللزوجة"]), oilVisc]),
  ]));
  right.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field" }, [el("label", {}, ["الكمية (لتر)"]), oilQty]),
    el("div", { class:"field" }, [el("label", {}, ["سعر الدهن"]), oilPrice]),
  ]));
  right.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field" }, [el("label", {}, ["فلتر (اختياري)"]), filter]),
    el("div", { class:"field" }, [el("label", {}, ["سعر الفلتر"]), filterPrice]),
  ]));
  right.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field" }, [el("label", {}, ["KM الحالي"]), kmNow]),
    el("div", { class:"field" }, [el("label", {}, ["KM القادم"]), kmNext]),
  ]));
  right.appendChild(el("div", { class:"field" }, [el("label", {}, ["ملاحظات"]), notes]));

  const preview = el("div", { class:"card" }, [
    el("h3", {}, ["المجموع"]),
    el("div", { class:"kpi" }, [
      el("div", { class:"n", id:"oilTotal" }, [fmtMoney(0)]),
      el("div", { class:"l" }, ["دهن + فلتر (تقريباً)"])
    ]),
    el("div", { class:"muted", style:"margin-top:8px" }, ["سيتم إنشاء: أمر شغل + فاتورة قابلة للطباعة"])
  ]);

  function oilTotal(){
    const o = Number(oilPrice.value||0);
    const f = Number(filterPrice.value||0);
    return o + f;
  }
  function refreshOilTotal(){
    $("#oilTotal", preview).textContent = fmtMoney(oilTotal());
  }
  [oilPrice, filterPrice].forEach(i=>i.addEventListener("input", refreshOilTotal));
  refreshOilTotal();

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

      const services = [
        { name: "تبديل دهن", price: Number(oilPrice.value||0) }
      ];
      const parts = [];
      if (filter.value.trim()) parts.push({ name: `فلتر: ${filter.value.trim()}`, qty: 1, price: Number(filterPrice.value||0) });

      const orderPayload = {
        type: "oilChange",
        status: "done",
        customerId,
        customerName: cName.value.trim(),
        customerPhone: cPhone.value.trim(),
        carId,
        carPlate: plate.value.trim(),
        carModel: model.value.trim(),
        carYear: year.value ? Number(year.value) : null,
        oil: {
          brand: oilType.value.trim(),
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

      // Update car with oil info (optional)
      try{
        await updateDoc(doc(state.db, C.cars, carId), {
          lastOilChangeAt: serverTimestamp(),
          lastOilKm: kmNow.value ? Number(kmNow.value) : null,
          nextOilKm: kmNext.value ? Number(kmNext.value) : null,
          oilBrand: oilType.value.trim(),
          oilViscosity: oilVisc.value.trim(),
          updatedAt: serverTimestamp(),
        });
      } catch {}

      // Create invoice directly
      const invId = await createInvoiceFromOrder(orderRef.id, { serviceTitle: "تبديل دهن" });

      toast("تمت العملية بنجاح", "أمر شغل + فاتورة", "ok");
      navTo("invoices", invId);
    } catch(e){
      toast("فشل إنشاء تبديل الدهن", e?.message || String(e), "bad");
    } finally{
      btnCreate.disabled = false;
    }
  }}, ["إنشاء أمر + فاتورة"]);

  box.appendChild(left);
  box.appendChild(right);
  box.appendChild(preview);
  box.appendChild(el("div", { class:"card" }, [
    el("h3", {}, ["ملاحظة"]),
    el("div", { class:"muted" }, [
      "هذه الصفحة مصممة لتكون سريعة: مجرد تعبئة البيانات ثم إنشاء الفاتورة مباشرة.",
      "بعدها تقدرين تعدلين الفاتورة من صفحة الفواتير."
    ])
  ]));
  preview.appendChild(el("div", { class:"actions", style:"margin-top:12px" }, [btnCreate]));

  return box;
}

/* ---------- Create Invoice from Order ---------- */
async function createInvoiceFromOrder(orderId, extra={}) {
  const oSnap = await getDoc(doc(state.db, C.orders, orderId));
  if (!oSnap.exists()) throw new Error("أمر الشغل غير موجود");
  const order = { id:oSnap.id, ...oSnap.data() };

  const invoiceNo = await nextInvoiceNo();

  // pick template
  let templateId = state.settings?.defaultTemplateId || "";
  if (!templateId) {
    const tq = query(collection(state.db, C.invoiceTemplates), orderBy("createdAt","desc"), limit(1));
    const ts = await getDocs(tq);
    if (!ts.empty) templateId = ts.docs[0].id;
  }

  // build items
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

/* ---------- Invoices Page ---------- */
async function pageInvoices() {
  setPageHeader("الفواتير", "تعديل / طباعة / حذف");

  const host = el("div", { class:"grid", style:"gap:16px" }, []);
  const top = el("div", { class:"card" }, [
    el("h3", {}, ["قائمة الفواتير"]),
    el("div", { class:"muted" }, ["يمكن تعديل الفاتورة، اختيار قالب، ثم طباعة"]),
    el("hr", { class:"hr" }),
  ]);

  const search = el("input", { class:"input", placeholder:"بحث: رقم الفاتورة / اسم / هاتف / لوحة…" });
  const btnRefresh = el("button", { class:"btn ghost" }, ["تحديث"]);
  top.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field" }, [el("label", {}, ["بحث"]), search]),
    el("div", { class:"actions", style:"align-items:flex-end; padding-top:18px" }, [btnRefresh]),
  ]));

  const tableBox = el("div", { class:"card" }, [el("div", { class:"muted" }, ["جارِ التحميل…"])]);
  host.appendChild(top);
  host.appendChild(tableBox);

  async function load() {
    tableBox.innerHTML = "";
    tableBox.appendChild(el("div", { class:"muted" }, ["جارِ التحميل…"]));
    try{
      const q1 = query(collection(state.db, C.invoices), orderBy("createdAt","desc"), limit(150));
      const s1 = await getDocs(q1);
      const rows = s1.docs.map(d => ({ id:d.id, ...d.data() }));
      render(rows);
    }catch(e){
      tableBox.innerHTML = "";
      tableBox.appendChild(el("div", { class:"muted" }, ["فشل التحميل: ", String(e?.message||e)]));
    }
  }

  function render(rows) {
    const q = search.value.trim().toLowerCase();
    let filtered = rows;
    if (q) {
      filtered = rows.filter(x => {
        const s = `${x.invoiceNo||""} ${x.customerName||""} ${x.customerPhone||""} ${x.plate||""}`.toLowerCase();
        return s.includes(q);
      });
    }

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
    if (!filtered.length) {
      tb.appendChild(el("tr", {}, [el("td", { colspan:"6", style:"text-align:center; color:rgba(234,240,255,.7)" }, ["لا يوجد بيانات"])]));
    } else {
      for (const r of filtered) {
        tb.appendChild(el("tr", {}, [
          el("td", {}, [r.date || fmtDate(r.createdAt)]),
          el("td", {}, [el("b", {}, [r.invoiceNo || "-"])]),
          el("td", {}, [
            el("div", {}, [el("b", {}, [r.customerName || "-"])]),
            el("div", { class:"muted", style:"font-size:12px" }, [r.customerPhone || ""])
          ]),
          el("td", {}, [`${r.plate||"-"} ${r.carModel ? "— "+r.carModel : ""}`]),
          el("td", {}, [fmtMoney(r.total||0)]),
          el("td", {}, [
            el("div", { class:"actions" }, [
              el("button", { class:"btn", onclick: () => openInvoiceEditor(r.id) }, ["تعديل"]),
              el("button", { class:"btn ok", onclick: () => printInvoice(r.id) }, ["طباعة"]),
              hasPerm(state.profile, "delete")
                ? el("button", { class:"btn bad", onclick: () => deleteInvoice(r.id) }, ["حذف"])
                : el("span"),
            ])
          ]),
        ]));
      }
    }

    tableBox.innerHTML = "";
    tableBox.appendChild(tbl);
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

/* ---------- Invoice Editor (Admin-friendly) ---------- */
async function openInvoiceEditor(id) {
  const s = await getDoc(doc(state.db, C.invoices, id));
  if (!s.exists()) return toast("غير موجود", "الفاتورة غير موجودة", "warn");
  const inv = { id:s.id, ...s.data() };

  const fNo = el("input", { class:"input", value: inv.invoiceNo || "", disabled:true });
  const fDate = el("input", { class:"input", value: inv.date || fmtDate(inv.createdAt) });

  const fName = el("input", { class:"input", value: inv.customerName || "" });
  const fPhone = el("input", { class:"input", value: inv.customerPhone || "" });

  const fPlate = el("input", { class:"input", value: inv.plate || "" });
  const fModel = el("input", { class:"input", value: inv.carModel || "" });
  const fYear  = el("input", { class:"input", type:"number", value: inv.year || "" });

  // template dropdown
  const tplSel = el("select", {});
  {
    const qs = query(collection(state.db, C.invoiceTemplates), orderBy("createdAt","desc"), limit(50));
    const ss = await getDocs(qs);
    tplSel.appendChild(el("option", { value:"" }, ["(بدون قالب)"]));
    ss.docs.forEach(d => {
      tplSel.appendChild(el("option", { value:d.id }, [d.data().name || d.id]));
    });
    tplSel.value = inv.templateId || "";
  }

  // items editor
  inv.items = inv.items || [];
  const itemsHost = el("div", {}, []);

  function recalc() {
    const subtotal = inv.items.reduce((a,i)=>a + (Number(i.qty||1) * Number(i.price||0)), 0);
    const taxPercent = Number(inv.taxPercent || state.settings?.taxPercent || 0);
    const tax = subtotal * (taxPercent/100);
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
      el("tbody")
    ]);

    const tb = t.querySelector("tbody");

    if (!inv.items.length) {
      tb.appendChild(el("tr", {}, [
        el("td", { colspan:"4", style:"text-align:center; color:rgba(234,240,255,.7)" }, ["لا توجد عناصر"])
      ]));
    } else {
      inv.items.forEach((it, idx) => {
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
            el("button", { class:"btn bad", onclick: () => { inv.items.splice(idx,1); renderItems(); }}, ["حذف"])
          ]),
        ]));
      });
    }

    itemsHost.appendChild(t);
    itemsHost.appendChild(el("div", { class:"actions", style:"margin-top:10px" }, [
      el("button", { class:"btn", onclick: () => { inv.items.push({ desc:"", qty:1, price:0 }); renderItems(); }}, ["+ إضافة سطر"]),
      el("span", { class:"badge" }, [`Subtotal: ${fmtMoney(inv.subtotal||0)}`]),
      el("span", { class:"badge" }, [`Tax(${inv.taxPercent||0}%): ${fmtMoney(inv.tax||0)}`]),
      el("span", { class:"badge ok" }, [`Total: ${fmtMoney(inv.total||0)}`]),
    ]));
  }

  renderItems();

  const body = el("div", { class:"grid", style:"gap:14px" }, [
    el("div", { class:"card" }, [
      el("h3", {}, ["معلومات الفاتورة"]),
      el("div", { class:"row" }, [
        el("div", { class:"field" }, [el("label", {}, ["رقم الفاتورة"]), fNo]),
        el("div", { class:"field" }, [el("label", {}, ["التاريخ"]), fDate]),
      ]),
      el("div", { class:"row" }, [
        el("div", { class:"field" }, [el("label", {}, ["الاسم"]), fName]),
        el("div", { class:"field" }, [el("label", {}, ["الهاتف"]), fPhone]),
      ]),
      el("div", { class:"row" }, [
        el("div", { class:"field" }, [el("label", {}, ["اللوحة"]), fPlate]),
        el("div", { class:"field" }, [el("label", {}, ["الموديل"]), fModel]),
        el("div", { class:"field" }, [el("label", {}, ["السنة"]), fYear]),
      ]),
      el("div", { class:"field" }, [el("label", {}, ["قالب الطباعة"]), tplSel]),
    ]),
    el("div", { class:"card" }, [
      el("h3", {}, ["عناصر الفاتورة"]),
      itemsHost
    ])
  ]);

  const btnSave = el("button", { class:"btn primary", onclick: async () => {
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

  const btnPrint = el("button", { class:"btn ok", onclick: () => printInvoice(id) }, ["طباعة"]);
  openModal("تعديل فاتورة", body, [btnSave, btnPrint]);
}

/* ---------- Print Invoice ---------- */
async function printInvoice(invoiceId) {
  try{
    const s = await getDoc(doc(state.db, C.invoices, invoiceId));
    if (!s.exists()) return toast("غير موجود", "الفاتورة غير موجودة", "warn");
    const inv = { id:s.id, ...s.data() };

    let tpl = null;
    if (inv.templateId) {
      const t = await getDoc(doc(state.db, C.invoiceTemplates, inv.templateId));
      if (t.exists()) tpl = { id:t.id, ...t.data() };
    }
    if (!tpl) {
      // fallback: pick any
      const qs = query(collection(state.db, C.invoiceTemplates), limit(1));
      const ss = await getDocs(qs);
      if (!ss.empty) tpl = { id:ss.docs[0].id, ...ss.docs[0].data() };
    }
    if (!tpl) throw new Error("لا يوجد قالب فواتير");

    const items = (inv.items||[]).map(it => {
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
        <script>
          window.onload = () => { setTimeout(()=>window.print(), 250); };
        </script>
      </body>
      </html>
    `;

    const iframe = el("iframe", { style:"width:100%; height:80vh; border:1px solid rgba(255,255,255,.12); border-radius:16px; background:#fff;" });
    openModal("معاينة الطباعة", el("div", {}, [iframe]), [
      el("button", { class:"btn ok", onclick: () => iframe.contentWindow?.print() }, ["طباعة الآن"])
    ]);
    iframe.srcdoc = html;

  }catch(e){
    toast("تعذر الطباعة", e?.message||String(e), "bad");
  }
}

/* ---------- Templates Page ---------- */
async function pageTemplates() {
  setPageHeader("قوالب الفواتير", "تعديل القالب + معاينة فورية + حفظ");

  const host = el("div", { class:"grid cols2" }, []);

  const listBox = el("div", { class:"card" }, [
    el("h3", {}, ["القوالب"]),
    el("div", { class:"muted" }, ["إنشاء/تعديل/حذف القوالب"]),
    el("hr", { class:"hr" }),
  ]);

  const editorBox = el("div", { class:"card" }, [
    el("h3", {}, ["المحرر"]),
    el("div", { class:"muted" }, ["قالب HTML + CSS — يدعم {{var}} و {{#items}} ... {{/items}}"]),
    el("hr", { class:"hr" }),
  ]);

  host.appendChild(listBox);
  host.appendChild(editorBox);

  const tplList = el("div", { class:"muted" }, ["جارِ التحميل…"]);
  listBox.appendChild(tplList);

  const name = el("input", { class:"input", placeholder:"اسم القالب" });
  const css = el("textarea", {}, [""]);
  const html = el("textarea", {}, [""]);

  const preview = el("iframe", { style:"width:100%; height:360px; border:1px solid rgba(255,255,255,.12); border-radius:16px; background:#fff;" });

  const current = { id:null };

  function sampleData() {
    return {
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
    const docHtml = `
      <!doctype html><html lang="ar" dir="rtl">
      <head><meta charset="utf-8"/><style>${css.value}</style></head>
      <body>${renderTemplate(html.value, sampleData())}</body></html>
    `;
    preview.srcdoc = docHtml;
  }

  [name, css, html].forEach(x => x.addEventListener("input", refreshPreview));

  editorBox.appendChild(el("div", { class:"field" }, [el("label", {}, ["اسم القالب"]), name]));
  editorBox.appendChild(el("div", { class:"field" }, [el("label", {}, ["CSS"]), css]));
  editorBox.appendChild(el("div", { class:"field" }, [el("label", {}, ["HTML"]), html]));
  editorBox.appendChild(el("div", { class:"actions" }, [
    el("button", { class:"btn primary", onclick: async () => {
      try{
        if (!name.value.trim()) return toast("اسم القالب مطلوب", "", "warn");
        if (!current.id) {
          const ref = await addDoc(collection(state.db, C.invoiceTemplates), {
            name: name.value.trim(),
            css: css.value,
            html: html.value,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          current.id = ref.id;
          toast("تم الإنشاء", "قالب جديد", "ok");
        } else {
          await updateDoc(doc(state.db, C.invoiceTemplates, current.id), {
            name: name.value.trim(),
            css: css.value,
            html: html.value,
            updatedAt: serverTimestamp(),
          });
          toast("تم الحفظ", "القالب تحدّث", "ok");
        }
        await loadList();
      }catch(e){
        toast("فشل الحفظ", e?.message||String(e), "bad");
      }
    }}, ["حفظ القالب"]),
    el("button", { class:"btn", onclick: () => {
      current.id = null;
      name.value=""; css.value=""; html.value="";
      refreshPreview();
    }}, ["قالب جديد"]),
    hasPerm(state.profile, "delete")
      ? el("button", { class:"btn bad", onclick: async () => {
        if (!current.id) return;
        if (!confirm("حذف القالب؟")) return;
        try{
          await deleteDoc(doc(state.db, C.invoiceTemplates, current.id));
          toast("تم الحذف", "قالب", "ok");
          current.id=null;
          name.value=""; css.value=""; html.value="";
          refreshPreview();
          await loadList();
        }catch(e){
          toast("تعذر الحذف", e?.message||"", "bad");
        }
      }}, ["حذف"])
      : el("span")
  ]));

  editorBox.appendChild(el("hr", { class:"hr" }));
  editorBox.appendChild(el("h3", {}, ["المعاينة"]));
  editorBox.appendChild(preview);

  async function loadList() {
    tplList.innerHTML = "";
    tplList.appendChild(el("div", { class:"muted" }, ["جارِ التحميل…"]));

    const q1 = query(collection(state.db, C.invoiceTemplates), orderBy("createdAt","desc"), limit(50));
    const s1 = await getDocs(q1);

    tplList.innerHTML = "";
    if (s1.empty) {
      tplList.appendChild(el("div", { class:"muted" }, ["لا توجد قوالب."]));
      return;
    }
    s1.docs.forEach(d => {
      const t = d.data();
      const row = el("div", { class:"card", style:"margin-bottom:10px" }, [
        el("div", { style:"display:flex; justify-content:space-between; align-items:center; gap:10px" }, [
          el("div", {}, [
            el("b", {}, [t.name || d.id]),
            el("div", { class:"muted", style:"font-size:12px" }, [d.id]),
          ]),
          el("div", { class:"actions" }, [
            el("button", { class:"btn", onclick: () => {
              current.id = d.id;
              name.value = t.name || "";
              css.value = t.css || "";
              html.value = t.html || "";
              refreshPreview();
              toast("تم التحميل", "القالب في المحرر", "ok");
            }}, ["تحميل"]),
          ])
        ])
      ]);
      tplList.appendChild(row);
    });
  }

  refreshPreview();
  await loadList();
  return host;
}

/* ---------- Customers Page ---------- */
async function pageCustomers() {
  setPageHeader("الزبائن", "إدارة الزبائن");

  const host = el("div", { class:"grid", style:"gap:16px" }, []);
  const top = el("div", { class:"card" }, [
    el("h3", {}, ["قائمة الزبائن"]),
    el("div", { class:"muted" }, ["الاسم + الهاتف + إنشاء/تعديل"]),
    el("hr", { class:"hr" }),
  ]);

  const search = el("input", { class:"input", placeholder:"بحث: اسم أو هاتف…" });
  const btnAdd = el("button", { class:"btn primary" }, ["+ زبون"]);
  const btnRefresh = el("button", { class:"btn ghost" }, ["تحديث"]);

  top.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field" }, [el("label", {}, ["بحث"]), search]),
    el("div", { class:"actions", style:"align-items:flex-end; padding-top:18px" }, [btnAdd, btnRefresh]),
  ]));

  const box = el("div", { class:"card" }, [el("div", { class:"muted" }, ["جارِ التحميل…"])]);
  host.appendChild(top);
  host.appendChild(box);

  btnAdd.onclick = () => openCustomerEditor();

  async function load() {
    box.innerHTML = "";
    box.appendChild(el("div", { class:"muted" }, ["جارِ التحميل…"]));

    try{
      const q1 = query(collection(state.db, C.customers), orderBy("createdAt","desc"), limit(200));
      const s1 = await getDocs(q1);
      const rows = s1.docs.map(d => ({ id:d.id, ...d.data() }));
      render(rows);
    }catch(e){
      box.innerHTML = "";
      box.appendChild(el("div", { class:"muted" }, ["فشل: ", String(e?.message||e)]));
    }
  }

  function render(rows) {
    const q = search.value.trim().toLowerCase();
    const filtered = q ? rows.filter(x => (`${x.name||x.customerName||""} ${x.phone||x.customerPhone||""}`.toLowerCase().includes(q))) : rows;

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

    if (!filtered.length) {
      tb.appendChild(el("tr", {}, [el("td", { colspan:"4", style:"text-align:center; color:rgba(234,240,255,.7)" }, ["لا يوجد بيانات"])]));
    } else {
      for (const r of filtered) {
        tb.appendChild(el("tr", {}, [
          el("td", {}, [el("b", {}, [r.name || r.customerName || "-"])]),
          el("td", {}, [r.phone || r.customerPhone || "-"]),
          el("td", {}, [fmtDate(r.createdAt)]),
          el("td", {}, [
            el("div", { class:"actions" }, [
              el("button", { class:"btn", onclick: () => openCustomerEditor(r) }, ["تعديل"]),
              hasPerm(state.profile, "delete")
                ? el("button", { class:"btn bad", onclick: () => deleteCustomer(r.id) }, ["حذف"])
                : el("span"),
            ])
          ]),
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

function openCustomerEditor(row=null){
  const isNew = !row;
  const name = el("input", { class:"input", value: row?.name || row?.customerName || "" });
  const phone = el("input", { class:"input", value: row?.phone || row?.customerPhone || "" });

  const body = el("div", { class:"grid" }, [
    el("div", { class:"card" }, [
      el("h3", {}, [isNew ? "زبون جديد" : "تعديل زبون"]),
      el("div", { class:"field" }, [el("label", {}, ["الاسم"]), name]),
      el("div", { class:"field" }, [el("label", {}, ["الهاتف"]), phone]),
    ])
  ]);

  const btnSave = el("button", { class:"btn primary", onclick: async () => {
    try{
      if (!name.value.trim() || !phone.value.trim()) return toast("الاسم والهاتف مطلوبين", "", "warn");
      btnSave.disabled=true;

      if (isNew) {
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
      btnSave.disabled=false;
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

/* ---------- Cars Page ---------- */
async function pageCars() {
  setPageHeader("السيارات", "إدارة السيارات");

  const host = el("div", { class:"grid", style:"gap:16px" }, []);
  const top = el("div", { class:"card" }, [
    el("h3", {}, ["قائمة السيارات"]),
    el("div", { class:"muted" }, ["اللوحة + الموديل + الزبون"]),
    el("hr", { class:"hr" }),
  ]);

  const search = el("input", { class:"input", placeholder:"بحث: لوحة / موديل / زبون…" });
  const btnRefresh = el("button", { class:"btn ghost" }, ["تحديث"]);

  top.appendChild(el("div", { class:"row" }, [
    el("div", { class:"field" }, [el("label", {}, ["بحث"]), search]),
    el("div", { class:"actions", style:"align-items:flex-end; padding-top:18px" }, [btnRefresh]),
  ]));

  const box = el("div", { class:"card" }, [el("div", { class:"muted" }, ["جارِ التحميل…"])]);
  host.appendChild(top);
  host.appendChild(box);

  async function load() {
    box.innerHTML = "";
    box.appendChild(el("div", { class:"muted" }, ["جارِ التحميل…"]));
    try{
      const q1 = query(collection(state.db, C.cars), orderBy("createdAt","desc"), limit(200));
      const s1 = await getDocs(q1);
      const rows = s1.docs.map(d => ({ id:d.id, ...d.data() }));
      render(rows);
    }catch(e){
      box.innerHTML = "";
      box.appendChild(el("div", { class:"muted" }, ["فشل: ", String(e?.message||e)]));
    }
  }

  function render(rows) {
    const q = search.value.trim().toLowerCase();
    const filtered = q ? rows.filter(x => (`${x.plate||""} ${x.model||""} ${x.customerName||""}`.toLowerCase().includes(q))) : rows;

    const tbl = el("table", { class:"table" }, [
      el("thead", {}, [el("tr", {}, [
        el("th", {}, ["اللوحة"]),
        el("th", {}, ["الموديل"]),
        el("th", {}, ["السنة"]),
        el("th", {}, ["الزبون"]),
        el("th", {}, ["تاريخ"]),
      ])]),
      el("tbody")
    ]);
    const tb = tbl.querySelector("tbody");

    if (!filtered.length) {
      tb.appendChild(el("tr", {}, [el("td", { colspan:"5", style:"text-align:center; color:rgba(234,240,255,.7)" }, ["لا يوجد بيانات"])]));
    } else {
      for (const r of filtered) {
        tb.appendChild(el("tr", {}, [
          el("td", {}, [el("b", {}, [r.plate || "-"])]),
          el("td", {}, [r.model || "-"]),
          el("td", {}, [r.year ? String(r.year) : "-"]),
          el("td", {}, [r.customerName || "-"]),
          el("td", {}, [fmtDate(r.createdAt)]),
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

/* ---------- Users (Admin) ---------- */
async function pageUsers() {
  if (!hasPerm(state.profile, "manageUsers")) {
    setPageHeader("ممنوع", "لا تملكين صلاحية إدارة المستخدمين");
    return el("div", { class:"card" }, [el("div", { class:"muted" }, ["لا يوجد صلاحية."])]);
  }

  setPageHeader("صلاحيات المستخدمين", "إنشاء حسابات + أدوار + صلاحيات");

  const host = el("div", { class:"grid cols2" }, []);

  const left = el("div", { class:"card" }, [
    el("h3", {}, ["إنشاء مستخدم (Auth)"]),
    el("div", { class:"muted" }, ["ينشئ حساب دخول + يسجل دوره في users/{uid}"]),
    el("hr", { class:"hr" }),
  ]);

  const email = el("input", { class:"input", placeholder:"email@example.com" });
  const pass = el("input", { class:"input", placeholder:"كلمة مرور مبدئية", type:"password" });
  const role = el("select", {}, [
    el("option", { value:"viewer" }, ["viewer"]),
    el("option", { value:"tech" }, ["tech"]),
    el("option", { value:"manager" }, ["manager"]),
    el("option", { value:"admin" }, ["admin"]),
  ]);

  left.appendChild(el("div", { class:"field" }, [el("label", {}, ["Email"]), email]));
  left.appendChild(el("div", { class:"field" }, [el("label", {}, ["Password"]), pass]));
  left.appendChild(el("div", { class:"field" }, [el("label", {}, ["Role"]), role]));

  const btnCreate = el("button", { class:"btn primary", onclick: async () => {
    try{
      btnCreate.disabled = true;
      if (!email.value.trim() || !pass.value) return toast("أكملي البيانات", "", "warn");

      // Create auth user (requires privileged context normally; but client can create if rules allow)
      const cred = await createUserWithEmailAndPassword(state.auth, email.value.trim(), pass.value);
      const uid = cred.user.uid;

      await setDoc(doc(state.db, C.users, uid), {
        email: email.value.trim(),
        role: role.value,
        permissions: {},
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      toast("تم إنشاء المستخدم", "تمت إضافة الدور في Firestore", "ok");
      renderRoute();
    } catch(e){
      toast("فشل الإنشاء", e?.message || String(e), "bad");
    } finally{
      btnCreate.disabled = false;
    }
  }}, ["إنشاء"]);

  left.appendChild(el("div", { class:"actions" }, [btnCreate]));
  left.appendChild(el("div", { class:"muted", style:"margin-top:10px" }, [
    "ملاحظة: إنشاء المستخدم من الواجهة يعتمد على إعدادات Auth وقيود المشروع. "
  ]));

  const right = el("div", { class:"card" }, [
    el("h3", {}, ["قائمة المستخدمين (users)"]),
    el("div", { class:"muted" }, ["تعديل الدور/الصلاحيات (Firestore)"]),
    el("hr", { class:"hr" }),
  ]);

  const list = el("div", { class:"muted" }, ["جارِ التحميل…"]);
  right.appendChild(list);

  async function load() {
    list.innerHTML = "";
    list.appendChild(el("div", { class:"muted" }, ["جارِ التحميل…"]));
    try{
      const q1 = query(collection(state.db, C.users), orderBy("createdAt","desc"), limit(200));
      const s1 = await getDocs(q1);
      list.innerHTML = "";
      if (s1.empty) return list.appendChild(el("div", { class:"muted" }, ["لا يوجد مستخدمين داخل users."]));

      s1.docs.forEach(d => {
        const u = d.data();
        const sel = el("select", {}, [
          el("option", { value:"viewer" }, ["viewer"]),
          el("option", { value:"tech" }, ["tech"]),
          el("option", { value:"manager" }, ["manager"]),
          el("option", { value:"admin" }, ["admin"]),
        ]);
        sel.value = u.role || "viewer";

        const btnSaveRole = el("button", { class:"btn", onclick: async () => {
          try{
            await updateDoc(doc(state.db, C.users, d.id), { role: sel.value, updatedAt: serverTimestamp() });
            toast("تم تحديث الدور", u.email || d.id, "ok");
          }catch(e){
            toast("فشل", e?.message||"", "bad");
          }
        }}, ["حفظ"]);

        const card = el("div", { class:"card", style:"margin-bottom:10px" }, [
          el("div", { style:"display:flex; justify-content:space-between; gap:10px; align-items:center" }, [
            el("div", {}, [
              el("b", {}, [u.email || d.id]),
              el("div", { class:"muted", style:"font-size:12px" }, [`uid: ${d.id}`]),
            ]),
            el("div", { class:"actions" }, [sel, btnSaveRole]),
          ]),
        ]);

        list.appendChild(card);
      });

    }catch(e){
      list.innerHTML = "";
      list.appendChild(el("div", { class:"muted" }, ["فشل التحميل: ", String(e?.message||e)]));
    }
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

  const s = state.settings || {};
  const name = el("input", { class:"input", value: s.workshopName || "" });
  const phone = el("input", { class:"input", value: s.workshopPhone || "" });
  const addr = el("input", { class:"input", value: s.workshopAddress || "" });

  const prefix = el("input", { class:"input", value: s.invoicePrefix || "RPM-" });
  const padding = el("input", { class:"input", type:"number", value: s.invoicePadding || 6 });
  const tax = el("input", { class:"input", type:"number", value: s.taxPercent || 0 });

  const box = el("div", { class:"grid cols2" }, [
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
  ]);

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

      toast("تم حفظ الإعدادات", "", "ok");
      await loadBootstrapData(); // refresh state
      renderRoute();
    }catch(e){
      toast("فشل الحفظ", e?.message||String(e), "bad");
    }finally{
      btnSave.disabled = false;
    }
  }}, ["حفظ"]);

  const btnSeed = el("button", { class:"btn", onclick: async () => {
    try{
      await ensureDefaults();
      toast("تم تهيئة الافتراضيات", "settings/uiConfig/meta/templates", "ok");
      await loadBootstrapData();
      renderRoute();
    }catch(e){
      toast("فشل التهيئة", e?.message||String(e), "bad");
    }
  }}, ["تهيئة افتراضيات"]);

  return el("div", {}, [
    el("div", { class:"actions", style:"margin-bottom:12px" }, [btnSave, btnSeed]),
    box
  ]);
}

/* ---------- UI Pages (Admin) ---------- */
async function pageUI() {
  if (!hasPerm(state.profile, "manageSettings")) {
    setPageHeader("ممنوع", "لا تملكين صلاحية صفحات مخصصة");
    return el("div", { class:"card" }, [el("div", { class:"muted" }, ["لا يوجد صلاحية."])]);
  }

  setPageHeader("صفحات مخصّصة", "إنشاء صفحات داخل uiConfig بدون تعديل الملفات");

  const host = el("div", { class:"grid cols2" }, []);

  const left = el("div", { class:"card" }, [
    el("h3", {}, ["إنشاء صفحة HTML"]),
    el("div", { class:"muted" }, ["تُحفظ داخل uiConfig/{docId} كـ kind=page"]),
    el("hr", { class:"hr" }),
  ]);

  const slug = el("input", { class:"input", placeholder:"slug مثال: offers" });
  const title = el("input", { class:"input", placeholder:"عنوان الصفحة" });
  const html = el("textarea", {}, ["<h2>مرحبا</h2><p>هذه صفحة مخصصة.</p>"]);

  const btnCreate = el("button", { class:"btn primary", onclick: async () => {
    try{
      if (!slug.value.trim() || !title.value.trim()) return toast("slug والعنوان مطلوبين", "", "warn");
      btnCreate.disabled=true;
      const id = "page_" + slug.value.trim().toLowerCase();
      await setDoc(doc(state.db, C.uiConfig, id), {
        kind: "page",
        slug: slug.value.trim().toLowerCase(),
        title: title.value.trim(),
        type: "html",
        html: html.value,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge:true });

      toast("تم إنشاء الصفحة", "يمكن فتحها من الرابط مباشرة", "ok");
      navTo("page", slug.value.trim().toLowerCase());
    }catch(e){
      toast("فشل", e?.message||String(e), "bad");
    }finally{
      btnCreate.disabled=false;
    }
  }}, ["حفظ الصفحة"]);

  left.appendChild(el("div", { class:"field" }, [el("label", {}, ["Slug"]), slug]));
  left.appendChild(el("div", { class:"field" }, [el("label", {}, ["Title"]), title]));
  left.appendChild(el("div", { class:"field" }, [el("label", {}, ["HTML"]), html]));
  left.appendChild(el("div", { class:"actions" }, [btnCreate]));

  const right = el("div", { class:"card" }, [
    el("h3", {}, ["الصفحات الموجودة"]),
    el("div", { class:"muted" }, ["تظهر وتُفتح عبر: #/page/<slug>"]),
    el("hr", { class:"hr" }),
  ]);
  const list = el("div", { class:"muted" }, ["جارِ التحميل…"]);
  right.appendChild(list);

  async function load() {
    list.innerHTML = "";
    try{
      const q1 = query(collection(state.db, C.uiConfig), where("kind","==","page"), limit(80));
      const s1 = await getDocs(q1);
      if (s1.empty) return list.appendChild(el("div", { class:"muted" }, ["لا توجد صفحات."]));
      s1.docs.forEach(d => {
        const p = d.data();
        list.appendChild(el("div", { class:"card", style:"margin-bottom:10px" }, [
          el("b", {}, [p.title || p.slug || d.id]),
          el("div", { class:"muted", style:"font-size:12px" }, [`slug: ${p.slug}`]),
          el("div", { class:"actions", style:"margin-top:8px" }, [
            el("button", { class:"btn", onclick: () => navTo("page", p.slug) }, ["فتح"]),
            hasPerm(state.profile, "delete")
              ? el("button", { class:"btn bad", onclick: async () => {
                if (!confirm("حذف الصفحة؟")) return;
                await deleteDoc(doc(state.db, C.uiConfig, d.id));
                toast("تم الحذف", "", "ok");
                load();
              }}, ["حذف"])
              : el("span"),
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

/* ---------- Custom Page viewer: #/page/<slug> ---------- */
async function pageCustom(slug) {
  setPageHeader("صفحة مخصصة", slug);

  const id = "page_" + slug;
  const s = await getDoc(doc(state.db, C.uiConfig, id));
  if (!s.exists()) {
    return el("div", { class:"card" }, [
      el("h3", {}, ["غير موجودة"]),
      el("div", { class:"muted" }, ["لا توجد صفحة بهذا الـ slug."]),
    ]);
  }
  const p = s.data();
  setPageHeader(p.title || "صفحة", p.slug || "");
  return el("div", { class:"card" }, [el("div", { html: p.html || "" })]);
}

/* ---------- Employees / Departments (basic CRUD placeholders) ---------- */
async function pageEmployees() {
  setPageHeader("الموظفون", "إدارة الموظفين");
  return el("div", { class:"card" }, [
    el("h3", {}, ["جاهز للتوسعة"]),
    el("div", { class:"muted" }, ["حالياً: يمكن إضافة CRUD مشابه للزبائن بسهولة داخل employees collection."])
  ]);
}
async function pageDepartments() {
  setPageHeader("الأقسام", "إدارة الأقسام");
  return el("div", { class:"card" }, [
    el("h3", {}, ["جاهز للتوسعة"]),
    el("div", { class:"muted" }, ["حالياً: يمكن إضافة CRUD مشابه للزبائن داخل departments collection."])
  ]);
}

/* ---------- Route Renderer ---------- */
async function renderRoute() {
  if (!state.user) return renderAuth();
  if (!state.profile) return; // wait

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
    else if (slug === "settings") page.appendChild(await pageSettings());
    else if (slug === "ui") page.appendChild(await pageUI());
    else if (slug === "page") page.appendChild(await pageCustom(id || ""));
    else {
      setPageHeader("غير معروف", slug);
      page.appendChild(el("div", { class:"card" }, [el("div", { class:"muted" }, ["الصفحة غير موجودة."])]));
    }
  } catch(e){
    page.innerHTML = "";
    page.appendChild(el("div", { class:"card" }, [
      el("h3", {}, ["حصل خطأ"]),
      el("div", { class:"muted" }, [String(e?.message || e)]),
      el("hr", { class:"hr" }),
      el("div", { class:"muted" }, [
        "إذا الخطأ Permission Denied: راجعي Firestore Rules.",
      ])
    ]));
  }
}

/* ---------- Bootstrap Data ---------- */
async function loadBootstrapData() {
  try{
    await ensureDefaults();
    state.settings = await getSettings();

    const uiRef = doc(state.db, C.uiConfig, "app");
    const uiSnap = await getDoc(uiRef);
    state.uiConfig = uiSnap.exists() ? { id:uiSnap.id, ...uiSnap.data() } : null;
  } catch(e) {
    toast("مشكلة إعدادات", e?.message || String(e), "warn");
  }
}

/* ---------- Load User Profile ---------- */
async function loadProfile(uid, email) {
  const ref = doc(state.db, C.users, uid);
  const s = await getDoc(ref);
  if (s.exists()) return { id:s.id, ...s.data() };

  // If missing profile: create viewer by default (safe)
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
  // Validate config
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey.includes("PUT_YOUR_API_KEY")) {
    renderAuth();
    toast("ملاحظة", "أدخلي apiKey داخل firebaseConfig في app.js", "warn");
  }

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
      await loadBootstrapData();
      state.profile = await loadProfile(user.uid, user.email);
      renderShell();
      toast("أهلاً", `تم تسجيل الدخول: ${user.email}`, "ok");
    } catch(e){
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

/* =========================================================
   🔐 Firestore Rules (اقتراح — ضعيها في Firebase Console)
   =========================================================
   ملاحظة: الواجهة وحدها لا تكفي. لازم Rules حقيقية.
   الفكرة: role محفوظ في users/{uid}.role

   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {

       function signedIn() { return request.auth != null; }
       function userDoc() { return get(/databases/$(database)/documents/users/$(request.auth.uid)); }
       function role() { return signedIn() ? userDoc().data.role : 'viewer'; }
       function isAdmin() { return role() == 'admin'; }
       function isManager() { return role() == 'manager' || isAdmin(); }
       function isTech() { return role() == 'tech' || isManager(); }

       match /users/{uid} {
         allow read: if signedIn() && (isAdmin() || request.auth.uid == uid);
         allow write: if isAdmin();
       }

       match /settings/{doc} {
         allow read: if signedIn();
         allow write: if isAdmin();
       }

       match /uiConfig/{doc} {
         allow read: if signedIn();
         allow write: if isAdmin();
       }

       match /meta/{doc} {
         allow read: if signedIn();
         allow write: if isAdmin();
       }

       match /invoiceTemplates/{id} {
         allow read: if signedIn();
         allow write: if isManager();
       }

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
*/
