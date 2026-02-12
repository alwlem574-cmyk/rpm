// app.js - RPM (SPA + Firebase Auth + Firestore)
// ✅ أوامر + فواتير + طباعة + قالب فاتورة من الأدمن + بحث شامل + مزامنة زبون/سيارة + إدارة مستخدمين
// ملاحظة: الصلاحيات هنا واجهة فقط، لازم Firestore Rules للحماية الحقيقية.

const firebaseConfig = {
  apiKey: "AIzaSyC0p4cqNHuqZs9_gNuKLl7nEY0MqRXbf_A",
  authDomain: "rpm574.firebaseapp.com",
  databaseURL: "https://rpm574-default-rtdb.firebaseio.com",
  projectId: "rpm574",
  storageBucket: "rpm574.firebasestorage.app",
  messagingSenderId: "150918603525",
  appId: "1:150918603525:web:fe1d0fbe5c4505936c4d6c"
};

let auth, db;
let currentRole = "guest";
let currentUser = null;

// Reception / Workorder selections
let rxSelectedCustomer = null;
let rxSelectedCar = null;

let woSelectedCustomer = null;
let woSelectedCar = null;
let woSelectedEmp = null;

// CRUD editing
let custEditingId = null;
let carEditingId = null;
let empEditingId = null;

// Invoices
let invEditingId = null;
let invEditingData = null;

// Admin custom pages
let editingPageId = null;

// UI config cached
let uiCfg = null;

const $ = (id) => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function clean(s) { return (s || "").trim(); }
function normalizePlate(s) { return (s || "").trim().toUpperCase(); }

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}
function formatDate(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : null;
    if (!d) return "—";
    return d.toLocaleString("ar-IQ");
  } catch { return "—"; }
}
function setMsg(el, text, type = "") {
  if (!el) return;
  el.className = "msg" + (type ? " " + type : "");
  el.textContent = text || "";
}
function debounce(fn, ms = 250) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// =========================
// Arabic IME / Smooth typing guard
// =========================
function attachCompositionGuard(el) {
  if (!el) return;
  el._composing = false;
  el._lastValue = el.value || "";

  el.addEventListener("compositionstart", () => { el._composing = true; });
  el.addEventListener("compositionend", () => {
    el._composing = false;
    el._lastValue = el.value;
  });
  el.addEventListener("input", () => {
    if (!el._composing) el._lastValue = el.value;
  });
}
function stableValue(el) {
  if (!el) return "";
  return el._composing ? (el._lastValue || el.value || "") : (el.value || "");
}
function guardAllInputs() {
  qsa("input,textarea").forEach(attachCompositionGuard);
}
async function tick() { return new Promise(r => setTimeout(r, 0)); }

// =========================
// Firebase
// =========================
function ensureFirebase() {
  try {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    $("firebaseBadge").textContent = "Firebase: مرتبط";
    $("firebaseBadge").classList.add("badge-ok");
    return true;
  } catch (e) {
    console.error(e);
    $("firebaseBadge").textContent = "Firebase: فشل الربط";
    return false;
  }
}

function showAuth(show) {
  $("authCard").classList.toggle("hidden", !show);
  qsa(".page").forEach(p => p.classList.toggle("hidden", show));
}

function setRoleBadge(role) {
  $("roleBadge").textContent = role === "admin" ? "أدمن" : (role === "user" ? "موظف" : "زائر");
  $("adminNav").style.display = (role === "admin") ? "" : "none";
}

async function loadRole(uid) {
  currentRole = "user";
  try {
    const snap = await db.collection("users").doc(uid).get();
    const data = snap.exists ? snap.data() : null;
    currentRole = data?.role || "user";
  } catch (e) { }
  setRoleBadge(currentRole);
}

// =========================
// Navigation / Routing
// =========================
function bindNav() {
  qsa(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      navigate(btn.dataset.route);
      $("sidebar").classList.remove("open");
    });
  });
  $("btnToggleSidebar").addEventListener("click", () => $("sidebar").classList.toggle("open"));
  $("btnSignOut").addEventListener("click", () => auth?.signOut());
}

function setActiveNav(route) {
  qsa(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.route === route));
}

function setTitle(route) {
  const titles = {
    dashboard: "لوحة التحكم",
    reception: "الاستقبال",
    workorders: "أمر تشغيلي",
    orders: "الأوامر",
    invoices: "الفواتير",
    search: "بحث شامل",
    customers: "الزبائن",
    cars: "السيارات",
    admin: "إعدادات الأدمن"
  };
  $("pageTitle").textContent = titles[route] || "RPM";
}

function navigate(route) {
  if (route === "admin" && currentRole !== "admin") route = "dashboard";
  setTitle(route);
  setActiveNav(route);

  qsa(".page").forEach(p => p.classList.add("hidden"));
  const el = $("page-" + route);
  if (el) el.classList.remove("hidden");

  // Load page data
  if (route === "dashboard") refreshDashboard();
  if (route === "reception") loadRecentOrders("reception");
  if (route === "workorders") { loadDepartmentsToSelect(); loadRecentOrders("work"); }
  if (route === "orders") loadOrdersPage();
  if (route === "invoices") loadInvoicesPage();
  if (route === "search") { $("globalSearch").focus(); }
  if (route === "customers") { $("custCars").innerHTML = ""; }
  if (route === "admin") loadAdmin();
}

// =========================
// Data helpers / queries
// =========================
function uniqById(arr) {
  const m = new Map();
  for (const x of arr) {
    const id = x?.id || JSON.stringify(x);
    if (!m.has(id)) m.set(id, x);
  }
  return Array.from(m.values());
}

