/* نظام حسن الوليم RPM - V3 (Front-end only)
   - زباين + سيارات + سجل
   - تبديل دهن + عداد حالي/جاي + طباعة
   - تفاصيل أمر شغل + صرف قطع + أجور + فاتورة
   - موظفين
   - تقارير
   - نسخ احتياطي
*/

/* ======================== SYSTEM 0: Firebase (Lazy Load) ========================
   ملاحظة:
   - نخلي Firebase "اختياري" حتى إذا الشبكة تمنع gstatic (CORB) يبقى البرنامج يشتغل محلي بدون ما يطيح.
   - Firebase ينزل فقط لما تفتحين صفحة الحساب/تختارين السحابة.
*/

// Firebase config (rpm574)
const firebaseConfig = {
  apiKey: "AIzaSyC0p4cqNHuqZs9_gNuKLl7nEY0MqRXbf_A",
  authDomain: "rpm574.firebaseapp.com",
  databaseURL: "https://rpm574-default-rtdb.firebaseio.com",
  projectId: "rpm574",
  storageBucket: "rpm574.firebasestorage.app",
  messagingSenderId: "150918603525",
  appId: "1:150918603525:web:95c93b1498d869d46c4d6c",
};

// Firebase globals (تتهيأ عند الحاجة)
let firebaseApp = null;
let auth = null;
let firestore = null;
let storage = null;

// Functions holders (نخلي نفس أسماء الدوال حتى باقي الكود ما يتغير)
let initializeApp;
let getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence;
let initializeFirestore, persistentLocalCache, persistentSingleTabManager, collection, doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch;
let getStorage, storageRef, uploadString, getDownloadURL, deleteObject;

let _firebaseInitPromise = null;
async function ensureFirebase() {
  if (_firebaseInitPromise) return _firebaseInitPromise;
  _firebaseInitPromise = (async () => {
    try {
      const appMod = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js");
      const authMod = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js");
      const fsMod = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js");
      const stMod = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-storage.js");

      ({ initializeApp } = appMod);
      ({
        getAuth,
        onAuthStateChanged,
        signInWithEmailAndPassword,
        createUserWithEmailAndPassword,
        signOut,
        setPersistence,
        browserLocalPersistence,
      } = authMod);

      ({
        initializeFirestore,
        persistentLocalCache,
        persistentSingleTabManager,
        collection,
        doc,
        getDoc,
        getDocs,
        setDoc,
        deleteDoc,
        writeBatch,
      } = fsMod);

      ({
        getStorage,
        ref: storageRef,
        uploadString,
        getDownloadURL,
        deleteObject,
      } = stMod);

      firebaseApp = initializeApp(firebaseConfig);
      auth = getAuth(firebaseApp);

      // تمكين Cache دائم للويب (Single-tab) حسب الدوك
      firestore = initializeFirestore(firebaseApp, {
        localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
      });

      storage = getStorage(firebaseApp);

      // نخلي تسجيل الدخول يبقى محفوظ بالمتصفح
      setPersistence(auth, browserLocalPersistence).catch(() => {});

      return true;
    } catch (e) {
      console.warn("Firebase blocked or failed to load:", e);
      return false;
    }
  })();
  return _firebaseInitPromise;
}

let _authListenerStarted = false;
async function startAuthListenerIfNeeded() {
  if (_authListenerStarted) return true;
  const ok = await ensureFirebase();
  if (!ok) return false;

  onAuthStateChanged(auth, async (u) => {
    authState.user = u || null;

    const btn = $("#btnAuth");
    if (btn) btn.textContent = u ? "حساب" : "الحساب";

    // إذا كانت السحابة مفعّلة وطلعنا من الحساب، نرجع محلي حتى التطبيق يظل يشتغل
    if (!u && Settings.get("storageMode", "local") === "firebase") {
      Settings.set("storageMode", "local");
      toast("تم التحويل للمحلي لأن الحساب خرج", "warn", 4200);
    }

    await ensureRole();
    renderRoute();
  });

  _authListenerStarted = true;
  return true;
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ------------------------ IndexedDB ------------------------ */
const DB_NAME = "alwaleem_rpm_db";
const DB_VER = 3;

const stores = {
  customers: "id",
  vehicles: "id",
  workOrders: "id",
  parts: "id",
  invoices: "id",
  employees: "id",
  appointments: "id",
  expenses: "id",
  attachments: "id",
  rbacUsers: "id",
  rbacInvites: "id",
};

function uid() {
  return "id_" + (crypto?.randomUUID ? crypto.randomUUID() : (Date.now() + "_" + Math.random()).replace(".", ""));
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      Object.entries(stores).forEach(([name, keyPath]) => {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let out;
    Promise.resolve(fn(store)).then(v => out = v).catch(reject);
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
  });
}

/* ======================== SYSTEM 1: Local DB (IndexedDB) ======================== */

const localAPI = {
  getAll: (store) => tx(store, "readonly", (s) => new Promise((res, rej) => {
    const r = s.getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  })),
  get: (store, key) => tx(store, "readonly", (s) => new Promise((res, rej) => {
    const r = s.get(key);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  })),
  put: (store, obj) => tx(store, "readwrite", (s) => new Promise((res, rej) => {
    const r = s.put(obj);
    r.onsuccess = () => res(true);
    r.onerror = () => rej(r.error);
  })),
  del: (store, key) => tx(store, "readwrite", (s) => new Promise((res, rej) => {
    const r = s.delete(key);
    r.onsuccess = () => res(true);
    r.onerror = () => rej(r.error);
  })),
  clear: (store) => tx(store, "readwrite", (s) => new Promise((res, rej) => {
    const r = s.clear();
    r.onsuccess = () => res(true);
    r.onerror = () => rej(r.error);
  })),
};

/* ======================== SYSTEM 2: Settings + Auth State ======================== */

const Settings = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem("alwaleem_rpm_" + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem("alwaleem_rpm_" + key, JSON.stringify(value));
  },
};

const DEFAULT_SHOP = {
  name: "نظام حسن الوليم RPM",
  phone: "",
  address: "",
};

function getShop() {
  return Settings.get("shop", DEFAULT_SHOP);
}
function setShop(patch) {
  const cur = getShop();
  Settings.set("shop", { ...cur, ...patch });
}

const authState = {
  user: null,
};

// 🔧 Cloud scope:
// - "root"  => collections at root (cars, customers, orders, invoices, employees, parts...)
// - "user"  => collections under users/{uid}/...  (old mode)
// الافتراضي: root حتى يطابق Firestore اللي عندچ
if (Settings.get("cloudScope", null) == null) Settings.set("cloudScope", "root");

// Mapping بين أسماء الـStores داخل التطبيق وأسماء الـCollections داخل Firestore
const CLOUD_COLLECTION_MAP = {
  vehicles: "cars",
  workOrders: "orders",
  appointments: "appointments",
  expenses: "expenses",
  attachments: "attachments",
  rbacUsers: "rbac_users",
  rbacInvites: "rbac_invites",
  // customers: "customers",
  // employees: "employees",
  // invoices: "invoices",
  // parts: "parts",
};

function cloudStoreName(store) {
  return CLOUD_COLLECTION_MAP[store] || store;
}

function cloudBasePath() {
  const scope = Settings.get("cloudScope", "root");
  if (scope === "user") {
    const base = userPath();
    return base ? `${base}/` : null;
  }
  return ""; // root
}

const CLOUD_ROOT_ONLY_STORES = new Set(["rbacUsers","rbacInvites"]);

function cloudColPath(store) {
  // RBAC لازم يبقى Root حتى يشتغل مهما كان cloudScope
  if (CLOUD_ROOT_ONLY_STORES.has(store)) {
    return cloudStoreName(store);
  }
  const base = cloudBasePath();
  if (base == null) return null;
  return `${base}${cloudStoreName(store)}`;
}

/* ======================== SYSTEM 3: Cloud DB (Firestore) ======================== */

function userPath() {
  const u = authState.user;
  return u ? `users/${u.uid}` : null;
}

function cloudEnabled() {
  return Settings.get("storageMode", "local") === "firebase" && !!authState.user;
}

async function fsGetAll(store) {
  /* ORIGINAL (قبل تصحيح root/user + mapping):
    const base = userPath();
    if (!base) return [];
    const colRef = collection(firestore, `${base}/${store}`);
    const snap = await getDocs(colRef);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  */
  const colPath = cloudColPath(store);
  if (!colPath) return [];
  const colRef = collection(firestore, colPath);
  const snap = await getDocs(colRef);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}


async function fsGet(store, key) {
  /* ORIGINAL (قبل تصحيح root/user + mapping):
    const base = userPath();
    if (!base) return null;
    const ref = doc(firestore, `${base}/${store}/${key}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  */
  const colPath = cloudColPath(store);
  if (!colPath) return null;
  const ref = doc(firestore, `${colPath}/${key}`);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}


async function fsPut(store, obj) {
  /* ORIGINAL (قبل تصحيح root/user + mapping):
    const base = userPath();
    if (!base) throw new Error("NO_AUTH");
    const ref = doc(firestore, `${base}/${store}/${obj.id}`);
    await setDoc(ref, obj, { merge: false });
    return true;
  */
  const colPath = cloudColPath(store);
  if (!colPath) throw new Error("NO_AUTH");
  const ref = doc(firestore, `${colPath}/${obj.id}`);
  await setDoc(ref, obj, { merge: false });
  return true;
}


async function fsDel(store, key) {
  /* ORIGINAL (قبل تصحيح root/user + mapping):
    const base = userPath();
    if (!base) throw new Error("NO_AUTH");
    const ref = doc(firestore, `${base}/${store}/${key}`);
    await deleteDoc(ref);
    return true;
  */
  const colPath = cloudColPath(store);
  if (!colPath) throw new Error("NO_AUTH");
  const ref = doc(firestore, `${colPath}/${key}`);
  await deleteDoc(ref);
  return true;
}


async function fsClear(store) {
  /* ORIGINAL (قبل تصحيح root/user + mapping):
    const base = userPath();
    if (!base) throw new Error("NO_AUTH");
    const colRef = collection(firestore, `${base}/${store}`);
    const snap = await getDocs(colRef);
    const docs = snap.docs.map(d => d.ref);
    // batch delete (حد فايرستور 500 عملية بالباتش، نخليها 400 للأمان)
    for (let i = 0; i < docs.length; i += 400) {
      const b = writeBatch(firestore);
      docs.slice(i, i + 400).forEach(r => b.delete(r));
      await b.commit();
    }
    return true;
  */
  const colPath = cloudColPath(store);
  if (!colPath) throw new Error("NO_AUTH");
  const colRef = collection(firestore, colPath);
  const snap = await getDocs(colRef);
  const batch = writeBatch(firestore);
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  return true;
}


const cloudAPI = {
  getAll: fsGetAll,
  get: fsGet,
  put: fsPut,
  del: fsDel,
  clear: fsClear,
};

/* ======================== SYSTEM 4: Unified Data API (Local / Firebase) ======================== */

const dbAPI = {
  mode: () => (cloudEnabled() ? "firebase" : "local"),
  setMode: async (mode) => {
    Settings.set("storageMode", mode);
    if (mode === "firebase") {
      // شغّل Firebase عند الحاجة فقط. إذا محجوب بالشبكة نرجع محلي.
      const ok = await startAuthListenerIfNeeded();
      if (!ok) {
        Settings.set("storageMode", "local");
        return false;
      }
      // لو اختارت سحابة وماكو تسجيل دخول، حولي على الحساب
      if (!authState.user) {
        location.hash = "#/auth";
      }
    }
    return true;
  },

  getAll: (store) => (cloudEnabled() ? cloudAPI.getAll(store) : localAPI.getAll(store)),
  get: (store, key) => (cloudEnabled() ? cloudAPI.get(store, key) : localAPI.get(store, key)),
  put: (store, obj) => (cloudEnabled() ? cloudAPI.put(store, obj) : localAPI.put(store, obj)),
  del: (store, key) => (cloudEnabled() ? cloudAPI.del(store, key) : localAPI.del(store, key)),
  clear: (store) => (cloudEnabled() ? cloudAPI.clear(store) : localAPI.clear(store)),
};

// مزامنة يدوية (اختيارية) بين المحلي والسحابة
async function syncLocalToCloud() {
  if (!authState.user) throw new Error("NO_AUTH");
  const base = userPath();
  for (const store of Object.keys(stores)) {
    const items = await localAPI.getAll(store);
    const refs = items.map(it => doc(firestore, `${base}/${store}/${it.id}`));
    for (let i = 0; i < items.length; i += 400) {
      const b = writeBatch(firestore);
      items.slice(i, i + 400).forEach((it) => {
        b.set(doc(firestore, `${base}/${store}/${it.id}`), it, { merge: false });
      });
      await b.commit();
    }
  }
  return true;
}

async function syncCloudToLocal() {
  if (!authState.user) throw new Error("NO_AUTH");
  for (const store of Object.keys(stores)) {
    const items = await cloudAPI.getAll(store);
    await localAPI.clear(store);
    for (const it of items) await localAPI.put(store, it);
  }
  return true;
}

/* ------------------------ State & Router ------------------------ */
const state = {
  route: "dashboard",
  search: "",
  role: "admin",
  employeeId: "",
};


/* ======================== SYSTEM 4.5: Roles & Permissions (RBAC) ======================== */

const ROLE_LABELS = {
  admin: "مدير",
  accountant: "محاسب",
  reception: "استقبال",
  technician: "فني",
  pending: "غير مفعل",
};

const ROLE_ROUTES = {
  admin: ["*"],
  accountant: ["dashboard","orders","order","customers","customer","vehicles","vehicle","invoices","reports","expenses","backup","dedupe","more","auth"],
  reception: ["dashboard","checkin","appointments","orders","order","customers","customer","vehicles","vehicle","invoices","more","auth"],
  technician: ["dashboard","appointments","orders","order","customers","customer","vehicles","vehicle","more","auth"],
  pending: ["dashboard","more","auth"],
};

function normEmail(s) {
  return String(s || "").trim().toLowerCase();
}

function currentRole() {
  return state.role || "pending";
}

function roleLabel(r) {
  return ROLE_LABELS[r] || r || "—";
}

function canAccessRoute(route) {
  const r = currentRole();
  const list = ROLE_ROUTES[r] || ROLE_ROUTES.pending;
  return list.includes("*") || list.includes(route);
}

function applyNavPermissions() {
  // Sidebar + bottom tabs
  document.querySelectorAll("[data-route]").forEach(el => {
    const r = el.dataset.route;
    if (!r) return;
    const ok = canAccessRoute(r);
    el.classList.toggle("is-hidden", !ok);
  });

  // لو المستخدم داخل صفحة ممنوعة، رجعيه للداشبورد
  const { route } = parseHash();
  if (route && !canAccessRoute(route) && route !== "auth") {
    location.hash = "#/dashboard";
  }
}

async function getMyEmployeeId() {
  if (state.employeeId) return state.employeeId;

  const u = authState.user;
  const email = normEmail(u?.email);
  if (!email) return "";

  const emps = await dbAPI.getAll("employees");
  const me = emps.find(e => normEmail(e.email) === email);
  if (me) {
    state.employeeId = me.id;

    // إذا سحابة: ثبتي الربط داخل RBAC للمرة الجاية
    try {
      if (authState.user) {
        const uid = authState.user.uid;
        const r = await cloudAPI.get("rbacUsers", uid);
        if (r && !r.employeeId) {
          r.employeeId = me.id;
          await cloudAPI.put("rbacUsers", r);
        }
      }
    } catch {}
  }
  return state.employeeId || "";
}

async function ensureRole() {
  // Local بدون حساب = مدير افتراضياً
  if (!authState.user) {
    state.role = Settings.get("localRole", "admin");
    state.employeeId = Settings.get("localEmployeeId", "");
    applyNavPermissions();
    return;
  }

  try {
    const uid = authState.user.uid;
    const email = normEmail(authState.user.email);

    // 1) دور ثابت على UID
    let rdoc = await cloudAPI.get("rbacUsers", uid);

    // 2) إذا ما موجود: شيّكي دعوة بالإيميل
    if (!rdoc && email) {
      const inv = await cloudAPI.get("rbacInvites", email);
      if (inv) {
        rdoc = {
          id: uid,
          uid,
          email,
          role: inv.role || "reception",
          employeeId: inv.employeeId || "",
          createdAt: Date.now(),
          createdBy: inv.createdBy || "",
        };
        await cloudAPI.put("rbacUsers", rdoc);
        await cloudAPI.del("rbacInvites", email);
      }
    }

    // 3) أول مستخدم بالنظام يصير Admin تلقائياً
    if (!rdoc) {
      const all = await cloudAPI.getAll("rbacUsers");
      const first = !all.length;
      rdoc = {
        id: uid,
        uid,
        email,
        role: first ? "admin" : "pending",
        employeeId: "",
        createdAt: Date.now(),
      };
      await cloudAPI.put("rbacUsers", rdoc);
    }

    state.role = rdoc.role || "pending";
    state.employeeId = rdoc.employeeId || "";
  } catch (e) {
    // fallback إذا فشل الوصول
    state.role = "admin";
    state.employeeId = "";
  }

  applyNavPermissions();
}

function parseHash() {
  const raw = (location.hash || "#/dashboard").replace("#/", "");
  const [path, query] = raw.split("?");
  const params = new URLSearchParams(query || "");
  return { route: path || "dashboard", params };
}

function baseRoute(route) {
  // حتى تبقى القائمة مفعلة بالصفحات الفرعية
  const map = {
    customer: "customers",
    vehicle: "vehicles",
    order: "orders",
    more: "more",
    auth: "more",
  };
  return map[route] || route;
}

function setTitle(route) {
  const map = {
    dashboard: "لوحة التحكم",
    checkin: "الاستقبال",
    appointments: "المواعيد",
    orders: "أوامر الشغل",
    order: "تفاصيل أمر شغل",
    customers: "الزباين",
    customer: "سجل الزبون",
    vehicles: "السيارات",
    vehicle: "سجل السيارة",
    oil: "تبديل دهن",
    inventory: "المخزون",
    invoices: "الفواتير",
    expenses: "المصروفات",
    employees: "الموظفين",
    roles: "الصلاحيات",
    reports: "التقارير",
    backup: "نسخ احتياطي",
    dedupe: "دمج المكررات",
    more: "المزيد",
    auth: "الحساب",
  };
  $("#pageTitle").textContent = map[route] || "نظام حسن الوليم RPM";
}

function setActiveNav(route) {
  const b = baseRoute(route);
  $$(".nav-item").forEach(a => a.classList.toggle("active", a.dataset.route === b));
  $$(".tab").forEach(a => a.classList.toggle("active", a.dataset.route === b));
}

/* ------------------------ Helpers ------------------------ */
function fmtDate(ts) { return new Date(ts).toLocaleString("ar-IQ"); }
function fmtDay(ts) { return new Date(ts).toLocaleDateString("ar-IQ"); }
function money(n) { return (Number(n || 0)).toLocaleString("ar-IQ") + " د.ع"; }

/* ======================== SYSTEM UI: Toast ======================== */
function ensureToastHost() {
  if ($(".toast-host")) return;
  const host = document.createElement("div");
  host.className = "toast-host";
  document.body.appendChild(host);
}

function toast(msg, kind = "ok", ttlMs = 3200) {
  ensureToastHost();
  const host = $(".toast-host");
  const t = document.createElement("div");
  t.className = `toast ${kind === "bad" ? "bad" : kind === "warn" ? "warn" : ""}`.trim();
  t.innerHTML = `<div>${escapeHtml(msg)}</div><button class="x" aria-label="Close">✕</button>`;
  host.appendChild(t);

  const kill = () => {
    t.style.opacity = "0";
    t.style.transform = "translateY(6px)";
    setTimeout(() => t.remove(), 200);
  };
  t.querySelector(".x")?.addEventListener("click", kill);
  setTimeout(kill, ttlMs);
}

/* ======================== SYSTEM UI: Form Modal (بديل للـ prompt) ======================== */
function ensureFormModal() {
  if ($("#formModal")) return;
  document.body.insertAdjacentHTML(
    "beforeend",
    `
    <div id="formModal" class="modal hidden" role="dialog" aria-modal="true">
      <div class="fmodal-card">
        <div class="modal-head">
          <div>
            <div class="modal-title" id="fmTitle">نموذج</div>
            <div class="small" id="fmSub" style="margin-top:4px"></div>
          </div>
          <button id="fmClose" class="btn btn-icon" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          <form id="fmForm">
            <div class="fmodal-grid" id="fmFields"></div>
            <div class="fmodal-actions">
              <button type="submit" class="btn btn-primary" id="fmSubmit">حفظ</button>
              <button type="button" class="btn" id="fmCancel">إلغاء</button>
            </div>
          </form>
        </div>
      </div>
    </div>
    `
  );
}

async function formModal({ title, subtitle = "", submitText = "حفظ", fields = [], initial = {} }) {
  ensureFormModal();
  const modal = $("#formModal");
  $("#fmTitle").textContent = title || "نموذج";
  $("#fmSub").textContent = subtitle || "";
  $("#fmSubmit").textContent = submitText || "حفظ";

  const wrap = $("#fmFields");
  wrap.innerHTML = "";

  for (const f of fields) {
    const id = `fm_${f.name}`;
    const label = f.label || f.name;
    const type = f.type || "text";
    const val = initial[f.name] ?? f.default ?? "";

    let inputHtml = "";
    if (type === "textarea") {
      inputHtml = `<textarea id="${id}" class="input" rows="3" placeholder="${escapeHtml(f.placeholder || "")}">${escapeHtml(val)}</textarea>`;
    } else if (type === "select") {
      const opts = (f.options || []).map(o => {
        const ov = typeof o === "string" ? o : o.value;
        const ot = typeof o === "string" ? o : o.label;
        const sel = String(ov) === String(val) ? "selected" : "";
        return `<option value="${escapeHtml(ov)}" ${sel}>${escapeHtml(ot)}</option>`;
      }).join("");
      inputHtml = `<select id="${id}" class="input">${opts}</select>`;
    } else if (type === "checkbox") {
      const checked = !!val ? "checked" : "";
      inputHtml = `<label class="small" style="display:flex;gap:8px;align-items:center">
        <input id="${id}" type="checkbox" ${checked} />
        <span>${escapeHtml(f.help || "")}</span>
      </label>`;
    } else {
      const step = f.step != null ? `step="${f.step}"` : "";
      inputHtml = `<input id="${id}" class="input" type="${escapeHtml(type)}" value="${escapeHtml(val)}" placeholder="${escapeHtml(f.placeholder || "")}" ${step} />`;
    }

    wrap.insertAdjacentHTML(
      "beforeend",
      `
      <div>
        <div class="small" style="margin:4px 2px">${escapeHtml(label)}${f.required ? " *" : ""}</div>
        ${inputHtml}
      </div>
      `
    );
  }

  modal.classList.remove("hidden");

  return new Promise((resolve) => {
    const close = (out) => {
      modal.classList.add("hidden");
      cleanup();
      resolve(out);
    };

    const onCancel = () => close(null);
    const onBackdrop = (e) => { if (e.target === modal) close(null); };
    const onSubmit = (e) => {
      e.preventDefault();
      const out = {};
      for (const f of fields) {
        const id = `fm_${f.name}`;
        const type = f.type || "text";
        const el = $("#" + id);
        if (!el) continue;
        let v;
        if (type === "checkbox") v = !!el.checked;
        else v = el.value;

        if (f.cast === "number") v = Number(v || 0);
        if (f.trim !== false && typeof v === "string") v = v.trim();

        if (f.required && (!v || (typeof v === "string" && !v.trim()))) {
          toast(`الحقل مطلوب: ${labelOf(f)}`, "warn");
          el.focus();
          return;
        }
        out[f.name] = v;
      }
      close(out);
    };

    const labelOf = (f) => f.label || f.name;

    const cleanup = () => {
      $("#fmClose")?.removeEventListener("click", onCancel);
      $("#fmCancel")?.removeEventListener("click", onCancel);
      modal.removeEventListener("click", onBackdrop);
      $("#fmForm")?.removeEventListener("submit", onSubmit);
    };

    $("#fmClose")?.addEventListener("click", onCancel);
    $("#fmCancel")?.addEventListener("click", onCancel);
    modal.addEventListener("click", onBackdrop);
    $("#fmForm")?.addEventListener("submit", onSubmit);
  });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function pill(status) {
  const cls =
    status === "OPEN" ? "open" :
    status === "IN_PROGRESS" ? "progress" :
    status === "WAITING_PARTS" ? "parts" :
    status === "DONE" || status === "DELIVERED" ? "done" : "";
  const label =
    status === "OPEN" ? "مفتوح" :
    status === "WAITING_APPROVAL" ? "بانتظار موافقة" :
    status === "IN_PROGRESS" ? "قيد الشغل" :
    status === "WAITING_PARTS" ? "انتظار قطع" :
    status === "DONE" ? "مكتمل" :
    status === "DELIVERED" ? "مستلم" : status;
  return `<span class="pill ${cls}">${label}</span>`;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function readFileAsText(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsText(file);
  });
}

function sum(arr, fn) { return arr.reduce((a,b)=>a+fn(b), 0); }


/* ------------------------ Integrations (QR / WhatsApp / SMS / Scanner / Excel) ------------------------ */
function digitsOnly(s) { return String(s||"").replace(/\D+/g, ""); }

// افتراضي: أرقام العراق. إذا عندچ دولة ثانية، غيّري المنطق هنا.
function normalizePhone(phone) {
  let p = String(phone || "").trim();
  if (!p) return "";
  p = p.replace(/[\s\-\(\)]+/g, "");
  if (p.startsWith("00")) p = "+" + p.slice(2);
  // إذا 07xxxxxxxxx -> +9647xxxxxxxxx
  if (p.startsWith("0") && p.length >= 10 && p.length <= 12) {
    const d = digitsOnly(p);
    if (d.startsWith("0")) p = "+964" + d.slice(1);
  }
  // إذا 9647xxxx بدون +
  if (/^964\d+/.test(p)) p = "+" + p;
  return p;
}

function waDigits(phone) {
  const p = normalizePhone(phone);
  return digitsOnly(p); // wa.me يحتاج digits فقط
}

function openWhatsApp(phone, text) {
  const to = waDigits(phone);
  if (!to) return toast("رقم الهاتف غير صحيح", "warn");
  const url = `https://wa.me/${to}?text=${encodeURIComponent(text || "")}`;
  window.open(url, "_blank");
}

function openSMS(phone, text) {
  const p = normalizePhone(phone);
  if (!p) return toast("رقم الهاتف غير صحيح", "warn");
  // يدعم موبايل غالبًا
  const url = `sms:${encodeURIComponent(p)}?body=${encodeURIComponent(text || "")}`;
  window.open(url, "_blank");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(String(text || ""));
    toast("تم النسخ ✅");
  } catch {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = String(text || "");
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast("تم النسخ ✅");
  }
}

async function sendMessageFlow({ title = "رسالة", phone = "", text = "", channelDefault = "whatsapp" }) {
  const out = await formModal({
    title,
    subtitle: "تقدرين تفتحي واتساب أو SMS مباشرة (أو تنسخي النص).",
    submitText: "متابعة",
    fields: [
      { name: "channel", label: "القناة", type: "select", options: [
        { value: "whatsapp", label: "WhatsApp" },
        { value: "sms", label: "SMS" },
        { value: "copy", label: "نسخ فقط" },
      ], default: channelDefault },
      { name: "phone", label: "رقم الهاتف", default: phone, required: true },
      { name: "text", label: "نص الرسالة", type: "textarea", default: text, required: true },
    ],
    initial: { channel: channelDefault, phone, text },
  });
  if (!out) return;
  if (out.channel === "whatsapp") return openWhatsApp(out.phone, out.text);
  if (out.channel === "sms") return openSMS(out.phone, out.text);
  return copyText(out.text);
}

// Templates
function tplAppointmentReminder(ap, c, v) {
  const when = ap?.date ? `${ap.date}${ap.time ? " " + ap.time : ""}` : fmtDate(ap?.whenTs || Date.now());
  return `تذكير ✅\nموعد سيارتك: ${v?.plate || "—"}\nالتاريخ/الوقت: ${when}\nالملاحظة: ${ap?.note || "—"}\n\nننتظركم بالكراج.`;
}
function tplCarReady(wo, c, v) {
  return `سيارتك جاهزة للاستلام ✅\nاللوحة: ${v?.plate || "—"}\nرقم أمر الشغل: ${wo?.id || "—"}\n\nإذا تحتاج أي استفسار احنا بالخدمة.`;
}
function tplPaymentReminder(inv, wo, c, v) {
  const rem = Math.max(0, Number(inv?.total||0) - Number(inv?.paid||0));
  return `تنبيه متبقي الدفع ⚠️\nاللوحة: ${v?.plate || "—"}\nرقم الفاتورة: ${inv?.id || "—"}\nالمتبقي: ${money(rem)}\n\nممكن تسديدها عند الاستلام أو تحويل.`;
}

// QR generator (يطبع DataURL للصورة)
async function makeQRDataURL(text, size = 220) {
  try {
    if (typeof QRCode === "undefined" || !QRCode?.toDataURL) return "";
    return await QRCode.toDataURL(String(text || ""), { width: size, margin: 1 });
  } catch {
    return "";
  }
}

async function choosePrintMode(title = "نوع الطباعة") {
  const def = Settings.get("printMode", "a4");
  const out = await formModal({
    title,
    subtitle: "A4 للطابعة العادية • حراري 80mm لطابعة الفواتير الصغيرة",
    submitText: "متابعة",
    fields: [
      { name: "mode", label: "النوع", type: "select", options: [
        { value: "a4", label: "A4 (عادي)" },
        { value: "thermal", label: "حراري 80mm" },
      ], default: def },
      { name: "remember", label: "تذكر الاختيار", type: "checkbox", default: true, help: "خلي النوع هذا هو الافتراضي" },
    ],
    initial: { mode: def, remember: true },
  });
  if (!out) return null;
  if (out.remember) Settings.set("printMode", out.mode);
  return out.mode;
}

// Scanner modal
let __scanInstance = null;
function ensureScanModal() {
  if ($("#scanModal")) return;
  document.body.insertAdjacentHTML("beforeend", `
    <div id="scanModal" class="modal hidden" role="dialog" aria-modal="true">
      <div class="scan-card">
        <div class="modal-head">
          <div class="modal-title">مسح باركود/QR</div>
          <button id="scanClose" class="btn btn-icon" aria-label="Close">✕</button>
        </div>
        <div class="scan-body">
          <div class="small">اسمحي للكاميرا ووجهيها على الباركود/QR. (بديل: USB Scanner يشتغل ككيبورد داخل حقل المسح)</div>
          <div style="height:10px"></div>
          <div id="scanReader"></div>
          <div style="height:10px"></div>
          <div class="mini">
            <button id="scanStop" class="btn">إيقاف</button>
            <button id="scanCancel" class="btn btn-danger">إغلاق</button>
          </div>
        </div>
      </div>
    </div>
  `);
}
async function stopScanner() {
  try {
    if (__scanInstance) {
      await __scanInstance.stop();
      await __scanInstance.clear();
    }
  } catch {}
  __scanInstance = null;
}
async function scanWithCamera() {
  ensureScanModal();
  const modal = $("#scanModal");
  modal.classList.remove("hidden");

  const close = async (val) => {
    modal.classList.add("hidden");
    await stopScanner();
    cleanup();
    return val;
  };

  const cleanup = () => {
    $("#scanClose")?.removeEventListener("click", onCancel);
    $("#scanCancel")?.removeEventListener("click", onCancel);
    $("#scanStop")?.removeEventListener("click", onStop);
    modal.removeEventListener("click", onBackdrop);
  };

  const onCancel = () => close(null);
  const onStop = () => stopScanner();
  const onBackdrop = (e) => { if (e.target === modal) onCancel(); };

  $("#scanClose")?.addEventListener("click", onCancel);
  $("#scanCancel")?.addEventListener("click", onCancel);
  $("#scanStop")?.addEventListener("click", onStop);
  modal.addEventListener("click", onBackdrop);

  if (typeof Html5Qrcode === "undefined") {
    toast("مكتبة الكاميرا غير متوفرة (تأكدي من الإنترنت)", "warn");
    return null;
  }

  const readerId = "scanReader";
  $("#scanReader").innerHTML = ""; // reset
  __scanInstance = new Html5Qrcode(readerId);

  const config = { fps: 12, qrbox: 240, aspectRatio: 1.777 };

  return new Promise(async (resolve) => {
    try {
      await __scanInstance.start(
        { facingMode: "environment" },
        config,
        async (decodedText) => {
          resolve(await close(decodedText));
        },
        () => {}
      );
    } catch (e) {
      toast("تعذر تشغيل الكاميرا. تحققي من الصلاحيات.", "bad");
      resolve(await close(null));
    }
  });
}