async function queryPrefix(col, field, term, limitN = 10, upper = false) {
  const t = upper ? normalizePlate(term) : clean(term);
  if (!t) return [];
  const snap = await db.collection(col)
    .orderBy(field)
    .startAt(t)
    .endAt(t + "\uf8ff")
    .limit(limitN)
    .get()
    .catch(() => null);
  if (!snap || snap.empty) return [];
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function searchCustomerSmart(term) {
  term = clean(term);
  if (!term) return [];

  // 1) اذا يبدو لوحة: ابحث cars ثم ارجع صاحبها
  const plate = normalizePlate(term);
  if (plate.length >= 4 && /[0-9]/.test(plate)) {
    const carSnap = await db.collection("cars").where("plate", "==", plate).limit(5).get().catch(() => null);
    if (carSnap && !carSnap.empty) {
      const owners = [];
      for (const doc of carSnap.docs) {
        const car = doc.data();
        if (car.customerId) {
          const cdoc = await db.collection("customers").doc(car.customerId).get().catch(() => null);
          if (cdoc?.exists) {
            const c = cdoc.data();
            owners.push({ id: cdoc.id, name: c.name || car.customerName || "—", phone: c.phone || car.customerPhone || "", fromPlate: plate });
          } else {
            owners.push({ id: car.customerId, name: car.customerName || "—", phone: car.customerPhone || "", fromPlate: plate });
          }
        }
      }
      if (owners.length) return uniqById(owners);
    }
  }

  const out = [];
  if (/[0-9]/.test(term)) out.push(...await queryPrefix("customers", "phone", term, 10));
  out.push(...await queryPrefix("customers", "name", term, 10));
  return uniqById(out).slice(0, 10);
}

async function searchCarsSmart(term) {
  term = clean(term);
  if (!term) return [];
  const out = [];

  const plate = normalizePlate(term);
  out.push(...(await queryPrefix("cars", "plate", plate, 10, true)).map(c => ({ ...c, _hit: "plate" })));
  out.push(...(await queryPrefix("cars", "model", term, 10)).map(c => ({ ...c, _hit: "model" })));

  // 3) ابحث باسم صاحب/هاتفه => cars by customerId IN
  const cust = await searchCustomerSmart(term);
  const ids = cust.map(x => x.id).slice(0, 10);
  if (ids.length) {
    const snap = await db.collection("cars").where("customerId", "in", ids).limit(10).get().catch(() => null);
    if (snap && !snap.empty) snap.docs.forEach(d => out.push({ id: d.id, ...d.data(), _hit: "owner" }));
  }

  return uniqById(out).slice(0, 10);
}

async function searchEmployeesSmart(term) {
  term = clean(term);
  if (!term) return [];
  const out = [];
  if (/[0-9]/.test(term)) out.push(...await queryPrefix("employees", "phone", term, 10));
  out.push(...await queryPrefix("employees", "name", term, 10));
  return uniqById(out).slice(0, 10);
}

function renderResults(container, items, onPick, kind) {
  container.innerHTML = "";
  if (!items.length) {
    container.innerHTML = '<div class="result-item"><div>لا توجد نتائج</div><div class="result-meta">—</div></div>';
    return;
  }
  items.forEach(it => {
    const el = document.createElement("div");
    el.className = "result-item";
    const left = document.createElement("div");
    const right = document.createElement("div");
    right.className = "result-meta";

    if (kind === "customer") {
      left.innerHTML = `<b>${escapeHtml(it.name || "—")}</b><div class="result-meta">${escapeHtml(it.phone || "")}${it.fromPlate ? " • لوحة: " + escapeHtml(it.fromPlate) : ""}</div>`;
      right.textContent = "اختيار";
    } else if (kind === "employee") {
      left.innerHTML = `<b>${escapeHtml(it.name || "—")}</b><div class="result-meta">${escapeHtml(it.phone || "")} • ${escapeHtml((it.salaryType || "") + " " + (it.salaryAmount ?? ""))}</div>`;
      right.textContent = "اختيار";
    } else {
      left.innerHTML = `<b>${escapeHtml(it.plate || "—")}</b><div class="result-meta">${escapeHtml(it.model || "")} • ${escapeHtml(it.customerName || "")} ${it.customerPhone ? ("• " + escapeHtml(it.customerPhone)) : ""}</div>`;
      right.textContent = "اختيار";
    }

    el.appendChild(left); el.appendChild(right);
    el.addEventListener("click", () => onPick(it));
    container.appendChild(el);
  });
}

// =========================
// Upsert / Sync
// =========================
async function upsertCustomer({ name, phone }) {
  name = clean(name); phone = clean(phone);
  if (!name) throw new Error("اسم الزبون إجباري");

  let existing = null;
  if (phone) {
    const snap = await db.collection("customers").where("phone", "==", phone).limit(1).get().catch(() => null);
    if (snap && !snap.empty) existing = { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
  if (existing) {
    await db.collection("customers").doc(existing.id).set(
      { name, phone, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    await syncCustomerToCars(existing.id, name, phone);
    return { id: existing.id, name, phone };
  }

  const ref = await db.collection("customers").add({
    name, phone,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  return { id: ref.id, name, phone };
}

async function syncCustomerToCars(customerId, name, phone) {
  try {
    const snap = await db.collection("cars").where("customerId", "==", customerId).get().catch(() => null);
    if (!snap || snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach(d => {
      batch.set(d.ref, {
        customerName: name,
        customerPhone: phone,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
    await batch.commit();
  } catch (e) { console.warn(e); }
}

async function upsertCar({ plate, model, year, customer }) {
  plate = normalizePlate(plate);
  model = clean(model);
  year = year ? Number(year) : null;
  if (!plate) throw new Error("رقم اللوحة مطلوب");

  const snap = await db.collection("cars").where("plate", "==", plate).limit(1).get().catch(() => null);
  if (snap && !snap.empty) {
    const doc = snap.docs[0];
    const old = doc.data();
    await db.collection("cars").doc(doc.id).set({
      plate, model, year: year || null,
      customerId: customer?.id || old.customerId || null,
      customerName: customer?.name || old.customerName || "",
      customerPhone: customer?.phone || old.customerPhone || "",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { id: doc.id, ...old, plate, model, year };
  }

  const ref = await db.collection("cars").add({
    plate, model, year: year || null,
    customerId: customer?.id || null,
    customerName: customer?.name || "",
    customerPhone: customer?.phone || "",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  return { id: ref.id, plate, model, year, customerId: customer?.id || null };
}

async function createOrder(type, payload) {
  await db.collection("orders").add({
    type,
    status: "open",
    ...payload,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

// =========================
// UI Config + Custom Pages + Invoice Template
// =========================
async function ensureDefaults() {
  // departments defaults
  const depSnap = await db.collection("departments").limit(1).get().catch(() => null);
  if (depSnap && depSnap.empty) {
    const defaults = ["ميكانيك", "كهرباء", "تبريد", "إطارات", "فحص", "حدادة/دهن"];
    for (const name of defaults) {
      await db.collection("departments").add({ name, active: true, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    }
  }

  // uiConfig
  const cfgRef = db.collection("uiConfig").doc("main");
  const cfgSnap = await cfgRef.get().catch(() => null);
  if (!cfgSnap || !cfgSnap.exists) {
    await cfgRef.set({
      sections: { dashboard: true, reception: true, workorders: true, orders: true, invoices: true, search: true, customers: true, cars: true, admin: true },
      nextInvoiceNo: 1,
      invoiceTemplate: {
        shopName: "ورشة RPM",
        shopPhone: "",
        shopAddress: "",
        currency: "IQD",
        headerHtml: "<h2 style='margin:0'>{{shopName}}</h2><div style='opacity:.8'>هاتف: {{shopPhone}} • {{shopAddress}}</div><hr/>",
        footerHtml: "<div style='text-align:center;opacity:.75'>شكراً لزيارتكم</div>",
        css: ""
      },
      customPages: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }
}

async function loadUIConfig() {
  await ensureDefaults();
  const snap = await db.collection("uiConfig").doc("main").get().catch(() => null);
  uiCfg = snap?.exists ? snap.data() : null;
  await applyUIConfig();
  await buildCustomNav();
}

async function applyUIConfig() {
  const defaults = { dashboard: true, reception: true, workorders: true, orders: true, invoices: true, search: true, customers: true, cars: true, admin: true };
  let sections = { ...defaults };
  if (uiCfg?.sections) sections = { ...sections, ...uiCfg.sections };

  const map = {
    dashboard: qsa('[data-route="dashboard"]')[0],
    reception: qsa('[data-route="reception"]')[0],
    workorders: qsa('[data-route="workorders"]')[0],
    orders: qsa('[data-route="orders"]')[0],
    invoices: qsa('[data-route="invoices"]')[0],
    search: qsa('[data-route="search"]')[0],
    customers: qsa('[data-route="customers"]')[0],
    cars: qsa('[data-route="cars"]')[0],
    admin: $("adminNav")
  };
  Object.entries(map).forEach(([k, btn]) => {
    if (!btn) return;
    btn.style.display = (sections[k] !== false) ? "" : "none";
  });
}

async function buildCustomNav() {
  const wrap = $("customNav");
  wrap.innerHTML = "";
  const pages = (uiCfg?.customPages || []).slice().sort((a, b) => (a.sort ?? 10) - (b.sort ?? 10));
  pages.filter(p => p.visible !== false).forEach(p => {
    const btn = document.createElement("button");
    btn.className = "nav-item";
    btn.textContent = p.title || "صفحة";
    btn.addEventListener("click", () => openCustomPage(p));
    wrap.appendChild(btn);
  });
}

function openCustomPage(p) {
  // create or reuse a dynamic page section
  let sec = $("page-custom");
  if (!sec) {
    sec = document.createElement("section");
    sec.id = "page-custom";
    sec.className = "page card hidden";
    qs(".main").insertBefore(sec, qs(".footer"));
  }
  qsa(".page").forEach(x => x.classList.add("hidden"));
  sec.classList.remove("hidden");
  $("pageTitle").textContent = p.title || "صفحة";

  sec.innerHTML = `
    <h2>${escapeHtml(p.title || "صفحة")}</h2>
    <div class="divider"></div>
    <div class="card" style="box-shadow:none;background:rgba(255,255,255,.03)">${p.html || ""}</div>
  `;
  setActiveNav(""); // remove active highlight
}

// =========================
// Departments
// =========================
async function loadDepartmentsToSelect() {
  const sel = $("woDept");
  sel.innerHTML = "";
  const snap = await db.collection("departments").orderBy("name").get().catch(() => null);
  if (!snap || snap.empty) { sel.innerHTML = '<option value="">—</option>'; return; }
  snap.docs.forEach(d => {
    const dep = d.data();
    if (dep.active === false) return;
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = dep.name || "—";
    sel.appendChild(opt);
  });
}

// =========================
// Reception binding
// =========================
function clearReceptionForm() {
  rxSelectedCustomer = null;
  rxSelectedCar = null;

  $("rxCustomerSearch").value = "";
  $("rxCustomerResults").innerHTML = "";
  $("rxCustomerName").value = "";
  $("rxCustomerPhone").value = "";

  $("rxCarSearch").value = "";
  $("rxCarResults").innerHTML = "";
  $("rxPlate").value = "";
  $("rxCarModel").value = "";
  $("rxCarYear").value = "";

  $("rxNotes").value = "";
  $("rxCustomerSearch").focus();
}

function bindReception() {
  $("rxCustomerSearch").addEventListener("input", debounce(async () => {
    const term = stableValue($("rxCustomerSearch"));
    const items = await searchCustomerSmart(term);
    renderResults($("rxCustomerResults"), items, (it) => {
      rxSelectedCustomer = it;
      $("rxCustomerName").value = it.name || "";
      $("rxCustomerPhone").value = it.phone || "";

      // سلاسة: فضّي مربع البحث بعد الاختيار
      $("rxCustomerSearch").value = "";
      $("rxCustomerResults").innerHTML = "";
      setMsg($("rxMsg"), "تم اختيار الزبون.", "ok");
      $("rxCustomerName").focus();
    }, "customer");
  }));

  $("rxCarSearch").addEventListener("input", debounce(async () => {
    const term = stableValue($("rxCarSearch"));
    const items = await searchCarsSmart(term);
    renderResults($("rxCarResults"), items, async (it) => {
      rxSelectedCar = it;
      $("rxPlate").value = it.plate || "";
      $("rxCarModel").value = it.model || "";
      $("rxCarYear").value = it.year || "";

      // اذا السيارة مرتبطة بزبون -> املأ معلوماته
      if (it.customerId) {
        const cdoc = await db.collection("customers").doc(it.customerId).get().catch(() => null);
        if (cdoc?.exists) {
          const c = cdoc.data();
          rxSelectedCustomer = { id: cdoc.id, name: c.name || it.customerName || "", phone: c.phone || it.customerPhone || "" };
        } else {
          rxSelectedCustomer = { id: it.customerId, name: it.customerName || "", phone: it.customerPhone || "" };
        }
        $("rxCustomerName").value = rxSelectedCustomer.name || "";
        $("rxCustomerPhone").value = rxSelectedCustomer.phone || "";
      }

      // سلاسة: فضّي مربع البحث بعد الاختيار
      $("rxCarSearch").value = "";
      $("rxCarResults").innerHTML = "";
      setMsg($("rxMsg"), "تم اختيار السيارة.", "ok");
      $("rxPlate").focus();
    }, "car");
  }));

  $("rxCustomerClear").addEventListener("click", () => {
    rxSelectedCustomer = null;
    $("rxCustomerSearch").value = "";
    $("rxCustomerResults").innerHTML = "";
    $("rxCustomerName").value = "";
    $("rxCustomerPhone").value = "";
  });

  $("rxCarClear").addEventListener("click", () => {
    rxSelectedCar = null;
    $("rxCarSearch").value = "";
    $("rxCarResults").innerHTML = "";
    $("rxPlate").value = "";
    $("rxCarModel").value = "";
    $("rxCarYear").value = "";
  });

  $("btnCreateReception").addEventListener("click", async () => {
    await tick(); // يضمن آخر حرف ينقرأ (IME)
    setMsg($("rxMsg"), "جارٍ الحفظ...");

    try {
      const name = stableValue($("rxCustomerName"));
      const phone = stableValue($("rxCustomerPhone"));
      if (!clean(name)) throw new Error("اسم الزبون إجباري");

      const customer = rxSelectedCustomer?.id
        ? (await (async () => {
          await db.collection("customers").doc(rxSelectedCustomer.id).set(
            { name: clean(name), phone: clean(phone), updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
          await syncCustomerToCars(rxSelectedCustomer.id, clean(name), clean(phone));
          return { id: rxSelectedCustomer.id, name: clean(name), phone: clean(phone) };
        })())
        : await upsertCustomer({ name, phone });

      const plate = stableValue($("rxPlate"));
      const model = stableValue($("rxCarModel"));
      const year = stableValue($("rxCarYear"));

      let car = null;
      if (clean(plate)) car = await upsertCar({ plate, model, year, customer });

      await createOrder("reception", {
        customerId: customer.id, customerName: customer.name, customerPhone: customer.phone || "",
        carId: car?.id || null,
        plate: car?.plate || normalizePlate(plate) || "",
        carModel: car?.model || clean(model) || "",
        carYear: car?.year || (year ? Number(year) : null),
        notes: clean(stableValue($("rxNotes"))),
        assignedEmployeeId: null,
        assignedEmployeeName: ""
      });

      setMsg($("rxMsg"), "تم إنشاء الاستقبال ✅", "ok");
      await loadRecentOrders("reception");
      await refreshDashboard();

      // سلاسة: تفريغ الحقول
      clearReceptionForm();

    } catch (e) {
      console.error(e);
      setMsg($("rxMsg"), e.message || "فشل", "err");
    }
  });
}

// =========================
// Work Orders binding
// =========================
function clearWorkOrderForm() {
  woSelectedCustomer = null;
  woSelectedCar = null;
  woSelectedEmp = null;

  $("woCustomerSearch").value = "";
  $("woCustomerResults").innerHTML = "";
  $("woCustomerName").value = "";
  $("woCustomerPhone").value = "";

  $("woCarSearch").value = "";
  $("woCarResults").innerHTML = "";
  $("woPlate").value = "";
  $("woCarModel").value = "";
  $("woCarYear").value = "";

  $("woEmpSearch").value = "";
  $("woEmpResults").innerHTML = "";
  $("woEmpPicked").value = "";

  $("woLabor").value = 0;
  $("woParts").value = 0;
  $("woTotal").value = 0;
  $("woNotes").value = "";

  $("woCustomerSearch").focus();
}

function bindWorkOrders() {
  $("woCustomerSearch").addEventListener("input", debounce(async () => {
    const term = stableValue($("woCustomerSearch"));
    const items = await searchCustomerSmart(term);
    renderResults($("woCustomerResults"), items, (it) => {
      woSelectedCustomer = it;
      $("woCustomerName").value = it.name || "";
      $("woCustomerPhone").value = it.phone || "";
      $("woCustomerSearch").value = "";
      $("woCustomerResults").innerHTML = "";
      setMsg($("woMsg"), "تم اختيار الزبون.", "ok");
      $("woCustomerName").focus();
    }, "customer");
  }));

  $("woCarSearch").addEventListener("input", debounce(async () => {
    const term = stableValue($("woCarSearch"));
    const items = await searchCarsSmart(term);
    renderResults($("woCarResults"), items, async (it) => {
      woSelectedCar = it;
      $("woPlate").value = it.plate || "";
      $("woCarModel").value = it.model || "";
      $("woCarYear").value = it.year || "";

      if (it.customerId) {
        const cdoc = await db.collection("customers").doc(it.customerId).get().catch(() => null);
        if (cdoc?.exists) {
          const c = cdoc.data();
          woSelectedCustomer = { id: cdoc.id, name: c.name || it.customerName || "", phone: c.phone || it.customerPhone || "" };
        } else {
          woSelectedCustomer = { id: it.customerId, name: it.customerName || "", phone: it.customerPhone || "" };
        }
        $("woCustomerName").value = woSelectedCustomer.name || "";
        $("woCustomerPhone").value = woSelectedCustomer.phone || "";
      }

      $("woCarSearch").value = "";
      $("woCarResults").innerHTML = "";
      setMsg($("woMsg"), "تم اختيار السيارة.", "ok");
      $("woPlate").focus();
    }, "car");
  }));

  $("woEmpSearch").addEventListener("input", debounce(async () => {
    const term = stableValue($("woEmpSearch"));
    if (clean(term).length < 2) { $("woEmpResults").innerHTML = ""; return; }
    const items = await searchEmployeesSmart(term);
    renderResults($("woEmpResults"), items, (it) => {
      woSelectedEmp = it;
      $("woEmpPicked").value = it.name || "";
      $("woEmpSearch").value = "";
      $("woEmpResults").innerHTML = "";
      setMsg($("woMsg"), "تم تعيين الموظف.", "ok");
    }, "employee");
  }, 220));

  $("woCustomerClear").addEventListener("click", () => {
    woSelectedCustomer = null;
    $("woCustomerSearch").value = "";
    $("woCustomerResults").innerHTML = "";
    $("woCustomerName").value = "";
    $("woCustomerPhone").value = "";
  });
  $("woCarClear").addEventListener("click", () => {
    woSelectedCar = null;
    $("woCarSearch").value = "";
    $("woCarResults").innerHTML = "";
    $("woPlate").value = "";
    $("woCarModel").value = "";
    $("woCarYear").value = "";
  });

  const recalc = () => {
    const labor = Number(stableValue($("woLabor")) || 0);
    const parts = Number(stableValue($("woParts")) || 0);
    $("woTotal").value = labor + parts;
  };
  $("woLabor").addEventListener("input", recalc);
  $("woParts").addEventListener("input", recalc);

  $("btnCreateWorkOrder").addEventListener("click", async () => {
    await tick();
    setMsg($("woMsg"), "جارٍ الحفظ...");

    try {
      const name = stableValue($("woCustomerName"));
      const phone = stableValue($("woCustomerPhone"));
      if (!clean(name)) throw new Error("اسم الزبون إجباري");

      const customer = woSelectedCustomer?.id
        ? (await (async () => {
          await db.collection("customers").doc(woSelectedCustomer.id).set(
            { name: clean(name), phone: clean(phone), updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
            { merge: true }
          );
          await syncCustomerToCars(woSelectedCustomer.id, clean(name), clean(phone));
          return { id: woSelectedCustomer.id, name: clean(name), phone: clean(phone) };
        })())
        : await upsertCustomer({ name, phone });

      const plate = stableValue($("woPlate"));
      const model = stableValue($("woCarModel"));
      const year = stableValue($("woCarYear"));

      let car = null;
      if (clean(plate)) car = await upsertCar({ plate, model, year, customer });

      const deptId = $("woDept").value || "";
      const deptName = $("woDept").selectedOptions?.[0]?.textContent || "";

      const labor = Number(stableValue($("woLabor")) || 0);
      const parts = Number(stableValue($("woParts")) || 0);
      const total = labor + parts;

      await createOrder("work", {
        customerId: customer.id, customerName: customer.name, customerPhone: customer.phone || "",
        carId: car?.id || null,
        plate: car?.plate || normalizePlate(plate) || "",
        carModel: car?.model || clean(model) || "",
        carYear: car?.year || (year ? Number(year) : null),
        deptId, deptName,
        labor, parts, total,
        notes: clean(stableValue($("woNotes"))),
        assignedEmployeeId: woSelectedEmp?.id || null,
        assignedEmployeeName: woSelectedEmp?.name || ""
      });

      setMsg($("woMsg"), "تم إنشاء أمر تشغيلي ✅", "ok");
      await loadRecentOrders("work");
      await refreshDashboard();

      clearWorkOrderForm();

    } catch (e) {
      console.error(e);
      setMsg($("woMsg"), e.message || "فشل", "err");
    }
  });
}

// =========================
// Recent Orders + dashboard blocks
// =========================
function renderOrdersTable(tableEl, orders, opts = {}) {
  tableEl.innerHTML = "";
  const head = document.createElement("div");
  head.className = "table-row head";
  head.innerHTML = `<div>الزبون</div><div>السيارة</div><div>${opts.midTitle || "تفاصيل"}</div><div>تاريخ</div>`;
  tableEl.appendChild(head);

  if (!orders.length) {
    const r = document.createElement("div");
    r.className = "table-row";
    r.style.gridTemplateColumns = "1fr";
    r.innerHTML = "<div>لا توجد بيانات</div>";
    tableEl.appendChild(r);
    return;
  }

  orders.forEach(o => {
    const r = document.createElement("div");
    r.className = "table-row";
    const c = `${o.customerName || "—"} ${o.customerPhone ? ("• " + o.customerPhone) : ""}`;
    const car = `${o.plate || "—"} • ${o.carModel || ""}`;
    const mid = opts.midFn ? opts.midFn(o) : (o.notes || "—");
    r.innerHTML = `<div>${escapeHtml(c)}</div><div>${escapeHtml(car)}</div><div>${escapeHtml(mid)}</div><div>${escapeHtml(formatDate(o.createdAt))}</div>`;
    tableEl.appendChild(r);
  });
}

async function loadRecentOrders(type) {
  const table = type === "reception" ? $("rxTable") : $("woTable");
  table.innerHTML = "جارٍ التحميل...";

  const snap = await db.collection("orders")
    .where("type", "==", type)
    .orderBy("createdAt", "desc")
    .limit(10)
    .get()
    .catch(() => null);

  const orders = snap?.empty ? [] : snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (type === "work") {
    renderOrdersTable(table, orders, { midTitle: "القسم/الحالة", midFn: (o) => `${o.deptName || "—"} • ${statusLabel(o.status)} • ${o.assignedEmployeeName || "غير معيّن"}` });
  } else {
    renderOrdersTable(table, orders, { midTitle: "ملاحظات", midFn: (o) => o.notes || "—" });
  }
}

function statusLabel(s) {
  return ({
    open: "مفتوح",
    in_progress: "قيد العمل",
    done: "مكتمل",
    canceled: "ملغي"
  }[s] || s || "—");
}

async function refreshDashboard() {
  await refreshKPIs();
  await loadUIConfig();
  await loadLastCustomers();
  await loadLastOrders();
}

async function refreshKPIs() {
  try {
    const [c1, c2, c3] = await Promise.all([
      db.collection("customers").get(),
      db.collection("cars").get(),
      db.collection("orders").where("status", "in", ["open", "in_progress"]).get()
    ]);
    $("kpiCustomers").textContent = c1.size;
    $("kpiCars").textContent = c2.size;
    $("kpiOpenOrders").textContent = c3.size;
  } catch (e) { }
}

async function loadLastCustomers() {
  const box = $("lastCustomers");
  box.innerHTML = "جارٍ التحميل...";
  const snap = await db.collection("customers").orderBy("createdAt", "desc").limit(5).get().catch(() => null);
  const rows = snap?.empty ? [] : snap.docs.map(d => ({ id: d.id, ...d.data() }));
  box.innerHTML = "";
  if (!rows.length) {
    box.innerHTML = '<div class="result-item"><div>لا يوجد</div><div class="result-meta">—</div></div>';
    return;
  }
  rows.forEach(c => {
    const el = document.createElement("div");
    el.className = "result-item";
    el.innerHTML = `<div><b>${escapeHtml(c.name || "—")}</b><div class="result-meta">${escapeHtml(c.phone || "")}</div></div><div class="result-meta">فتح</div>`;
    el.addEventListener("click", () => {
      navigate("customers");
      custEditingId = c.id;
      $("custFormTitle").textContent = "تعديل زبون";
      $("custName").value = c.name || "";
      $("custPhone").value = c.phone || "";
      loadCustomerCars(c.id);
    });
    box.appendChild(el);
  });
}

async function loadLastOrders() {
  const table = $("lastOrders");
  table.innerHTML = "جارٍ التحميل...";
  const snap = await db.collection("orders").orderBy("createdAt", "desc").limit(6).get().catch(() => null);
  const orders = snap?.empty ? [] : snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderOrdersTable(table, orders, { midTitle: "الحالة", midFn: (o) => `${statusLabel(o.status)} • ${o.assignedEmployeeName || "—"}` });
}

// =========================
// Quick search
// =========================
function bindDashboardQuickSearch() {
  const run = async () => {
    const term = stableValue($("quickSearch"));
    const box = $("quickResults");
    box.innerHTML = "جارٍ البحث...";
    const cust = await searchCustomerSmart(term);
    const cars = await searchCarsSmart(term);
    const items = [];
    cust.forEach(c => items.push({ type: "customer", ...c }));
    cars.forEach(c => items.push({ type: "car", ...c }));
    box.innerHTML = "";
    if (!items.length) {
      box.innerHTML = '<div class="result-item"><div>لا توجد نتائج</div><div class="result-meta">—</div></div>';
      return;
    }
    items.slice(0, 12).forEach(it => {
      const el = document.createElement("div");
      el.className = "result-item";
      if (it.type === "customer") {
        el.innerHTML = `<div><b>زبون:</b> ${escapeHtml(it.name || "—")}<div class="result-meta">${escapeHtml(it.phone || "")}</div></div><div class="result-meta">فتح</div>`;
        el.addEventListener("click", () => {
          navigate("customers");
          custEditingId = it.id;
          $("custFormTitle").textContent = "تعديل زبون";
          $("custName").value = it.name || "";
          $("custPhone").value = it.phone || "";
          loadCustomerCars(it.id);
        });
      } else {
        el.innerHTML = `<div><b>سيارة:</b> ${escapeHtml(it.plate || "—")}<div class="result-meta">${escapeHtml(it.model || "")} • ${escapeHtml(it.customerName || "")}</div></div><div class="result-meta">فتح</div>`;
        el.addEventListener("click", () => {
          navigate("cars");
          carEditingId = it.id;
          $("carFormTitle").textContent = "تعديل سيارة";
          $("carPlate").value = it.plate || "";
          $("carModel").value = it.model || "";
          $("carYear").value = it.year || "";
          $("carOwnerSearch").value = `${it.customerName || ""} ${it.customerPhone || ""}`.trim();
          $("carOwnerSearch").dataset.customerId = it.customerId || "";
          $("carOwnerSearch").dataset.customerName = it.customerName || "";
          $("carOwnerSearch").dataset.customerPhone = it.customerPhone || "";
        });
      }
      box.appendChild(el);
    });
  };
  $("btnQuickSearch").addEventListener("click", run);
  $("quickSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
}

// =========================
// Customers page
// =========================
async function loadCustomerCars(customerId) {
  const table = $("custCars");
  table.innerHTML = "جارٍ التحميل...";
  const snap = await db.collection("cars").where("customerId", "==", customerId).orderBy("plate").limit(50).get().catch(() => null);
  const cars = snap?.empty ? [] : snap.docs.map(d => ({ id: d.id, ...d.data() }));

  table.innerHTML = "";
  const head = document.createElement("div");
  head.className = "table-row head";
  head.innerHTML = "<div>اللوحة</div><div>الموديل</div><div>السنة</div><div>—</div>";
  table.appendChild(head);

  if (!cars.length) {
    const r = document.createElement("div");
    r.className = "table-row";
    r.style.gridTemplateColumns = "1fr";
    r.innerHTML = "<div>لا توجد سيارات مرتبطة</div>";
    table.appendChild(r);
    return;
  }

  cars.forEach(c => {
    const r = document.createElement("div");
    r.className = "table-row";
    r.innerHTML = `<div>${escapeHtml(c.plate || "—")}</div><div>${escapeHtml(c.model || "—")}</div><div>${escapeHtml(c.year ?? "—")}</div><div class="result-meta">—</div>`;
    table.appendChild(r);
  });
}

function bindCustomers() {
  $("btnCustNew").addEventListener("click", () => {
    custEditingId = null;
    $("custFormTitle").textContent = "إضافة زبون";
    $("custName").value = "";
    $("custPhone").value = "";
    $("custResults").innerHTML = "";
    $("custCars").innerHTML = "";
    setMsg($("custMsg"), "");
    $("custName").focus();
  });

  const run = async () => {
    const res = await searchCustomerSmart(stableValue($("custSearch")));
    const box = $("custResults");
    box.innerHTML = "";
    if (!res.length) {
      box.innerHTML = '<div class="result-item"><div>لا توجد نتائج</div><div class="result-meta">—</div></div>';
      return;
    }
    res.forEach(it => {
      const el = document.createElement("div");
      el.className = "result-item";
      el.innerHTML = `<div><b>${escapeHtml(it.name || "—")}</b><div class="result-meta">${escapeHtml(it.phone || "")}</div></div><div class="result-meta">تحرير</div>`;
      el.addEventListener("click", () => {
        custEditingId = it.id;
        $("custFormTitle").textContent = "تعديل زبون";
        $("custName").value = it.name || "";
        $("custPhone").value = it.phone || "";
        setMsg($("custMsg"), "تم اختيار الزبون للتحرير.", "ok");
        loadCustomerCars(it.id);
      });
      box.appendChild(el);
    });
  };

  $("btnCustSearch").addEventListener("click", run);
  $("custSearch").addEventListener("input", debounce(async () => {
    if (clean(stableValue($("custSearch"))).length < 2) { $("custResults").innerHTML = ""; return; }
    await run();
  }));

  $("btnCustSave").addEventListener("click", async () => {
    await tick();
    setMsg($("custMsg"), "جارٍ الحفظ...");
    try {
      const name = stableValue($("custName"));
      const phone = stableValue($("custPhone"));
      if (!clean(name)) throw new Error("الاسم مطلوب");
      if (custEditingId) {
        await db.collection("customers").doc(custEditingId).set(
          { name: clean(name), phone: clean(phone), updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
          { merge: true }
        );
        await syncCustomerToCars(custEditingId, clean(name), clean(phone));
        setMsg($("custMsg"), "تم التحديث ✅", "ok");
        await loadCustomerCars(custEditingId);
      } else {
        const c = await upsertCustomer({ name, phone });
        custEditingId = c.id;
        setMsg($("custMsg"), "تمت الإضافة ✅", "ok");
        await loadCustomerCars(c.id);
      }
      await refreshDashboard();
    } catch (e) {
      setMsg($("custMsg"), e.message || "فشل", "err");
    }
  });

  $("btnCustDelete").addEventListener("click", async () => {
    if (!custEditingId) return setMsg($("custMsg"), "اختاري زبون أولاً", "err");
    if (!confirm("حذف الزبون؟")) return;
    await db.collection("customers").doc(custEditingId).delete();
    custEditingId = null;
    $("custName").value = "";
    $("custPhone").value = "";
    $("custCars").innerHTML = "";
    setMsg($("custMsg"), "تم الحذف", "ok");
    await refreshDashboard();
  });
}

// =========================
// Cars page
// =========================
function bindCars() {
  $("btnCarNew").addEventListener("click", () => {
    carEditingId = null;
    $("carFormTitle").textContent = "إضافة سيارة";
    $("carPlate").value = "";
    $("carModel").value = "";
    $("carYear").value = "";
    $("carOwnerSearch").value = "";
    $("carOwnerSearch").dataset.customerId = "";
    $("carOwnerResults").innerHTML = "";
    setMsg($("carMsg"), "");
    $("carPlate").focus();
  });

  const run = async () => {
    const res = await searchCarsSmart(stableValue($("carSearch")));
    const box = $("carResults");
    box.innerHTML = "";
    if (!res.length) {
      box.innerHTML = '<div class="result-item"><div>لا توجد نتائج</div><div class="result-meta">—</div></div>';
      return;
    }
    res.forEach(it => {
      const el = document.createElement("div");
      el.className = "result-item";
      el.innerHTML = `<div><b>${escapeHtml(it.plate || "—")}</b><div class="result-meta">${escapeHtml(it.model || "")} • ${escapeHtml(it.customerName || "")}${it.customerPhone ? (" • " + escapeHtml(it.customerPhone)) : ""}</div></div><div class="result-meta">تحرير</div>`;
      el.addEventListener("click", () => {
        carEditingId = it.id;
        $("carFormTitle").textContent = "تعديل سيارة";
        $("carPlate").value = it.plate || "";
        $("carModel").value = it.model || "";
        $("carYear").value = it.year || "";
        $("carOwnerSearch").value = `${it.customerName || ""} ${it.customerPhone || ""}`.trim();
        $("carOwnerSearch").dataset.customerId = it.customerId || "";
        $("carOwnerSearch").dataset.customerName = it.customerName || "";
        $("carOwnerSearch").dataset.customerPhone = it.customerPhone || "";
        setMsg($("carMsg"), "تم اختيار السيارة للتحرير.", "ok");
      });
      box.appendChild(el);
    });
  };

  $("btnCarSearch").addEventListener("click", run);
  $("carSearch").addEventListener("input", debounce(async () => {
    if (clean(stableValue($("carSearch"))).length < 2) { $("carResults").innerHTML = ""; return; }
    await run();
  }));

  $("carOwnerSearch").addEventListener("input", debounce(async () => {
    const term = stableValue($("carOwnerSearch"));
    if (clean(term).length < 2) { $("carOwnerResults").innerHTML = ""; return; }
    const res = await searchCustomerSmart(term);
    renderResults($("carOwnerResults"), res, (c) => {
      $("carOwnerSearch").value = `${c.name || ""} ${c.phone || ""}`.trim();
      $("carOwnerSearch").dataset.customerId = c.id;
      $("carOwnerSearch").dataset.customerName = c.name || "";
      $("carOwnerSearch").dataset.customerPhone = c.phone || "";
      $("carOwnerResults").innerHTML = "";
      setMsg($("carMsg"), "تم اختيار المالك.", "ok");
    }, "customer");
  }));

  $("btnCarSave").addEventListener("click", async () => {
    await tick();
    setMsg($("carMsg"), "جارٍ الحفظ...");
    try {
      const plate = stableValue($("carPlate"));
      const model = stableValue($("carModel"));
      const year = stableValue($("carYear"));

      const ownerId = $("carOwnerSearch").dataset.customerId || null;
      const owner = ownerId ? {
        id: ownerId,
        name: $("carOwnerSearch").dataset.customerName || "",
        phone: $("carOwnerSearch").dataset.customerPhone || ""
      } : null;

      if (carEditingId) {
        await db.collection("cars").doc(carEditingId).set({
          plate: normalizePlate(plate),
          model: clean(model),
          year: year ? Number(year) : null,
          customerId: owner?.id || null,
          customerName: owner?.name || "",
          customerPhone: owner?.phone || "",
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        setMsg($("carMsg"), "تم التحديث ✅", "ok");
      } else {
        const c = await upsertCar({ plate, model, year, customer: owner });
        carEditingId = c.id;
        setMsg($("carMsg"), "تمت الإضافة ✅", "ok");
      }
      await refreshDashboard();
    } catch (e) {
      setMsg($("carMsg"), e.message || "فشل", "err");
    }
  });

  $("btnCarDelete").addEventListener("click", async () => {
    if (!carEditingId) return setMsg($("carMsg"), "اختاري سيارة أولاً", "err");
    if (!confirm("حذف السيارة؟")) return;
    await db.collection("cars").doc(carEditingId).delete();
    carEditingId = null;
    $("carPlate").value = "";
    $("carModel").value = "";
    $("carYear").value = "";
    $("carOwnerSearch").value = "";
    $("carOwnerSearch").dataset.customerId = "";
    $("carOwnerResults").innerHTML = "";
    setMsg($("carMsg"), "تم الحذف", "ok");
    await refreshDashboard();
  });
}

// =========================
// Orders page (status + assign + create/open invoice)
// =========================
async function loadOrdersPage() {
  $("ordersMsg").textContent = "";
  await renderOrdersPage();
}
async function renderOrdersPage() {
  const table = $("ordersTable");
  table.innerHTML = "جارٍ التحميل...";
  const snap = await db.collection("orders").orderBy("createdAt", "desc").limit(50).get().catch(() => null);
  const orders = snap?.empty ? [] : snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const term = clean(stableValue($("ordSearch")));
  const type = $("ordType").value;
  const status = $("ordStatus").value;

  const filtered = orders.filter(o => {
    const hay = `${o.customerName || ""} ${o.customerPhone || ""} ${o.plate || ""} ${o.carModel || ""} ${o.deptName || ""} ${o.assignedEmployeeName || ""} ${o.type || ""} ${o.status || ""}`.toLowerCase();
    const okTerm = !term || hay.includes(term.toLowerCase());
    const okType = type === "all" || o.type === type;
    const okStatus = status === "all" || o.status === status;
    return okTerm && okType && okStatus;
  });

  table.innerHTML = "";
  const head = document.createElement("div");
  head.className = "table-row head";
  head.innerHTML = "<div>الزبون</div><div>السيارة</div><div>الحالة/الموظف</div><div>إجراءات</div>";
  table.appendChild(head);

  if (!filtered.length) {
    const r = document.createElement("div");
    r.className = "table-row";
    r.style.gridTemplateColumns = "1fr";
    r.innerHTML = "<div>لا توجد أوامر مطابقة</div>";
    table.appendChild(r);
    return;
  }

  filtered.forEach(o => {
    const r = document.createElement("div");
    r.className = "table-row";

    const customer = `${o.customerName || "—"} ${o.customerPhone ? ("• " + o.customerPhone) : ""}`;
    const car = `${o.plate || "—"} • ${o.carModel || ""}`;
    const mid = `${statusLabel(o.status)} • ${o.assignedEmployeeName || "غير معيّن"}${o.deptName ? (" • " + o.deptName) : ""}`;

    const act = document.createElement("div");
    act.className = "table-actions";

    const btnOpen = document.createElement("button");
    btnOpen.className = "btn btn-mini btn-ghost";
    btnOpen.textContent = "فتح";
    btnOpen.onclick = () => {
      if (o.type === "work") navigate("workorders");
      else navigate("reception");
    };

    const btnStatus = document.createElement("button");
    btnStatus.className = "btn btn-mini btn-secondary";
    btnStatus.textContent = "تغيير الحالة";
    btnStatus.onclick = async () => {
      const next = prompt("الحالة: open / in_progress / done / canceled", o.status || "open");
      if (!next) return;
      await db.collection("orders").doc(o.id).set({ status: clean(next) }, { merge: true });
      setMsg($("ordersMsg"), "تم تحديث الحالة ✅", "ok");
      await renderOrdersPage();
      await refreshDashboard();
    };

    const btnAssign = document.createElement("button");
    btnAssign.className = "btn btn-mini btn-ghost";
    btnAssign.textContent = "تعيين موظف";
    btnAssign.onclick = async () => {
      const term = prompt("اكتب اسم الموظف/هاتفه للبحث:", "");
      if (!term) return;
      const emps = await searchEmployeesSmart(term);
      if (!emps.length) return alert("لا توجد نتائج موظفين.");
      const pick = emps[0]; // أول نتيجة (يمكن تطويرها لاحقاً لواجهة اختيار)
      await db.collection("orders").doc(o.id).set({
        assignedEmployeeId: pick.id,
        assignedEmployeeName: pick.name || ""
      }, { merge: true });
      setMsg($("ordersMsg"), "تم تعيين الموظف ✅", "ok");
      await renderOrdersPage();
    };

    const btnInvoice = document.createElement("button");
    btnInvoice.className = "btn btn-mini";
    btnInvoice.textContent = "فاتورة";
    btnInvoice.onclick = async () => {
      const invId = await ensureInvoiceForOrder(o);
      await openInvoice(invId);
      navigate("invoices");
    };

    act.appendChild(btnInvoice);
    act.appendChild(btnAssign);
    act.appendChild(btnStatus);

    r.innerHTML = `<div>${escapeHtml(customer)}</div><div>${escapeHtml(car)}</div><div>${escapeHtml(mid)}</div>`;
    r.appendChild(act);
    table.appendChild(r);
  });
}

function bindOrdersPage() {
  const rer = debounce(renderOrdersPage, 220);
  $("ordSearch").addEventListener("input", rer);
  $("ordType").addEventListener("change", rer);
  $("ordStatus").addEventListener("change", rer);
  $("btnOrdersReload").addEventListener("click", renderOrdersPage);
}

// =========================
// Invoices: create/edit/print + template from admin
// =========================
function calcInvoiceTotals(inv) {
  const items = inv.items || [];
  const subtotal = items.reduce((s, x) => s + (Number(x.qty || 0) * Number(x.price || 0)), 0);
  const discount = Number(inv.discount || 0);
  const taxPct = Number(inv.taxPct || 0);
  const afterDiscount = Math.max(0, subtotal - discount);
  const tax = afterDiscount * (taxPct / 100);
  const total = afterDiscount + tax;

  inv.subtotal = round2(subtotal);
  inv.tax = round2(tax);
  inv.total = round2(total);
  return inv;
}
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

async function getInvoiceTemplate() {
  if (!uiCfg) await loadUIConfig();
  return uiCfg?.invoiceTemplate || {
    shopName: "ورشة RPM",
    shopPhone: "",
    shopAddress: "",
    currency: "IQD",
    headerHtml: "<h2>{{shopName}}</h2><hr/>",
    footerHtml: "<div>شكراً</div>",
    css: ""
  };
}

function applyTplVars(html, vars) {
  return String(html || "").replace(/\{\{(\w+)\}\}/g, (_, k) => escapeHtml(vars[k] ?? ""));
}

async function ensureInvoiceForOrder(order) {
  // إذا هناك فاتورة مرتبطة بالأمر -> رجعها
  const snap = await db.collection("invoices").where("orderId", "==", order.id).limit(1).get().catch(() => null);
  if (snap && !snap.empty) return snap.docs[0].id;

  // إنشاء رقم فاتورة عبر Transaction
  const cfgRef = db.collection("uiConfig").doc("main");
  const newInvRef = db.collection("invoices").doc();

  await db.runTransaction(async (tx) => {
    const cfgSnap = await tx.get(cfgRef);
    const cfg = cfgSnap.exists ? cfgSnap.data() : {};
    const next = Number(cfg.nextInvoiceNo || 1);

    const items = [
      { desc: "أجور عمل", qty: 1, price: Number(order.labor || 0) },
      { desc: "قطع غيار", qty: 1, price: Number(order.parts || 0) }
    ].filter(x => x.price !== 0 || order.type === "work");

    const inv = calcInvoiceTotals({
      invoiceNo: next,
      orderId: order.id,
      status: "unpaid",
      customerId: order.customerId || null,
      customerName: order.customerName || "",
      customerPhone: order.customerPhone || "",
      carId: order.carId || null,
      plate: order.plate || "",
      carModel: order.carModel || "",
      items,
      discount: 0,
      taxPct: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    tx.set(newInvRef, inv, { merge: true });
    tx.set(cfgRef, { nextInvoiceNo: next + 1, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  });

  return newInvRef.id;
}

async function loadInvoicesPage() {
  $("invoiceEditor").classList.add("hidden");
  await renderInvoicesTable();
}

async function renderInvoicesTable() {
  const table = $("invoicesTable");
  table.innerHTML = "جارٍ التحميل...";
  const snap = await db.collection("invoices").orderBy("createdAt", "desc").limit(60).get().catch(() => null);
  const invoices = snap?.empty ? [] : snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const term = clean(stableValue($("invSearch")));
  const st = $("invStatus").value;

  const filtered = invoices.filter(inv => {
    const hay = `${inv.invoiceNo || ""} ${inv.customerName || ""} ${inv.customerPhone || ""} ${inv.plate || ""} ${inv.carModel || ""}`.toLowerCase();
    const okTerm = !term || hay.includes(term.toLowerCase());
    const okStatus = st === "all" || inv.status === st;
    return okTerm && okStatus;
  });

  table.innerHTML = "";
  const head = document.createElement("div");
  head.className = "table-row head";
  head.innerHTML = "<div>رقم/زبون</div><div>سيارة</div><div>المبلغ/الحالة</div><div>إجراءات</div>";
  table.appendChild(head);

  if (!filtered.length) {
    const r = document.createElement("div");
    r.className = "table-row";
    r.style.gridTemplateColumns = "1fr";
    r.innerHTML = "<div>لا توجد فواتير مطابقة</div>";
    table.appendChild(r);
    return;
  }

  filtered.forEach(inv => {
    const r = document.createElement("div");
    r.className = "table-row";

    const left = `#${inv.invoiceNo ?? "—"} • ${inv.customerName || "—"} ${inv.customerPhone ? ("• " + inv.customerPhone) : ""}`;
    const car = `${inv.plate || "—"} • ${inv.carModel || ""}`;
    const mid = `${inv.total ?? 0} ${uiCfg?.invoiceTemplate?.currency || "IQD"} • ${inv.status === "paid" ? "مدفوعة" : "غير مدفوعة"}`;

    const act = document.createElement("div");
    act.className = "table-actions";

    const btnOpen = document.createElement("button");
    btnOpen.className = "btn btn-mini btn-secondary";
    btnOpen.textContent = "فتح";
    btnOpen.onclick = async () => openInvoice(inv.id);

    const btnPrint = document.createElement("button");
    btnPrint.className = "btn btn-mini btn-ghost";
    btnPrint.textContent = "طباعة";
    btnPrint.onclick = async () => {
      const data = await getInvoice(inv.id);
      await printInvoice(data);
    };

    act.appendChild(btnOpen);
    act.appendChild(btnPrint);

    r.innerHTML = `<div>${escapeHtml(left)}</div><div>${escapeHtml(car)}</div><div>${escapeHtml(mid)}</div>`;
    r.appendChild(act);
    table.appendChild(r);
  });
}

async function getInvoice(id) {
  const snap = await db.collection("invoices").doc(id).get();
  if (!snap.exists) throw new Error("الفاتورة غير موجودة");
  return { id: snap.id, ...snap.data() };
}

async function openInvoice(id) {
  invEditingId = id;
  invEditingData = await getInvoice(id);
  invEditingData = calcInvoiceTotals(invEditingData);

  $("invoiceEditor").classList.remove("hidden");
  $("invEditTitle").textContent = `تعديل فاتورة #${invEditingData.invoiceNo ?? "—"}`;

  $("invNo").value = invEditingData.invoiceNo ?? "";
  $("invPaid").value = invEditingData.status || "unpaid";
  $("invDate").value = formatDate(invEditingData.createdAt);

  $("invCustomer").value = `${invEditingData.customerName || "—"} • ${invEditingData.customerPhone || ""}`.trim();
  $("invCar").value = `${invEditingData.plate || "—"} • ${invEditingData.carModel || ""}`.trim();
  $("invOrder").value = invEditingData.orderId || "—";

  $("invDiscount").value = invEditingData.discount || 0;
  $("invTax").value = invEditingData.taxPct || 0;

  renderInvoiceItems();
  updateInvoiceTotalUI();
  setMsg($("invEditorMsg"), "");
}

function renderInvoiceItems() {
  const wrap = $("invItems");
  wrap.innerHTML = "";

  const items = invEditingData?.items || [];
  if (!items.length) {
    wrap.innerHTML = `<div class="inv-item"><div class="muted">لا توجد بنود</div><div></div><div></div><div></div></div>`;
    return;
  }

  items.forEach((it, idx) => {
    const row = document.createElement("div");
    row.className = "inv-item";

    row.innerHTML = `
      <input data-k="desc" placeholder="الوصف" value="${escapeHtml(it.desc || "")}"/>
      <input data-k="qty" type="number" placeholder="الكمية" value="${escapeHtml(it.qty ?? 1)}"/>
      <input data-k="price" type="number" placeholder="السعر" value="${escapeHtml(it.price ?? 0)}"/>
      <button class="btn btn-mini btn-danger" title="حذف">✕</button>
    `;

    const inputs = qsa("input", row);
    inputs.forEach(inp => {
      attachCompositionGuard(inp);
      inp.addEventListener("input", () => {
        const k = inp.dataset.k;
        if (k === "desc") invEditingData.items[idx].desc = stableValue(inp);
        if (k === "qty") invEditingData.items[idx].qty = Number(stableValue(inp) || 0);
        if (k === "price") invEditingData.items[idx].price = Number(stableValue(inp) || 0);
        calcInvoiceTotals(invEditingData);
        updateInvoiceTotalUI();
      });
    });

    qs("button", row).addEventListener("click", () => {
      invEditingData.items.splice(idx, 1);
      calcInvoiceTotals(invEditingData);
      renderInvoiceItems();
      updateInvoiceTotalUI();
    });

    wrap.appendChild(row);
  });
}

function updateInvoiceTotalUI() {
  const d = Number(stableValue($("invDiscount")) || 0);
  const t = Number(stableValue($("invTax")) || 0);
  invEditingData.discount = d;
  invEditingData.taxPct = t;
  calcInvoiceTotals(invEditingData);

  const cur = uiCfg?.invoiceTemplate?.currency || "IQD";
  $("invTotal").value = `${invEditingData.total} ${cur}`;
}

function bindInvoicesPage() {
  const rer = debounce(renderInvoicesTable, 220);
  $("invSearch").addEventListener("input", rer);
  $("invStatus").addEventListener("change", rer);
  $("btnInvoicesReload").addEventListener("click", renderInvoicesTable);

  $("btnInvAddItem").addEventListener("click", () => {
    invEditingData.items = invEditingData.items || [];
    invEditingData.items.push({ desc: "", qty: 1, price: 0 });
    renderInvoiceItems();
    updateInvoiceTotalUI();
  });

  $("invDiscount").addEventListener("input", () => updateInvoiceTotalUI());
  $("invTax").addEventListener("input", () => updateInvoiceTotalUI());

  $("btnInvSave").addEventListener("click", async () => {
    await tick();
    try {
      if (!invEditingId) return;
      invEditingData.status = $("invPaid").value;

      calcInvoiceTotals(invEditingData);

      await db.collection("invoices").doc(invEditingId).set({
        status: invEditingData.status,
        items: invEditingData.items || [],
        discount: Number(invEditingData.discount || 0),
        taxPct: Number(invEditingData.taxPct || 0),
        subtotal: invEditingData.subtotal,
        tax: invEditingData.tax,
        total: invEditingData.total,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        paidAt: invEditingData.status === "paid" ? firebase.firestore.FieldValue.serverTimestamp() : null
      }, { merge: true });

      setMsg($("invEditorMsg"), "تم حفظ الفاتورة ✅", "ok");
      await renderInvoicesTable();
      await refreshDashboard();
    } catch (e) {
      console.error(e);
      setMsg($("invEditorMsg"), e.message || "فشل", "err");
    }
  });

  $("btnInvClose").addEventListener("click", () => {
    $("invoiceEditor").classList.add("hidden");
    invEditingId = null;
    invEditingData = null;
  });

  $("btnInvPrint").addEventListener("click", async () => {
    try {
      if (!invEditingId) return;
      const data = await getInvoice(invEditingId);
      await printInvoice(data);
    } catch (e) {
      setMsg($("invEditorMsg"), e.message || "فشل", "err");
    }
  });
}

// ============ Printing ============
async function printInvoice(inv) {
  const tpl = await getInvoiceTemplate();
  const cur = tpl.currency || "IQD";
  inv = calcInvoiceTotals(inv);

  const vars = {
    shopName: tpl.shopName || "",
    shopPhone: tpl.shopPhone || "",
    shopAddress: tpl.shopAddress || "",
    currency: cur,
    invoiceNo: inv.invoiceNo ?? "",
    date: formatDate(inv.createdAt),
    customerName: inv.customerName || "",
    customerPhone: inv.customerPhone || "",
    plate: inv.plate || "",
    carModel: inv.carModel || "",
    subtotal: inv.subtotal ?? 0,
    discount: inv.discount ?? 0,
    taxPct: inv.taxPct ?? 0,
    tax: inv.tax ?? 0,
    total: inv.total ?? 0
  };

  const header = applyTplVars(tpl.headerHtml || "", vars);
  const footer = applyTplVars(tpl.footerHtml || "", vars);

  const itemsRows = (inv.items || []).map(x => `
    <tr>
      <td>${escapeHtml(x.desc || "")}</td>
      <td style="text-align:center">${escapeHtml(x.qty ?? 0)}</td>
      <td style="text-align:center">${escapeHtml(x.price ?? 0)}</td>
      <td style="text-align:center">${round2(Number(x.qty || 0) * Number(x.price || 0))}</td>
    </tr>
  `).join("");

  const html = `
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>فاتورة #${escapeHtml(inv.invoiceNo)}</title>
<style>
  body{ font-family: Tahoma, Arial, sans-serif; margin:20px; color:#111; }
  .wrap{ max-width:820px; margin:auto; }
  .meta{ display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .box{ border:1px solid #ddd; border-radius:10px; padding:10px 12px; }
  table{ width:100%; border-collapse:collapse; margin-top:12px; }
  th,td{ border:1px solid #ddd; padding:8px; font-size:14px; }
  th{ background:#f5f5f5; }
  .totals{ margin-top:12px; display:flex; justify-content:flex-end; }
  .totals .box{ min-width:280px; }
  .row{ display:flex; justify-content:space-between; margin:6px 0; }
  .big{ font-size:18px; font-weight:700; }
  hr{ border:none; border-top:1px solid #e5e5e5; margin:10px 0; }
  @media print { .no-print{ display:none; } body{ margin:0; } }
  ${tpl.css || ""}
</style>
</head>
<body>
  <div class="wrap">
    <div class="no-print" style="display:flex;justify-content:flex-end;gap:10px;margin-bottom:10px">
      <button onclick="window.print()">طباعة</button>
      <button onclick="window.close()">إغلاق</button>
    </div>

    ${header}

    <div class="meta">
      <div class="box">
        <div><b>رقم الفاتورة:</b> #${escapeHtml(inv.invoiceNo)}</div>
        <div><b>التاريخ:</b> ${escapeHtml(formatDate(inv.createdAt))}</div>
        <div><b>الحالة:</b> ${inv.status === "paid" ? "مدفوعة" : "غير مدفوعة"}</div>
      </div>
      <div class="box">
        <div><b>الزبون:</b> ${escapeHtml(inv.customerName || "—")}</div>
        <div><b>الهاتف:</b> ${escapeHtml(inv.customerPhone || "")}</div>
        <div><b>السيارة:</b> ${escapeHtml(inv.plate || "—")} • ${escapeHtml(inv.carModel || "")}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>الوصف</th><th style="width:90px">الكمية</th><th style="width:120px">السعر</th><th style="width:120px">المجموع</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows || `<tr><td colspan="4" style="text-align:center">لا توجد بنود</td></tr>`}
      </tbody>
    </table>

    <div class="totals">
      <div class="box">
        <div class="row"><span>Subtotal</span><span>${inv.subtotal} ${escapeHtml(cur)}</span></div>
        <div class="row"><span>خصم</span><span>${inv.discount} ${escapeHtml(cur)}</span></div>
        <div class="row"><span>ضريبة (${inv.taxPct}%)</span><span>${inv.tax} ${escapeHtml(cur)}</span></div>
        <hr/>
        <div class="row big"><span>الإجمالي</span><span>${inv.total} ${escapeHtml(cur)}</span></div>
      </div>
    </div>

    <div style="margin-top:14px">
      ${footer}
    </div>
  </div>
</body>
</html>
  `;

  const w = window.open("", "_blank", "width=920,height=720");
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
}

// =========================
// Global Search page
// =========================
function bindGlobalSearch() {
  const run = async () => {
    const term = stableValue($("globalSearch"));
    $("searchCustomers").innerHTML = "جارٍ البحث...";
    $("searchCars").innerHTML = "جارٍ البحث...";
    $("searchOrders").innerHTML = "جارٍ البحث...";
    $("searchInvoices").innerHTML = "جارٍ البحث...";

    const [cust, cars] = await Promise.all([
      searchCustomerSmart(term),
      searchCarsSmart(term)
    ]);

    renderResults($("searchCustomers"), cust, (it) => {
      navigate("customers");
      custEditingId = it.id;
      $("custFormTitle").textContent = "تعديل زبون";
      $("custName").value = it.name || "";
      $("custPhone").value = it.phone || "";
      loadCustomerCars(it.id);
    }, "customer");

    renderResults($("searchCars"), cars, (it) => {
      navigate("cars");
      carEditingId = it.id;
      $("carFormTitle").textContent = "تعديل سيارة";
      $("carPlate").value = it.plate || "";
      $("carModel").value = it.model || "";
      $("carYear").value = it.year || "";
      $("carOwnerSearch").value = `${it.customerName || ""} ${it.customerPhone || ""}`.trim();
      $("carOwnerSearch").dataset.customerId = it.customerId || "";
      $("carOwnerSearch").dataset.customerName = it.customerName || "";
      $("carOwnerSearch").dataset.customerPhone = it.customerPhone || "";
    }, "car");

    // Orders (client search)
    const ordSnap = await db.collection("orders").orderBy("createdAt", "desc").limit(40).get().catch(() => null);
    const orders = ordSnap?.empty ? [] : ordSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const termLc = clean(term).toLowerCase();
    const ordFiltered = orders.filter(o => (`${o.customerName} ${o.customerPhone} ${o.plate} ${o.carModel} ${o.deptName} ${o.assignedEmployeeName}`.toLowerCase().includes(termLc)));

    renderOrdersTable($("searchOrders"), ordFiltered.slice(0, 10), { midTitle: "الحالة", midFn: (o) => `${statusLabel(o.status)} • ${o.assignedEmployeeName || "—"}` });

    // Invoices (client search)
    const invSnap = await db.collection("invoices").orderBy("createdAt", "desc").limit(40).get().catch(() => null);
    const invoices = invSnap?.empty ? [] : invSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const invFiltered = invoices.filter(i => (`${i.invoiceNo} ${i.customerName} ${i.customerPhone} ${i.plate} ${i.carModel}`.toLowerCase().includes(termLc)));

    const invTable = $("searchInvoices");
    invTable.innerHTML = "";
    const head = document.createElement("div");
    head.className = "table-row head";
    head.innerHTML = "<div>فاتورة</div><div>زبون</div><div>مبلغ</div><div>فتح</div>";
    invTable.appendChild(head);

    if (!invFiltered.length) {
      const r = document.createElement("div");
      r.className = "table-row";
      r.style.gridTemplateColumns = "1fr";
      r.innerHTML = "<div>لا توجد فواتير</div>";
      invTable.appendChild(r);
    } else {
      invFiltered.slice(0, 10).forEach(i => {
        const r = document.createElement("div");
        r.className = "table-row";
        const btn = document.createElement("button");
        btn.className = "btn btn-mini btn-secondary";
        btn.textContent = "فتح";
        btn.onclick = async () => { navigate("invoices"); await openInvoice(i.id); };
        r.innerHTML = `<div>#${escapeHtml(i.invoiceNo ?? "—")}</div><div>${escapeHtml(i.customerName || "—")}</div><div>${escapeHtml(i.total ?? 0)}</div>`;
        r.appendChild(btn);
        invTable.appendChild(r);
      });
    }
  };

  $("btnGlobalSearch").addEventListener("click", run);
  $("globalSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
}

// =========================
// Admin
// =========================
async function loadAdmin() {
  if (currentRole !== "admin") return;
  await ensureDefaults();
  await loadUIConfig();
  await loadDeptTable();
  await loadSectionsBox();
  await loadEmpTable();
  await loadInvoiceTemplateUI();
  await loadPagesTable();
  await loadUsersTable();
  await initReportDefaults();
}

async function loadDeptTable() {
  const table = $("deptTable");
  table.innerHTML = "جارٍ التحميل...";
  const snap = await db.collection("departments").orderBy("name").get().catch(() => null);

  table.innerHTML = "";
  const head = document.createElement("div");
  head.className = "table-row head";
  head.innerHTML = "<div>القسم</div><div>الحالة</div><div>—</div><div>إجراءات</div>";
  table.appendChild(head);

  if (!snap || snap.empty) {
    const r = document.createElement("div");
    r.className = "table-row"; r.style.gridTemplateColumns = "1fr";
    r.innerHTML = "<div>لا توجد أقسام</div>";
    table.appendChild(r);
  } else {
    snap.docs.forEach(doc => {
      const d = doc.data();
      const active = d.active !== false;
      const r = document.createElement("div");
      r.className = "table-row";
      r.innerHTML = `
        <div>${escapeHtml(d.name || "—")}</div>
        <div>${active ? "مفعل" : "موقف"}</div>
        <div class="result-meta">${escapeHtml(formatDate(d.createdAt))}</div>
        <div class="table-actions">
          <button class="btn btn-mini btn-secondary" data-act="toggle">تفعيل/إيقاف</button>
          <button class="btn btn-mini btn-ghost" data-act="rename">تعديل</button>
          <button class="btn btn-mini btn-danger" data-act="del">حذف</button>
        </div>`;
      qsa("button", r).forEach(b => {
        b.addEventListener("click", async () => {
          const act = b.dataset.act;
          if (act === "toggle") {
            await db.collection("departments").doc(doc.id).set({ active: !active }, { merge: true });
            await loadDeptTable(); await loadDepartmentsToSelect();
          }
          if (act === "rename") {
            const nn = prompt("اسم جديد للقسم:", d.name || "");
            if (nn && clean(nn)) {
              await db.collection("departments").doc(doc.id).set({ name: clean(nn) }, { merge: true });
              await loadDeptTable(); await loadDepartmentsToSelect();
            }
          }
          if (act === "del") {
            if (confirm("حذف القسم؟")) {
              await db.collection("departments").doc(doc.id).delete();
              await loadDeptTable(); await loadDepartmentsToSelect();
            }
          }
        });
      });
      table.appendChild(r);
    });
  }

  $("btnDeptAdd").onclick = async () => {
    const name = stableValue($("deptName"));
    if (!clean(name)) return setMsg($("adminMsg"), "اسم القسم مطلوب", "err");
    await db.collection("departments").add({ name: clean(name), active: true, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    $("deptName").value = "";
    setMsg($("adminMsg"), "تمت إضافة قسم ✅", "ok");
    await loadDeptTable(); await loadDepartmentsToSelect();
  };
}

async function loadSectionsBox() {
  const box = $("sectionsBox");
  box.innerHTML = "جارٍ التحميل...";
  const defaults = { dashboard: true, reception: true, workorders: true, orders: true, invoices: true, search: true, customers: true, cars: true, admin: true };
  let sections = { ...defaults };
  if (uiCfg?.sections) sections = { ...sections, ...uiCfg.sections };

  const labels = {
    dashboard: "لوحة التحكم",
    reception: "الاستقبال",
    workorders: "أمر تشغيلي",
    orders: "الأوامر",
    invoices: "الفواتير",
    search: "بحث شامل",
    customers: "الزبائن",
    cars: "السيارات",
    admin: "إعدادات الأدمن"
  };

  box.innerHTML = "";
  Object.keys(labels).forEach(k => {
    const wrap = document.createElement("div");
    wrap.className = "card";
    wrap.style.padding = "12px";
    wrap.style.boxShadow = "none";
    wrap.innerHTML = `
      <div class="row" style="justify-content:space-between;margin:0">
        <div><b>${labels[k]}</b><div class="muted small">إظهار/إخفاء في القائمة</div></div>
        <label style="display:flex;align-items:center;gap:10px;margin:0">
          <input type="checkbox" ${sections[k] !== false ? "checked" : ""} data-key="${k}" style="width:auto;transform:scale(1.2)"/>
        </label>
      </div>`;
    box.appendChild(wrap);
  });

  $("btnSaveSections").onclick = async () => {
    const out = {};
    qsa('input[type="checkbox"]', box).forEach(ch => out[ch.dataset.key] = ch.checked);
    await db.collection("uiConfig").doc("main").set({ sections: out, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    setMsg($("adminMsg"), "تم حفظ الإعدادات ✅", "ok");
    uiCfg.sections = out;
    await applyUIConfig();
  };
}

async function loadEmpTable() {
  const table = $("empTable");
  table.innerHTML = "جارٍ التحميل...";
  const snap = await db.collection("employees").orderBy("name").get().catch(() => null);

  table.innerHTML = "";
  const head = document.createElement("div");
  head.className = "table-row head";
  head.innerHTML = "<div>الموظف</div><div>الراتب</div><div>هاتف</div><div>إجراءات</div>";
  table.appendChild(head);

  if (!snap || snap.empty) {
    const r = document.createElement("div");
    r.className = "table-row"; r.style.gridTemplateColumns = "1fr";
    r.innerHTML = "<div>لا توجد بيانات موظفين</div>";
    table.appendChild(r);
  } else {
    snap.docs.forEach(doc => {
      const e = doc.data();
      const r = document.createElement("div");
      r.className = "table-row";
      r.innerHTML = `
        <div>${escapeHtml(e.name || "—")}</div>
        <div>${escapeHtml((e.salaryType || "") + " • " + (e.salaryAmount ?? "—"))}</div>
        <div>${escapeHtml(e.phone || "")}</div>
        <div class="table-actions"><button class="btn btn-mini btn-secondary">تحرير</button></div>`;
      qs("button", r).addEventListener("click", () => {
        empEditingId = doc.id;
        $("empName").value = e.name || "";
        $("empPhone").value = e.phone || "";
        $("empType").value = e.salaryType || "monthly";
        $("empAmount").value = e.salaryAmount ?? 0;
        $("empNotes").value = e.notes || "";
        setMsg($("adminMsg"), "تم اختيار موظف للتحرير.", "ok");
      });
      table.appendChild(r);
    });
  }

  $("btnEmpSave").onclick = async () => {
    try {
      const payload = {
        name: clean(stableValue($("empName"))),
        phone: clean(stableValue($("empPhone"))),
        salaryType: $("empType").value,
        salaryAmount: Number(stableValue($("empAmount")) || 0),
        notes: clean(stableValue($("empNotes"))),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (!payload.name) throw new Error("اسم الموظف مطلوب");

      if (empEditingId) {
        await db.collection("employees").doc(empEditingId).set(payload, { merge: true });
      } else {
        payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        const ref = await db.collection("employees").add(payload);
        empEditingId = ref.id;
      }
      setMsg($("adminMsg"), "تم حفظ بيانات الموظف ✅", "ok");
      await loadEmpTable();
    } catch (e) {
      setMsg($("adminMsg"), e.message || "فشل", "err");
    }
  };

  $("btnEmpDelete").onclick = async () => {
    if (!empEditingId) return setMsg($("adminMsg"), "اختاري موظف أولاً", "err");
    if (!confirm("حذف الموظف؟")) return;
    await db.collection("employees").doc(empEditingId).delete();
    empEditingId = null;
    $("empName").value = ""; $("empPhone").value = ""; $("empAmount").value = 0; $("empNotes").value = "";
    setMsg($("adminMsg"), "تم الحذف", "ok");
    await loadEmpTable();
  };
}

// ===== Invoice template admin UI =====
async function loadInvoiceTemplateUI() {
  const tpl = await getInvoiceTemplate();
  $("tplShopName").value = tpl.shopName || "";
  $("tplShopPhone").value = tpl.shopPhone || "";
  $("tplShopAddress").value = tpl.shopAddress || "";
  $("tplCurrency").value = tpl.currency || "IQD";
  $("tplHeaderHtml").value = tpl.headerHtml || "";
  $("tplFooterHtml").value = tpl.footerHtml || "";
  $("tplCss").value = tpl.css || "";

  $("btnSaveInvoiceTemplate").onclick = async () => {
    const t = {
      shopName: clean(stableValue($("tplShopName"))),
      shopPhone: clean(stableValue($("tplShopPhone"))),
      shopAddress: clean(stableValue($("tplShopAddress"))),
      currency: clean(stableValue($("tplCurrency"))) || "IQD",
      headerHtml: stableValue($("tplHeaderHtml")),
      footerHtml: stableValue($("tplFooterHtml")),
      css: stableValue($("tplCss"))
    };
    await db.collection("uiConfig").doc("main").set({
      invoiceTemplate: t,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    setMsg($("tplMsg"), "تم حفظ قالب الفاتورة ✅", "ok");
    uiCfg.invoiceTemplate = t;
  };

  $("btnPreviewTemplate").onclick = async () => {
    const demo = {
      invoiceNo: 999,
      status: "unpaid",
      createdAt: firebase.firestore.Timestamp.now(),
      customerName: "زبون تجريبي",
      customerPhone: "07xxxxxxxxx",
      plate: "ABC-1234",
      carModel: "Camry",
      items: [{ desc: "بند تجريبي", qty: 1, price: 10000 }],
      discount: 0,
      taxPct: 0
    };
    await printInvoice(demo);
  };
}

// ===== Custom Pages admin =====
async function loadPagesTable() {
  const table = $("pagesTable");
  table.innerHTML = "";
  const pages = (uiCfg?.customPages || []).slice().sort((a, b) => (a.sort ?? 10) - (b.sort ?? 10));

  const head = document.createElement("div");
  head.className = "table-row head";
  head.innerHTML = "<div>العنوان</div><div>مرئية</div><div>ترتيب</div><div>إجراءات</div>";
  table.appendChild(head);

  if (!pages.length) {
    const r = document.createElement("div");
    r.className = "table-row";
    r.style.gridTemplateColumns = "1fr";
    r.innerHTML = "<div>لا توجد صفحات</div>";
    table.appendChild(r);
  } else {
    pages.forEach(p => {
      const r = document.createElement("div");
      r.className = "table-row";
      const act = document.createElement("div");
      act.className = "table-actions";

      const btnEdit = document.createElement("button");
      btnEdit.className = "btn btn-mini btn-secondary";
      btnEdit.textContent = "تحرير";
      btnEdit.onclick = () => {
        editingPageId = p.id;
        $("pgTitle").value = p.title || "";
        $("pgSort").value = p.sort ?? 10;
        $("pgHtml").value = p.html || "";
        $("pgVisible").checked = p.visible !== false;
        setMsg($("adminMsg"), "تم تحميل الصفحة للتحرير.", "ok");
      };

      const btnDel = document.createElement("button");
      btnDel.className = "btn btn-mini btn-danger";
      btnDel.textContent = "حذف";
      btnDel.onclick = async () => {
        if (!confirm("حذف الصفحة؟")) return;
        uiCfg.customPages = (uiCfg.customPages || []).filter(x => x.id !== p.id);
        await db.collection("uiConfig").doc("main").set({ customPages: uiCfg.customPages }, { merge: true });
        await loadUIConfig();
        await loadPagesTable();
      };

      act.appendChild(btnEdit);
      act.appendChild(btnDel);

      r.innerHTML = `<div>${escapeHtml(p.title || "—")}</div><div>${p.visible !== false ? "نعم" : "لا"}</div><div>${escapeHtml(p.sort ?? 10)}</div>`;
      r.appendChild(act);
      table.appendChild(r);
    });
  }

  $("btnAddPage").onclick = async () => {
    const title = clean(stableValue($("pgTitle")));
    const html = stableValue($("pgHtml"));
    const sort = Number(stableValue($("pgSort")) || 10);
    const visible = $("pgVisible").checked;

    if (!title) return setMsg($("adminMsg"), "عنوان الصفحة مطلوب", "err");

    const list = uiCfg.customPages || [];
    const id = editingPageId || ("pg_" + Math.random().toString(16).slice(2));

    const next = { id, title, html, sort, visible };
    const idx = list.findIndex(x => x.id === id);
    if (idx >= 0) list[idx] = next;
    else list.push(next);

    uiCfg.customPages = list;
    await db.collection("uiConfig").doc("main").set({ customPages: list }, { merge: true });
    setMsg($("adminMsg"), "تم حفظ الصفحة ✅", "ok");
    editingPageId = null;
    $("pgTitle").value = ""; $("pgHtml").value = ""; $("pgSort").value = 10; $("pgVisible").checked = true;

    await loadUIConfig();
    await loadPagesTable();
  };

  $("btnClearPage").onclick = () => {
    editingPageId = null;
    $("pgTitle").value = ""; $("pgHtml").value = ""; $("pgSort").value = 10; $("pgVisible").checked = true;
  };
}

// ===== Users admin (create without logout using Secondary Auth) =====
async function loadUsersTable() {
  const table = $("usersTable");
  table.innerHTML = "جارٍ التحميل...";
  const snap = await db.collection("users").orderBy("email").limit(80).get().catch(() => null);
  const users = snap?.empty ? [] : snap.docs.map(d => ({ id: d.id, ...d.data() }));

  table.innerHTML = "";
  const head = document.createElement("div");
  head.className = "table-row head";
  head.innerHTML = "<div>الإيميل</div><div>Role</div><div>اسم</div><div>إجراء</div>";
  table.appendChild(head);

  if (!users.length) {
    const r = document.createElement("div");
    r.className = "table-row";
    r.style.gridTemplateColumns = "1fr";
    r.innerHTML = "<div>لا توجد بيانات</div>";
    table.appendChild(r);
    return;
  }

  users.forEach(u => {
    const r = document.createElement("div");
    r.className = "table-row";

    const btn = document.createElement("button");
    btn.className = "btn btn-mini btn-secondary";
    btn.textContent = "تغيير Role";
    btn.onclick = async () => {
      const next = prompt("role: admin / user", u.role || "user");
      if (!next) return;
      await db.collection("users").doc(u.id).set({ role: clean(next), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      setMsg($("usersMsg"), "تم تحديث role ✅", "ok");
      await loadUsersTable();
      if (u.id === currentUser?.uid) {
        await loadRole(currentUser.uid);
      }
    };

    r.innerHTML = `<div>${escapeHtml(u.email || u.id)}</div><div>${escapeHtml(u.role || "user")}</div><div>${escapeHtml(u.displayName || "")}</div>`;
    r.appendChild(btn);
    table.appendChild(r);
  });

  $("btnCreateUser").onclick = async () => {
    try {
      const email = clean(stableValue($("usrEmail")));
      const pass = stableValue($("usrPass"));
      const role = $("usrRole").value;
      const displayName = clean(stableValue($("usrName")));

      if (!email || !pass) throw new Error("إيميل وكلمة مرور مطلوبة");

      // Secondary app auth to avoid logging out admin
      const secondary = firebase.apps.find(a => a.name === "Secondary")
        ? firebase.app("Secondary")
        : firebase.initializeApp(firebaseConfig, "Secondary");

      const secAuth = secondary.auth();

      const res = await secAuth.createUserWithEmailAndPassword(email, pass);
      const uid = res.user.uid;

      await db.collection("users").doc(uid).set({
        email,
        role,
        displayName,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      await secAuth.signOut();

      setMsg($("usersMsg"), "تم إنشاء المستخدم ✅", "ok");
      $("usrEmail").value = ""; $("usrPass").value = ""; $("usrName").value = "";
      await loadUsersTable();
    } catch (e) {
      console.error(e);
      setMsg($("usersMsg"), e.message || "فشل", "err");
    }
  };
}

// ===== Reports =====
async function initReportDefaults() {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  const from = fromDate.toISOString().slice(0, 10);
  $("repFrom").value = from;
  $("repTo").value = to;

  $("btnRunReport").onclick = async () => runReport();
}

async function runReport() {
  const from = $("repFrom").value;
  const to = $("repTo").value;
  if (!from || !to) return;

  const fromTs = firebase.firestore.Timestamp.fromDate(new Date(from + "T00:00:00"));
  const toTs = firebase.firestore.Timestamp.fromDate(new Date(to + "T23:59:59"));

  const snap = await db.collection("invoices")
    .where("createdAt", ">=", fromTs)
    .where("createdAt", "<=", toTs)
    .get()
    .catch(() => null);

  const rows = snap?.empty ? [] : snap.docs.map(d => ({ id: d.id, ...d.data() }));

  let paid = 0, unpaid = 0;
  rows.forEach(i => {
    const t = Number(i.total || 0);
    if (i.status === "paid") paid += t;
    else unpaid += t;
  });

  $("repPaid").textContent = paid;
  $("repUnpaid").textContent = unpaid;
  $("repCount").textContent = rows.length;

  const table = $("repTable");
  table.innerHTML = "";
  const head = document.createElement("div");
  head.className = "table-row head";
  head.innerHTML = "<div>فاتورة</div><div>زبون</div><div>مبلغ</div><div>حالة</div>";
  table.appendChild(head);

  if (!rows.length) {
    const r = document.createElement("div");
    r.className = "table-row";
    r.style.gridTemplateColumns = "1fr";
    r.innerHTML = "<div>لا توجد بيانات ضمن الفترة</div>";
    table.appendChild(r);
    return;
  }

  rows
    .sort((a, b) => (b.invoiceNo ?? 0) - (a.invoiceNo ?? 0))
    .slice(0, 30)
    .forEach(i => {
      const r = document.createElement("div");
      r.className = "table-row";
      r.innerHTML = `<div>#${escapeHtml(i.invoiceNo ?? "—")}</div><div>${escapeHtml(i.customerName || "—")}</div><div>${escapeHtml(i.total ?? 0)}</div><div>${i.status === "paid" ? "مدفوعة" : "غير مدفوعة"}</div>`;
      table.appendChild(r);
    });
}

// =========================
// Auth
// =========================
function bindAuth() {
  $("btnLogin").addEventListener("click", async () => {
    await tick();
    setMsg($("authMsg"), "جارٍ تسجيل الدخول...");
    try {
      const email = clean(stableValue($("loginEmail")));
      const pass = stableValue($("loginPassword"));
      await auth.signInWithEmailAndPassword(email, pass);
      setMsg($("authMsg"), "تم ✅", "ok");
    } catch (e) {
      console.error(e);
      setMsg($("authMsg"), e.message || "فشل", "err");
    }
  });

  $("btnRegister").addEventListener("click", async () => {
    await tick();
    setMsg($("authMsg"), "جارٍ إنشاء الحساب...");
    try {
      const email = clean(stableValue($("loginEmail")));
      const pass = stableValue($("loginPassword"));
      const res = await auth.createUserWithEmailAndPassword(email, pass);

      await db.collection("users").doc(res.user.uid).set({
        email,
        role: "user",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      setMsg($("authMsg"), "تم إنشاء الحساب ✅", "ok");
    } catch (e) {
      console.error(e);
      setMsg($("authMsg"), e.message || "فشل", "err");
    }
  });

  auth.onAuthStateChanged(async (u) => {
    currentUser = u || null;
    if (!u) {
      $("userEmail").textContent = "غير مسجل";
      currentRole = "guest";
      setRoleBadge(currentRole);
      showAuth(true);
      return;
    }
    $("userEmail").textContent = u.email || u.uid;
    showAuth(false);
    await loadRole(u.uid);
    await loadUIConfig();
    navigate("dashboard");
  });
}

// =========================
// Bind All
// =========================
function bindAll() {
  bindNav();
  bindAuth();
  bindReception();
  bindWorkOrders();
  bindCustomers();
  bindCars();
  bindOrdersPage();
  bindInvoicesPage();
  bindGlobalSearch();
  bindDashboardQuickSearch();

  // today badge
  $("todayBadge").textContent = new Date().toLocaleDateString("ar-IQ", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

// =========================
// Init
// =========================
(async function init() {
  const ok = ensureFirebase();
  bindAll();
  guardAllInputs();

  if (!ok) {
    showAuth(true);
    setMsg($("authMsg"), "تأكدي من إعدادات Firebase داخل app.js", "err");
    return;
  }

  showAuth(true);
})();