/* Excel (XLSX) */
function xlsxOk() { return typeof XLSX !== "undefined" && !!XLSX.utils; }
function normKey(k){ return String(k||"").trim().toLowerCase().replace(/\s+/g,""); }
function rowMap(row){
  const m = {};
  for (const [k,v] of Object.entries(row||{})) m[normKey(k)] = v;
  return m;
}
function pick(row, aliases){
  const m = rowMap(row);
  for (const a of aliases) {
    const v = m[normKey(a)];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return "";
}

function excelFileName(prefix){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${prefix}_${y}-${m}-${day}.xlsx`;
}

async function excelExport(kind) {
  if (!xlsxOk()) return toast("مكتبة Excel غير متوفرة (تأكدي من الإنترنت)", "warn");

  const wb = XLSX.utils.book_new();

  if (kind === "customers") {
    const customers = (await dbAPI.getAll("customers")).sort((a,b)=>(a.name||"").localeCompare(b.name||"", "ar"));
    const rows = customers.map(c => ({
      id: c.id, name: c.name, phone: c.phone || "", address: c.address || "", notes: c.notes || "", createdAt: fmtDate(c.createdAt || Date.now())
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Customers");
  }

  if (kind === "parts") {
    const parts = (await dbAPI.getAll("parts")).sort((a,b)=>(a.name||"").localeCompare(b.name||"", "ar"));
    const rows = parts.map(p => ({
      id: p.id, name: p.name, sku: p.sku || "", buy: Number(p.buy||0), sell: Number(p.sell||0), stock: Number(p.stock||0), min: Number(p.min||0), createdAt: fmtDate(p.createdAt || Date.now())
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Parts");
  }

  if (kind === "invoices") {
    const invoices = (await dbAPI.getAll("invoices")).sort((a,b)=>b.createdAt-a.createdAt);
    const invRows = invoices.map(i => ({
      id: i.id,
      workOrderId: i.workOrderId,
      type: i.invoiceType || "NORMAL",
      subtotal: Number(i.subtotal||0),
      discount: Number(i.discount||0),
      total: Number(i.total||0),
      paid: Number(i.paid||0),
      createdAt: fmtDate(i.createdAt || Date.now())
    }));
    const ws1 = XLSX.utils.json_to_sheet(invRows);
    XLSX.utils.book_append_sheet(wb, ws1, "Invoices");

    // Items sheet (flatten)
    const itemRows = [];
    for (const i of invoices) {
      const items = Array.isArray(i.items) ? i.items : [];
      for (const it of items) {
        itemRows.push({
          invoiceId: i.id,
          title: it.title || "",
          qty: Number(it.qty||0),
          price: Number(it.price||0),
          total: Number(it.total||0)
        });
      }
    }
    const ws2 = XLSX.utils.json_to_sheet(itemRows);
    XLSX.utils.book_append_sheet(wb, ws2, "Items");
  }

  XLSX.writeFile(wb, excelFileName(kind));
  toast("تم تصدير Excel ✅");
}

async function excelImport(kind, file) {
  if (!xlsxOk()) return toast("مكتبة Excel غير متوفرة (تأكدي من الإنترنت)", "warn");
  if (!file) return toast("اختاري ملف Excel أولاً", "warn");

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

  if (!rows.length) return toast("الملف فارغ", "warn");

  let created = 0, updated = 0, skipped = 0;

  if (kind === "customers") {
    const existing = await dbAPI.getAll("customers");
    const byPhone = new Map(existing.map(c => [digitsOnly(normalizePhone(c.phone)), c]).filter(([k])=>k));
    for (const r of rows) {
      const name = String(pick(r, ["name","الاسم","اسم"]) || "").trim();
      const phone = String(pick(r, ["phone","الهاتف","رقم","رقم الهاتف"]) || "").trim();
      const address = String(pick(r, ["address","العنوان"]) || "").trim();
      const notes = String(pick(r, ["notes","ملاحظات","ملاحظة"]) || "").trim();
      if (!name) { skipped++; continue; }

      const normP = digitsOnly(normalizePhone(phone));
      const ex = normP ? byPhone.get(normP) : null;

      if (ex) {
        // تحديث ذكي: لا تستبدلي الحقول غير الفارغة
        ex.name = ex.name || name;
        ex.phone = ex.phone || phone;
        ex.address = ex.address || address;
        ex.notes = ex.notes || notes;
        await dbAPI.put("customers", ex);
        updated++;
      } else {
        const id = String(pick(r, ["id","ID","معرف"]) || "") || uid("customer");
        await dbAPI.put("customers", { id, name, phone, address, notes, createdAt: Date.now() });
        if (normP) byPhone.set(normP, { id, name, phone, address, notes });
        created++;
      }
    }
  }

  if (kind === "parts") {
    const existing = await dbAPI.getAll("parts");
    const bySku = new Map(existing.map(p => [String(p.sku||"").trim().toLowerCase(), p]).filter(([k])=>k));
    for (const r of rows) {
      const name = String(pick(r, ["name","القطعة","اسم","الاسم"]) || "").trim();
      const sku = String(pick(r, ["sku","SKU"]) || "").trim();
      if (!name) { skipped++; continue; }

      const buy = Number(pick(r, ["buy","شراء","سعر شراء"]) || 0);
      const sell = Number(pick(r, ["sell","بيع","سعر بيع"]) || 0);
      const stock = Number(pick(r, ["stock","الرصيد"]) || 0);
      const min = Number(pick(r, ["min","الحدالأدنى","الحد الادنى","Min"]) || 0);

      const ex = sku ? bySku.get(sku.toLowerCase()) : null;
      if (ex) {
        ex.name = name || ex.name;
        ex.sku = sku || ex.sku;
        ex.buy = Number.isFinite(buy) ? buy : ex.buy;
        ex.sell = Number.isFinite(sell) ? sell : ex.sell;
        ex.stock = Number.isFinite(stock) ? stock : ex.stock;
        ex.min = Number.isFinite(min) ? min : ex.min;
        await dbAPI.put("parts", ex);
        updated++;
      } else {
        const id = String(pick(r, ["id","ID","معرف"]) || "") || uid("part");
        await dbAPI.put("parts", { id, name, sku, buy, sell, stock, min, createdAt: Date.now() });
        if (sku) bySku.set(sku.toLowerCase(), { id, name, sku, buy, sell, stock, min });
        created++;
      }
    }
  }


  if (kind === "invoices") {
    // حاول يقرأ Sheet ثانية اسمها Items (اختياري)
    const itemsSheet = wb.SheetNames.find(n => String(n).toLowerCase() === "items");
    const itemsByInv = new Map();
    if (itemsSheet) {
      const wsItems = wb.Sheets[itemsSheet];
      const itemRows = XLSX.utils.sheet_to_json(wsItems, { defval: "" });
      for (const r of itemRows) {
        const invoiceId = String(pick(r, ["invoiceId","invoice_id","InvoiceId","فاتورة","رقم الفاتورة","invoice"]) || "").trim();
        if (!invoiceId) continue;
        const title = String(pick(r, ["title","الوصف","البند"]) || "").trim();
        const qty = Number(pick(r, ["qty","الكمية","كمية"]) || 0);
        const price = Number(pick(r, ["price","السعر"]) || 0);
        const total = Number(pick(r, ["total","المجموع"]) || (qty*price));
        if (!itemsByInv.has(invoiceId)) itemsByInv.set(invoiceId, []);
        itemsByInv.get(invoiceId).push({ title, qty, price, total });
      }
    }

    const existing = await dbAPI.getAll("invoices");
    const byId = new Map(existing.map(i => [i.id, i]));

    for (const r of rows) {
      const id = String(pick(r, ["id","ID","invoiceId","رقم","رقم الفاتورة"]) || "").trim();
      const workOrderId = String(pick(r, ["workOrderId","work_order_id","WO","امر شغل","أمر شغل"]) || "").trim();
      if (!id || !workOrderId) { skipped++; continue; }

      const invoiceType = String(pick(r, ["type","invoiceType","نوع"]) || "NORMAL").trim() || "NORMAL";

      let subtotal = Number(pick(r, ["subtotal","المجموع"]) || 0);
      let discount = Number(pick(r, ["discount","خصم"]) || 0);
      let total = Number(pick(r, ["total","الإجمالي","اجمالي"]) || (subtotal - discount));
      let paid = Number(pick(r, ["paid","المدفوع"]) || 0);

      if (!Number.isFinite(subtotal)) subtotal = 0;
      if (!Number.isFinite(discount)) discount = 0;
      if (!Number.isFinite(total)) total = Math.max(0, subtotal - discount);
      if (!Number.isFinite(paid)) paid = 0;

      if (total < 0) total = 0;
      if (paid < 0) paid = 0;
      if (paid > total) paid = total;

      const createdAt = Date.now();

      const items = itemsByInv.get(id) || undefined;

      const ex = byId.get(id);
      if (ex) {
        ex.workOrderId = workOrderId || ex.workOrderId;
        ex.invoiceType = invoiceType || ex.invoiceType;
        ex.subtotal = subtotal;
        ex.discount = discount;
        ex.total = total;
        ex.paid = paid;
        if (items) ex.items = items;
        await dbAPI.put("invoices", ex);
        updated++;
      } else {
        const inv = { id, workOrderId, invoiceType, subtotal, discount, total, paid, items: items || [], createdAt };
        await dbAPI.put("invoices", inv);
        byId.set(id, inv);
        created++;
      }
    }
  }

  toast(`تم الاستيراد ✅ (جديد: ${created} • تحديث: ${updated} • تخطي: ${skipped})`);
  await renderRoute();
}


/* ------------------------ Print (HTML) ------------------------ */
function openPrintWindow(title, bodyHtml, mode = Settings.get("printMode","a4")) {
  return openPrintWindowEx({ title, bodyHtml, mode });
}

function openPrintWindowEx({ title, bodyHtml, mode = "a4" }) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return alert("المتصفح منع فتح نافذة الطباعة. فعّلي Popups.");

  const pageStyle =
    mode === "thermal"
      ? `@page{ size: 80mm auto; margin: 0; } body{ width:80mm; }`
      : `@page{ size: A4; margin: 10mm; }`;

  w.document.open();
  w.document.write(`
    <html lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <link rel="stylesheet" href="styles.css" />
        <style>
          ${pageStyle}
        </style>
      </head>
      <body class="print-${mode === "thermal" ? "thermal" : "a4"}">
        ${bodyHtml}
        <script>
          window.onload = function(){ window.focus(); window.print(); };
        </script>
      </body>
    </html>
  `);
  w.document.close();
  return w;
}

async function printInvoice(inv, ctx, opts = {}) {
  const { customer, vehicle, employee, wo } = ctx;
  const items = Array.isArray(inv.items) ? inv.items : [];
  const remaining = Math.max(0, Number(inv.total||0) - Number(inv.paid||0));

  const mode = opts.mode || Settings.get("printMode","a4");
  const qrDataUrl = opts.qrDataUrl || "";
  const qrHtml = qrDataUrl ? `<div class="print-qr"><img src="${qrDataUrl}" alt="QR" /></div>` : "";

  const shopName = Settings.get("shopName", "كراج حسن الوليم");
  const shopPhone = Settings.get("shopPhone", "");
  const shopAddr = Settings.get("shopAddress", "");

  const title = `فاتورة ${inv.id}`;
  const headerRight = `
    <div class="print-head-right">
      ${qrHtml}
      <div style="text-align:left">
        <div class="print-title">${escapeHtml(shopName)}</div>
        ${shopAddr ? `<div class="print-sub">${escapeHtml(shopAddr)}</div>` : ""}
        ${shopPhone ? `<div class="print-sub">☎ ${escapeHtml(shopPhone)}</div>` : ""}
      </div>
    </div>
  `;

  const body = `
  <div class="print-wrap">
    <div class="print-header">
      <div>
        <div class="print-title">فاتورة / Invoice</div>
        <div class="print-sub">رقم: <b>${escapeHtml(inv.id)}</b> • ${fmtDay(inv.createdAt)}</div>
        <div class="print-sub">النوع: <b>${escapeHtml(inv.invoiceType || "NORMAL")}</b></div>
      </div>
      ${headerRight}
    </div>

    <div class="print-grid">
      <div>
        <div class="print-lbl">الزبون</div>
        <div class="print-val">${escapeHtml(customer?.name||"—")}</div>
        <div class="print-sub">${escapeHtml(customer?.phone||"")}</div>
      </div>
      <div>
        <div class="print-lbl">السيارة</div>
        <div class="print-val">${escapeHtml(vehicle?.plate||"—")}</div>
        <div class="print-sub">${escapeHtml([vehicle?.make,vehicle?.model,vehicle?.year].filter(Boolean).join(" "))}</div>
      </div>
      <div>
        <div class="print-lbl">الفني</div>
        <div class="print-val">${escapeHtml(employee?.name||"—")}</div>
        <div class="print-sub">${escapeHtml(employee?.specialty||"")}</div>
      </div>
    </div>

    ${wo ? `
      <div class="print-box">
        <div class="print-lbl">وصف الشغل</div>
        <div class="print-val">${escapeHtml(wo.complaint||"—")}</div>
        <div class="print-sub">عداد: ${wo.odometer ?? "—"} • حالة: ${escapeHtml(wo.status||"—")}</div>
      </div>
    ` : ""}

    ${items.length ? `
      <table class="print-table">
        <thead>
          <tr>
            <th>الوصف</th>
            <th style="width:80px">الكمية</th>
            <th style="width:110px">السعر</th>
            <th style="width:120px">المجموع</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(it => `
            <tr>
              <td>${escapeHtml(it.title||"")}</td>
              <td>${it.qty ?? ""}</td>
              <td>${money(it.price||0)}</td>
              <td><b>${money(it.total||0)}</b></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    ` : `<div class="print-box"><div class="print-val">— لا توجد بنود —</div></div>`}

    <div class="print-totals">
      <div class="kv"><span>المجموع</span><b>${money(inv.subtotal||0)}</b></div>
      <div class="kv"><span>خصم</span><b>${money(inv.discount||0)}</b></div>
      <div class="kv"><span>الإجمالي</span><b>${money(inv.total||0)}</b></div>
      <div class="kv"><span>المدفوع</span><b>${money(inv.paid||0)}</b></div>
      <div class="kv"><span>المتبقي</span><b style="color:${remaining>0?"#b91c1c":"#16a34a"}">${money(remaining)}</b></div>
    </div>

    <div class="print-foot">
      <div class="print-sub">شكراً لثقتكم بنا 🌿</div>
      <div class="print-sub">تمت الطباعة: ${fmtDate(Date.now())}</div>
    </div>
  </div>
  `;

  openPrintWindowEx({ title, bodyHtml: body, mode });
}

async function printWorkOrder(wo, ctx, opts = {}) {
  const { customer, vehicle, employee } = ctx;

  const mode = opts.mode || Settings.get("printMode","a4");
  const qrDataUrl = opts.qrDataUrl || "";
  const qrHtml = qrDataUrl ? `<div class="print-qr"><img src="${qrDataUrl}" alt="QR" /></div>` : "";

  const shopName = Settings.get("shopName", "كراج حسن الوليم");
  const shopPhone = Settings.get("shopPhone", "");
  const shopAddr = Settings.get("shopAddress", "");

  const partLines = Array.isArray(wo.partLines) ? wo.partLines : [];
  const laborLines = Array.isArray(wo.laborLines) ? wo.laborLines : [];

  const parts = await dbAPI.getAll("parts");
  const inv = (await dbAPI.getAll("invoices")).find(i => i.workOrderId === wo.id) || null;
  const invRemaining = inv ? Math.max(0, Number(inv.total||0) - Number(inv.paid||0)) : 0;
  const pMap = new Map(parts.map(p=>[p.id,p]));

  const partsTotal = sum(partLines, ln => Number(ln.qty||0) * Number(ln.unit||0));
  const laborTotal = sum(laborLines, ln => Number(ln.amount||0));
  const total = partsTotal + laborTotal;

  const title = `Work Order ${wo.id}`;

  const body = `
    <div class="print-wrap">
      <div class="print-header">
        <div>
          <div class="print-title">أمر شغل / Work Order</div>
          <div class="print-sub">رقم: <b>${escapeHtml(wo.id)}</b> • ${fmtDay(wo.createdAt)}</div>
          <div class="print-sub">الحالة: <b>${escapeHtml(wo.status||"OPEN")}</b> • نوع: <b>${escapeHtml(wo.serviceType||"GENERAL")}</b></div>
        </div>

        <div class="print-head-right">
          ${qrHtml}
          <div style="text-align:left">
            <div class="print-title">${escapeHtml(shopName)}</div>
            ${shopAddr ? `<div class="print-sub">${escapeHtml(shopAddr)}</div>` : ""}
            ${shopPhone ? `<div class="print-sub">☎ ${escapeHtml(shopPhone)}</div>` : ""}
          </div>
        </div>
      </div>

      <div class="print-grid">
        <div>
          <div class="print-lbl">الزبون</div>
          <div class="print-val">${escapeHtml(customer?.name||"—")}</div>
          <div class="print-sub">${escapeHtml(customer?.phone||"")}</div>
        </div>
        <div>
          <div class="print-lbl">السيارة</div>
          <div class="print-val">${escapeHtml(vehicle?.plate||"—")}</div>
          <div class="print-sub">${escapeHtml([vehicle?.make,vehicle?.model,vehicle?.year].filter(Boolean).join(" "))}</div>
        </div>
        <div>
          <div class="print-lbl">الفني</div>
          <div class="print-val">${escapeHtml(employee?.name||"—")}</div>
          <div class="print-sub">${escapeHtml(employee?.specialty||"")}</div>
        </div>
      </div>

      <div class="print-box">
        <div class="print-lbl">وصف الشغل / Notes</div>
        <div class="print-val">${escapeHtml(wo.complaint||"—")}</div>
        <div class="print-sub">عداد: ${wo.odometer ?? "—"}</div>
      </div>

      <div class="row" style="gap:10px;flex-wrap:wrap">
        <div class="col">
          <div class="print-box">
            <div class="print-lbl">قطع مصروفة</div>
            ${partLines.length ? `
              <table class="print-table">
                <thead><tr><th>القطعة</th><th style="width:70px">كمية</th><th style="width:110px">سعر</th><th style="width:120px">مجموع</th></tr></thead>
                <tbody>
                  ${partLines.map(ln => {
                    const p = pMap.get(ln.partId);
                    const name = p?.name || ln.partId;
                    const lt = Number(ln.qty||0)*Number(ln.unit||0);
                    return `<tr><td>${escapeHtml(name)}</td><td>${ln.qty||0}</td><td>${money(ln.unit||0)}</td><td><b>${money(lt)}</b></td></tr>`;
                  }).join("")}
                </tbody>
              </table>
            ` : `<div class="print-sub">— لا توجد قطع —</div>`}
          </div>
        </div>

        <div class="col">
          <div class="print-box">
            <div class="print-lbl">الأجور</div>
            ${laborLines.length ? `
              <table class="print-table">
                <thead><tr><th>الوصف</th><th style="width:140px">المبلغ</th></tr></thead>
                <tbody>
                  ${laborLines.map(ln => `<tr><td>${escapeHtml(ln.title||"أجور")}</td><td><b>${money(ln.amount||0)}</b></td></tr>`).join("")}
                </tbody>
              </table>
            ` : `<div class="print-sub">— لا توجد أجور —</div>`}
          </div>
        </div>
      </div>

      <div class="print-totals">
        <div class="kv"><span>مجموع قطع</span><b>${money(partsTotal)}</b></div>
        <div class="kv"><span>مجموع أجور</span><b>${money(laborTotal)}</b></div>
        <div class="kv"><span>المجموع التقريبي</span><b>${money(total)}</b></div>
      </div>

      <div class="print-box">
        <div class="print-lbl">تواقيع</div>
        <div class="print-sub">توقيع الزبون: _________________________</div>
        <div class="print-sub">توقيع الفني: ___________________________</div>
      </div>

      <div class="print-foot">
        <div class="print-sub">تمت الطباعة: ${fmtDate(Date.now())}</div>
      </div>
    </div>
  `;

  openPrintWindowEx({ title, bodyHtml: body, mode });
}

async function printWorkOrderById(woId, mode) {
  const wo = await dbAPI.get("workOrders", woId);
  if (!wo) return;

  if (!mode) mode = await choosePrintMode("طباعة أمر شغل");
  if (!mode) return;

  const customer = wo ? await dbAPI.get("customers", wo.customerId) : null;
  const vehicle = wo ? await dbAPI.get("vehicles", wo.vehicleId) : null;
  const employee = wo && wo.employeeId ? await dbAPI.get("employees", wo.employeeId) : null;

  const qrText = JSON.stringify({
    type: "workOrder",
    id: wo.id,
    plate: vehicle?.plate || "",
    customer: customer?.name || "",
    phone: customer?.phone || "",
    status: wo.status || "",
    at: wo.createdAt || Date.now(),
  });
  const qrDataUrl = await makeQRDataURL(qrText, mode === "thermal" ? 180 : 220);

  await printWorkOrder(wo, { customer, vehicle, employee }, { mode, qrDataUrl });
}


/* ------------------------ Seed Demo ------------------------ */
async function seedDemo() {
  const now = Date.now();

  // Employees
  const emp1 = { id:"emp_demo_1", name:"حسن", phone:"07xxxxxxxxx", specialty:"ميكانيك", salaryType:"شهري", salaryAmount:900000, active:true, createdAt: now };
  const emp2 = { id:"emp_demo_2", name:"طه", phone:"07yyyyyyyyy", specialty:"كهرباء سيارات", salaryType:"شهري", salaryAmount:850000, active:true, createdAt: now };
  await dbAPI.put("employees", emp1);
  await dbAPI.put("employees", emp2);

  // Customer + Vehicles
  const c1 = { id:"cust_demo_1", name:"زبون تجريبي", phone:"07zzzzzzzzz", address:"", notes:"", createdAt: now };
  await dbAPI.put("customers", c1);

  const v1 = { id:"veh_demo_1", customerId:c1.id, plate:"بغداد-12345", vin:"", make:"Toyota", model:"Corolla", year:2015, odometer:150500, nextOilOdo:155500, createdAt: now };
  await dbAPI.put("vehicles", v1);

  // Parts
  const pOil = { id:"part_oil", name:"زيت محرك 4L", sku:"OIL-4L", buy:18000, sell:25000, stock:8, min:3, createdAt: now };
  const pFilter = { id:"part_filter", name:"فلتر زيت", sku:"FILTER-OIL", buy:6000, sell:9000, stock:4, min:2, createdAt: now };
  await dbAPI.put("parts", pOil);
  await dbAPI.put("parts", pFilter);

  // Work order
  const wo = {
    id:"wo_demo_1",
    customerId:c1.id,
    vehicleId:v1.id,
    employeeId: emp1.id,
    serviceType:"GENERAL",
    complaint:"فحص اهتزاز + ميزان",
    odometer:150500,
    status:"OPEN",
    createdAt: now - 3600e3,
    updatedAt: now - 3600e3,
    partLines: [],
    laborLines: [{ title:"أجور فحص", amount:10000 }]
  };
  await dbAPI.put("workOrders", wo);

  // Oil change work order + invoice
  const woOil = {
    id:"wo_demo_oil",
    customerId:c1.id,
    vehicleId:v1.id,
    employeeId: emp2.id,
    serviceType:"OIL",
    complaint:"تبديل دهن + فلتر",
    odometer:150500,
    status:"DONE",
    createdAt: now - 2*86400e3,
    updatedAt: now - 2*86400e3,
    partLines: [{ partId:"part_oil", qty:1, unit:25000 }, { partId:"part_filter", qty:1, unit:9000 }],
    laborLines: [{ title:"أجور خدمة", amount:8000 }]
  };
  await dbAPI.put("workOrders", woOil);

  const invOil = {
    id:"inv_demo_oil",
    workOrderId: woOil.id,
    invoiceType:"OIL",
    subtotal: 25000+9000+8000,
    discount:0,
    total: 42000,
    paid: 42000,
    createdAt: now - 2*86400e3,
    oil: { currentOdo:150500, interval:5000, nextOdo:155500, oilType:"5W-30" },
    items: [
      { name:"زيت محرك 4L", qty:1, unit:25000, total:25000, kind:"part" },
      { name:"فلتر زيت", qty:1, unit:9000, total:9000, kind:"part" },
      { name:"أجور خدمة", qty:1, unit:8000, total:8000, kind:"labor" },
    ]
  };
  await dbAPI.put("invoices", invOil);

  alert("تمت إضافة بيانات تجريبية ✅");
  renderRoute();
}

/* ------------------------ CRUD Prompts (خفيفة وبسيطة) ------------------------ */
async function createCustomer() {
  const v = await formModal({
    title: "زبون جديد",
    fields: [
      { name: "name", label: "اسم الزبون", required: true },
      { name: "phone", label: "الهاتف", type: "tel" },
      { name: "address", label: "العنوان" },
      { name: "notes", label: "ملاحظات", type: "textarea" },
    ],
  });
  if (!v) return;
  const obj = { id: "cust_" + uid().slice(3), ...v, createdAt: Date.now() };
  await dbAPI.put("customers", obj);
  toast("تم إضافة الزبون ✅");
  renderRoute();
}

async function editCustomer(id) {
  const c = await dbAPI.get("customers", id);
  if (!c) return;
  const v = await formModal({
    title: "تعديل زبون",
    fields: [
      { name: "name", label: "اسم الزبون", required: true },
      { name: "phone", label: "الهاتف", type: "tel" },
      { name: "address", label: "العنوان" },
      { name: "notes", label: "ملاحظات", type: "textarea" },
    ],
    initial: c,
    submitText: "حفظ التعديل",
  });
  if (!v) return;
  Object.assign(c, v);
  await dbAPI.put("customers", c);
  toast("تم التعديل ✅");
  renderRoute();
}

async function deleteCustomer(id) {
  const c = await dbAPI.get("customers", id);
  if (!c) return;
  if (!confirm("هسه إذا حذفنا الزبون راح نحذف سياراته + أوامره + فواتيره. موافقة؟")) return;

  const vehicles = await dbAPI.getAll("vehicles");
  const workOrders = await dbAPI.getAll("workOrders");
  const invoices = await dbAPI.getAll("invoices");

  const vIds = vehicles.filter(v => v.customerId === id).map(v => v.id);
  const woIds = workOrders.filter(w => w.customerId === id).map(w => w.id);
  const invIds = invoices.filter(i => woIds.includes(i.workOrderId)).map(i => i.id);

  for (const invId of invIds) await dbAPI.del("invoices", invId);
  for (const woId of woIds) await dbAPI.del("workOrders", woId);
  for (const vid of vIds) await dbAPI.del("vehicles", vid);
  await dbAPI.del("customers", id);

  toast("تم الحذف ✅");
  renderRoute();
}

async function createVehicle(prefCustomerId = "") {
  const customers = await dbAPI.getAll("customers");
  if (!customers.length) return alert("سوي زبون أولاً.");

  const opts = customers
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ar"))
    .map((c) => ({ value: c.id, label: `${c.name}${c.phone ? " • " + c.phone : ""}` }));

  const v = await formModal({
    title: "سيارة جديدة",
    fields: [
      { name: "customerId", label: "الزبون", type: "select", options: opts, required: true, default: prefCustomerId || opts?.[0]?.value },
      { name: "plate", label: "رقم اللوحة", placeholder: "مثال: 1234 بغداد" },
      { name: "make", label: "الشركة", placeholder: "Toyota" },
      { name: "model", label: "الموديل" },
      { name: "year", label: "السنة", type: "number", cast: "number" },
      { name: "vin", label: "VIN" },
      { name: "odometer", label: "العداد الحالي", type: "number", cast: "number" },
    ],
  });
  if (!v) return;

  const obj = {
    id: "veh_" + uid().slice(3),
    customerId: v.customerId,
    plate: (v.plate || "").trim(),
    make: (v.make || "").trim(),
    model: (v.model || "").trim(),
    year: v.year ? Number(v.year) : undefined,
    vin: (v.vin || "").trim(),
    odometer: v.odometer ? Number(v.odometer) : undefined,
    nextOilOdo: undefined,
    createdAt: Date.now(),
  };

  await dbAPI.put("vehicles", obj);
  toast("تم إضافة السيارة ✅");
  renderRoute();
}

async function editVehicle(id) {
  const v = await dbAPI.get("vehicles", id);
  if (!v) return;

  const out = await formModal({
    title: "تعديل سيارة",
    fields: [
      { name: "plate", label: "رقم اللوحة" },
      { name: "make", label: "الشركة" },
      { name: "model", label: "الموديل" },
      { name: "year", label: "السنة", type: "number", cast: "number" },
      { name: "vin", label: "VIN" },
      { name: "odometer", label: "العداد الحالي", type: "number", cast: "number" },
      { name: "nextOilOdo", label: "العداد الجاي للدهن", type: "number", cast: "number" },
    ],
    initial: v,
    submitText: "حفظ التعديل",
  });
  if (!out) return;

  Object.assign(v, out);
  v.plate = (v.plate || "").trim();
  v.make = (v.make || "").trim();
  v.model = (v.model || "").trim();
  v.vin = (v.vin || "").trim();

  await dbAPI.put("vehicles", v);
  toast("تم التعديل ✅");
  renderRoute();
}

async function deleteVehicle(id) {
  const v = await dbAPI.get("vehicles", id);
  if (!v) return;
  if (!confirm("حذف السيارة؟ راح ينحذف وياها أوامرها وفواتيرها.")) return;

  const workOrders = await dbAPI.getAll("workOrders");
  const invoices = await dbAPI.getAll("invoices");

  const woIds = workOrders.filter(w => w.vehicleId === id).map(w => w.id);
  const invIds = invoices.filter(i => woIds.includes(i.workOrderId)).map(i => i.id);

  for (const invId of invIds) await dbAPI.del("invoices", invId);
  for (const woId of woIds) await dbAPI.del("workOrders", woId);
  await dbAPI.del("vehicles", id);

  toast("تم الحذف ✅");
  renderRoute();
}

/* ------------------------ Employees ------------------------ */
async function createEmployee() {
  const v = await formModal({
    title: "موظف جديد",
    fields: [
      { name: "name", label: "اسم الموظف", required: true },
      { name: "phone", label: "الهاتف", type: "tel" },
      { name: "email", label: "إيميل الدخول (اختياري)", type: "email", placeholder: "name@example.com" },
      { name: "specialty", label: "الاختصاص", placeholder: "ميكانيك / كهرباء..." },
      { name: "salaryType", label: "نوع الراتب", type: "select", options: [
        { value: "شهري", label: "شهري" },
        { value: "يومي", label: "يومي" },
        { value: "بالنسبة", label: "بالنسبة" },
      ] },
      { name: "salaryAmount", label: "قيمة الراتب", type: "number", cast: "number" },
    ],
  });
  if (!v) return;

  const e = {
    id: "emp_" + uid().slice(3),
    name: (v.name || "").trim(),
    phone: (v.phone || "").trim(),
    email: normEmail(v.email || ""),
    specialty: (v.specialty || "").trim(),
    salaryType: (v.salaryType || "شهري").trim(),
    salaryAmount: Number(v.salaryAmount || 0),
    active: true,
    createdAt: Date.now(),
  };
  await dbAPI.put("employees", e);
  toast("تم إضافة الموظف ✅");
  renderRoute();
}

async function editEmployee(id) {
  const e = await dbAPI.get("employees", id);
  if (!e) return;
  const v = await formModal({
    title: "تعديل موظف",
    fields: [
      { name: "name", label: "اسم الموظف", required: true },
      { name: "phone", label: "الهاتف", type: "tel" },
      { name: "email", label: "إيميل الدخول (اختياري)", type: "email", placeholder: "name@example.com" },
      { name: "specialty", label: "الاختصاص" },
      { name: "salaryType", label: "نوع الراتب", type: "select", options: [
        { value: "شهري", label: "شهري" },
        { value: "يومي", label: "يومي" },
        { value: "بالنسبة", label: "بالنسبة" },
      ] },
      { name: "salaryAmount", label: "قيمة الراتب", type: "number", cast: "number" },
    ],
    initial: e,
    submitText: "حفظ التعديل",
  });
  if (!v) return;

  Object.assign(e, v);
  e.name = (e.name || "").trim();
  e.phone = (e.phone || "").trim();
  e.email = normEmail(e.email || "");
  e.specialty = (e.specialty || "").trim();
  e.salaryType = (e.salaryType || "شهري").trim();
  e.salaryAmount = Number(e.salaryAmount || 0);
  await dbAPI.put("employees", e);

  toast("تم التعديل ✅");
  renderRoute();
}

async function toggleEmployee(id) {
  const e = await dbAPI.get("employees", id);
  if (!e) return;
  e.active = !e.active;
  await dbAPI.put("employees", e);
  renderRoute();
}

async function deleteEmployee(id) {
  if (!confirm("حذف الموظف؟")) return;
  await dbAPI.del("employees", id);
  renderRoute();
}

/* ------------------------ Inventory ------------------------ */
async function createPart() {
  const v = await formModal({
    title: "قطعة جديدة",
    fields: [
      { name: "name", label: "اسم القطعة", required: true },
      { name: "sku", label: "SKU / رقم" },
      { name: "buy", label: "سعر الشراء", type: "number", cast: "number" },
      { name: "sell", label: "سعر البيع", type: "number", cast: "number" },
      { name: "stock", label: "الرصيد الحالي", type: "number", cast: "number" },
      { name: "min", label: "الحد الأدنى", type: "number", cast: "number" },
    ],
  });
  if (!v) return;
  const p = {
    id: "part_" + uid().slice(3),
    name: (v.name || "").trim(),
    sku: (v.sku || "").trim(),
    buy: Number(v.buy || 0),
    sell: Number(v.sell || 0),
    stock: Number(v.stock || 0),
    min: Number(v.min || 0),
    createdAt: Date.now(),
  };
  await dbAPI.put("parts", p);
  toast("تمت إضافة القطعة ✅");
  renderRoute();
}

async function adjustStock(partId, delta) {
  const p = await dbAPI.get("parts", partId);
  if (!p) return;
  const v = await formModal({
    title: delta > 0 ? "إضافة رصيد" : "صرف من الرصيد",
    subtitle: p.name || "",
    fields: [
      { name: "amount", label: delta > 0 ? "الكمية للإضافة" : "الكمية للصرف", type: "number", cast: "number", required: true, default: 1 },
    ],
    submitText: "تطبيق",
  });
  if (!v) return;
  const amount = Number(v.amount || 0);
  if (!amount || amount <= 0) return;
  const next = Number(p.stock||0) + (delta>0 ? amount : -amount);
  if (next < 0) return toast("ما يصير الرصيد يصير سالب.", "bad");
  p.stock = next;
  await dbAPI.put("parts", p);
  toast("تم تحديث الرصيد ✅");
  renderRoute();
}

async function deletePart(partId) {
  if (!confirm("حذف القطعة؟")) return;
  await dbAPI.del("parts", partId);
  renderRoute();
}

/* ------------------------ Work Orders ------------------------ */
async function createWorkOrderFromCheckin() {
  const customerId = $("#ciCustomer").value;
  const vehicleId = $("#ciVehicle").value;
  const employeeId = $("#ciEmployee").value || undefined;
  const complaint = $("#ciComplaint").value.trim();
  const odometer = $("#ciOdometer").value.trim();
  const status = $("#ciStatus").value;

  if (!customerId) return alert("اختاري الزبون.");
  if (!vehicleId) return alert("اختاري السيارة.");
  if (!complaint) return alert("اكتبي وصف الشغل.");

  const now = Date.now();
  const wo = {
    id: "wo_" + uid().slice(3),
    customerId,
    vehicleId,
    employeeId,
    serviceType: "GENERAL",
    complaint,
    odometer: odometer ? Number(odometer) : undefined,
    status,
    createdAt: now,
    updatedAt: now,
    partLines: [],
    laborLines: [],
  };

  await dbAPI.put("workOrders", wo);

  // تحديث عداد السيارة إذا انكتب
  if (wo.odometer != null) {
    const v = await dbAPI.get("vehicles", vehicleId);
    if (v) { v.odometer = wo.odometer; await dbAPI.put("vehicles", v); }
  }

  alert("تم فتح أمر شغل ✅");
  location.hash = `#/order?id=${encodeURIComponent(wo.id)}`;
}

async function deleteWorkOrder(id) {
  if (!confirm("حذف أمر الشغل؟")) return;
  // ملاحظة: الفواتير تبقى؟ هنا نخليها تبقى مرتبطة بس راح تصير orphan.
  // الأفضل نحذف الفواتير المرتبطة:
  const invoices = await dbAPI.getAll("invoices");
  for (const inv of invoices.filter(i => i.workOrderId === id)) await dbAPI.del("invoices", inv.id);

  await dbAPI.del("workOrders", id);
  alert("تم الحذف ✅");
  location.hash = "#/orders";
}

async function setOrderStatus(id, status) {
  const wo = await dbAPI.get("workOrders", id);
  if (!wo) return;
  wo.status = status;
  wo.updatedAt = Date.now();
  await dbAPI.put("workOrders", wo);
  renderRoute();
}

async function setOrderEmployee(id, employeeId) {
  const wo = await dbAPI.get("workOrders", id);
  if (!wo) return;
  wo.employeeId = employeeId || undefined;
  wo.updatedAt = Date.now();
  await dbAPI.put("workOrders", wo);
  renderRoute();
}

async function addLaborLine(woId) {
  const wo = await dbAPI.get("workOrders", woId);
  if (!wo) return;
  const title = prompt("وصف الأجور:", "أجور خدمة") || "";
  if (!title.trim()) return;
  const amount = Number(prompt("القيمة (رقم):","0") || "0");
  if (!amount || amount <= 0) return;
  wo.laborLines = Array.isArray(wo.laborLines) ? wo.laborLines : [];
  wo.laborLines.push({ title:title.trim(), amount });
  wo.updatedAt = Date.now();
  await dbAPI.put("workOrders", wo);
  renderRoute();
}

async function removeLaborLine(woId, idx) {
  const wo = await dbAPI.get("workOrders", woId);
  if (!wo) return;
  wo.laborLines = Array.isArray(wo.laborLines) ? wo.laborLines : [];
  if (!(idx>=0 && idx<wo.laborLines.length)) return;
  wo.laborLines.splice(idx,1);
  wo.updatedAt = Date.now();
  await dbAPI.put("workOrders", wo);
  renderRoute();
}

async function addPartLine(woId, partId, qty) {
  const wo = await dbAPI.get("workOrders", woId);
  const part = await dbAPI.get("parts", partId);
  if (!wo || !part) return;

  qty = Number(qty || 0);
  if (!qty || qty <= 0) return alert("أدخل كمية صحيحة.");

  // ملاحظة: حسب سياسة النظام الجديدة، لا يتم خصم المخزن هنا
  // (يتم الخصم عند حفظ الفاتورة فقط).

  wo.partLines = Array.isArray(wo.partLines) ? wo.partLines : [];
  wo.partLines.push({ partId: part.id, qty, unit: Number(part.sell || 0) });
  wo.updatedAt = Date.now();
  await dbAPI.put("workOrders", wo);

  renderRoute();
}

async function removePartLine(woId, idx) {
  const wo = await dbAPI.get("workOrders", woId);
  if (!wo) return;
  wo.partLines = Array.isArray(wo.partLines) ? wo.partLines : [];
  if (!(idx>=0 && idx<wo.partLines.length)) return;

  const line = wo.partLines[idx];
  // NOTE: Stock changes happen on invoice save only (not here).

  wo.partLines.splice(idx,1);
  wo.updatedAt = Date.now();
  await dbAPI.put("workOrders", wo);

  renderRoute();
}

/* ------------------------ Invoice Creation ------------------------ */
function buildInvoiceFromWO(wo, partsMap) {
  const partLines = Array.isArray(wo.partLines) ? wo.partLines : [];
  const laborLines = Array.isArray(wo.laborLines) ? wo.laborLines : [];

  const items = [];

  for (const ln of partLines) {
    const p = partsMap.get(ln.partId);
    const name = p?.name || ln.partId;
    const qty = Number(ln.qty||0);
    const unit = Number(ln.unit||0);
    items.push({ partId: ln.partId, name, qty, unit, total: qty*unit, kind:"part" });
  }

  for (const ll of laborLines) {
    const amt = Number(ll.amount||0);
    if (amt>0) items.push({ name: ll.title || "أجور", qty: 1, unit: amt, total: amt, kind:"labor" });
  }

  const subtotal = sum(items, it => Number(it.total||0));
  return { items, subtotal };
}


/* ------------------------ Stock Consume (Invoice Only) ------------------------
   ✅ سياسة المخزن:
   - لا نخصم من أمر الشغل (workOrders/orders)
   - نخصم فقط عند إنشاء/حفظ الفاتورة (invoices)
   - خيارچ: السماح بالسالب ✅ (اذا المخزون 0 يصير -1, -2 ...)

   ملاحظة: لا يصير خصم مزدوج لأن الفاتورة تتوسم stockConsumed=true بعد أول خصم.
*/

async function consumeStockFromInvoice(invId) {
  if (!invId) return;

  // نقرأ الفاتورة من نفس الـAPI (محلي/سحابة)
  const inv = await dbAPI.get("invoices", invId);
  if (!inv) return;

  if (inv.stockConsumed) return; // already consumed

  const items = Array.isArray(inv.items) ? inv.items : [];
  const take = new Map();

  for (const it of items) {
    const kind = String(it.kind || "").toLowerCase();
    const partId = it.partId;
    const qty = Number(it.qty || 0);

    if (kind !== "part") continue;
    if (!partId) continue;
    if (!isFinite(qty) || qty <= 0) continue;

    take.set(partId, (take.get(partId) || 0) + qty);
  }

  if (take.size === 0) return; // nothing to consume

  const now = Date.now();
  const moves = [];

  // خصم فعلي من المخزن
  for (const [partId, qty] of take.entries()) {
    let part = await dbAPI.get("parts", partId);

    // إذا القطعة غير موجودة بالمخزن: نسويها تلقائياً حتى الخصم يصير (وبالسالب لو لازم)
    if (!part) {
      const sample = items.find(x => x && x.partId === partId) || {};
      part = {
        id: partId,
        name: sample.name || "قطعة",
        buy: Number(sample.buy || 0),
        sell: Number(sample.unit || 0),
        stock: 0,
        createdAt: now,
        updatedAt: now,
        note: "AUTO_CREATED_FROM_INVOICE",
      };
    }

    const before = Number(part.stock || 0);
    const after = before - Number(qty || 0); // ✅ يسمح بالسالب حسب خيارچ
    part.stock = after;
    part.updatedAt = now;

    await dbAPI.put("parts", part);
    moves.push({ partId, qty, before, after });
  }

  // توسيم الفاتورة حتى ما نخصم مرتين
  inv.stockConsumed = true;
  inv.stockConsumedAt = now;
  inv.stockMoves = moves;

  await dbAPI.put("invoices", inv);
}

async function createInvoiceForWO(woId) {
  const wo = await dbAPI.get("workOrders", woId);
  if (!wo) return alert("ما لقيت أمر الشغل.");

  const parts = await dbAPI.getAll("parts");
  const partsMap = new Map(parts.map(p => [p.id, p]));

  const { items, subtotal } = buildInvoiceFromWO(wo, partsMap);

  const discount = Number(prompt("خصم (اختياري):","0") || "0");
  const total = Math.max(0, subtotal - discount);
  const paid = Number(prompt("مدفوع الآن:","0") || "0");

  const inv = {
    id: "inv_" + uid().slice(3),
    workOrderId: wo.id,
    invoiceType: "GENERAL",
    subtotal,
    discount,
    total,
    paid: Math.min(paid, total),
    createdAt: Date.now(),
    items,
  };
  await dbAPI.put("invoices", inv);

  // ✅ خصم المخزن من الفاتورة فقط
  await consumeStockFromInvoice(inv.id);

  alert("تم إنشاء الفاتورة ✅");
  location.hash = "#/invoices";
}

async function payInvoice(invId) {
  const inv = await dbAPI.get("invoices", invId);
  if (!inv) return;
  const rem = Math.max(0, Number(inv.total||0) - Number(inv.paid||0));
  const v = await formModal({
    title: "دفع فاتورة",
    subtitle: `المتبقي: ${rem}`,
    fields: [
      { name: "add", label: "دفعة إضافية", type: "number", cast: "number", required: true, default: 0 },
    ],
    submitText: "تسجيل الدفع",
  });
  if (!v) return;
  const add = Number(v.add || 0);
  if (!add || add<=0) return;
  inv.paid = Math.min(Number(inv.total||0), Number(inv.paid||0) + add);
  await dbAPI.put("invoices", inv);
  toast("تم تسجيل الدفع ✅");
  renderRoute();
}

async function deleteInvoice(invId) {
  if (!confirm("حذف الفاتورة؟")) return;
  await dbAPI.del("invoices", invId);
  renderRoute();
}

async function printInvoiceById(invId, mode) {
  const inv = await dbAPI.get("invoices", invId);
  if (!inv) return;

  if (!mode) mode = await choosePrintMode("طباعة فاتورة");
  if (!mode) return;

  const wo = await dbAPI.get("workOrders", inv.workOrderId);
  const customer = wo ? await dbAPI.get("customers", wo.customerId) : null;
  const vehicle = wo ? await dbAPI.get("vehicles", wo.vehicleId) : null;
  const employee = wo && wo.employeeId ? await dbAPI.get("employees", wo.employeeId) : null;

  const remaining = Math.max(0, Number(inv.total||0) - Number(inv.paid||0));
  const qrText = JSON.stringify({
    type: "invoice",
    id: inv.id,
    wo: wo?.id || "",
    plate: vehicle?.plate || "",
    customer: customer?.name || "",
    phone: customer?.phone || "",
    total: Number(inv.total||0),
    paid: Number(inv.paid||0),
    remaining,
    at: inv.createdAt || Date.now(),
  });

  const qrDataUrl = await makeQRDataURL(qrText, mode === "thermal" ? 180 : 220);

  await printInvoice(inv, { wo, customer, vehicle, employee }, { mode, qrDataUrl });
}

/* ------------------------ Oil Change Flow ------------------------ */
async function createOilChangeInvoice() {
  const customerId = $("#oilCustomer").value;
  const vehicleId = $("#oilVehicle").value;
  const employeeId = $("#oilEmployee").value || undefined;

  const currentOdo = Number($("#oilCurrentOdo").value || 0);
  const interval = Number($("#oilInterval").value || 5000);
  const nextOdo = Number($("#oilNextOdo").value || 0);
  const oilType = ($("#oilType").value || "").trim();

  const oilPrice = Number($("#oilPrice").value || 0);
  const filterPrice = Number($("#oilFilterPrice").value || 0);
  const laborPrice = Number($("#oilLabor").value || 0);

  if (!customerId) return alert("اختاري الزبون.");
  if (!vehicleId) return alert("اختاري السيارة.");
  if (!currentOdo || currentOdo <= 0) return alert("أدخلي العداد الحالي.");

  const now = Date.now();

  // Work Order (DONE)
  const wo = {
    id: "wo_" + uid().slice(3),
    customerId,
    vehicleId,
    employeeId,
    serviceType: "OIL",
    complaint: "تبديل دهن + فلتر",
    odometer: currentOdo,
    status: "DONE",
    createdAt: now,
    updatedAt: now,
    partLines: [],
    laborLines: [],
  };

  // Items (direct, not linked to stock here — ممكن نربطها لاحقاً بالمخزون لو تريدين)
  const items = [];
  if (oilPrice > 0) items.push({ name: `دهن ${oilType || ""}`.trim() || "دهن", qty: 1, unit: oilPrice, total: oilPrice, kind:"oil" });
  if (filterPrice > 0) items.push({ name: "فلتر دهن", qty: 1, unit: filterPrice, total: filterPrice, kind:"part" });
  if (laborPrice > 0) items.push({ name: "أجور خدمة", qty: 1, unit: laborPrice, total: laborPrice, kind:"labor" });

  const subtotal = sum(items, it => it.total);
  const discount = Number($("#oilDiscount").value || 0);
  const total = Math.max(0, subtotal - discount);
  const paid = Math.min(Number($("#oilPaid").value || 0), total);

  const inv = {
    id: "inv_" + uid().slice(3),
    workOrderId: wo.id,
    invoiceType: "OIL",
    subtotal,
    discount,
    total,
    paid,
    createdAt: now,
    oil: { currentOdo, interval, nextOdo: nextOdo || (currentOdo + interval), oilType: oilType || "" },
    items
  };

  await dbAPI.put("workOrders", wo);
  await dbAPI.put("invoices", inv);

  // ✅ خصم المخزن من الفاتورة فقط (إذا كانت العناصر مربوطة بـ partId)
  await consumeStockFromInvoice(inv.id);

  // Update vehicle odometer + nextOil
  const v = await dbAPI.get("vehicles", vehicleId);
  if (v) {
    v.odometer = currentOdo;
    v.nextOilOdo = inv.oil.nextOdo;
    await dbAPI.put("vehicles", v);
  }

  alert("تم تسجيل تبديل الدهن + إنشاء فاتورة ✅");
  location.hash = `#/invoices`;
}

/* ------------------------ Backup ------------------------ */
async function exportAll() {
  const data = {};
  for (const s of Object.keys(stores)) data[s] = await dbAPI.getAll(s);
  data._meta = { exportedAt: Date.now(), app: "نظام حسن الوليم RPM", dbVer: DB_VER };
  downloadText(`alwaleem_rpm_backup_${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(data, null, 2));
}

async function importAll() {
  const file = $("#importFile").files?.[0];
  if (!file) return alert("اختاري ملف JSON أولاً.");
  const txt = await readFileAsText(file);
  let data;
  try { data = JSON.parse(txt); } catch { return alert("ملف غير صالح."); }

  if (!confirm("راح يتم استبدال كل البيانات الحالية. متابعة؟")) return;

  for (const s of Object.keys(stores)) await dbAPI.clear(s);
  for (const s of Object.keys(stores)) {
    const arr = Array.isArray(data[s]) ? data[s] : [];
    for (const obj of arr) await dbAPI.put(s, obj);
  }
  alert("تم الاستيراد ✅");
  renderRoute();
}

async function resetAll() {
  if (!confirm("تأكيد حذف كل البيانات؟")) return;
  for (const s of Object.keys(stores)) await dbAPI.clear(s);
  alert("تم الحذف ✅");
  renderRoute();
}

/* ------------------------ Views ------------------------ */


/* ======================== EXT: Appointments + Expenses + Attachments + Roles UI ======================== */

const AP_STATUS_LABELS = {
  scheduled: "مجدول",
  done: "منجز",
  cancelled: "ملغي",
};

function apPill(status) {
  const s = (status || "scheduled").toLowerCase();
  const label = AP_STATUS_LABELS[s] || status || "—";
  const cls = s === "done" ? "ok" : s === "cancelled" ? "bad" : "progress";
  return `<span class="pill ${cls}">${escapeHtml(label)}</span>`;
}

function storagePrefix() {
  const scope = Settings.get("cloudScope", "root");
  if (scope === "user") {
    const base = userPath();
    return base || "users/unknown";
  }
  return "root";
}

function ensureImageModal() {
  if ($("#imgModal")) return;
  document.body.insertAdjacentHTML(
    "beforeend",
    `
    <div id="imgModal" class="modal hidden" role="dialog" aria-modal="true">
      <div class="imgmodal-card">
        <div class="modal-head">
          <div>
            <div class="modal-title" id="imTitle">صورة</div>
            <div class="small" id="imSub" style="margin-top:4px"></div>
          </div>
          <button id="imClose" class="btn btn-icon" aria-label="Close">✕</button>
        </div>
        <div class="imgmodal-body">
          <img id="imImg" alt="attachment" />
        </div>
      </div>
    </div>
    `
  );

  $("#imClose").addEventListener("click", () => $("#imgModal").classList.add("hidden"));
  $("#imgModal").addEventListener("click", (e) => { if (e.target === $("#imgModal")) $("#imgModal").classList.add("hidden"); });
}

function openImageModal(src, title = "صورة", sub = "") {
  ensureImageModal();
  $("#imTitle").textContent = title;
  $("#imSub").textContent = sub;
  $("#imImg").src = src;
  $("#imgModal").classList.remove("hidden");
}

function pickFiles({ accept = "image/*", multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files || []));
    input.click();
  });
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error || new Error("FILE_READ_ERROR"));
    r.readAsDataURL(file);
  });
}

async function getAttachmentsFor(entityType, entityId) {
  const all = await dbAPI.getAll("attachments");
  return all
    .filter(a => a.entityType === entityType && a.entityId === entityId)
    .sort((a,b)=> (b.createdAt||0)-(a.createdAt||0));
}

async function renderAttachmentThumbs(entityType, entityId) {
  const list = await getAttachmentsFor(entityType, entityId);
  return list.map(att => {
    const src = att.url || att.dataUrl || "";
    const title = att.kind ? `(${att.kind})` : "";
    return `
      <div class="thumb-wrap">
        <img class="thumb" src="${escapeHtml(src)}" alt="att" data-act="viewAttachment" data-id="${att.id}" />
        <div class="thumb-actions">
          <button class="btn" data-act="viewAttachment" data-id="${att.id}">عرض</button>
          <button class="btn btn-danger" data-act="delAttachment" data-id="${att.id}">حذف</button>
        </div>
      </div>
    `;
  });
}

async function addAttachment(entityType, entityId, kind = "other") {
  const files = await pickFiles({ accept: "image/*", multiple: true });
  if (!files.length) return;

  for (const f of files) {
    const dataUrl = await fileToDataURL(f);
    const att = {
      id: "att_" + uid().slice(3),
      entityType,
      entityId,
      kind,
      name: f.name || "",
      mime: f.type || "",
      size: Number(f.size || 0),
      createdAt: Date.now(),
    };

    if (cloudEnabled()) {
      const path = `rpm/${storagePrefix()}/attachments/${entityType}/${entityId}/${att.id}`;
      const r = storageRef(storage, path);
      await uploadString(r, dataUrl, "data_url");
      const url = await getDownloadURL(r);
      att.storagePath = path;
      att.url = url;
    } else {
      att.dataUrl = dataUrl;
    }

    await dbAPI.put("attachments", att);
  }

  toast("تم رفع المرفقات ✅");
  renderRoute();
}

async function deleteAttachment(attId) {
  const att = await dbAPI.get("attachments", attId);
  if (!att) return;

  if (!confirm("حذف المرفق؟")) return;

  try {
    if (cloudEnabled() && att.storagePath) {
      await deleteObject(storageRef(storage, att.storagePath));
    }
  } catch {}

  await dbAPI.del("attachments", attId);
  toast("تم الحذف ✅");
  renderRoute();
}

async function viewAttachment(attId) {
  const att = await dbAPI.get("attachments", attId);
  if (!att) return;
  const src = att.url || att.dataUrl || "";
  openImageModal(src, "مرفق", `${att.name || ""}`.trim());
}

/* ------------------------ Appointments ------------------------ */

function buildWhenTs(dateStr, timeStr) {
  // date: YYYY-MM-DD , time: HH:MM
  const d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  let ts = d.getTime();
  if (timeStr && /^\d{2}:\d{2}$/.test(timeStr)) {
    const [hh, mm] = timeStr.split(":").map(n => Number(n));
    ts += (hh * 60 + mm) * 60e3;
  }
  return ts;
}

async function createAppointment(prefill = {}) {
  const vehicles = await dbAPI.getAll("vehicles");
  const customers = await dbAPI.getAll("customers");
  const employees = (await dbAPI.getAll("employees")).filter(e => e.active);

  const vMap = new Map(vehicles.map(v => [v.id, v]));
  const cMap = new Map(customers.map(c => [c.id, c]));

  const vOptions = [
    { value: "", label: "— اختاري سيارة —" },
    ...vehicles
      .sort((a,b)=> (a.plate||"").localeCompare(b.plate||"", "ar"))
      .map(v => {
        const c = cMap.get(v.customerId);
        const label = `${v.plate || "—"} • ${[v.make,v.model,v.year].filter(Boolean).join(" ")} • ${c?.name||"—"}`;
        return { value: v.id, label };
      })
  ];

  const eOptions = [
    { value: "", label: "— بدون —" },
    ...employees
      .sort((a,b)=>(a.name||"").localeCompare(b.name||"", "ar"))
      .map(e => ({ value: e.id, label: `${e.name} • ${e.specialty||""}` }))
  ];

  const todayStr = new Date().toISOString().slice(0,10);

  const initial = {
    vehicleId: prefill.vehicleId || "",
    date: prefill.date || todayStr,
    time: prefill.time || "",
    employeeId: prefill.employeeId || "",
    status: prefill.status || "scheduled",
    note: prefill.note || "",
  };

  const v = await formModal({
    title: "موعد جديد",
    subtitle: "تثبيت موعد للزبون/السيارة (ويمكن تحويله لأمر شغل)",
    fields: [
      { name: "vehicleId", label: "السيارة", type: "select", options: vOptions, required: true },
      { name: "date", label: "التاريخ", type: "date", required: true },
      { name: "time", label: "الوقت (اختياري)", type: "time" },
      { name: "employeeId", label: "تعيين لفني (اختياري)", type: "select", options: eOptions },
      { name: "status", label: "الحالة", type: "select", options: [
        { value: "scheduled", label: "مجدول" },
        { value: "done", label: "منجز" },
        { value: "cancelled", label: "ملغي" },
      ] },
      { name: "note", label: "ملاحظة", type: "textarea", placeholder: "سبب الموعد / المشكلة..." },
    ],
    initial,
    submitText: "حفظ الموعد",
  });
  if (!v) return;

  const vv = vMap.get(v.vehicleId);
  const ap = {
    id: "ap_" + uid().slice(3),
    vehicleId: v.vehicleId,
    customerId: vv?.customerId || "",
    employeeId: v.employeeId || "",
    date: v.date,
    time: v.time || "",
    whenTs: buildWhenTs(v.date, v.time),
    status: v.status || "scheduled",
    note: v.note || "",
    createdAt: Date.now(),
  };

  await dbAPI.put("appointments", ap);
  toast("تم إضافة الموعد ✅");
  renderRoute();
}

async function editAppointment(apId) {
  const ap = await dbAPI.get("appointments", apId);
  if (!ap) return;

  const vehicles = await dbAPI.getAll("vehicles");
  const customers = await dbAPI.getAll("customers");
  const employees = (await dbAPI.getAll("employees")).filter(e => e.active);

  const vMap = new Map(vehicles.map(v => [v.id, v]));
  const cMap = new Map(customers.map(c => [c.id, c]));

  const vOptions = [
    { value: "", label: "— اختاري سيارة —" },
    ...vehicles
      .sort((a,b)=> (a.plate||"").localeCompare(b.plate||"", "ar"))
      .map(v => {
        const c = cMap.get(v.customerId);
        const label = `${v.plate || "—"} • ${[v.make,v.model,v.year].filter(Boolean).join(" ")} • ${c?.name||"—"}`;
        return { value: v.id, label };
      })
  ];

  const eOptions = [
    { value: "", label: "— بدون —" },
    ...employees
      .sort((a,b)=>(a.name||"").localeCompare(b.name||"", "ar"))
      .map(e => ({ value: e.id, label: `${e.name} • ${e.specialty||""}` }))
  ];

  const v = await formModal({
    title: "تعديل موعد",
    fields: [
      { name: "vehicleId", label: "السيارة", type: "select", options: vOptions, required: true },
      { name: "date", label: "التاريخ", type: "date", required: true },
      { name: "time", label: "الوقت", type: "time" },
      { name: "employeeId", label: "الفني", type: "select", options: eOptions },
      { name: "status", label: "الحالة", type: "select", options: [
        { value: "scheduled", label: "مجدول" },
        { value: "done", label: "منجز" },
        { value: "cancelled", label: "ملغي" },
      ] },
      { name: "note", label: "ملاحظة", type: "textarea" },
    ],
    initial: ap,
    submitText: "حفظ",
  });
  if (!v) return;

  const vv = vMap.get(v.vehicleId);
  Object.assign(ap, v);
  ap.customerId = vv?.customerId || ap.customerId || "";
  ap.whenTs = buildWhenTs(ap.date, ap.time);
  await dbAPI.put("appointments", ap);
  toast("تم التعديل ✅");
  renderRoute();
}

async function deleteAppointment(apId) {
  if (!confirm("حذف الموعد؟")) return;
  await dbAPI.del("appointments", apId);
  toast("تم الحذف ✅");
  renderRoute();
}

async function appointmentToOrder(apId) {
  const ap = await dbAPI.get("appointments", apId);
  if (!ap) return;

  // إنشاء أمر شغل جديد من الموعد
  const wo = {
    id: "wo_" + uid().slice(3),
    customerId: ap.customerId,
    vehicleId: ap.vehicleId,
    employeeId: ap.employeeId || "",
    status: "OPEN",
    complaint: ap.note || "موعد صيانة",
    notes: `تم التحويل من موعد بتاريخ ${ap.date} ${ap.time||""}`.trim(),
    partLines: [],
    laborLines: [],
    createdAt: Date.now(),
  };

  await dbAPI.put("workOrders", wo);

  ap.status = "done";
  ap.linkedWorkOrderId = wo.id;
  await dbAPI.put("appointments", ap);

  toast("تم التحويل لأمر شغل ✅");
  location.hash = `#/order?id=${encodeURIComponent(wo.id)}`;
}

/* ------------------------ Expenses ------------------------ */

async function createExpense(prefill = {}) {
  const todayStr = new Date().toISOString().slice(0,10);

  const v = await formModal({
    title: "مصروف جديد",
    fields: [
      { name: "date", label: "التاريخ", type: "date", required: true, default: todayStr },
      { name: "amount", label: "المبلغ", type: "number", cast: "number", required: true, step: 0.01 },
      { name: "category", label: "التصنيف", placeholder: "كهرباء / إيجار / قطع / رواتب..." },
      { name: "method", label: "طريقة الدفع", type: "select", options: [
        { value: "نقدي", label: "نقدي" },
        { value: "بطاقة/تحويل", label: "بطاقة/تحويل" },
        { value: "أخرى", label: "أخرى" },
      ] },
      { name: "note", label: "ملاحظة", type: "textarea" },
    ],
    initial: { date: todayStr, method: "نقدي", ...prefill },
    submitText: "حفظ",
  });
  if (!v) return;

  const exp = {
    id: "exp_" + uid().slice(3),
    date: v.date,
    whenTs: buildWhenTs(v.date, "00:00"),
    amount: Number(v.amount || 0),
    category: (v.category || "").trim(),
    method: (v.method || "نقدي").trim(),
    note: (v.note || "").trim(),
    createdAt: Date.now(),
  };

  await dbAPI.put("expenses", exp);
  toast("تم إضافة المصروف ✅");
  renderRoute();
}

async function editExpense(expId) {
  const exp = await dbAPI.get("expenses", expId);
  if (!exp) return;

  const v = await formModal({
    title: "تعديل مصروف",
    fields: [
      { name: "date", label: "التاريخ", type: "date", required: true },
      { name: "amount", label: "المبلغ", type: "number", cast: "number", required: true, step: 0.01 },
      { name: "category", label: "التصنيف" },
      { name: "method", label: "طريقة الدفع", type: "select", options: [
        { value: "نقدي", label: "نقدي" },
        { value: "بطاقة/تحويل", label: "بطاقة/تحويل" },
        { value: "أخرى", label: "أخرى" },
      ] },
      { name: "note", label: "ملاحظة", type: "textarea" },
    ],
    initial: exp,
    submitText: "حفظ",
  });
  if (!v) return;

  Object.assign(exp, v);
  exp.amount = Number(exp.amount || 0);
  exp.whenTs = buildWhenTs(exp.date, "00:00");
  exp.category = (exp.category || "").trim();
  exp.method = (exp.method || "نقدي").trim();
  exp.note = (exp.note || "").trim();
  await dbAPI.put("expenses", exp);
  toast("تم التعديل ✅");
  renderRoute();
}

async function deleteExpense(expId) {
  if (!confirm("حذف المصروف؟")) return;
  await dbAPI.del("expenses", expId);
  toast("تم الحذف ✅");
  renderRoute();
}

/* ------------------------ Views ------------------------ */

async function viewAppointments() {
  const appointments = await dbAPI.getAll("appointments");
  const vehicles = await dbAPI.getAll("vehicles");
  const customers = await dbAPI.getAll("customers");
  const employees = await dbAPI.getAll("employees");

  const vMap = new Map(vehicles.map(v=>[v.id,v]));
  const cMap = new Map(customers.map(c=>[c.id,c]));
  const eMap = new Map(employees.map(e=>[e.id,e]));

  const q = (state.search || "").trim().toLowerCase();

  let list = appointments
    .sort((a,b)=> (b.whenTs||0)-(a.whenTs||0))
    .filter(ap => {
      if (!q) return true;
      const v = vMap.get(ap.vehicleId);
      const c = cMap.get(ap.customerId);
      const e = ap.employeeId ? eMap.get(ap.employeeId) : null;
      return (
        (ap.note||"").toLowerCase().includes(q) ||
        (v?.plate||"").toLowerCase().includes(q) ||
        (c?.name||"").toLowerCase().includes(q) ||
        (c?.phone||"").toLowerCase().includes(q) ||
        (e?.name||"").toLowerCase().includes(q)
      );
    });

  if (currentRole() === "technician") {
    const myId = await getMyEmployeeId();
    list = myId ? list.filter(ap => ap.employeeId === myId) : [];
  }

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div>
          <div class="section-title">المواعيد</div>
          <div class="small">جدولة مواعيد + تحويلها لأوامر شغل</div>
        </div>
        <button class="btn btn-primary" data-act="newAppointment">+ موعد</button>
      </div>

      <div class="hr"></div>

      ${list.length ? `
        <table class="table">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>السيارة</th>
              <th>الزبون</th>
              <th>الفني</th>
              <th>الملاحظة</th>
              <th>الحالة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${list.map(ap => {
              const v = vMap.get(ap.vehicleId);
              const c = cMap.get(ap.customerId);
              const e = ap.employeeId ? eMap.get(ap.employeeId) : null;
              return `
                <tr>
                  <td>${escapeHtml(ap.date || "")} ${escapeHtml(ap.time || "")}</td>
                  <td><a href="#/vehicle?id=${encodeURIComponent(ap.vehicleId)}">${escapeHtml(v?.plate || "—")}</a></td>
                  <td><a href="#/customer?id=${encodeURIComponent(ap.customerId)}">${escapeHtml(c?.name || "—")}</a></td>
                  <td>${escapeHtml(e?.name || "—")}</td>
                  <td class="small">${escapeHtml(ap.note || "")}</td>
                  <td>${apPill(ap.status)}</td>
                  <td style="white-space:nowrap">
                    <button class="btn" data-act="editAppointment" data-id="${ap.id}">تعديل</button>
                    <button class="btn btn-soft" data-act="msgAppt" data-id="${ap.id}">تذكير</button>
                    <button class="btn btn-danger" data-act="delAppointment" data-id="${ap.id}">حذف</button>
                    <button class="btn btn-soft" data-act="apToOrder" data-id="${ap.id}">تحويل</button>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      ` : `<div class="notice">لا توجد مواعيد.</div>`}
    </div>
  `;
}

async function viewExpenses() {
  const expenses = await dbAPI.getAll("expenses");
  const today = new Date();
  const startDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startMonth = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
  const endDay = startDay + 86400e3;

  const todayExp = expenses.filter(x => x.whenTs>=startDay && x.whenTs<endDay).reduce((s,x)=> s + Number(x.amount||0), 0);
  const monthExp = expenses.filter(x => x.whenTs>=startMonth).reduce((s,x)=> s + Number(x.amount||0), 0);

  const q = (state.search || "").trim().toLowerCase();
  const list = expenses
    .sort((a,b)=> (b.whenTs||0)-(a.whenTs||0))
    .filter(x => {
      if (!q) return true;
      return (
        (x.category||"").toLowerCase().includes(q) ||
        (x.note||"").toLowerCase().includes(q) ||
        (x.method||"").toLowerCase().includes(q)
      );
    });

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div>
          <div class="section-title">المصروفات</div>
          <div class="small">سجل مصروفات الكراج</div>
        </div>
        <button class="btn btn-primary" data-act="newExpense">+ مصروف</button>
      </div>

      <div class="hr"></div>

      <div class="cards">
        <div class="card"><div class="card-title">مصروف اليوم</div><div class="card-value">${money(todayExp)}</div></div>
        <div class="card"><div class="card-title">مصروف هذا الشهر</div><div class="card-value">${money(monthExp)}</div></div>
        <div class="card"><div class="card-title">عدد القيود</div><div class="card-value">${list.length}</div></div>
      </div>

      <div class="hr"></div>

      ${list.length ? `
        <table class="table">
          <thead>
            <tr>
              <th>التاريخ</th>
              <th>المبلغ</th>
              <th>التصنيف</th>
              <th>الدفع</th>
              <th>ملاحظة</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${list.map(x => `
              <tr>
                <td>${escapeHtml(x.date || "")}</td>
                <td><b>${money(x.amount || 0)}</b></td>
                <td>${escapeHtml(x.category || "—")}</td>
                <td>${escapeHtml(x.method || "—")}</td>
                <td class="small">${escapeHtml(x.note || "")}</td>
                <td style="white-space:nowrap">
                  <button class="btn" data-act="editExpense" data-id="${x.id}">تعديل</button>
                  <button class="btn btn-danger" data-act="delExpense" data-id="${x.id}">حذف</button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      ` : `<div class="notice">لا توجد مصروفات.</div>`}
    </div>
  `;
}

async function viewRoles() {
  const u = authState.user;
  if (!u) {
    return `
      <div class="card">
        <div class="section-title">الصلاحيات</div>
        <div class="notice">لازم تسجيل دخول حتى تدار الصلاحيات.</div>
        <a class="btn btn-primary" href="#/auth">اذهب للحساب</a>
      </div>
    `;
  }

  const role = currentRole();

  if (role !== "admin") {
    return `
      <div class="card">
        <div class="section-title">الصلاحيات</div>
        <div class="small">حسابك: <b>${escapeHtml(u.email || "")}</b></div>
        <div style="height:10px"></div>
        <div class="card subcard">
          <div class="kv"><span>الدور الحالي</span><b>${escapeHtml(roleLabel(role))}</b></div>
          <div style="height:8px"></div>
          <div class="notice">إدارة الصلاحيات للمدير فقط.</div>
        </div>
      </div>
    `;
  }

  const employees = await dbAPI.getAll("employees");
  const eOptions = [
    { value: "", label: "— ربط بموظف (اختياري) —" },
    ...employees.sort((a,b)=>(a.name||"").localeCompare(b.name||"", "ar")).map(e => ({
      value: e.id,
      label: `${e.name} • ${e.specialty||""}`,
    }))
  ];

  const invites = await cloudAPI.getAll("rbacInvites");
  const users = await cloudAPI.getAll("rbacUsers");

  const eMap = new Map(employees.map(e => [e.id, e]));

  return `
    <div class="card">
      <div class="section-title">الصلاحيات</div>
      <div class="small">إدارة دخول الموظفين (دعوات + أدوار)</div>
      <div class="hr"></div>

      <div class="card subcard">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
          <div>
            <div style="font-weight:900">إنشاء دعوة</div>
            <div class="small">اكتب إيميل الموظف وحدد دوره (وبإمكانك ربطه بموظف من قائمة الموظفين)</div>
          </div>
          <button class="btn btn-primary" data-act="createInvite">إنشاء</button>
        </div>

        <div style="height:10px"></div>

        <div class="grid2">
          <div>
            <div class="small" style="margin:4px 2px">الإيميل</div>
            <input id="invEmail" class="input" type="email" placeholder="name@example.com" />
          </div>
          <div>
            <div class="small" style="margin:4px 2px">الدور</div>
            <select id="invRole" class="input">
              <option value="reception">استقبال</option>
              <option value="technician">فني</option>
              <option value="accountant">محاسب</option>
              <option value="admin">مدير</option>
            </select>
          </div>
          <div style="grid-column:1/-1">
            <div class="small" style="margin:4px 2px">ربط بموظف (اختياري)</div>
            <select id="invEmp" class="input">
              ${eOptions.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join("")}
            </select>
          </div>
        </div>
      </div>

      <div class="hr"></div>

      <div class="card subcard">
        <div style="font-weight:900">الدعوات الحالية</div>
        <div class="small">الدعوة تشتغل لما يسوي الموظف تسجيل دخول/إنشاء حساب بالإيميل.</div>
        <div class="hr"></div>

        ${invites.length ? `
          <table class="table">
            <thead>
              <tr>
                <th>الإيميل</th>
                <th>الدور</th>
                <th>الموظف</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${invites.sort((a,b)=>(a.email||"").localeCompare(b.email||"")).map(inv => `
                <tr>
                  <td>${escapeHtml(inv.email || inv.id || "")}</td>
                  <td>${escapeHtml(roleLabel(inv.role))}</td>
                  <td>${escapeHtml(eMap.get(inv.employeeId||"")?.name || "—")}</td>
                  <td style="white-space:nowrap">
                    <button class="btn btn-danger" data-act="revokeInvite" data-id="${escapeHtml(inv.id)}">حذف</button>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        ` : `<div class="notice">لا توجد دعوات.</div>`}
      </div>

      <div class="hr"></div>

      <div class="card subcard">
        <div style="font-weight:900">مستخدمين النظام</div>
        <div class="small">تغيير الدور/الربط (يحفظ فوراً)</div>
        <div class="hr"></div>

        ${users.length ? `
          <table class="table">
            <thead>
              <tr>
                <th>الإيميل</th>
                <th>الدور</th>
                <th>ربط موظف</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${users.sort((a,b)=>(a.email||"").localeCompare(b.email||"")).map(ru => `
                <tr>
                  <td class="small">${escapeHtml(ru.email || "—")}</td>
                  <td>
                    <select class="input" data-role-uid="${escapeHtml(ru.id)}">
                      <option value="reception" ${ru.role==="reception"?"selected":""}>استقبال</option>
                      <option value="technician" ${ru.role==="technician"?"selected":""}>فني</option>
                      <option value="accountant" ${ru.role==="accountant"?"selected":""}>محاسب</option>
                      <option value="admin" ${ru.role==="admin"?"selected":""}>مدير</option>
                      <option value="pending" ${ru.role==="pending"?"selected":""}>غير مفعل</option>
                    </select>
                  </td>
                  <td>
                    <select class="input" data-emp-uid="${escapeHtml(ru.id)}">
                      ${eOptions.map(o => `<option value="${escapeHtml(o.value)}" ${(ru.employeeId||"")===(o.value||"") ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("")}
                    </select>
                  </td>
                  <td style="white-space:nowrap">
                    <button class="btn btn-primary" data-act="saveUserRole" data-id="${escapeHtml(ru.id)}">حفظ</button>
                    ${ru.id === u.uid ? `<span class="small">(أنت)</span>` : ""}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        ` : `<div class="notice">لا يوجد مستخدمين بعد.</div>`}
      </div>
    </div>
  `;
}


/* ------------------------ Roles actions ------------------------ */

async function createInvite() {
  if (currentRole() !== "admin") return toast("غير مسموح");

  const email = normEmail($("#invEmail")?.value);
  const role = $("#invRole")?.value || "reception";
  const employeeId = $("#invEmp")?.value || "";

  if (!email || !email.includes("@")) return toast("اكتب إيميل صحيح");

  const inv = {
    id: email,
    email,
    role,
    employeeId,
    createdAt: Date.now(),
    createdBy: normEmail(authState.user?.email),
  };

  await cloudAPI.put("rbacInvites", inv);
  toast("تم إنشاء الدعوة ✅");
  renderRoute();
}

async function revokeInvite(invId) {
  if (currentRole() !== "admin") return toast("غير مسموح");
  if (!confirm("حذف الدعوة؟")) return;
  await cloudAPI.del("rbacInvites", invId);
  toast("تم الحذف ✅");
  renderRoute();
}

async function saveUserRole(uid) {
  if (currentRole() !== "admin") return toast("غير مسموح");

  const roleSel = document.querySelector(`[data-role-uid="${CSS.escape(uid)}"]`);
  const empSel = document.querySelector(`[data-emp-uid="${CSS.escape(uid)}"]`);
  const role = roleSel?.value || "pending";
  const employeeId = empSel?.value || "";

  const rdoc = await cloudAPI.get("rbacUsers", uid);
  if (!rdoc) return toast("ما لقيت المستخدم");

  rdoc.role = role;
  rdoc.employeeId = employeeId;
  rdoc.updatedAt = Date.now();

  await cloudAPI.put("rbacUsers", rdoc);

  // لو عدلتي دورك أنتِ: حدّثي الواجهة فوراً
  if (authState.user?.uid === uid) {
    state.role = role;
    state.employeeId = employeeId;
    applyNavPermissions();
  }

  toast("تم الحفظ ✅");
  renderRoute();
}


async function viewDashboard() {
  const workOrders = await dbAPI.getAll("workOrders");
  const invoices = await dbAPI.getAll("invoices");
  const parts = await dbAPI.getAll("parts");
  const vehicles = await dbAPI.getAll("vehicles");
  const customers = await dbAPI.getAll("customers");

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const end = start + 86400e3;

  const todayOrders = workOrders.filter(w => w.createdAt >= start && w.createdAt < end);
  const openOrders = workOrders.filter(w => ["OPEN","IN_PROGRESS","WAITING_PARTS","WAITING_APPROVAL"].includes(w.status));
  const waitingParts = workOrders.filter(w => w.status === "WAITING_PARTS");
  const todayIncome = invoices.filter(i => i.createdAt >= start && i.createdAt < end).reduce((a,b)=> a + Number(b.paid||0), 0);

  const lowStock = parts.filter(p => Number(p.stock || 0) <= Number(p.min || 0));

  const latest = workOrders.sort((a,b)=>b.createdAt-a.createdAt).slice(0, 7);

  // Oil reminders: if vehicle has nextOilOdo and odometer close
  const reminders = vehicles
    .filter(v => (v.nextOilOdo != null) && (v.odometer != null))
    .map(v => ({ ...v, diff: Number(v.nextOilOdo) - Number(v.odometer) }))
    .filter(v => v.diff <= 300 && v.diff >= -200) // قريب أو متأخر شوي
    .sort((a,b)=>a.diff-b.diff)
    .slice(0, 6);

  const cMap = new Map(customers.map(c=>[c.id,c]));

  return `
    <div class="cards">
      <div class="card"><div class="card-title">سيارات اليوم</div><div class="card-value">${todayOrders.length}</div></div>
      <div class="card"><div class="card-title">أوامر مفتوحة</div><div class="card-value">${openOrders.length}</div></div>
      <div class="card"><div class="card-title">انتظار قطع</div><div class="card-value">${waitingParts.length}</div></div>
      <div class="card"><div class="card-title">دخل اليوم (مدفوع)</div><div class="card-value">${money(todayIncome)}</div></div>
    </div>

    <div class="row" style="margin-top:12px">
      <div class="col">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
            <div>
              <div class="section-title">آخر أوامر الشغل</div>
              <div class="small">تفاصيل / طباعة / فاتورة</div>
            </div>
            <a class="btn btn-soft" href="#/orders">عرض الكل</a>
          </div>
          <div class="hr"></div>

          ${latest.length ? latest.map(w => `
            <div class="card subcard" style="margin-bottom:10px">
              <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
                <div>
                  <div style="font-weight:900">${escapeHtml(w.complaint).slice(0,80)}</div>
                  <div class="small">${escapeHtml(w.id)} • ${fmtDate(w.createdAt)}</div>
                </div>
                <div>${pill(w.status)}</div>
              </div>
              <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
                <a class="btn" href="#/order?id=${encodeURIComponent(w.id)}">تفاصيل</a>
                <button class="btn" data-act="makeInvoice" data-id="${w.id}">فاتورة</button>
              </div>
            </div>
          `).join("") : `<div class="notice">بعد ماكو أوامر. روحي على الاستقبال وسوي أمر جديد.</div>`}
        </div>
      </div>

      <div class="col">
        <div class="card">
          <div class="section-title">تنبيهات دهن</div>
          <div class="small">سيارات قرب موعد الدهن الجاي</div>
          <div class="hr"></div>
          ${reminders.length ? reminders.map(v => {
            const c = cMap.get(v.customerId);
            return `
              <div class="card subcard" style="margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;gap:10px">
                  <div>
                    <div style="font-weight:900">${escapeHtml(c?.name || "—")} • ${escapeHtml(v.plate || "—")}</div>
                    <div class="small">${escapeHtml([v.make,v.model,v.year].filter(Boolean).join(" "))}</div>
                    <div class="small">حالي: <b>${v.odometer}</b> • جاي: <b>${v.nextOilOdo}</b></div>
                  </div>
                  <div class="pill ${v.diff<0 ? "parts" : "progress"}">${v.diff<0 ? "متأخر" : `باقي ${v.diff} كم`}</div>
                </div>
                <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
                  <a class="btn" href="#/customer?id=${encodeURIComponent(v.customerId)}">سجل الزبون</a>
                  <a class="btn btn-primary" href="#/oil?customerId=${encodeURIComponent(v.customerId)}&vehicleId=${encodeURIComponent(v.id)}">تبديل دهن</a>
                </div>
              </div>
            `;
          }).join("") : `<div class="notice">ماكو تنبيهات دهن حالياً ✅</div>`}

          <div class="hr"></div>

          <div class="section-title">مخزون حرج</div>
          ${lowStock.length ? lowStock.slice(0,6).map(p => `
            <div class="kv">
              <span>${escapeHtml(p.name)} <span class="small">(${escapeHtml(p.sku || "—")})</span></span>
              <b>${p.stock ?? 0} / min ${p.min ?? 0}</b>
            </div>
          `).join("<div style='height:8px'></div>") : `<div class="small">ماكو قطع تحت الحد الأدنى ✅</div>`}
          <div class="hr"></div>
          <a class="btn" href="#/inventory">إدارة المخزون</a>
        </div>
      </div>
    </div>
  `;
}

async function viewCheckin() {
  const customers = await dbAPI.getAll("customers");
  const vehicles = await dbAPI.getAll("vehicles");
  const employees = (await dbAPI.getAll("employees")).filter(e => e.active);

  const custOptions = customers
    .sort((a,b)=> (a.name||"").localeCompare(b.name||"", "ar"))
    .map(c => `<option value="${c.id}">${escapeHtml(c.name)} ${c.phone? "• "+escapeHtml(c.phone):""}</option>`)
    .join("");

  const vehOptions = vehicles
    .sort((a,b)=> (a.plate||"").localeCompare(b.plate||"", "ar"))
    .map(v => `<option value="${v.id}">${escapeHtml(v.plate || "—")} • ${escapeHtml([v.make,v.model,v.year].filter(Boolean).join(" "))}</option>`)
    .join("");

  const empOptions = employees
    .sort((a,b)=> (a.name||"").localeCompare(b.name||"", "ar"))
    .map(e => `<option value="${e.id}">${escapeHtml(e.name)} • ${escapeHtml(e.specialty || "—")}</option>`)
    .join("");

  return `
    <div class="card">
      <div class="section-title">الاستقبال</div>
      <div class="small">اختاري زبون + سيارة + فني (اختياري) وبعدين افتحي أمر شغل.</div>
      <div class="hr"></div>

      <div class="grid2">
        <div>
          <label class="small">الزبون</label>
          <select id="ciCustomer" class="input">
            <option value="">— اختيار —</option>
            ${custOptions}
          </select>
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" data-act="newCustomer">+ زبون</button>
            <a class="btn" href="#/customers">قائمة الزباين</a>
          </div>
        </div>

        <div>
          <label class="small">السيارة</label>
          <select id="ciVehicle" class="input">
            <option value="">— اختيار —</option>
            ${vehOptions}
          </select>
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" data-act="newVehicle">+ سيارة</button>
            <a class="btn" href="#/vehicles">قائمة السيارات</a>
          </div>
        </div>
      </div>

      <div class="grid2" style="margin-top:12px">
        <div>
          <label class="small">الفني (اختياري)</label>
          <select id="ciEmployee" class="input">
            <option value="">— بدون —</option>
            ${empOptions}
          </select>
        </div>

        <div>
          <label class="small">الحالة</label>
          <select id="ciStatus" class="input">
            <option value="OPEN">مفتوح</option>
            <option value="WAITING_APPROVAL">بانتظار موافقة</option>
            <option value="IN_PROGRESS">قيد الشغل</option>
            <option value="WAITING_PARTS">انتظار قطع</option>
            <option value="DONE">مكتمل</option>
            <option value="DELIVERED">مستلم</option>
          </select>
        </div>
      </div>

      <div style="margin-top:12px">
        <label class="small">وصف الشغل</label>
        <textarea id="ciComplaint" class="input" placeholder="مثال: صوت بالمحرك... فحص كهرباء..."></textarea>
      </div>

      <div class="grid2" style="margin-top:12px">
        <div>
          <label class="small">العداد الحالي (اختياري)</label>
          <input id="ciOdometer" class="input" inputmode="numeric" placeholder="150000" />
        </div>
        <div class="notice">
          إذا الشغل تبديل دهن، روحي على صفحة <b>تبديل دهن</b> لأن بيها عداد حالي + عداد جاي وفاتورة جاهزة.
        </div>
      </div>

      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" data-act="createWO">فتح أمر شغل</button>
      </div>
    </div>
  `;
}

async function viewOrders() {
  const workOrders = await dbAPI.getAll("workOrders");
  const customers = await dbAPI.getAll("customers");
  const vehicles = await dbAPI.getAll("vehicles");
  const employees = await dbAPI.getAll("employees");

  const cMap = new Map(customers.map(c => [c.id,c]));
  const vMap = new Map(vehicles.map(v => [v.id,v]));
  const eMap = new Map(employees.map(e => [e.id,e]));

  const q = (state.search || "").trim().toLowerCase();

  const filtered = workOrders
    .sort((a,b)=>b.createdAt-a.createdAt)
    .filter(w => {
      if (!q) return true;
      const c = cMap.get(w.customerId);
      const v = vMap.get(w.vehicleId);
      const e = w.employeeId ? eMap.get(w.employeeId) : null;
      return (
        (w.id||"").toLowerCase().includes(q) ||
        (w.complaint||"").toLowerCase().includes(q) ||
        (c?.name||"").toLowerCase().includes(q) ||
        (c?.phone||"").toLowerCase().includes(q) ||
        (v?.plate||"").toLowerCase().includes(q) ||
        (e?.name||"").toLowerCase().includes(q)
      );
    });


  let scoped = filtered;
  if (currentRole() === "technician") {
    const myId = await getMyEmployeeId();
    scoped = myId ? filtered.filter(w => w.employeeId === myId) : [];
  }

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div>
          <div class="section-title">أوامر الشغل</div>
          <div class="small">اضغطي تفاصيل حتى تسوين صرف قطع + أجور + فاتورة</div>
        </div>
        <a class="btn btn-primary" href="#/checkin">+ استقبال</a>
      </div>

      <div class="hr"></div>

      ${scoped.length ? `
      <table class="table">
        <thead>
          <tr>
            <th>الرقم</th>
            <th>الزبون</th>
            <th>السيارة</th>
            <th>الفني</th>
            <th>الحالة</th>
            <th>تاريخ</th>
            <th>إجراءات</th>
          </tr>
        </thead>
        <tbody>
          ${scoped.map(w => {
            const c = cMap.get(w.customerId);
            const v = vMap.get(w.vehicleId);
            const e = w.employeeId ? eMap.get(w.employeeId) : null;
            return `
              <tr class="tr">
                <td><b>${escapeHtml(w.id)}</b><div class="small">${escapeHtml(w.serviceType || "GENERAL")}</div></td>
                <td>${escapeHtml(c?.name || "—")}<div class="small">${escapeHtml(c?.phone || "")}</div></td>
                <td>${escapeHtml(v?.plate || "—")}<div class="small">${escapeHtml([v?.make,v?.model,v?.year].filter(Boolean).join(" "))}</div></td>
                <td>${escapeHtml(e?.name || "—")}<div class="small">${escapeHtml(e?.specialty || "")}</div></td>
                <td>${pill(w.status)}</td>
                <td class="small">${fmtDate(w.createdAt)}</td>
                <td>
                  <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <a class="btn" href="#/order?id=${encodeURIComponent(w.id)}">تفاصيل</a>
                    <button class="btn btn-soft" data-act="printWO" data-id="${w.id}">طباعة WO</button>
                    <button class="btn" data-act="makeInvoice" data-id="${w.id}">فاتورة</button>
                    <button class="btn btn-danger" data-act="deleteWO" data-id="${w.id}">حذف</button>
                  </div>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
      ` : `<div class="notice">ماكو أوامر مطابقة. سوي استقبال وأنشئي أمر جديد.</div>`}
    </div>
  `;
}

async function viewOrderDetails(orderId) {
  const wo = await dbAPI.get("workOrders", orderId);
  if (!wo) return `<div class="card"><div class="notice">ما لقيت أمر الشغل.</div></div>`;

  // صلاحيات الفني: يشوف أوامره فقط
  if (currentRole() === "technician") {
    const myId = await getMyEmployeeId();
    if (!myId || wo.employeeId !== myId) {
      return `<div class="card"><div class="notice">ما عندك صلاحية تشوف هذا الأمر.</div></div>`;
    }
  }

  const customer = await dbAPI.get("customers", wo.customerId);
  const vehicle = await dbAPI.get("vehicles", wo.vehicleId);
  const employees = (await dbAPI.getAll("employees")).filter(e => e.active);
  const parts = await dbAPI.getAll("parts");
  const inv = (await dbAPI.getAll("invoices")).find(i => i.workOrderId === wo.id) || null;
  const invRemaining = inv ? Math.max(0, Number(inv.total||0) - Number(inv.paid||0)) : 0;

  const empOptions = [
    `<option value="">— بدون —</option>`,
    ...employees.sort((a,b)=>(a.name||"").localeCompare(b.name||"", "ar"))
      .map(e => `<option value="${e.id}" ${wo.employeeId===e.id ? "selected":""}>${escapeHtml(e.name)} • ${escapeHtml(e.specialty||"")}</option>`)
  ].join("");

  const partOptions = [
    `<option value="">— اختيار قطعة —</option>`,
    ...parts.sort((a,b)=>(a.name||"").localeCompare(b.name||"", "ar"))
      .map(p => `<option value="${p.id}">${escapeHtml(p.name)} • رصيد ${p.stock ?? 0} • بيع ${money(p.sell||0)}</option>`)
  ].join("");

  const partLines = Array.isArray(wo.partLines) ? wo.partLines : [];
  const laborLines = Array.isArray(wo.laborLines) ? wo.laborLines : [];

  const pMap = new Map(parts.map(p=>[p.id,p]));

  const partsTotal = sum(partLines, ln => Number(ln.qty||0)*Number(ln.unit||0));
  const laborTotal = sum(laborLines, ln => Number(ln.amount||0));
  const total = partsTotal + laborTotal;

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
        <div>
          <div class="section-title">تفاصيل أمر شغل</div>
          <div class="small">${escapeHtml(wo.id)} • ${fmtDate(wo.createdAt)}</div>
          <div class="small">الزبون: <b>${escapeHtml(customer?.name || "—")}</b> • ${escapeHtml(customer?.phone || "")}</div>
          <div class="small">السيارة: <b>${escapeHtml(vehicle?.plate || "—")}</b> • ${escapeHtml([vehicle?.make,vehicle?.model,vehicle?.year].filter(Boolean).join(" "))}</div>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn" href="#/orders">رجوع</a>
          <button class="btn btn-soft" data-act="printWO" data-id="${wo.id}">طباعة WO</button>
          <button class="btn" data-act="msgCarReady" data-id="${wo.id}">جاهزية (WhatsApp/SMS)</button>
          ${inv && invRemaining>0 ? `<button class="btn" data-act="msgPaymentWO" data-id="${wo.id}">متبقي الدفع</button>` : ``}
          ${inv ? `<button class="btn btn-soft" data-act="printInvoice" data-id="${inv.id}">طباعة الفاتورة</button>` : ``}
          <button class="btn btn-primary" data-act="makeInvoice" data-id="${wo.id}">إنشاء فاتورة</button>
          <button class="btn btn-danger" data-act="deleteWO" data-id="${wo.id}">حذف</button>
        </div>
      </div>

      <div class="hr"></div>

      <div class="grid2">
        <div class="card subcard">
          <div class="small">الحالة</div>
          <select class="input" data-act="setStatus" data-id="${wo.id}">
            ${["OPEN","WAITING_APPROVAL","IN_PROGRESS","WAITING_PARTS","DONE","DELIVERED"].map(s =>
              `<option value="${s}" ${wo.status===s?"selected":""}>${s}</option>`
            ).join("")}
          </select>

          <div style="height:10px"></div>

          <div class="small">الفني</div>
          <select class="input" data-act="setEmployee" data-id="${wo.id}">
            ${empOptions}
          </select>

          <div style="height:10px"></div>

          <div class="small">وصف الشغل</div>
          <div class="notice">${escapeHtml(wo.complaint || "—")}</div>

          <div style="height:10px"></div>
          <div class="kv"><span>عداد</span><b>${wo.odometer ?? "—"}</b></div>
          <div class="kv"><span>مجموع قطع</span><b>${money(partsTotal)}</b></div>
          <div class="kv"><span>مجموع أجور</span><b>${money(laborTotal)}</b></div>
          <div class="kv"><span>المجموع التقريبي</span><b>${money(total)}</b></div>
        </div>

        <div class="card subcard">
          <div class="section-title">صرف قطع من المخزون</div>
          <div class="small">راح ينخصم الرصيد تلقائيًا</div>
          <div class="hr"></div>

          <label class="small">القطعة</label>
          <select id="odPart" class="input">${partOptions}</select>

          <div style="height:10px"></div>

          <div class="grid2">
            <div>
              <label class="small">الكمية</label>
              <input id="odQty" class="input" inputmode="numeric" value="1" />
            </div>
            <div style="display:flex;align-items:end">
              <button class="btn btn-primary" data-act="addPartToWO" data-id="${wo.id}">صرف</button>
            </div>
          </div>

          <div class="hr"></div>

          ${partLines.length ? `
            <div class="section-title">قطع مصروفة</div>
            ${partLines.map((ln, idx) => {
              const p = pMap.get(ln.partId);
              const name = p?.name || ln.partId;
              const lineTotal = Number(ln.qty||0)*Number(ln.unit||0);
              return `
                <div class="card subcard" style="margin-bottom:10px">
                  <div style="display:flex;justify-content:space-between;gap:10px">
                    <div>
                      <div style="font-weight:900">${escapeHtml(name)}</div>
                      <div class="small">كمية: ${ln.qty} • سعر: ${money(ln.unit||0)} • مجموع: <b>${money(lineTotal)}</b></div>
                    </div>
                    <button class="btn btn-danger" data-act="removePartLine" data-id="${wo.id}" data-idx="${idx}">إرجاع</button>
                  </div>
                </div>
              `;
            }).join("")}
          ` : `<div class="notice">بعد ماكو قطع مصروفة لهذا الأمر.</div>`}
        </div>
      </div>

      <div class="hr"></div>

      <div class="card subcard">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
          <div>
            <div class="section-title">الأجور</div>
            <div class="small">تقدرين تضيفين أكثر من سطر أجور</div>
          </div>
          <button class="btn btn-primary" data-act="addLabor" data-id="${wo.id}">+ إضافة أجور</button>
        </div>

        <div class="hr"></div>

        ${laborLines.length ? laborLines.map((ln, idx) => `
          <div class="card subcard" style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
              <div>
                <div style="font-weight:900">${escapeHtml(ln.title || "أجور")}</div>
                <div class="small">قيمة: <b>${money(ln.amount || 0)}</b></div>
              </div>
              <button class="btn btn-danger" data-act="removeLabor" data-id="${wo.id}" data-idx="${idx}">حذف</button>
            </div>
          </div>
        `).join("") : `<div class="notice">بعد ماكو أجور مضافة.</div>`}

    <div class="hr"></div>

    <div class="card subcard">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div>
          <div class="section-title">المرفقات</div>
          <div class="small">صور قبل/بعد أو وصل — تُحفظ محلياً أو على Firebase Storage حسب وضع التخزين</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn" data-act="addAttachment" data-type="workOrder" data-kind="before" data-entity="${wo.id}">+ قبل</button>
          <button class="btn" data-act="addAttachment" data-type="workOrder" data-kind="after" data-entity="${wo.id}">+ بعد</button>
          <button class="btn btn-primary" data-act="addAttachment" data-type="workOrder" data-kind="other" data-entity="${wo.id}">+ مرفق</button>
        </div>
      </div>

      <div class="gallery">
        ${(await renderAttachmentThumbs("workOrder", wo.id)).join("") || `<div class="notice">لا توجد مرفقات.</div>`}
      </div>
    </div>
      </div>
    </div>
  `;
}
async function viewCustomers(params) {
  const customers = await dbAPI.getAll("customers");
  const vehicles = await dbAPI.getAll("vehicles");
  const workOrders = await dbAPI.getAll("workOrders");

  const q = (state.search || "").trim().toLowerCase();

  const vCount = new Map();
  for (const v of vehicles) vCount.set(v.customerId, (vCount.get(v.customerId)||0)+1);

  const lastVisit = new Map();
  for (const w of workOrders) {
    const prev = lastVisit.get(w.customerId) || 0;
    if (w.createdAt > prev) lastVisit.set(w.customerId, w.createdAt);
  }

  const list = customers
    .sort((a,b)=> (a.name||"").localeCompare(b.name||"", "ar"))
    .filter(c => {
      if (!q) return true;
      return (c.name||"").toLowerCase().includes(q) || (c.phone||"").toLowerCase().includes(q);
    });

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div>
          <div class="section-title">الزباين</div>
          <div class="small">كل زبون إله سجل: سيارات + أوامر + فواتير + دهن</div>
        </div>
        <button class="btn btn-primary" data-act="newCustomer">+ زبون جديد</button>
      </div>

      <div class="hr"></div>

      ${list.length ? `
      <table class="table">
        <thead>
          <tr>
            <th>الاسم</th>
            <th>الهاتف</th>
            <th>الإيميل</th>
            <th>عدد السيارات</th>
            <th>آخر زيارة</th>
            <th>إجراءات</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(c => `
            <tr class="tr">
              <td><b>${escapeHtml(c.name)}</b><div class="small">${escapeHtml(c.address||"")}</div></td>
              <td class="small">${escapeHtml(c.phone||"—")}</td>
              <td>${vCount.get(c.id) || 0}</td>
              <td class="small">${lastVisit.get(c.id) ? fmtDate(lastVisit.get(c.id)) : "—"}</td>
              <td>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                  <a class="btn" href="#/customer?id=${encodeURIComponent(c.id)}">السجل</a>
                  <button class="btn" data-act="editCustomer" data-id="${c.id}">تعديل</button>
                  <button class="btn" data-act="newVehicleForCustomer" data-id="${c.id}">+ سيارة</button>
                  <a class="btn btn-soft" href="#/oil?customerId=${encodeURIComponent(c.id)}">تبديل دهن</a>
                  <button class="btn btn-danger" data-act="deleteCustomer" data-id="${c.id}">حذف</button>
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      ` : `<div class="notice">ماكو زباين بعد. اضغطي + زبون جديد.</div>`}
    </div>
  `;
}


async function viewDedupeCustomers() {
  const customers = await dbAPI.getAll("customers");
  const vehicles = await dbAPI.getAll("vehicles");
  const workOrders = await dbAPI.getAll("workOrders");

  const vCount = new Map();
  for (const v of vehicles) vCount.set(v.customerId, (vCount.get(v.customerId)||0) + 1);

  const wCount = new Map();
  for (const w of workOrders) wCount.set(w.customerId, (wCount.get(w.customerId)||0) + 1);

  const groups = new Map();
  for (const c of customers) {
    const k = digitsOnly(normalizePhone(c.phone));
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }

  const dups = Array.from(groups.entries())
    .filter(([,arr]) => arr.length > 1)
    .sort((a,b) => b[1].length - a[1].length);

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div>
          <div class="section-title">دمج المكررات (الزباين)</div>
          <div class="small">الدمج يتم حسب رقم الهاتف فقط (الأوثق).</div>
        </div>
        <a class="btn" href="#/backup">رجوع</a>
      </div>

      <div class="hr"></div>

      ${dups.length ? dups.map(([phoneKey, arr]) => `
        <div class="card subcard" style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
            <div>
              <div style="font-weight:900">📞 ${escapeHtml(arr[0].phone || "+"+phoneKey)}</div>
              <div class="small">مكرر: <b>${arr.length}</b></div>
            </div>
            <button class="btn btn-primary" data-act="mergeDupPhone" data-phone="${escapeHtml(phoneKey)}">دمج الآن</button>
          </div>
          <div class="hr"></div>
          <table class="table">
            <thead><tr><th>الاسم</th><th>سيارات</th><th>أوامر</th><th>المعرف</th></tr></thead>
            <tbody>
              ${arr.sort((a,b)=>(a.name||"").localeCompare(b.name||"", "ar")).map(c => `
                <tr class="tr">
                  <td><b>${escapeHtml(c.name||"—")}</b><div class="small">${escapeHtml(c.address||"")}</div></td>
                  <td>${vCount.get(c.id) || 0}</td>
                  <td>${wCount.get(c.id) || 0}</td>
                  <td class="small">${escapeHtml(c.id)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `).join("") : `<div class="notice">✅ ماكو مكررات حسب رقم الهاتف حالياً.</div>`}
    </div>
  `;
}

async function mergeCustomers(masterId, otherIds) {
  const master = await dbAPI.get("customers", masterId);
  if (!master) throw new Error("MASTER_NOT_FOUND");

  const vehicles = await dbAPI.getAll("vehicles");
  const workOrders = await dbAPI.getAll("workOrders");
  const appointments = await dbAPI.getAll("appointments");

  for (const oid of otherIds) {
    if (oid === masterId) continue;
    const other = await dbAPI.get("customers", oid);
    if (!other) continue;

    // دمج حقول فارغة فقط
    master.phone = master.phone || other.phone;
    master.address = master.address || other.address;
    master.notes = master.notes || other.notes;

    // نقل العلاقات
    for (const v of vehicles.filter(x => x.customerId === oid)) {
      v.customerId = masterId;
      await dbAPI.put("vehicles", v);
    }
    for (const w of workOrders.filter(x => x.customerId === oid)) {
      w.customerId = masterId;
      await dbAPI.put("workOrders", w);
    }
    for (const a of appointments.filter(x => x.customerId === oid)) {
      a.customerId = masterId;
      await dbAPI.put("appointments", a);
    }

    await dbAPI.delete("customers", oid);
  }

  await dbAPI.put("customers", master);
}


async function viewCustomerDetails(customerId) {
  const c = await dbAPI.get("customers", customerId);
  if (!c) return `<div class="card"><div class="notice">ما لقيت الزبون.</div></div>`;

  const vehicles = (await dbAPI.getAll("vehicles")).filter(v => v.customerId === c.id);
  const workOrders = (await dbAPI.getAll("workOrders")).filter(w => w.customerId === c.id).sort((a,b)=>b.createdAt-a.createdAt);
  const invoices = await dbAPI.getAll("invoices");

  const invByWO = new Map(invoices.map(i => [i.workOrderId, i]));

  const oilInv = invoices.filter(i => i.invoiceType === "OIL")
    .filter(i => {
      const wo = workOrders.find(w => w.id === i.workOrderId);
      return !!wo && wo.customerId === c.id;
    })
    .sort((a,b)=>b.createdAt-a.createdAt)
    .slice(0, 10);

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">
        <div>
          <div class="section-title">سجل الزبون</div>
          <div class="small"><b>${escapeHtml(c.name)}</b> • ${escapeHtml(c.phone||"")}</div>
          <div class="small">${escapeHtml(c.address||"")}</div>
          ${c.notes ? `<div class="notice" style="margin-top:10px">${escapeHtml(c.notes)}</div>` : ""}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn" href="#/customers">رجوع</a>
          <button class="btn" data-act="editCustomer" data-id="${c.id}">تعديل</button>
          <button class="btn" data-act="newVehicleForCustomer" data-id="${c.id}">+ سيارة</button>
          <a class="btn btn-primary" href="#/oil?customerId=${encodeURIComponent(c.id)}">تبديل دهن</a>
        </div>
      </div>

      <div class="hr"></div>

      <div class="row">
        <div class="col">
          <div class="card subcard">
            <div class="section-title">سيارات الزبون</div>
            ${vehicles.length ? vehicles.map(v => `
              <div class="card subcard" style="margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
                  <div>
                    <div style="font-weight:900">${escapeHtml(v.plate || "—")} • ${escapeHtml([v.make,v.model,v.year].filter(Boolean).join(" "))}</div>
                    <div class="small">عداد: <b>${v.odometer ?? "—"}</b> • دهن جاي: <b>${v.nextOilOdo ?? "—"}</b></div>
                  </div>
                  <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <a class="btn" href="#/vehicle?id=${encodeURIComponent(v.id)}">سجل السيارة</a>
                    <a class="btn btn-soft" href="#/oil?customerId=${encodeURIComponent(c.id)}&vehicleId=${encodeURIComponent(v.id)}">تبديل دهن</a>
                  </div>
                </div>
              </div>
            `).join("") : `<div class="notice">ماكو سيارات بعد.</div>`}
          </div>
        </div>

        <div class="col">
          <div class="card subcard">
            <div class="section-title">آخر تبديلات دهن</div>
            ${oilInv.length ? oilInv.map(inv => `
              <div class="card subcard" style="margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
                  <div>
                    <div style="font-weight:900">${fmtDay(inv.createdAt)} • فاتورة ${escapeHtml(inv.id)}</div>
                    <div class="small">حالي: <b>${inv.oil?.currentOdo ?? "—"}</b> • جاي: <b>${inv.oil?.nextOdo ?? "—"}</b></div>
                  </div>
                  <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <button class="btn" data-act="printInvoice" data-id="${inv.id}">طباعة</button>
                  </div>
                </div>
              </div>
            `).join("") : `<div class="notice">بعد ماكو فواتير دهن.</div>`}
          </div>
        </div>
      </div>

      <div class="hr"></div>

      <div class="card subcard">
        <div class="section-title">أوامر الشغل (سجل)</div>
        ${workOrders.length ? `
          <table class="table">
            <thead>
              <tr><th>الرقم</th><th>الوصف</th><th>الحالة</th><th>تاريخ</th><th>فاتورة</th><th>إجراءات</th></tr>
            </thead>
            <tbody>
              ${workOrders.slice(0, 20).map(w => {
                const inv = invByWO.get(w.id);
                return `
                  <tr class="tr">
                    <td><b>${escapeHtml(w.id)}</b><div class="small">${escapeHtml(w.serviceType||"GENERAL")}</div></td>
                    <td>${escapeHtml(w.complaint||"—")}</td>
                    <td>${pill(w.status)}</td>
                    <td class="small">${fmtDate(w.createdAt)}</td>
                    <td>${inv ? `<b>${escapeHtml(inv.id)}</b><div class="small">${money(inv.total||0)}</div>` : "—"}</td>
                    <td>
                      <div style="display:flex;gap:8px;flex-wrap:wrap">
                        <a class="btn" href="#/order?id=${encodeURIComponent(w.id)}">تفاصيل</a>
                        ${inv ? `<button class="btn" data-act="printInvoice" data-id="${inv.id}">طباعة</button>` : `<button class="btn" data-act="makeInvoice" data-id="${w.id}">فاتورة</button>`}
                      </div>
                    </td>
                  </tr>
                `;
              }).join("")}
            </tbody>
          </table>
        ` : `<div class="notice">ماكو أوامر شغل مسجلة لهذا الزبون.</div>`}
      </div>
    </div>
  `;
}

async function viewVehicles() {
  const vehicles = await dbAPI.getAll("vehicles");
  const customers = await dbAPI.getAll("customers");
  const cMap = new Map(customers.map(c=>[c.id,c]));

  const q = (state.search || "").trim().toLowerCase();

  const list = vehicles
    .sort((a,b)=> (a.plate||"").localeCompare(b.plate||"", "ar"))
    .filter(v => {
      if (!q) return true;
      const c = cMap.get(v.customerId);
      return (
        (v.plate||"").toLowerCase().includes(q) ||
        (v.vin||"").toLowerCase().includes(q) ||
        (c?.name||"").toLowerCase().includes(q) ||
        (c?.phone||"").toLowerCase().includes(q)
      );
    });

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div>
          <div class="section-title">السيارات</div>
          <div class="small">كل سيارة إلها سجل وتاريخ وتبديلات دهن</div>
        </div>
        <button class="btn btn-primary" data-act="newVehicle">+ سيارة جديدة</button>
      </div>

      <div class="hr"></div>

      ${list.length ? `
      <table class="table">
        <thead>
          <tr>
            <th>اللوحة</th>
            <th>السيارة</th>
            <th>الزبون</th>
            <th>عداد</th>
            <th>دهن جاي</th>
            <th>إجراءات</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(v => {
            const c = cMap.get(v.customerId);
            return `
              <tr class="tr">
                <td><b>${escapeHtml(v.plate || "—")}</b><div class="small">${escapeHtml(v.vin||"")}</div></td>
                <td>${escapeHtml([v.make,v.model,v.year].filter(Boolean).join(" ") || "—")}</td>
                <td>${escapeHtml(c?.name || "—")}<div class="small">${escapeHtml(c?.phone || "")}</div></td>
                <td>${v.odometer ?? "—"}</td>
                <td>${v.nextOilOdo ?? "—"}</td>
                <td>
                  <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <a class="btn" href="#/vehicle?id=${encodeURIComponent(v.id)}">السجل</a>
                    <button class="btn" data-act="editVehicle" data-id="${v.id}">تعديل</button>
                    <a class="btn btn-soft" href="#/oil?customerId=${encodeURIComponent(v.customerId)}&vehicleId=${encodeURIComponent(v.id)}">تبديل دهن</a>
                    <button class="btn btn-danger" data-act="deleteVehicle" data-id="${v.id}">حذف</button>
                  </div>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
      ` : `<div class="notice">ماكو سيارات بعد.</div>`}
    </div>
  `;
}

async function viewVehicleDetails(vehicleId) {
  const v = await dbAPI.get("vehicles", vehicleId);
  if (!v) return `<div class="card"><div class="notice">ما لقيت السيارة.</div></div>`;

  const c = await dbAPI.get("customers", v.customerId);
  const workOrders = (await dbAPI.getAll("workOrders")).filter(w => w.vehicleId === v.id).sort((a,b)=>b.createdAt-a.createdAt);
  const invoices = await dbAPI.getAll("invoices");
  const invByWO = new Map(invoices.map(i=>[i.workOrderId,i]));
  const appointments = (await dbAPI.getAll("appointments")).filter(a => a.vehicleId === v.id).sort((a,b)=> (b.whenTs||0)-(a.whenTs||0));

  const employees = await dbAPI.getAll("employees");
  const empById = new Map(employees.map(e=>[e.id, e]));
  const partsAll = await dbAPI.getAll("parts");
  const partById = new Map(partsAll.map(p=>[p.id, p]));
  const atts = await dbAPI.getAll("attachments");
  const photoCountByWO = new Map();
  for (const a of atts) {
    if (a.entityType !== "workOrder") continue;
    photoCountByWO.set(a.entityId, (photoCountByWO.get(a.entityId)||0) + 1);
  }

  const oilInvoices = invoices
    .filter(i => i.invoiceType === "OIL")
    .filter(i => workOrders.some(w => w.id === i.workOrderId))
    .sort((a,b)=>b.createdAt-a.createdAt);

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">
        <div>
          <div class="section-title">سجل السيارة</div>
          <div class="small"><b>${escapeHtml(v.plate || "—")}</b> • ${escapeHtml([v.make,v.model,v.year].filter(Boolean).join(" ") || "—")}</div>
          <div class="small">الزبون: <a href="#/customer?id=${encodeURIComponent(v.customerId)}">${escapeHtml(c?.name || "—")}</a> • ${escapeHtml(c?.phone||"")}</div>
          <div class="small">عداد: <b>${v.odometer ?? "—"}</b> • دهن جاي: <b>${v.nextOilOdo ?? "—"}</b></div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn" href="#/vehicles">رجوع</a>
          <button class="btn" data-act="editVehicle" data-id="${v.id}">تعديل</button>
          <a class="btn btn-primary" href="#/oil?customerId=${encodeURIComponent(v.customerId)}&vehicleId=${encodeURIComponent(v.id)}">تبديل دهن</a>
        </div>
      </div>

      <div class="hr"></div>


      <div class="card subcard">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
          <div>
            <div class="section-title">مواعيد السيارة</div>
            <div class="small">موعد صيانة/فحص — يمكن تحويله لأمر شغل</div>
          </div>
          <button class="btn btn-primary" data-act="newAppointmentForVehicle" data-id="${v.id}">+ موعد</button>
        </div>
        <div class="hr"></div>
        ${appointments.length ? appointments.slice(0, 12).map(ap => `
          <div class="card subcard" style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
              <div>
                <div style="font-weight:900">${fmtDate(ap.whenTs)} ${ap.time ? "• " + escapeHtml(ap.time) : ""}</div>
                <div class="small">${escapeHtml(ap.note || "—")}</div>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                ${apPill(ap.status)}
                <button class="btn" data-act="editAppointment" data-id="${ap.id}">تعديل</button>
                <button class="btn btn-danger" data-act="delAppointment" data-id="${ap.id}">حذف</button>
                <button class="btn btn-soft" data-act="apToOrder" data-id="${ap.id}">تحويل لأمر</button>
              </div>
            </div>
          </div>
        `).join("") : `<div class="notice">لا توجد مواعيد لهذه السيارة.</div>`}
      </div>

      <div class="hr"></div>

      <div class="card subcard">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <div>
            <div class="section-title">مرفقات السيارة</div>
            <div class="small">صور/مستندات تخص السيارة</div>
          </div>
          <button class="btn btn-primary" data-act="addAttachment" data-type="vehicle" data-kind="other" data-entity="${v.id}">+ إضافة</button>
        </div>

        <div class="gallery">
          ${(await renderAttachmentThumbs("vehicle", v.id)).join("") || `<div class="notice">لا توجد مرفقات.</div>`}
        </div>
      </div>

      <div class="hr"></div>
      <div class="row">
        <div class="col">
          <div class="card subcard">
            <div class="section-title">تاريخ تبديل الدهن</div>
            ${oilInvoices.length ? oilInvoices.slice(0, 12).map(inv => `
              <div class="card subcard" style="margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
                  <div>
                    <div style="font-weight:900">${fmtDay(inv.createdAt)} • فاتورة ${escapeHtml(inv.id)}</div>
                    <div class="small">حالي: <b>${inv.oil?.currentOdo ?? "—"}</b> • جاي: <b>${inv.oil?.nextOdo ?? "—"}</b></div>
                  </div>
                  <button class="btn" data-act="printInvoice" data-id="${inv.id}">طباعة</button>
                </div>
              </div>
            `).join("") : `<div class="notice">ماكو تبديلات دهن مسجلة.</div>`}
          </div>
        </div>

        <div class="col">
          <div class="card subcard">
            <div class="section-title">تاريخ أوامر الشغل</div>
            ${workOrders.length ? workOrders.slice(0, 15).map(w => {
              const inv = invByWO.get(w.id);
              const emp = empById.get(w.employeeId);
              const techName = emp?.name || (w.employeeId || "—");
              const partLines = Array.isArray(w.partLines) ? w.partLines : [];
              const partsQty = sum(partLines, ln => Number(ln.qty||0));
              const topParts = partLines.slice(0,2).map(ln => partById.get(ln.partId)?.name).filter(Boolean).join("، ");
              const photos = photoCountByWO.get(w.id) || 0;
              return `
                <div class="card subcard" style="margin-bottom:10px">
                  <div style="display:flex;justify-content:space-between;gap:10px;align-items:center">
                    <div>
                      <div style="font-weight:900">${escapeHtml(w.complaint || "—")}</div>
                      <div class="small">${escapeHtml(w.id)} • ${fmtDate(w.createdAt)} • ${pill(w.status)}</div>
                      <div class="small">فاتورة: ${inv ? `<b>${escapeHtml(inv.id)}</b> • ${money(inv.total||0)}` : "—"}</div>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap">
                      <a class="btn" href="#/order?id=${encodeURIComponent(w.id)}">تفاصيل</a>
                      ${inv ? `<button class="btn" data-act="printInvoice" data-id="${inv.id}">طباعة</button>` : `<button class="btn" data-act="makeInvoice" data-id="${w.id}">فاتورة</button>`}
                    </div>
                  </div>
                </div>
              `;
            }).join("") : `<div class="notice">ماكو أوامر شغل للسيارة.</div>`}
          </div>
        </div>
      </div>
    </div>
  `;
}

async function viewOil(params) {
  const customers = await dbAPI.getAll("customers");
  const vehicles = await dbAPI.getAll("vehicles");
  const employees = (await dbAPI.getAll("employees")).filter(e => e.active);

  // preselect from query
  const preC = params.get("customerId") || "";
  const preV = params.get("vehicleId") || "";

  const custOptions = customers
    .sort((a,b)=> (a.name||"").localeCompare(b.name||"", "ar"))
    .map(c => `<option value="${c.id}" ${preC===c.id ? "selected":""}>${escapeHtml(c.name)} ${c.phone? "• "+escapeHtml(c.phone):""}</option>`)
    .join("");

  const vehOptions = vehicles
    .sort((a,b)=> (a.plate||"").localeCompare(b.plate||"", "ar"))
    .map(v => `<option value="${v.id}" ${preV===v.id ? "selected":""}>${escapeHtml(v.plate || "—")} • ${escapeHtml([v.make,v.model,v.year].filter(Boolean).join(" "))}</option>`)
    .join("");

  const empOptions = employees
    .sort((a,b)=> (a.name||"").localeCompare(b.name||"", "ar"))
    .map(e => `<option value="${e.id}">${escapeHtml(e.name)} • ${escapeHtml(e.specialty||"")}</option>`)
    .join("");

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div>
          <div class="section-title">تبديل دهن</div>
          <div class="small">فاتورة جاهزة للطباعة وتحتوي: العداد الحالي + العداد الجاي</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" data-act="saveOil">حفظ + إنشاء فاتورة</button>
        </div>
      </div>

      <div class="hr"></div>

      <div class="grid2">
        <div>
          <label class="small">الزبون</label>
          <select id="oilCustomer" class="input">
            <option value="">— اختيار —</option>
            ${custOptions}
          </select>
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" data-act="newCustomer">+ زبون</button>
          </div>
        </div>

        <div>
          <label class="small">السيارة</label>
          <select id="oilVehicle" class="input">
            <option value="">— اختيار —</option>
            ${vehOptions}
          </select>
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn" data-act="newVehicle">+ سيارة</button>
          </div>
        </div>
      </div>

      <div class="grid2" style="margin-top:12px">
        <div>
          <label class="small">الفني (اختياري)</label>
          <select id="oilEmployee" class="input">
            <option value="">— بدون —</option>
            ${empOptions}
          </select>
        </div>

        <div class="notice">
          نصيحة: خلي فترة الدهن حسب نوع الدهن واستعمال السيارة (5000 / 7000 / 10000).
        </div>
      </div>

      <div class="hr"></div>

      <div class="grid3">
        <div>
          <label class="small">العداد الحالي</label>
          <input id="oilCurrentOdo" class="input" inputmode="numeric" placeholder="150000" />
        </div>
        <div>
          <label class="small">فترة التبديل (كم)</label>
          <select id="oilInterval" class="input">
            <option value="5000">5000</option>
            <option value="7000">7000</option>
            <option value="10000">10000</option>
          </select>
        </div>
        <div>
          <label class="small">العداد الجاي (ينحسب تلقائي)</label>
          <input id="oilNextOdo" class="input" inputmode="numeric" placeholder="155000" />
        </div>
      </div>

      <div class="grid2" style="margin-top:12px">
        <div>
          <label class="small">نوع الدهن (اختياري)</label>
          <input id="oilType" class="input" placeholder="مثال: 5W-30" />
        </div>
        <div>
          <label class="small">خصم</label>
          <input id="oilDiscount" class="input" inputmode="numeric" value="0" />
        </div>
      </div>

      <div class="hr"></div>

      <div class="grid3">
        <div>
          <label class="small">سعر الدهن</label>
          <input id="oilPrice" class="input" inputmode="numeric" value="0" />
        </div>
        <div>
          <label class="small">سعر الفلتر</label>
          <input id="oilFilterPrice" class="input" inputmode="numeric" value="0" />
        </div>
        <div>
          <label class="small">أجور الخدمة</label>
          <input id="oilLabor" class="input" inputmode="numeric" value="0" />
        </div>
      </div>

      <div class="grid2" style="margin-top:12px">
        <div class="notice">
          بعد الحفظ: راح ينحفظ العداد الحالي ويحدد العداد الجاي داخل سجل السيارة + سجل الزبون.
        </div>
        <div>
          <label class="small">مدفوع</label>
          <input id="oilPaid" class="input" inputmode="numeric" value="0" />
        </div>
      </div>
    </div>
  `;
}

async function viewInventory() {
  const parts = (await dbAPI.getAll("parts")).sort((a,b)=> (a.name||"").localeCompare(b.name||"", "ar"));
  const low = parts.filter(p => Number(p.stock||0) <= Number(p.min||0));

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div>
          <div class="section-title">المخزون</div>
          <div class="small">تقدرين تسوين صرف قطع من تفاصيل أمر الشغل</div>
        </div>
        <button class="btn btn-primary" data-act="newPart">+ قطعة</button>
      </div>

      <div class="hr"></div>
      ${low.length ? `<div class="notice">⚠️ قطع تحت الحد الأدنى: ${low.length}</div><div class="hr"></div>` : ""}

      <div class="grid2">
        <div>
          <div class="small" style="margin:4px 2px">حقل المسح (USB Scanner / SKU)</div>
          <input id="scanInput" class="input" placeholder="اسحبي الباركود هنا أو اكتبي SKU/QR..." />
          <div class="small" style="margin-top:6px">بديل: <b>مسح بالكاميرا</b> يقرأ QR/Barcode من الموبايل.</div>
        </div>
        <div style="display:flex;gap:8px;align-items:end;flex-wrap:wrap">
          <button class="btn" data-act="scanInventory">مسح بالكاميرا</button>
          <button class="btn btn-soft" data-act="excelExport" data-kind="parts">تصدير Excel</button>
          <button class="btn btn-primary" data-act="excelImportParts">استيراد Excel</button>
        </div>
      </div>

      <div class="hr"></div>

      ${parts.length ? `
      <table class="table">
        <thead>
          <tr>
            <th>القطعة</th>
            <th>SKU</th>
            <th>شراء</th>
            <th>بيع</th>
            <th>الرصيد</th>
            <th>الحد الأدنى</th>
            <th>إجراءات</th>
          </tr>
        </thead>
        <tbody>
          ${parts.map(p => `
            <tr class="tr">
              <td><b>${escapeHtml(p.name)}</b></td>
              <td class="small">${escapeHtml(p.sku || "—")}</td>
              <td class="small">${money(p.buy || 0)}</td>
              <td class="small">${money(p.sell || 0)}</td>
              <td><b>${p.stock ?? 0}</b></td>
              <td class="small">${p.min ?? 0}</td>
              <td>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                  <button class="btn" data-act="stockAdd" data-id="${p.id}">+ إضافة</button>
                  <button class="btn" data-act="stockSub" data-id="${p.id}">- صرف</button>
                  <button class="btn btn-danger" data-act="deletePart" data-id="${p.id}">حذف</button>
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      ` : `<div class="notice">بعد ماكو قطع. اضغطي + قطعة.</div>`}
    </div>
  `;
}

async function viewInvoices() {
  const invoices = (await dbAPI.getAll("invoices")).sort((a,b)=>b.createdAt-a.createdAt);
  const workOrders = await dbAPI.getAll("workOrders");
  const customers = await dbAPI.getAll("customers");
  const vehicles = await dbAPI.getAll("vehicles");

  const woMap = new Map(workOrders.map(w=>[w.id,w]));
  const cMap = new Map(customers.map(c=>[c.id,c]));
  const vMap = new Map(vehicles.map(v=>[v.id,v]));

  return `
    <div class="card">
      <div class="section-title">الفواتير</div>
      <div class="small">طباعة مباشرة + مدفوع/متبقي</div>
      <div class="hr"></div>

      ${invoices.length ? `
      <table class="table">
        <thead>
          <tr>
            <th>رقم الفاتورة</th>
            <th>النوع</th>
            <th>الزبون</th>
            <th>السيارة</th>
            <th>المجموع</th>
            <th>مدفوع</th>
            <th>متبقي</th>
            <th>إجراءات</th>
          </tr>
        </thead>
        <tbody>
          ${invoices.map(inv => {
            const wo = woMap.get(inv.workOrderId);
            const c = wo ? cMap.get(wo.customerId) : null;
            const v = wo ? vMap.get(wo.vehicleId) : null;
            const rem = Math.max(0, Number(inv.total||0) - Number(inv.paid||0));
            return `
              <tr class="tr">
                <td><b>${escapeHtml(inv.id)}</b><div class="small">${fmtDate(inv.createdAt)}</div></td>
                <td>${inv.invoiceType === "OIL" ? `<span class="pill progress">تبديل دهن</span>` : `<span class="pill open">عادي</span>`}</td>
                <td>${escapeHtml(c?.name || "—")}<div class="small">${escapeHtml(c?.phone || "")}</div></td>
                <td>${escapeHtml(v?.plate || "—")}<div class="small">${escapeHtml([v?.make,v?.model].filter(Boolean).join(" "))}</div></td>
                <td>${money(inv.total || 0)}</td>
                <td>${money(inv.paid || 0)}</td>
                <td>${money(rem)}</td>
                <td>
                  <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <button class="btn" data-act="invoicePay" data-id="${inv.id}">دفعة</button>
                    <button class="btn btn-soft" data-act="msgPaymentInv" data-id="${inv.id}">متبقي</button>
                    <button class="btn btn-primary" data-act="printInvoice" data-id="${inv.id}">طباعة</button>
                    <button class="btn btn-danger" data-act="deleteInvoice" data-id="${inv.id}">حذف</button>
                  </div>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
      ` : `<div class="notice">ماكو فواتير بعد.</div>`}
    </div>
  `;
}

async function viewEmployees() {
  const employees = (await dbAPI.getAll("employees")).sort((a,b)=> (a.name||"").localeCompare(b.name||"", "ar"));
  const active = employees.filter(e => e.active);
  const monthlyTotal = active.filter(e=>e.salaryType==="شهري").reduce((s,e)=> s + Number(e.salaryAmount||0), 0);

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div>
          <div class="section-title">الموظفين</div>
          <div class="small">اختصاص + راتب + تفعيل/إيقاف</div>
        </div>
        <button class="btn btn-primary" data-act="newEmployee">+ موظف</button>
      </div>

      <div class="hr"></div>

      <div class="card subcard">
        <div class="kv"><span>عدد الموظفين (فعّال)</span><b>${active.length}</b></div>
        <div style="height:8px"></div>
        <div class="kv"><span>مجموع الرواتب الشهرية (تقريبي)</span><b>${money(monthlyTotal)}</b></div>
      </div>

      <div class="hr"></div>

      ${employees.length ? `
      <table class="table">
        <thead>
          <tr>
            <th>الاسم</th>
            <th>الاختصاص</th>
            <th>الهاتف</th>
            <th>الإيميل</th>
            <th>الراتب</th>
            <th>الحالة</th>
            <th>إجراءات</th>
          </tr>
        </thead>
        <tbody>
          ${employees.map(e => `
            <tr class="tr">
              <td><b>${escapeHtml(e.name)}</b></td>
              <td class="small">${escapeHtml(e.specialty || "—")}</td>
              <td class="small">${escapeHtml(e.phone || "—")}</td>
              <td class="small">${escapeHtml(e.salaryType || "—")} • ${money(e.salaryAmount || 0)}</td>
              <td>${e.active ? `<span class="pill done">فعّال</span>` : `<span class="pill off">متوقف</span>`}</td>
              <td>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                  <button class="btn" data-act="editEmployee" data-id="${e.id}">تعديل</button>
                  <button class="btn" data-act="toggleEmployee" data-id="${e.id}">${e.active ? "إيقاف" : "تفعيل"}</button>
                  <button class="btn btn-danger" data-act="deleteEmployee" data-id="${e.id}">حذف</button>
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      ` : `<div class="notice">بعد ماكو موظفين.</div>`}
    </div>
  `;
}

async function viewReports() {
  const invoices = await dbAPI.getAll("invoices");
  const parts = await dbAPI.getAll("parts");
  const workOrders = await dbAPI.getAll("workOrders");
  const expenses = await dbAPI.getAll("expenses");

  const today = new Date();
  const startDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  const startMonth = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
  const endDay = startDay + 86400e3;

  const todayPaid = invoices.filter(i => i.createdAt>=startDay && i.createdAt<endDay).reduce((s,i)=> s + Number(i.paid||0), 0);
  const monthPaid = invoices.filter(i => i.createdAt>=startMonth).reduce((s,i)=> s + Number(i.paid||0), 0);

  const todayExp = expenses.filter(x => x.whenTs>=startDay && x.whenTs<endDay).reduce((s,x)=> s + Number(x.amount||0), 0);
  const monthExp = expenses.filter(x => x.whenTs>=startMonth).reduce((s,x)=> s + Number(x.amount||0), 0);

  const totalRemaining = invoices.reduce((s,i)=> s + Math.max(0, Number(i.total||0)-Number(i.paid||0)), 0);

  // Parts profit estimate: sum(qty*(sell-buy)) for issued part lines in workOrders
  const pMap = new Map(parts.map(p=>[p.id,p]));
  let partsProfit = 0;
  for (const wo of workOrders) {
    const lines = Array.isArray(wo.partLines) ? wo.partLines : [];
    for (const ln of lines) {
      const p = pMap.get(ln.partId);
      if (!p) continue;
      const qty = Number(ln.qty||0);
      const sell = Number(ln.unit||0);
      const buy = Number(p.buy||0);
      partsProfit += qty * Math.max(0, sell - buy);
    }
  }

  const oilCountMonth = invoices.filter(i => i.invoiceType==="OIL" && i.createdAt>=startMonth).length;

  return `
    <div class="card">
      <div class="section-title">التقارير</div>
      <div class="small">تقارير سريعة (ممكن نوسعها أكثر بعدين)</div>
      <div class="hr"></div>

      <div class="cards">
        <div class="card"><div class="card-title">مدفوع اليوم</div><div class="card-value">${money(todayPaid)}</div></div>
        <div class="card"><div class="card-title">مصروف اليوم</div><div class="card-value">${money(todayExp)}</div></div>
        <div class="card"><div class="card-title">صافي اليوم</div><div class="card-value">${money(todayPaid - todayExp)}</div></div>
        <div class="card"><div class="card-title">مدفوع هذا الشهر</div><div class="card-value">${money(monthPaid)}</div></div>
        <div class="card"><div class="card-title">مصروف هذا الشهر</div><div class="card-value">${money(monthExp)}</div></div>
        <div class="card"><div class="card-title">مبالغ متبقية (ديون)</div><div class="card-value">${money(totalRemaining)}</div></div>
      </div>

      <div class="small" style="margin-top:8px">عدد تبديل دهن هذا الشهر: <b>${oilCountMonth}</b></div>

      <div class="hr"></div>

      <div class="card subcard">
        <div class="kv"><span>ربح قطع (تقديري)</span><b>${money(partsProfit)}</b></div>
        <div class="small" style="margin-top:8px">
          الربح محسوب من (بيع - شراء) للقطع المصروفة داخل أوامر الشغل.
        </div>
      </div>
    </div>
  `;
}

async function viewBackup() {
  return `
    <div class="card">
      <div class="section-title">نسخ احتياطي</div>
      <div class="small">تصدير/استيراد كل الداتا (JSON)</div>
      <div class="hr"></div>

      <div class="row">
        <div class="col">
          <div class="card subcard">
            <div class="section-title">Export</div>
            <div class="small">تنزيل نسخة احتياطية</div>
            <div class="hr"></div>
            <button class="btn btn-primary" data-act="export">تصدير</button>
          </div>
        </div>

        <div class="col">
          <div class="card subcard">
            <div class="section-title">Import</div>
            <div class="small">استيراد نسخة (تستبدل الحالية)</div>
            <div class="hr"></div>
            <input type="file" id="importFile" class="input" accept="application/json" />
            <div style="height:10px"></div>
            <button class="btn" data-act="import">استيراد</button>
          </div>
        </div>
      </div>

      <div class="hr"></div>


      <div class="card subcard">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
          <div>
            <div class="section-title">Excel (استيراد/تصدير)</div>
            <div class="small">زباين • مخزون • فواتير — مع تصحيح تلقائي بسيط ودمج حسب الهاتف/SKU</div>
          </div>
          <a class="btn btn-soft" href="#/dedupe">دمج مكررات (زباين)</a>
        </div>
        <div class="hr"></div>

        <div class="grid3">
          <button class="btn" data-act="excelExport" data-kind="customers">تصدير الزباين</button>
          <button class="btn" data-act="excelExport" data-kind="parts">تصدير المخزون</button>
          <button class="btn" data-act="excelExport" data-kind="invoices">تصدير الفواتير</button>
        </div>

        <div class="hr"></div>

        <div class="grid2">
          <div>
            <div class="small" style="margin:4px 2px">نوع الاستيراد</div>
            <select id="excelKind" class="input">
              <option value="customers">زباين</option>
              <option value="parts">مخزون</option>
              <option value="invoices">فواتير</option>
            </select>
          </div>
          <div>
            <div class="small" style="margin:4px 2px">ملف Excel</div>
            <input type="file" id="excelFile" class="input" accept=".xlsx,.xls" />
          </div>
        </div>

        <div style="height:10px"></div>
        <button class="btn btn-primary" data-act="excelImport">استيراد</button>
        <div class="small" style="margin-top:8px">ملاحظة: أفضل شي تصدير أولاً وبنفس الأعمدة تسوين تعديل وترجعين تستوردين.</div>
      </div>


      <div class="hr"></div>

      <div class="card subcard" style="border:1px solid #fecaca">
        <div class="section-title" style="color:var(--bad)">Reset</div>
        <div class="small">حذف كل البيانات</div>
        <div class="hr"></div>
        <button class="btn btn-danger" data-act="reset">حذف الكل</button>
      </div>
    </div>
  `;
}

/* ------------------------ Auth (Firebase) ------------------------ */
async function viewAuth() {
  const u = authState.user;
  const wantCloud = Settings.get("storageMode", "local") === "firebase";
  const cloudOk = cloudEnabled();

  if (!u) {
    return `
      <div class="card">
        <div class="section-title">الحساب</div>
        <div class="small">سجلي دخول حتى تفعّلين حفظ سحابي (Firebase) ومزامنة بياناتك بين الأجهزة.</div>
        <div class="hr"></div>

        <div class="grid2">
          <div>
            <div class="small" style="margin:4px 2px">البريد</div>
            <input id="authEmail" class="input" type="email" placeholder="email@example.com" />
          </div>
          <div>
            <div class="small" style="margin:4px 2px">كلمة المرور</div>
            <input id="authPass" class="input" type="password" placeholder="••••••••" />
          </div>
        </div>

        <div class="mini" style="margin-top:10px">
          <button class="btn btn-primary" data-act="authSignIn">تسجيل دخول</button>
          <button class="btn" data-act="authSignUp">إنشاء حساب</button>
        </div>

        <div class="hr"></div>
        <div class="notice">
          <b>مهم:</b> حتى يشتغل التخزين السحابي لازم تفعّلين Firestore بالمشروع وتضبطين Rules على مسار <code>users/{uid}</code>.
          تگدرين تشتغلين محليًا بدون تسجيل دخول.
        </div>
        <div class="hr"></div>
        <div class="row" style="align-items:center; gap:10px; flex-wrap:wrap">
          <div class="small">مسار السحابة:</div>
          <select id="cloudScopeSelect" class="input" style="max-width:220px">
            <option value="root">Root (مقترح)</option>
            <option value="user">users/{uid}</option>
          </select>
          <button class="btn" data-act="setCloudScope">حفظ</button>
          <span class="small">الحالي: <b>${escapeHtml(Settings.get("cloudScope","root"))}</b></span>
        </div>


        <div class="hr"></div>
        <div class="row" style="align-items:center">
          <div class="small">وضع التخزين الحالي:</div>
          <span class="badge">${wantCloud ? "سحابة (ينتظر تسجيل دخول)" : "محلي"}</span>
        </div>
        <div class="mini" style="margin-top:8px">
          <button class="btn" data-act="useLocal">استخدام محلي</button>
          <button class="btn btn-primary" data-act="useCloud">اختيار السحابة</button>
        </div>
      </div>
    `;
  }

  const email = u.email || "(بدون ايميل)";

  return `
    <div class="card">
      <div class="section-title">الحساب</div>
      <div class="small">حفظ البيانات: محلي + سحابة (Firestore) حسب اختيارك</div>
      <div class="hr"></div>

      <div class="row" style="align-items:center; gap:10px; flex-wrap:wrap">
        <span class="badge">${escapeHtml(email)}</span>
        <span class="small">UID: ${escapeHtml(String(u.uid).slice(0, 8))}…</span>
        <span class="badge">${cloudOk ? "السحابة فعّالة" : "محلي"}</span>
      </div>

      <div class="hr"></div>

      <div class="grid2">
        <button class="btn ${cloudOk ? "btn-primary" : ""}" data-act="useCloud">استخدم السحابة</button>
        <button class="btn ${!cloudOk ? "btn-primary" : ""}" data-act="useLocal">استخدم المحلي</button>
        <button class="btn" data-act="syncUp">رفع المحلي للسحابة</button>
        <button class="btn" data-act="syncDown">تنزيل السحابة للمحلي</button>
      </div>

      <div class="hr"></div>

      <div class="notice">
        <b>ملاحظة المزامنة:</b> الرفع/التنزيل يستبدل الداتا بالطرف الثاني. إذا تريدين نظام تعارضات متقدم نضيفه بعدين.
      </div>

      <div class="hr"></div>
      <button class="btn btn-danger" data-act="authSignOut">تسجيل خروج</button>
    </div>
  `;
}

async function viewMore() {
  return `
    <div class="card">
      <div class="section-title">المزيد</div>
      <div class="small">روابط للموبايل</div>
      <div class="hr"></div>

      <div class="grid2">
        <a class="btn btn-primary" href="#/auth">الحساب / السحابة</a>
        <a class="btn" href="#/customers">الزباين</a>
        <a class="btn" href="#/vehicles">السيارات</a>
        <a class="btn" href="#/invoices">الفواتير</a>
        <a class="btn" href="#/expenses">المصروفات</a>
        <a class="btn" href="#/appointments">المواعيد</a>
        <a class="btn" href="#/employees">الموظفين</a>
        <a class="btn" href="#/roles">الصلاحيات</a>
        <a class="btn" href="#/reports">التقارير</a>
        <a class="btn" href="#/backup">نسخ احتياطي</a>
      </div>

      
      <div class="hr"></div>
      <div class="card subcard">
        <div class="section-title">بيانات الكراج (تظهر بالطباعة)</div>
        <div class="small">عدّلي الاسم/الهاتف/العنوان ثم احفظي. (تنعكس على فواتير الطباعة)</div>
        <div class="hr"></div>

        <div class="grid2">
          <div>
            <div class="small" style="margin:4px 2px">الاسم</div>
            <input id="shopName" class="input" value="${escapeHtml(getShop().name)}" />
          </div>
          <div>
            <div class="small" style="margin:4px 2px">الهاتف</div>
            <input id="shopPhone" class="input" value="${escapeHtml(getShop().phone)}" placeholder="07xxxxxxxxx" />
          </div>
        </div>
        <div style="height:10px"></div>
        <div>
          <div class="small" style="margin:4px 2px">العنوان</div>
          <input id="shopAddress" class="input" value="${escapeHtml(getShop().address)}" placeholder="بغداد / ..." />
        </div>

        <div class="mini" style="margin-top:10px">
          <button class="btn btn-primary" data-act="saveShop">حفظ بيانات الكراج</button>
        </div>
      </div>

      <div class="hr"></div>
      <div class="notice">
        إذا تحبين نضيف: تصميم طباعة أحلى (شعار/هاتف/عنوان)، أو ربط تبديل الدهن بالمخزون حتى ينخصم زيت/فلتر تلقائياً.
      </div>
    </div>
  `;
}

/* ------------------------ Render ------------------------ */
async function renderRoute() {
  const { route, params } = parseHash();
  state.route = route;

  // منع الوصول حسب الدور
  if (!canAccessRoute(route) && route !== "auth") {
    const view = $("#view");
    view.innerHTML = `<div class="card"><div class="notice">ما عندك صلاحية لهالصفحة (${escapeHtml(roleLabel(currentRole()))}).</div></div>`;
    return;
  }

  setTitle(route);
  setActiveNav(route);

  const d = new Date();
  const cloudOk = cloudEnabled();
  const label = cloudOk ? "سحابة" : "محلي";
  const who = cloudOk && authState.user ? (authState.user.email || String(authState.user.uid).slice(0, 6) + "…") : "";
  const rLabel = roleLabel(currentRole());
  $("#todayBadge").textContent = `اليوم: ${d.toLocaleDateString("ar-IQ")} • ${label}${who ? " • " + who : ""} • ${rLabel}`;

  const view = $("#view");
  view.innerHTML = `<div class="notice">... جاري التحميل</div>`;

  let html = "";
  if (route === "dashboard") html = await viewDashboard();
  if (route === "checkin") html = await viewCheckin();
  if (route === "orders") html = await viewOrders();
  if (route === "order") html = await viewOrderDetails(params.get("id") || "");
  if (route === "customers") html = await viewCustomers(params);
  if (route === "customer") html = await viewCustomerDetails(params.get("id") || "");
  if (route === "vehicles") html = await viewVehicles();
  if (route === "vehicle") html = await viewVehicleDetails(params.get("id") || "");
  if (route === "oil") html = await viewOil(params);
  if (route === "inventory") html = await viewInventory();
  if (route === "invoices") html = await viewInvoices();
  if (route === "employees") html = await viewEmployees();
  if (route === "reports") html = await viewReports();
  if (route === "expenses") html = await viewExpenses();
  if (route === "appointments") html = await viewAppointments(params);
  if (route === "roles") html = await viewRoles();
  if (route === "backup") html = await viewBackup();
  if (route === "dedupe") html = await viewDedupeCustomers();
  if (route === "more") html = await viewMore();
  if (route === "auth") html = await viewAuth();

  view.innerHTML = html;

  // Prefill cloud scope select
  const cs = $("#cloudScopeSelect");
  if (cs) cs.value = Settings.get("cloudScope", "root");

  // Oil: auto-calc next odo
  if (route === "oil") {
    const cur = $("#oilCurrentOdo");
    const interval = $("#oilInterval");
    const next = $("#oilNextOdo");

    const recalc = () => {
      const c = Number(cur.value || 0);
      const it = Number(interval.value || 5000);
      if (c > 0) next.value = String(c + it);
    };

    cur?.addEventListener("input", recalc);
    interval?.addEventListener("change", recalc);

    // if query has vehicleId, prefill odometer & nextOil
    const { params: ps } = parseHash();
    const vId = ps.get("vehicleId");
    if (vId) {
      const v = await dbAPI.get("vehicles", vId);
      if (v?.odometer) cur.value = String(v.odometer);
      if (v?.nextOilOdo) next.value = String(v.nextOilOdo);
      if (v?.odometer && !v?.nextOilOdo) recalc();
    }
  }
}

/* ------------------------ Global Events ------------------------ */
document.addEventListener("click", async (e) => {
  const t = e.target;

  // Modal open/close
  if (t?.id === "btnNew") return $("#modal").classList.remove("hidden");
  if (t?.id === "modalClose") return $("#modal").classList.add("hidden");
  if (t?.id === "modal") return $("#modal").classList.add("hidden");

  // Quick actions
  const q = t?.dataset?.quick;
  if (q) {
    $("#modal").classList.add("hidden");
    if (q === "checkin") location.hash = "#/checkin";
    if (q === "oil") location.hash = "#/oil";
    if (q === "appointment") return createAppointment();
    if (q === "expense") return createExpense();
    if (q === "customer") return createCustomer();
    if (q === "vehicle") return createVehicle();
    if (q === "employee") return createEmployee();
    if (q === "part") return createPart();
  }

  // Sidebar mobile toggle
  if (t?.id === "btnMenu") return $("#sidebar").classList.toggle("open");

  // Auth
  if (t?.id === "btnAuth") return (location.hash = "#/auth");

  const act = t?.dataset?.act;
  const id = t?.dataset?.id;
  const idx = t?.dataset?.idx;

  // More: save garage info (print header)
  if (act === "saveShop") {
    const name = ($("#shopName")?.value || "").trim();
    const phone = ($("#shopPhone")?.value || "").trim();
    const address = ($("#shopAddress")?.value || "").trim();
    setShop({ name: name || DEFAULT_SHOP.name, phone, address });
    toast("تم حفظ بيانات الكراج ✅");
    return;
  }

  // Auth: cloud scope (root vs users/{uid})
  if (act === "setCloudScope") {
    const v = $("#cloudScopeSelect")?.value || "root";
    Settings.set("cloudScope", v);
    toast("تم حفظ مسار السحابة ✅");
    renderRoute();
    return;
  }


  if (act === "newCustomer") return createCustomer();
  if (act === "editCustomer") return editCustomer(id);
  if (act === "deleteCustomer") return deleteCustomer(id);
  if (act === "newVehicle") return createVehicle();
  if (act === "newVehicleForCustomer") return createVehicle(id);
  if (act === "editVehicle") return editVehicle(id);
  if (act === "deleteVehicle") return deleteVehicle(id);

  // Appointments
  if (act === "newAppointment") return createAppointment();
  if (act === "newAppointmentForVehicle") return createAppointment({ vehicleId: id });
  if (act === "editAppointment") return editAppointment(id);
  if (act === "delAppointment") return deleteAppointment(id);
  if (act === "apToOrder") return appointmentToOrder(id);

  // Expenses
  if (act === "newExpense") return createExpense();
  if (act === "editExpense") return editExpense(id);
  if (act === "delExpense") return deleteExpense(id);

  // Attachments
  if (act === "addAttachment") return addAttachment(t.dataset.type, t.dataset.entity, t.dataset.kind);
  if (act === "delAttachment") return deleteAttachment(id);
  if (act === "viewAttachment") return viewAttachment(id);

  // Roles
  if (act === "createInvite") return createInvite();
  if (act === "revokeInvite") return revokeInvite(id);
  if (act === "saveUserRole") return saveUserRole(id);

  if (act === "newEmployee") return createEmployee();
  if (act === "editEmployee") return editEmployee(id);
  if (act === "toggleEmployee") return toggleEmployee(id);
  if (act === "deleteEmployee") return deleteEmployee(id);

  if (act === "newPart") return createPart();
  if (act === "stockAdd") return adjustStock(id, +1);
  if (act === "stockSub") return adjustStock(id, -1);
  if (act === "deletePart") return deletePart(id);

  if (act === "createWO") return createWorkOrderFromCheckin();
  if (act === "deleteWO") return deleteWorkOrder(id);
  if (act === "makeInvoice") return createInvoiceForWO(id);

  if (act === "invoicePay") return payInvoice(id);
  if (act === "deleteInvoice") return deleteInvoice(id);
  if (act === "printInvoice") return printInvoiceById(id);

  // Print Work Order
  if (act === "printWO") return printWorkOrderById(id);

  // Inventory scanner
  if (act === "scanInventory") {
    const txt = await scanWithCamera();
    if (txt) {
      let q = String(txt).trim();
      try {
        const obj = JSON.parse(q);
        q = obj.sku || obj.SKU || obj.partId || obj.id || q;
      } catch {}
      state.search = String(q).trim();
      const gs = $("#globalSearch");
      if (gs) gs.value = state.search;
      await renderRoute();
    }
    return;
  }

  // Excel
  if (act === "excelExport") return excelExport(btn.dataset.kind);
  if (act === "excelImport") {
    const kind = $("#excelKind")?.value || "customers";
    const file = $("#excelFile")?.files?.[0];
    return excelImport(kind, file);
  }
  if (act === "excelImportParts") {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".xlsx,.xls";
    inp.click();
    inp.onchange = async () => {
      const file = inp.files?.[0];
      if (file) await excelImport("parts", file);
    };
    return;
  }

  // Dedupe merge
  if (act === "mergeDupPhone") {
    const phoneKey = btn.dataset.phone || "";
    const customers = await dbAPI.getAll("customers");
    const group = customers.filter(c => digitsOnly(normalizePhone(c.phone)) === phoneKey);
    if (group.length < 2) return toast("ماكو مكررات بهالرقم", "warn");

    const out = await formModal({
      title: "دمج مكررات",
      subtitle: "اختاري الحساب الرئيسي (الآخرين ينحذفون بعد نقل البيانات).",
      submitText: "دمج",
      fields: [
        { name: "master", label: "الحساب الرئيسي", type: "select",
          options: group.map(c => ({ value: c.id, label: `${c.name} (${c.id})` })),
          default: group[0].id
        },
      ],
      initial: { master: group[0].id },
    });
    if (!out) return;
    const masterId = out.master;
    const otherIds = group.map(c => c.id).filter(x => x !== masterId);
    const ok = confirm(`تأكيد الدمج؟\\nالرئيسي: ${masterId}\\nسيتم دمج ${otherIds.length} حساب/حسابات ثم حذفها.`);
    if (!ok) return;

    await mergeCustomers(masterId, otherIds);
    toast("تم الدمج ✅");
    await renderRoute();
    return;
  }

  // Messaging (WhatsApp / SMS)
  if (act === "msgAppt") {
    const ap = await dbAPI.get("appointments", id);
    if (!ap) return;
    const c = await dbAPI.get("customers", ap.customerId);
    const v = await dbAPI.get("vehicles", ap.vehicleId);
    return sendMessageFlow({ title: "تذكير موعد", phone: c?.phone || "", text: tplAppointmentReminder(ap, c, v) });
  }

  if (act === "msgCarReady") {
    const wo = await dbAPI.get("workOrders", id);
    if (!wo) return;
    const c = await dbAPI.get("customers", wo.customerId);
    const v = await dbAPI.get("vehicles", wo.vehicleId);
    return sendMessageFlow({ title: "جاهزية السيارة", phone: c?.phone || "", text: tplCarReady(wo, c, v) });
  }

  if (act === "msgPaymentWO") {
    const wo = await dbAPI.get("workOrders", id);
    if (!wo) return;
    const inv = (await dbAPI.getAll("invoices")).find(x => x.workOrderId === wo.id) || null;
    if (!inv) return toast("لا توجد فاتورة لهذا الأمر", "warn");
    const c = await dbAPI.get("customers", wo.customerId);
    const v = await dbAPI.get("vehicles", wo.vehicleId);
    return sendMessageFlow({ title: "متبقي الدفع", phone: c?.phone || "", text: tplPaymentReminder(inv, wo, c, v) });
  }

  if (act === "msgPaymentInv") {
    const inv = await dbAPI.get("invoices", id);
    if (!inv) return;
    const wo = await dbAPI.get("workOrders", inv.workOrderId);
    const c = wo ? await dbAPI.get("customers", wo.customerId) : null;
    const v = wo ? await dbAPI.get("vehicles", wo.vehicleId) : null;
    return sendMessageFlow({ title: "متبقي الدفع", phone: c?.phone || "", text: tplPaymentReminder(inv, wo, c, v) });
  }

  // Auth / Cloud
  if (act === "authSignIn") {
    const email = $("#authEmail")?.value?.trim();
    const pass = $("#authPass")?.value;
    if (!email || !pass) return toast("اكتبي البريد وكلمة المرور", "warn");

    const ok = await startAuthListenerIfNeeded();
    if (!ok) return toast("تعذر تحميل Firebase (CORB/شبكة). اشتغلي محلي حالياً.", "bad", 5200);

    try {
      await signInWithEmailAndPassword(auth, email, pass);
      toast("تم تسجيل الدخول ✅");
      if (Settings.get("storageMode", "local") === "firebase") toast("السحابة جاهزة ✅");
      renderRoute();
    } catch (e) {
      toast("فشل تسجيل الدخول: " + (e?.message || ""), "bad", 4500);
    }
    return;
  }

  if (act === "authSignUp") {
    const email = $("#authEmail")?.value?.trim();
    const pass = $("#authPass")?.value;
    if (!email || !pass) return toast("اكتبي البريد وكلمة المرور", "warn");

    const ok = await startAuthListenerIfNeeded();
    if (!ok) return toast("تعذر تحميل Firebase (CORB/شبكة). اشتغلي محلي حالياً.", "bad", 5200);

    try {
      await createUserWithEmailAndPassword(auth, email, pass);
      toast("تم إنشاء الحساب ✅");
      renderRoute();
    } catch (e) {
      toast("فشل إنشاء الحساب: " + (e?.message || ""), "bad", 4500);
    }
    return;
  }

  if (act === "authSignOut") {
    const ok = await startAuthListenerIfNeeded();
    if (!ok) return toast("Firebase غير متاح حالياً (شبكة).", "warn", 4200);

    await signOut(auth).catch(() => {});
    toast("تم تسجيل الخروج");
    renderRoute();
    return;
  }

  if (act === "useCloud") {
    const ok = await dbAPI.setMode("firebase");
    if (!ok) return toast("تعذر تفعيل السحابة لأن Firebase محجوب/غير متاح (CORB).", "bad", 5200);

    toast(authState.user ? "تم تفعيل السحابة" : "اختيار السحابة (سجلي دخول)" , authState.user ? "ok" : "warn");
    renderRoute();
    return;
  }
  if (act === "useLocal") {
    await dbAPI.setMode("local");
    toast("تم التحويل للمحلي");
    renderRoute();
    return;
  }
  if (act === "syncUp") {
    if (!confirm("رفع المحلي للسحابة سيستبدل بيانات السحابة الحالية. متأكدة؟")) return;
    try {
      await syncLocalToCloud();
      toast("تم الرفع للسحابة ✅");
    } catch (e) {
      toast("فشل الرفع: " + (e?.message || ""), "bad", 4500);
    }
    return;
  }
  if (act === "syncDown") {
    if (!confirm("تنزيل السحابة للمحلي سيستبدل بيانات المحلي الحالية. متأكدة؟")) return;
    try {
      await syncCloudToLocal();
      toast("تم التنزيل للمحلي ✅");
      renderRoute();
    } catch (e) {
      toast("فشل التنزيل: " + (e?.message || ""), "bad", 4500);
    }
    return;
  }

  if (act === "export") return exportAll();
  if (act === "import") return importAll();
  if (act === "reset") return resetAll();

  if (act === "saveOil") return createOilChangeInvoice();

  // Order detail actions (selects)
  if (act === "setStatus") {
    const select = t;
    return setOrderStatus(id, select.value);
  }
  if (act === "setEmployee") {
    const select = t;
    return setOrderEmployee(id, select.value);
  }

  if (act === "addLabor") return addLaborLine(id);
  if (act === "removeLabor") return removeLaborLine(id, Number(idx));

  if (act === "addPartToWO") {
    const partId = $("#odPart").value;
    const qty = $("#odQty").value;
    if (!partId) return alert("اختاري قطعة.");
    return addPartLine(id, partId, qty);
  }
  if (act === "removePartLine") return removePartLine(id, Number(idx));
});

$("#globalSearch").addEventListener("input", () => {
  state.search = $("#globalSearch").value || "";
  const r = parseHash().route;
  // rerender for pages where search makes sense
  if (["orders","customers","vehicles","inventory","appointments","expenses"].includes(r)) renderRoute();
});

$("#btnSeed").addEventListener("click", seedDemo);
window.addEventListener("hashchange", () => { $("#sidebar").classList.remove("open"); renderRoute(); });

/* ------------------------ Init ------------------------ */
(async function init() {
  await openDB();
  await ensureRole();

  // Firebase (اختياري): ما نخليه ينزل عند تشغيل الصفحة حتى لا يطيح التطبيق إذا الشبكة تمنع gstatic.
  // إذا احتجتي السحابة/تسجيل الدخول: من صفحة "الحساب" راح نحاول تحميل Firebase وتشغيل مستمع الدخول.

  if (!location.hash) location.hash = "#/dashboard";
  renderRoute();
})();