/* نظام حسن الوليم RPM - V7 (Cloud only + Activity Log)
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
let firebaseBlocked = false;

// Functions holders (نخلي نفس أسماء الدوال حتى باقي الكود ما يتغير)
let initializeApp;
let getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, setPersistence, browserSessionPersistence;
let initializeFirestore, collection, doc, getDoc, getDocs, setDoc, deleteDoc, writeBatch, query, where, orderBy, limit;
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
        browserSessionPersistence,
      } = authMod);

      ({
        initializeFirestore,
        collection,
        doc,
        getDoc,
        getDocs,
        setDoc,
        deleteDoc,
        writeBatch,
        query,
        where,
        orderBy,
        limit,
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

      // Cloud-only: بدون Cache دائم (بدون IndexedDB) — ذاكرة فقط
      firestore = initializeFirestore(firebaseApp, {});

      storage = getStorage(firebaseApp);

      // Cloud-only: نخلي جلسة (Session) حتى ما نخزن دائم
      setPersistence(auth, browserSessionPersistence).catch(() => {});

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

    if (!u) {
      state.role = "pending";
      state.employeeId = "";
      applyNavPermissions();
      if (location.hash !== "#/auth") location.hash = "#/auth";
      return;
    }

    await ensureRole();
    await loadShopFromCloud();
    applyNavPermissions();

    // بعد تسجيل الدخول
    if (!location.hash || location.hash === "#" || location.hash === "#/auth") location.hash = "#/dashboard";
    renderRoute();
  });

  _authListenerStarted = true;
  return true;
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ------------------------ IndexedDB ------------------------ */
const DB_NAME = "alwaleem_rpm_db";
// DB schema bump: add fluids + fluidMoves
const DB_VER = 5;

const stores = {
  customers: "id",
  vehicles: "id",
  workOrders: "id",
  parts: "id",
  // سوائل (باللتر)
  fluids: "id",
  // حركات السوائل (صرف/إضافة/تصحيح)
  fluidMoves: "id",
  invoices: "id",
  employees: "id",
  appointments: "id",
  expenses: "id",
  attachments: "id",
  rbacUsers: "id",
  rbacInvites: "id",
  customPages: "id",
  customData: "id",
  activity: "id",
  appSettings: "id",
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
  return state.shop || DEFAULT_SHOP;
}
async function loadShopFromCloud() {
  try {
    const s = await dbAPI.get('appSettings', 'shop');
    if (s) {
      const { id, ...rest } = s;
      state.shop = { ...DEFAULT_SHOP, ...rest };
    } else {
      state.shop = { ...DEFAULT_SHOP };
    }
  } catch {
    state.shop = { ...DEFAULT_SHOP };
  }
}
async function setShop(patch) {
  const cur = getShop();
  const next = { ...cur, ...patch };
  state.shop = next;
  try {
    await dbAPI.put('appSettings', { id: 'shop', ...next }, { note: 'Update shop info' });
  } catch {}
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
  activity: "activity",
  appSettings: "settings",
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

const CLOUD_ROOT_ONLY_STORES = new Set(["rbacUsers","rbacInvites","activity","appSettings"]);

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
  return !!authState.user;
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



// Firestore لا يقبل undefined. ننظف أي قيم undefined/NaN قبل الكتابة.
function _fsCleanValue(v) {
  if (v === undefined) return undefined;
  if (typeof v === "number" && !Number.isFinite(v)) return null;

  if (Array.isArray(v)) {
    const arr = v.map(_fsCleanValue).filter(x => x !== undefined);
    return arr;
  }

  if (v && typeof v === "object") {
    // Preserve Date and non-plain objects (مثل Firebase FieldValue)
    if (v instanceof Date) return v;
    const proto = Object.getPrototypeOf(v);
    const isPlain = (proto === Object.prototype || proto === null);
    if (!isPlain) return v;

    const out = {};
    for (const [k, val] of Object.entries(v)) {
      const cleaned = _fsCleanValue(val);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }

  return v;
}

function _fsSanitize(data) {
  const cleaned = _fsCleanValue(data);
  return cleaned === undefined ? {} : cleaned;
}

async function fsPut(store, obj) {
  /* ORIGINAL (قبل تصحيح root/user + mapping):
    const base = userPath();
    if (!base) throw new Error("NO_AUTH");
    const ref = doc(firestore, `${base}/${store}/${obj.id}`);
    const payload = _fsSanitize(obj);
  await setDoc(ref, payload, { merge: false });
    return true;
  */
  const colPath = cloudColPath(store);
  if (!colPath) throw new Error("NO_AUTH");
  const ref = doc(firestore, `${colPath}/${obj.id}`);
  const payload = _fsSanitize(obj);
  await setDoc(ref, payload, { merge: false });
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

/* ======================== SYSTEM 4: Unified Data API (Cloud Only + Activity Log) ======================== */

function _truncateForLog(obj, maxLen = 5000) {
  try {
    if (obj == null) return null;
    const s = JSON.stringify(obj);
    if (s.length <= maxLen) return obj;
    return { _truncated: true, preview: s.slice(0, maxLen) };
  } catch {
    return { _truncated: true, preview: String(obj).slice(0, maxLen) };
  }
}

function _extractActivityRefs(store, entityId, before, after) {
  const s = String(store || "");
  const obj = after || before || {};
  const refs = {};

  if (s === "customers") {
    refs.customerId = entityId;
  }

  if (s === "vehicles") {
    refs.vehicleId = entityId;
    if (obj.customerId) refs.customerId = obj.customerId;
  }

  if (s === "workOrders") {
    refs.workOrderId = entityId;
    if (obj.customerId) refs.customerId = obj.customerId;
    if (obj.vehicleId) refs.vehicleId = obj.vehicleId;
  }

  if (s === "invoices") {
    refs.invoiceId = entityId;
    if (obj.workOrderId) refs.workOrderId = obj.workOrderId;
    if (obj.customerId) refs.customerId = obj.customerId;
    if (obj.vehicleId) refs.vehicleId = obj.vehicleId;
  }

  if (s === "appointments") {
    refs.appointmentId = entityId;
    if (obj.customerId) refs.customerId = obj.customerId;
    if (obj.vehicleId) refs.vehicleId = obj.vehicleId;
  }

  if (s === "attachments") {
    refs.attachmentId = entityId;
    if (obj.entityType === "vehicle") refs.vehicleId = obj.entityId;
    if (obj.entityType === "customer") refs.customerId = obj.entityId;
    if (obj.entityType === "workOrder") refs.workOrderId = obj.entityId;
  }

  if (s === "expenses") refs.expenseId = entityId;
  if (s === "parts") refs.partId = entityId;
  if (s === "employees") refs.employeeId = entityId;

  return refs;
}

async function writeActivity({ action, store, entityId = "", before = null, after = null, note = "" } = {}) {
  try {
    if (!authState.user) return;
    if (store === "activity") return;

    const id = "act_" + uid().slice(3);
    const refs = _extractActivityRefs(store, entityId, before, after);

    const entry = {
      id,
      ts: Date.now(),
      uid: authState.user.uid,
      email: authState.user.email || "",
      action: String(action || "UPDATE").toUpperCase(),
      store: String(store || ""),
      entityId: String(entityId || ""),
      // shortcuts for fast filtering
      vehicleId: refs.vehicleId || "",
      customerId: refs.customerId || "",
      refs,
      before: before ? _truncateForLog(before) : null,
      after: after ? _truncateForLog(after) : null,
      note: String(note || "").slice(0, 300),
    };

    await cloudAPI.put("activity", entry);
  } catch (e) {
    console.warn("activity log failed:", e);
  }
}

const dbAPI = {
  // Cloud-only
  getAll: (store) => cloudAPI.getAll(store),
  get: (store, key) => cloudAPI.get(store, key),

  // Raw ops (بدون لوق) — مفيدة للاستيراد
  putRaw: (store, obj) => cloudAPI.put(store, obj),
  delRaw: (store, key) => cloudAPI.del(store, key),
  clearRaw: (store) => cloudAPI.clear(store),

  // Ops مع Activity Log
  put: async (store, obj, meta = {}) => {
    const silent = !!meta.silent;
    if (silent || store === "activity") return cloudAPI.put(store, obj);
    const before = await cloudAPI.get(store, obj.id).catch(() => null);
    const action = before ? "UPDATE" : "CREATE";
    await cloudAPI.put(store, obj);
    await writeActivity({ action, store, entityId: obj.id, before, after: obj, note: meta.note || "" });
    return true;
  },
  del: async (store, key, meta = {}) => {
    const silent = !!meta.silent;
    if (silent || store === "activity") return cloudAPI.del(store, key);
    const before = await cloudAPI.get(store, key).catch(() => null);
    await cloudAPI.del(store, key);
    await writeActivity({ action: "DELETE", store, entityId: key, before, after: null, note: meta.note || "" });
    return true;
  },
  clear: async (store, meta = {}) => {
    const silent = !!meta.silent;
    if (silent) return cloudAPI.clear(store);
    // ما نحتفظ بكل الداتا — فقط العدد
    let count = 0;
    try { count = (await cloudAPI.getAll(store)).length; } catch {}
    await cloudAPI.clear(store);
    await writeActivity({ action: "CLEAR", store, entityId: "*", before: { count }, after: null, note: meta.note || "" });
    return true;
  },
};

/* ------------------------ State & Router ------------------------ */
const state = {
  route: "dashboard",
  search: "",
  role: "admin",
  employeeId: "",
  shop: { ...DEFAULT_SHOP },
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
  admin: ["*","activity"],
  accountant: ["dashboard","orders","workboard","order","customers","customer","vehicles","vehicle","invoices","reports","reportfull","expenses","backup","dedupe","custom","more","auth","activity"],
  reception: ["dashboard","checkin","appointments","orders","workboard","order","customers","customer","vehicles","vehicle","invoices","custom","more","auth","activity"],
  technician: ["dashboard","appointments","orders","workboard","order","customers","customer","vehicles","vehicle","custom","more","auth","activity"],
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
  // Cloud-only: بدون حساب = pending
  if (!authState.user) {
    state.role = 'pending';
    state.employeeId = '';
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
    reportfull: "reports",
    pagebuilder: "more",
    custom: "more",
  };
  return map[route] || route;
}

function setTitle(route) {
  const map = {
    dashboard: "لوحة التحكم",
    checkin: "الاستقبال",
    appointments: "المواعيد",
    orders: "أوامر الشغل",
    workboard: "لوحة الورشة",
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
    reportfull: "تقرير كامل",
    pagebuilder: "إدارة الصفحات",
    custom: "صفحة مخصصة",
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

function downloadBlob(filename, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
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
function appBaseURL() {
  try {
    let p = location.pathname || "/";
    // GitHub Pages ممكن يكون /repo/ أو /repo/index.html
    if (!p.endsWith("/")) {
      const i = p.lastIndexOf("/");
      if (i >= 0) p = p.slice(0, i + 1);
    }
    return location.origin + p;
  } catch {
    return "";
  }
}

function vehicleDeepLink(vehicleId) {
  return `${appBaseURL()}#/vehicle?id=${encodeURIComponent(vehicleId || "")}`;
}

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
  toast("تم سحب نسخة حالية Excel ✅");
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
  await writeActivity({ action: "PRINT", store: "workOrders", entityId: wo.id, before: null, after: { mode }, note: "Print work order" });
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

/* ======================== Fluids (Liters Stock) ======================== */

function fluidCatLabel(cat){
  if (cat === "engine") return "زيت محرك";
  if (cat === "gear") return "زيت كير";
  if (cat === "coolant") return "ماء/سائل راديتور";
  return "سائل";
}

function fmtLiters(x){
  const n = Number(x||0);
  if (!isFinite(n)) return "0";
  // نخلي 2 منازل بس نخفي الزيرو الزايد
  const s = n.toFixed(2);
  return s.replace(/\.00$/," ").trim().replace(/(\.[0-9])0$/,"$1");
}

async function createFluid() {
  const v = await formModal({
    title: "مادة سائل جديدة (باللتر)",
    subtitle: "زيت/كير/راديتور — الرصيد يُحسب باللتر",
    fields: [
      { name: "category", label: "النوع", type: "select", required: true,
        options: [
          { value: "engine", label: "زيت محرك" },
          { value: "gear", label: "زيت كير" },
          { value: "coolant", label: "ماء/سائل راديتور" },
        ],
        default: "engine",
      },
      { name: "name", label: "الاسم التجاري/الوصف", required: true, placeholder: "Mobil 1 / Toyota Coolant..." },
      { name: "spec", label: "المواصفة/اللزوجة (اختياري)", placeholder: "5W-30 / ATF Dexron VI / Red" },
      { name: "sku", label: "SKU (اختياري)" },
      { name: "buyPerLiter", label: "سعر الشراء للتر", type: "number", cast: "number" },
      { name: "sellPerLiter", label: "سعر البيع للتر", type: "number", cast: "number" },
      { name: "liters", label: "الرصيد الحالي (لتر)", type: "number", cast: "number" },
      { name: "minLiters", label: "الحد الأدنى (لتر)", type: "number", cast: "number" },
    ],
  });
  if (!v) return;
  const f = {
    id: "fl_" + uid().slice(3),
    category: String(v.category||"engine"),
    name: (v.name||"").trim(),
    spec: (v.spec||"").trim(),
    sku: (v.sku||"").trim(),
    buyPerLiter: Number(v.buyPerLiter||0),
    sellPerLiter: Number(v.sellPerLiter||0),
    liters: Number(v.liters||0),
    minLiters: Number(v.minLiters||0),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await dbAPI.put("fluids", f, { note: "إضافة مادة سائل" });
  toast("تمت إضافة المادة ✅");
  renderRoute();
}

async function adjustFluidLiters(fluidId, deltaSign) {
  const f = await dbAPI.get("fluids", fluidId);
  if (!f) return;

  const v = await formModal({
    title: deltaSign > 0 ? "إضافة مخزون (لتر)" : "صرف مخزون (لتر)",
    subtitle: `${fluidCatLabel(f.category)} • ${(f.name||"").trim()} ${f.spec? "• "+f.spec:""}`,
    fields: [
      { name: "liters", label: deltaSign > 0 ? "كم لتر تضيفين؟" : "كم لتر تصرفين؟", type: "number", cast: "number", required: true, default: 1 },
      { name: "note", label: "ملاحظة (اختياري)", placeholder: "شراء/تصحيح/صرف يدوي..." },
    ],
    submitText: "تطبيق",
  });
  if (!v) return;
  const liters = Number(v.liters||0);
  if (!liters || liters <= 0) return;

  const before = Number(f.liters||0);
  const after = before + (deltaSign>0 ? liters : -liters);
  if (after < -1e-9) return toast("ما يصير الرصيد يصير سالب.", "bad");

  f.liters = Math.max(0, after);
  f.updatedAt = Date.now();
  await dbAPI.put("fluids", f, { note: "تحديث مخزون سائل" });

  const mv = {
    id: "fm_" + uid().slice(3),
    fluidId: f.id,
    category: f.category,
    action: deltaSign>0 ? "ADD" : "ISSUE",
    liters,
    before,
    after: f.liters,
    note: (v.note||"").trim(),
    createdAt: Date.now(),
    by: authState.user?.uid || "",
  };
  await dbAPI.put("fluidMoves", mv, { note: "حركة سائل" });

  toast("تم تحديث مخزون السوائل ✅");
  renderRoute();
}

async function deleteFluid(fluidId) {
  if (!confirm("حذف مادة السائل؟")) return;
  await dbAPI.del("fluids", fluidId);
  toast("تم الحذف");
  renderRoute();
}

async function consumeFluidsFromInvoice(invoiceId) {
  // يخصم السوائل من عناصر الفاتورة اللي kind=fluid
  const inv = await dbAPI.get("invoices", invoiceId);
  if (!inv) return;

  const items = Array.isArray(inv.items) ? inv.items : [];
  const fluidItems = items.filter(it => String(it.kind||"") === "fluid" && it.fluidId);
  if (!fluidItems.length) return;

  for (const it of fluidItems) {
    const f = await dbAPI.get("fluids", it.fluidId);
    if (!f) continue;
    const liters = Number(it.qty||0);
    if (!liters || liters <= 0) continue;

    const before = Number(f.liters||0);
    const after = before - liters;
    if (after < -1e-9) {
      // إذا ماكو رصيد كافي، ما نوقف العملية (حتى ما نخسر الفاتورة)، بس نسجل ملاحظة.
      await writeActivity({ action: "WARN", store: "fluids", entityId: f.id, note: `رصيد غير كافي لصرف ${liters}L من ${f.name}` });
      continue;
    }

    f.liters = Math.max(0, after);
    f.updatedAt = Date.now();
    await dbAPI.put("fluids", f, { note: `صرف تلقائي من فاتورة ${invoiceId}` });

    const mv = {
      id: "fm_" + uid().slice(3),
      fluidId: f.id,
      category: f.category,
      action: "ISSUE",
      liters,
      before,
      after: f.liters,
      invoiceId,
      workOrderId: inv.workOrderId,
      vehicleId: inv.vehicleId,
      customerId: inv.customerId,
      note: "صرف تلقائي من تبديل/خدمة سوائل",
      createdAt: Date.now(),
      by: authState.user?.uid || "",
    };
    await dbAPI.put("fluidMoves", mv, { note: "حركة سائل" });
  }
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
    stage: "new",
    stageUpdatedAt: now,
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
    customerId: wo.customerId,
    vehicleId: wo.vehicleId,
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
  await writeActivity({ action: "PRINT", store: "invoices", entityId: inv.id, before: null, after: { mode }, note: "Print invoice" });
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

  // New: خدمة سوائل حسب اللتر (اختياري)
  const serviceKind = ($("#oilServiceKind")?.value || "engine").trim();
  const fluidId = ($("#oilFluidId")?.value || "").trim();
  const litersUsed = Number($("#oilLiters")?.value || 0);

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
    complaint: serviceKind === "engine" ? "تبديل دهن" : (serviceKind === "gear" ? "تبديل زيت كير" : "خدمة راديتور"),
    odometer: currentOdo,
    status: "DONE",
    createdAt: now,
    updatedAt: now,
    partLines: [],
    laborLines: [],
  };

  // Items
  const items = [];

  // 1) Fluid item (preferred)
  if (fluidId && litersUsed > 0) {
    const f = await dbAPI.get("fluids", fluidId);
    if (f) {
      const unit = Number(f.sellPerLiter || 0);
      const total = litersUsed * unit;
      const nm = `${fluidCatLabel(serviceKind)}: ${f.name}${f.spec ? " " + f.spec : ""}`.trim();
      items.push({ name: nm, qty: litersUsed, unit, total, kind: "fluid", fluidId: f.id, category: serviceKind, uom: "L" });
    }
  }

  // 2) Legacy manual oil price (fallback)
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
    customerId: wo.customerId,
    vehicleId: wo.vehicleId,
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

  // ✅ خصم السوائل (باللتر) إذا الفاتورة تحتوي fluid items
  await consumeFluidsFromInvoice(inv.id);

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
  const includeActivity = $("#includeActivity") ? !!$("#includeActivity").checked : true;
  const BACKUP_STORES = Object.keys(stores).filter(s => includeActivity ? true : !["activity"].includes(s));
  const data = {};
  for (const s of BACKUP_STORES) data[s] = await dbAPI.getAll(s);
  data._meta = { exportedAt: Date.now(), app: "نظام حسن الوليم RPM", cloudOnly: true, includeActivity };
  downloadText(`alwaleem_rpm_cloud_backup_${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(data, null, 2));
  await writeActivity({ action: "EXPORT", store: "backup", entityId: "cloud", before: null, after: { stores: BACKUP_STORES.length, includeActivity }, note: "Export JSON" });
}

async function importAll() {
  const file = $("#importFile").files?.[0];
  if (!file) return alert("اختاري ملف JSON أولاً.");
  const txt = await readFileAsText(file);
  let data;
  try { data = JSON.parse(txt); } catch { return alert("ملف غير صالح."); }

  if (!confirm("راح يتم استبدال كل بيانات السحابة الحالية. متابعة؟")) return;

  const includeActivity = $("#includeActivity") ? !!$("#includeActivity").checked : true;
  const BACKUP_STORES = Object.keys(stores).filter(s => includeActivity ? true : !["activity"].includes(s));

  // امسح (بدون لوق لكل سجل)
  for (const s of BACKUP_STORES) await dbAPI.clearRaw(s);

  // استيراد (بدون لوق لكل سجل)
  for (const s of BACKUP_STORES) {
    const arr = Array.isArray(data[s]) ? data[s] : [];
    for (const obj of arr) await dbAPI.putRaw(s, obj);
  }

  await writeActivity({ action: "IMPORT", store: "backup", entityId: "cloud", before: null, after: { stores: BACKUP_STORES.length, includeActivity }, note: "Import JSON" });

  alert("تم الاستيراد ✅");
  renderRoute();
}

async function resetAll() {
  if (!confirm("تأكيد حذف كل بيانات السحابة؟")) return;
  const includeActivity = $("#includeActivity") ? !!$("#includeActivity").checked : true;
  const BACKUP_STORES = Object.keys(stores).filter(s => includeActivity ? true : !["activity"].includes(s));
  for (const s of BACKUP_STORES) await dbAPI.clear(s, { note: "Reset all" });
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

async function viewCheckin(params) {
  params = params || new URLSearchParams();

  const customers = await dbAPI.getAll("customers");
  const vehicles = await dbAPI.getAll("vehicles");
  const employees = (await dbAPI.getAll("employees")).filter(e => e.active);

  const preCustomerId = (params.get("customerId") || "").trim();
  const preVehicleId = (params.get("vehicleId") || "").trim();
  const preEmployeeId = (params.get("employeeId") || "").trim();

  let preOdometer = (params.get("odometer") || "").trim();
  if (!preOdometer && preVehicleId) {
    const vv = vehicles.find(x => x.id === preVehicleId);
    if (vv && vv.odometer != null) preOdometer = String(vv.odometer);
  }

  const custOptions = customers
    .sort((a,b)=> (a.name||"").localeCompare(b.name||"", "ar"))
    .map(c => `<option value="${c.id}" ${(c.id===preCustomerId) ? "selected" : ""}>${escapeHtml(c.name)} ${c.phone? "• "+escapeHtml(c.phone):""}</option>`)
    .join("");

  const vehOptions = vehicles
    .sort((a,b)=> (a.plate||"").localeCompare(b.plate||"", "ar"))
    .map(v => `<option value="${v.id}" ${(v.id===preVehicleId) ? "selected" : ""}>${escapeHtml(v.plate || "—")} • ${escapeHtml([v.make,v.model,v.year].filter(Boolean).join(" "))}</option>`)
    .join("");

  const empOptions = employees
    .sort((a,b)=> (a.name||"").localeCompare(b.name||"", "ar"))
    .map(e => `<option value="${e.id}" ${(e.id===preEmployeeId) ? "selected" : ""}>${escapeHtml(e.name)} • ${escapeHtml(e.specialty || "—")}</option>`)
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
          <input id="ciOdometer" class="input" inputmode="numeric" placeholder="150000" value="${escapeHtml(preOdometer)}" />
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


async function viewWorkBoard(params) {
  const STAGES = [
    { key: "new", label: "جديد" },
    { key: "inspect", label: "قيد الفحص" },
    { key: "waiting_parts", label: "بانتظار قطع" },
    { key: "in_progress", label: "قيد العمل" },
    { key: "ready", label: "جاهز" },
    { key: "delivered", label: "تم التسليم" },
  ];

  const showDelivered = params?.get("show") === "1";
  const workOrders = await dbAPI.getAll("workOrders");
  const customers = await dbAPI.getAll("customers");
  const vehicles = await dbAPI.getAll("vehicles");
  const invoices = await dbAPI.getAll("invoices");
  const employees = await dbAPI.getAll("employees");

  const cMap = new Map(customers.map(c => [c.id, c]));
  const vMap = new Map(vehicles.map(v => [v.id, v]));
  const eMap = new Map(employees.map(e => [e.id, e]));
  const invByWO = new Map();
  for (const inv of invoices) {
    if (!inv.workOrderId) continue;
    if (!invByWO.has(inv.workOrderId)) invByWO.set(inv.workOrderId, []);
    invByWO.get(inv.workOrderId).push(inv);
  }

  const list = workOrders
    .map(wo => ({ ...wo, stage: wo.stage || "new" }))
    .filter(wo => showDelivered ? true : wo.stage !== "delivered")
    .sort((a,b) => Number(b.stageUpdatedAt||b.updatedAt||b.createdAt||0) - Number(a.stageUpdatedAt||a.updatedAt||a.createdAt||0));

  const byStage = new Map(STAGES.map(s => [s.key, []]));
  for (const wo of list) {
    if (!byStage.has(wo.stage)) byStage.set(wo.stage, []);
    byStage.get(wo.stage).push(wo);
  }

  const stageCols = STAGES.map(s => {
    const count = (byStage.get(s.key) || []).length;
    const cards = (byStage.get(s.key) || []).map(wo => {
      const c = cMap.get(wo.customerId) || {};
      const v = vMap.get(wo.vehicleId) || {};
      const emp = eMap.get(wo.employeeId) || {};
      const invs = invByWO.get(wo.id) || [];
      const total = invs.reduce((sum,i)=>sum+Number(i.total||0),0);
      const paid = invs.reduce((sum,i)=>sum+Number(i.paid||0),0);
      const remaining = Math.max(0, total - paid);
      const plate = v.plate || v.plateNo || v.plateNumber || "";
      const updated = wo.stageUpdatedAt || wo.updatedAt || wo.createdAt;
      const when = updated ? new Date(updated).toLocaleString("ar-IQ") : "";
      const svc = wo.serviceType === "OIL" ? "دهن" : (wo.serviceType || "عام");
      const title = `#${String(wo.id||"").slice(-6)} • ${c.name||"زبون"} • ${plate||"—"}`;
      return `<div class="kanban-card" draggable="true" data-wo="${escapeHtml(wo.id)}">
        <div class="kanban-card-title">${escapeHtml(title)}</div>
        <div class="kanban-card-meta">
          <span class="badge">${escapeHtml(svc)}</span>
          ${emp.name ? `<span class="badge badge-soft">👷 ${escapeHtml(emp.name)}</span>` : ""}
          ${remaining>0 ? `<span class="badge badge-warn">متبقي ${fmtMoney(remaining)}</span>` : (total>0 ? `<span class="badge badge-ok">مدفوع</span>` : "")}
        </div>
        <div class="kanban-card-foot">
          <span class="muted">${escapeHtml(when)}</span>
          <span class="kanban-actions">
            <button class="btn btn-sm" data-act="openWO" data-id="${escapeHtml(wo.id)}">فتح</button>
            <button class="btn btn-sm" data-act="woMsgReady" data-id="${escapeHtml(wo.id)}">رسالة</button>
          </span>
        </div>
      </div>`;
    }).join("");

    return `<div class="kanban-col" data-stage="${s.key}">
      <div class="kanban-col-head">
        <div class="kanban-col-title">${escapeHtml(s.label)}</div>
        <div class="kanban-col-count">${count}</div>
      </div>
      <div class="kanban-dropzone" data-stage="${s.key}">
        ${cards}
      </div>
    </div>`;
  }).join("");

  return `
  <div class="card">
    <div class="row between wrap gap">
      <div>
        <div class="h2">لوحة الورشة</div>
        <div class="muted">اسحبي الكرت بين الأعمدة لتغيير الحالة. تُعرض الأوامر المفتوحة فقط.</div>
      </div>
      <div class="row gap">
        <label class="row gap small">
          <input type="checkbox" id="wbShowDelivered" ${showDelivered ? "checked" : ""}/>
          <span>إظهار المُسلّمة</span>
        </label>
      </div>
    </div>
  </div>

  <div class="kanban" id="kanban">
    ${stageCols}
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
          <a class="btn" href="#/activity?store=workOrders&id=${encodeURIComponent(wo.id)}">سجل</a>
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

async function viewVehicleDetails(vehicleId, params) {
  params = params || new URLSearchParams();
  const v = await dbAPI.get("vehicles", vehicleId);
  if (!v) return `<div class="card"><div class="notice">ما لقيت السيارة.</div></div>`;

  const tab = String(params.get("tab") || "timeline").toLowerCase();

  const c = v.customerId ? await dbAPI.get("customers", v.customerId) : null;

  const workOrdersAll = await dbAPI.getAll("workOrders");
  const workOrders = workOrdersAll.filter(w => w.vehicleId === v.id).sort((a,b)=> (b.createdAt||0) - (a.createdAt||0));
  const woMap = new Map(workOrdersAll.map(w => [w.id, w]));

  const invoicesAll = await dbAPI.getAll("invoices");
  const invoicesForVehicle = invoicesAll
    .filter(inv => {
      if (!inv) return false;
      if (inv.vehicleId && inv.vehicleId === v.id) return true;
      const wo = woMap.get(inv.workOrderId);
      return wo && wo.vehicleId === v.id;
    })
    .sort((a,b)=> (b.createdAt||0) - (a.createdAt||0));

  const appointmentsAll = await dbAPI.getAll("appointments");
  const appointments = appointmentsAll
    .filter(a => a && a.vehicleId === v.id)
    .sort((a,b)=> (b.whenTs||b.createdAt||0) - (a.whenTs||a.createdAt||0));

  const attachmentsAll = await dbAPI.getAll("attachments");
  const attachments = attachmentsAll
    .filter(a => a && a.entityType === "vehicle" && a.entityId === v.id)
    .sort((a,b)=> (b.createdAt||0) - (a.createdAt||0));

  // activity (optional)
  let activityAll = [];
  try { activityAll = await dbAPI.getAll("activity"); } catch {}
  const isRelAct = (act) => {
    if (!act) return false;
    if (act.vehicleId && act.vehicleId === v.id) return true;
    if (act.refs && act.refs.vehicleId && act.refs.vehicleId === v.id) return true;
    const after = act.after || null;
    const before = act.before || null;
    if (after && after.vehicleId && after.vehicleId === v.id) return true;
    if (before && before.vehicleId && before.vehicleId === v.id) return true;

    // invoices without vehicleId: derive via workOrderId
    if (String(act.store||"") === "invoices") {
      const woId = (after && after.workOrderId) || (before && before.workOrderId) || act.entityId;
      const wo = woMap.get(woId);
      if (wo && wo.vehicleId === v.id) return true;
    }
    // attachments linked to vehicle
    if (String(act.store||"") === "attachments") {
      const a = after || before || {};
      if (a.entityType === "vehicle" && a.entityId === v.id) return true;
    }
    // workOrders
    if (String(act.store||"") === "workOrders") {
      const wo = woMap.get(act.entityId);
      if (wo && wo.vehicleId === v.id) return true;
    }
    return false;
  };
  const activity = (activityAll || []).filter(isRelAct).sort((a,b)=> (b.ts||0) - (a.ts||0));

  const empAll = await dbAPI.getAll("employees");
  const empMap = new Map(empAll.map(e => [e.id, e]));

  // quick meta
  const plate = v.plate || "—";
  const makeLine = [v.make, v.model, v.year].filter(Boolean).join(" ");
  const odo = Number(v.odometer || 0);
  const nextOil = Number(v.nextOilOdo || 0);
  const diffOil = (odo && nextOil) ? (nextOil - odo) : null;

  // tabs
  const mkTab = (k, label) => `<a class="tabbtn ${tab===k ? "active" : ""}" href="#/vehicle?id=${encodeURIComponent(v.id)}&tab=${encodeURIComponent(k)}">${escapeHtml(label)}</a>`;
  const tabs = `
    <div class="tabs">
      ${mkTab("timeline","الخط الزمني")}
      ${mkTab("orders","أوامر الشغل")}
      ${mkTab("invoices","الفواتير")}
      ${mkTab("appointments","المواعيد")}
      ${mkTab("attachments","الصور/المرفقات")}
      ${mkTab("report","تقرير")}
    </div>
  `;

  // timeline build (dedupe basic CREATE events that already exist in activity)
  const createdSet = new Set(
    (activity || [])
      .filter(a => String(a.action||"").toUpperCase() === "CREATE")
      .map(a => `${String(a.store||"")}:${String(a.entityId||"")}`)
  );

  const timelineItems = [];

  for (const w of workOrders) {
    if (createdSet.has(`workOrders:${w.id}`)) continue;
    timelineItems.push({
      ts: w.createdAt || 0,
      kind: "wo",
      title: `فتح أمر شغل`,
      sub: `${escapeHtml(w.complaint || "—")} • ${pill(w.status)}`,
      link: `#/order?id=${encodeURIComponent(w.id)}`
    });
  }

  for (const inv of invoicesForVehicle) {
    if (createdSet.has(`invoices:${inv.id}`)) continue;
    const remaining = Math.max(0, Number(inv.total||0) - Number(inv.paid||0));
    timelineItems.push({
      ts: inv.createdAt || 0,
      kind: (String(inv.invoiceType||"").toUpperCase()==="OIL" ? "oil" : "inv"),
      title: `فاتورة ${inv.invoiceType==="OIL" ? "دهن" : ""}`.trim(),
      sub: `الإجمالي: ${money(inv.total||0)} • المدفوع: ${money(inv.paid||0)} • المتبقي: ${money(remaining)}`,
      link: `#/invoices`
    });
  }

  for (const ap of appointments) {
    if (createdSet.has(`appointments:${ap.id}`)) continue;
    timelineItems.push({
      ts: ap.whenTs || ap.createdAt || 0,
      kind: "ap",
      title: `موعد`,
      sub: `${escapeHtml(ap.title || ap.note || "—")}`,
      link: `#/appointments`
    });
  }

  for (const a of activity.slice(0, 120)) {
    const action = String(a.action||"").toUpperCase();
    const store = String(a.store||"");
    const ts = a.ts || 0;
    const who = a.email ? ` • ${a.email}` : "";
    const note = a.note ? ` • ${a.note}` : "";
    let title = "";
    if (action === "CREATE") title = `إنشاء (${store})`;
    else if (action === "UPDATE") title = `تعديل (${store})`;
    else if (action === "DELETE") title = `حذف (${store})`;
    else if (action === "PRINT") title = `طباعة`;
    else title = `${action} (${store})`;

    timelineItems.push({
      ts,
      kind: "act",
      title,
      sub: `${escapeHtml(a.entityId||"")}${escapeHtml(who)}${escapeHtml(note)}`.trim(),
      link: store === "workOrders" ? `#/order?id=${encodeURIComponent(a.entityId||"")}` :
            store === "invoices" ? `#/invoices` :
            store === "appointments" ? `#/appointments` :
            store === "vehicles" ? `#/vehicle?id=${encodeURIComponent(v.id)}` :
            `#/activity?store=${encodeURIComponent(store)}&id=${encodeURIComponent(a.entityId||"")}`
    });
  }

  timelineItems.sort((x,y)=> (y.ts||0) - (x.ts||0));
  const tl = timelineItems.slice(0, 80);

  const renderTimeline = () => {
    const icon = (k) => ({ wo:"🛠️", inv:"🧾", oil:"🛢️", ap:"📅", act:"🧩" }[k] || "•");
    if (!tl.length) return `<div class="notice">لا يوجد سجل لهذه السيارة بعد.</div>`;
    return `<div class="timeline">
      ${tl.map(it => `
        <div class="titem">
          <div class="t-head">
            <div class="t-left">
              <div class="t-icon">${icon(it.kind)}</div>
              <div>
                <div class="t-title">${escapeHtml(it.title||"")}</div>
                <div class="small">${fmtDate(it.ts)}${it.sub ? " • " : ""}${it.sub || ""}</div>
              </div>
            </div>
            ${it.link ? `<a class="btn btn-soft" href="${it.link}">فتح</a>` : ``}
          </div>
        </div>
      `).join("")}
    </div>`;
  };

  // Orders tab
  const renderOrders = () => {
    if (!workOrders.length) return `<div class="notice">ماكو أوامر شغل للسيارة.</div>`;
    const invByWO = new Map(invoicesAll.map(i => [i.workOrderId, i]));
    return workOrders.map(w => {
      const inv = invByWO.get(w.id);
      const remaining = inv ? Math.max(0, Number(inv.total||0) - Number(inv.paid||0)) : 0;
      return `
        <div class="card subcard" style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
            <div>
              <div style="font-weight:900">${escapeHtml(w.complaint||"—")}</div>
              <div class="small">${escapeHtml(w.id)} • ${fmtDate(w.createdAt)}</div>
              <div class="small">${inv ? `فاتورة: ${money(inv.total||0)} • مدفوع: ${money(inv.paid||0)} • متبقي: ${money(remaining)}` : `لا توجد فاتورة بعد`}</div>
            </div>
            <div>${pill(w.status)}</div>
          </div>

          <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
            <a class="btn" href="#/order?id=${encodeURIComponent(w.id)}">تفاصيل</a>
            <a class="btn" href="#/activity?store=workOrders&id=${encodeURIComponent(w.id)}">سجل</a>
            ${inv ? `
              <button class="btn" data-act="printInvoice" data-id="${inv.id}">طباعة</button>
              <a class="btn" href="#/activity?store=invoices&id=${encodeURIComponent(inv.id)}">سجل الفاتورة</a>
            ` : `
              <button class="btn btn-primary" data-act="makeInvoice" data-id="${w.id}">إنشاء فاتورة</button>
            `}
          </div>
        </div>
      `;
    }).join("");
  };

  // Invoices tab
  const renderInvoices = () => {
    if (!invoicesForVehicle.length) return `<div class="notice">ماكو فواتير مرتبطة بهذه السيارة بعد.</div>`;
    return `
      <table class="table">
        <thead><tr><th>التاريخ</th><th>النوع</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th></th></tr></thead>
        <tbody>
          ${invoicesForVehicle.map(inv => {
            const remaining = Math.max(0, Number(inv.total||0) - Number(inv.paid||0));
            return `<tr>
              <td>${escapeHtml(fmtDay(inv.createdAt||0))}</td>
              <td>${escapeHtml(inv.invoiceType || "—")}</td>
              <td>${money(inv.total||0)}</td>
              <td>${money(inv.paid||0)}</td>
              <td>${money(remaining)}</td>
              <td style="white-space:nowrap">
                <button class="btn" data-act="printInvoice" data-id="${inv.id}">طباعة</button>
                <button class="btn btn-soft" data-act="payInvoice" data-id="${inv.id}">دفع</button>
                <a class="btn" href="#/activity?store=invoices&id=${encodeURIComponent(inv.id)}">سجل</a>
              </td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    `;
  };

  // Appointments tab
  const renderAppointments = () => {
    return `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div>
          <div style="font-weight:900">مواعيد السيارة</div>
          <div class="small">تقدرين تضيفين موعد وتربطيه بالسيارة</div>
        </div>
        <button class="btn btn-primary" data-act="newAppointmentForVehicle" data-id="${escapeHtml(v.id)}">+ موعد</button>
      </div>
      <div class="hr"></div>
      ${appointments.length ? appointments.map(a => `
        <div class="card subcard" style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
            <div>
              <div style="font-weight:900">${escapeHtml(a.title || "موعد")}</div>
              <div class="small">${fmtDate(a.whenTs||a.createdAt||0)} • ${escapeHtml(a.note||"")}</div>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap">
              <button class="btn" data-act="editAppointment" data-id="${escapeHtml(a.id)}">تعديل</button>
              <button class="btn btn-danger" data-act="delAppointment" data-id="${escapeHtml(a.id)}">حذف</button>
              <a class="btn" href="#/activity?store=appointments&id=${encodeURIComponent(a.id)}">سجل</a>
            </div>
          </div>
        </div>
      `).join("") : `<div class="notice">لا توجد مواعيد لهذه السيارة.</div>`}
    `;
  };

  // Attachments tab
  const renderAttachments = () => {
    return `
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div>
          <div style="font-weight:900">الصور / المرفقات</div>
          <div class="small">صور قبل/بعد أو أي ملفات تخص السيارة</div>
        </div>
        <button class="btn btn-primary" data-act="addAttachment" data-type="vehicle" data-kind="other" data-entity="${escapeHtml(v.id)}">+ إضافة</button>
      </div>
      <div class="hr"></div>
      ${attachments.length ? `
        <div class="card subcard">
          ${renderAttachmentThumbs(attachments)}
        </div>
      ` : `<div class="notice">لا توجد مرفقات بعد.</div>`}
    `;
  };

  // Report tab (date range + print/export) — vehicle only
  const renderReport = async () => {
    let start = params.get("start") || ymdToday();
    let end = params.get("end") || start;
    let sTs = tsFromYMD(start);
    let eTs = tsFromYMD(end);
    if (eTs < sTs) { const tmp = start; start = end; end = tmp; sTs = tsFromYMD(start); eTs = tsFromYMD(end); }
    const startTs = sTs;
    const endExcl = eTs + 86400e3;

    const rep = await buildVehicleReport(v.id, startTs, endExcl);
    state.vehicleReport = { vehicleId: v.id, startYMD: start, endYMD: end, ...rep };

    return `
      <div class="card subcard">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-end;flex-wrap:wrap">
          <div>
            <div style="font-weight:900">تقرير السيارة</div>
            <div class="small">اختاري فترة، ويطلع لك دخل/ديون وعدد الزيارات والفواتير الخاصة بهالسيارة.</div>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap">
            <button class="btn btn-soft" data-act="carReportPrint">طباعة</button>
            <button class="btn" data-act="carReportExport">تصدير CSV</button>
          </div>
        </div>

        <div class="hr"></div>

        <input type="hidden" id="crVehicleId" value="${escapeHtml(v.id)}" />

        <div class="grid3">
          <div>
            <div class="small" style="margin:4px 2px">من</div>
            <input id="crStart" class="input" type="date" value="${escapeHtml(start)}" />
          </div>
          <div>
            <div class="small" style="margin:4px 2px">إلى</div>
            <input id="crEnd" class="input" type="date" value="${escapeHtml(end)}" />
          </div>
          <div style="display:flex; gap:8px; align-items:end; flex-wrap:wrap">
            <button class="btn btn-primary" data-act="carReportRun" data-id="${escapeHtml(v.id)}">عرض</button>
            <button class="btn" data-act="carReportToday" data-id="${escapeHtml(v.id)}">اليوم</button>
          </div>
        </div>

        <div class="hr"></div>

        <div class="cards">
          <div class="card"><div class="card-title">عدد الزيارات</div><div class="card-value">${rep.visitsCount}</div></div>
          <div class="card"><div class="card-title">عدد الفواتير</div><div class="card-value">${rep.totals.invCount}</div></div>
          <div class="card"><div class="card-title">مدفوع</div><div class="card-value">${money(rep.totals.invPaid)}</div></div>
          <div class="card"><div class="card-title">متبقي (ديون)</div><div class="card-value">${money(rep.totals.invRemain)}</div></div>
        </div>

        <div class="hr"></div>

        ${rep.invRows.length ? `
          <table class="table">
            <thead><tr><th>اليوم</th><th>النوع</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>فاتورة</th></tr></thead>
            <tbody>
              ${rep.invRows.slice().sort((a,b)=>a.at-b.at).map(r => `
                <tr>
                  <td>${escapeHtml(fmtDay(r.at))}</td>
                  <td>${escapeHtml(r.type)}</td>
                  <td>${money(r.total)}</td>
                  <td>${money(r.paid)}</td>
                  <td>${money(r.remaining)}</td>
                  <td class="small">${escapeHtml(r.id)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        ` : `<div class="notice">لا توجد فواتير ضمن الفترة.</div>`}
      </div>
    `;
  };

  let body = "";
  if (tab === "timeline") body = renderTimeline();
  if (tab === "orders") body = renderOrders();
  if (tab === "invoices") body = renderInvoices();
  if (tab === "appointments") body = renderAppointments();
  if (tab === "attachments") body = renderAttachments();
  if (tab === "report") body = await renderReport();

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap">
        <div>
          <div class="section-title">سجل السيارة</div>
          <div style="font-weight:900">${escapeHtml(plate)} • ${escapeHtml(makeLine || "")}</div>
          <div class="small">${escapeHtml(c?.name || "—")} ${c?.phone ? "• "+escapeHtml(c.phone) : ""}</div>
          <div class="small">العداد: <b>${odo || "—"}</b> ${nextOil ? `• دهن جاي: <b>${nextOil}</b>` : ""} ${diffOil!=null ? `• ${diffOil<0 ? "متأخر" : "باقي"}: <b>${Math.abs(diffOil)}</b> كم` : ""}</div>
        </div>

        <div style="display:flex; gap:8px; flex-wrap:wrap">
          <a class="btn btn-soft" href="#/vehicles">رجوع</a>
          <button class="btn" data-act="editVehicle" data-id="${escapeHtml(v.id)}">تعديل</button>
          <button class="btn" data-act="vehicleQR" data-id="${escapeHtml(v.id)}">طباعة QR</button>
          <button class="btn btn-soft" data-act="vehicleFilePDF" data-id="${escapeHtml(v.id)}">PDF ملف السيارة</button>
          <a class="btn" href="#/customer?id=${encodeURIComponent(v.customerId||"")}">سجل الزبون</a>
          <a class="btn btn-primary" href="#/checkin?customerId=${encodeURIComponent(v.customerId||"")}&vehicleId=${encodeURIComponent(v.id)}">فتح أمر شغل</a>
          <a class="btn" href="#/oil?customerId=${encodeURIComponent(v.customerId||"")}&vehicleId=${encodeURIComponent(v.id)}">تبديل دهن</a>
        </div>
      </div>

      ${tabs}
      <div class="hr"></div>
      ${body}
    </div>
  `;
}


async function viewOil(params) {
  const customers = await dbAPI.getAll("customers");
  const vehicles = await dbAPI.getAll("vehicles");
  const employees = (await dbAPI.getAll("employees")).filter(e => e.active);
  const fluids = await dbAPI.getAll("fluids");

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

  const fluidOptions = fluids
    .sort((a,b)=> ((a.name||"")+(a.spec||"")).localeCompare((b.name||"")+(b.spec||""), "ar"))
    .map(f => {
      const label = `${fluidCatLabel(f.category)} • ${f.name}${f.spec? " • "+f.spec:""} (رصيد: ${fmtLiters(f.liters)}L)`;
      return `<option value="${f.id}" data-cat="${escapeHtml(f.category)}">${escapeHtml(label)}</option>`;
    })
    .join("");

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div>
          <div class="section-title">تبديل دهن</div>
          <div class="small">فاتورة جاهزة للطباعة وتحتوي: العداد الحالي + العداد الجاي</div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn" href="#/inventory?tab=fluids">مخزون السوائل</a>
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

      <div class="card subcard">
        <div class="section-title">خدمة سوائل (حسب اللتر)</div>
        <div class="small">اختاري النوع + المادة من المخزون ثم اكتبي اللترات — السعر ينحسب تلقائياً داخل الفاتورة.</div>
        <div class="hr"></div>

        <div class="grid3">
          <div>
            <label class="small">نوع الخدمة</label>
            <select id="oilServiceKind" class="input">
              <option value="engine">زيت محرك</option>
              <option value="gear">زيت كير</option>
              <option value="coolant">ماء/سائل راديتور</option>
            </select>
          </div>
          <div>
            <label class="small">المادة (من المخزون)</label>
            <select id="oilFluidId" class="input">
              <option value="">— بدون (يدوي) —</option>
              ${fluidOptions}
            </select>
          </div>
          <div>
            <label class="small">الكمية (لتر)</label>
            <input id="oilLiters" class="input" inputmode="decimal" placeholder="4.5" />
          </div>
        </div>

        <div class="small" style="margin-top:8px">
          ملاحظة: إذا اخترتي مادة + لترات، النظام راح يخصم تلقائياً من مخزون السوائل.
        </div>

        <div id="oilFluidCalc" class="notice" style="margin-top:10px; display:none"></div>
      </div>

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

async function viewInventory(params) {
  const tab = (params?.get("tab") || "parts").toLowerCase();

  const parts = (await dbAPI.getAll("parts")).sort((a,b)=> (a.name||"").localeCompare(b.name||"", "ar"));
  const fluids = (await dbAPI.getAll("fluids")).sort((a,b)=> ((a.name||"")+(a.spec||"")).localeCompare((b.name||"")+(b.spec||""), "ar"));

  const lowParts = parts.filter(p => Number(p.stock||0) <= Number(p.min||0));
  const lowFluids = fluids.filter(f => Number(f.liters||0) <= Number(f.minLiters||0));

  const tabs = `
    <div class="row" style="gap:8px; flex-wrap:wrap">
      <a class="btn ${tab==="parts"?"btn-primary":""}" href="#/inventory?tab=parts">قطع</a>
      <a class="btn ${tab==="fluids"?"btn-primary":""}" href="#/inventory?tab=fluids">سوائل (لتر)</a>
    </div>
  `;

  const headerBtn = tab === "fluids"
    ? `<button class="btn btn-primary" data-act="newFluid">+ مادة سائل</button>`
    : `<button class="btn btn-primary" data-act="newPart">+ قطعة</button>`;

  const warn = tab === "fluids"
    ? (lowFluids.length ? `<div class="notice">⚠️ سوائل تحت الحد الأدنى: ${lowFluids.length}</div><div class="hr"></div>` : "")
    : (lowParts.length ? `<div class="notice">⚠️ قطع تحت الحد الأدنى: ${lowParts.length}</div><div class="hr"></div>` : "");

  const partsUI = `
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
  `;

  const fluidsUI = `
    <div class="small">المخزون هنا باللتر. استخدمي (+ إضافة) للشراء/التوريد، و(- صرف) للصرف اليدوي. صرف تبديل الدهن يصير تلقائياً من صفحة تبديل دهن.</div>
    <div class="hr"></div>

    ${fluids.length ? `
    <table class="table">
      <thead>
        <tr>
          <th>النوع</th>
          <th>المادة</th>
          <th>SKU</th>
          <th>شراء/لتر</th>
          <th>بيع/لتر</th>
          <th>الرصيد (L)</th>
          <th>الحد الأدنى (L)</th>
          <th>إجراءات</th>
        </tr>
      </thead>
      <tbody>
        ${fluids.map(f => `
          <tr class="tr">
            <td><b>${escapeHtml(fluidCatLabel(f.category))}</b></td>
            <td>${escapeHtml(f.name)}${f.spec? `<div class="small">${escapeHtml(f.spec)}</div>`:``}</td>
            <td class="small">${escapeHtml(f.sku || "—")}</td>
            <td class="small">${money(f.buyPerLiter || 0)}</td>
            <td class="small">${money(f.sellPerLiter || 0)}</td>
            <td><b>${fmtLiters(f.liters || 0)}</b></td>
            <td class="small">${fmtLiters(f.minLiters || 0)}</td>
            <td>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="btn" data-act="fluidAdd" data-id="${f.id}">+ إضافة</button>
                <button class="btn" data-act="fluidSub" data-id="${f.id}">- صرف</button>
                <button class="btn btn-danger" data-act="deleteFluid" data-id="${f.id}">حذف</button>
              </div>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    ` : `<div class="notice">بعد ماكو سوائل. اضغطي + مادة سائل.</div>`}
  `;

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div>
          <div class="section-title">المخزون</div>
          <div class="small">قطع + سوائل (باللتر)</div>
        </div>
        ${headerBtn}
      </div>

      <div class="hr"></div>
      ${tabs}
      <div class="hr"></div>
      ${warn}

      ${tab === "fluids" ? fluidsUI : partsUI}
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
      <div class="mini" style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap">
        <a class="btn btn-primary" href="#/reportfull">تقرير كامل (يوم/فترة)</a>
      </div>
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


/* ======================== REPORT FULL (Day / Range) ======================== */

function ymdToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}
function tsFromYMD(ymd) {
  const s = String(ymd || "").trim();
  if (!s) return Date.now();
  const [y, m, d] = s.split("-").map(n => Number(n || 0));
  return new Date(y || 1970, (m || 1) - 1, d || 1).getTime();
}
function ymdFromTs(ts) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}
function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function buildFullReport(startTs, endExcl) {
  const invoices = await dbAPI.getAll("invoices");
  const expenses = await dbAPI.getAll("expenses");
  const workOrders = await dbAPI.getAll("workOrders");
  const customers = await dbAPI.getAll("customers");
  const vehicles = await dbAPI.getAll("vehicles");
  const employees = await dbAPI.getAll("employees");

  const invRange = invoices
    .filter(i => (i.createdAt || 0) >= startTs && (i.createdAt || 0) < endExcl)
    .sort((a,b) => (b.createdAt||0) - (a.createdAt||0));

  const expRange = expenses
    .filter(x => (x.whenTs || x.createdAt || 0) >= startTs && (x.whenTs || x.createdAt || 0) < endExcl)
    .sort((a,b) => (b.whenTs||b.createdAt||0) - (a.whenTs||a.createdAt||0));

  const woMap = new Map(workOrders.map(w => [w.id, w]));
  const cMap = new Map(customers.map(c => [c.id, c]));
  const vMap = new Map(vehicles.map(v => [v.id, v]));
  const eMap = new Map(employees.map(e => [e.id, e]));

  const totals = {
    invCount: invRange.length,
    invTotal: sum(invRange, i => Number(i.total || 0)),
    invPaid: sum(invRange, i => Number(i.paid || 0)),
    invRemain: sum(invRange, i => Math.max(0, Number(i.total || 0) - Number(i.paid || 0))),
    expCount: expRange.length,
    expTotal: sum(expRange, x => Number(x.amount || 0)),
  };
  totals.net = totals.invPaid - totals.expTotal;

  // Work orders (created + done within range)
  const woCreated = workOrders.filter(w => (w.createdAt||0) >= startTs && (w.createdAt||0) < endExcl);
  const woDone = workOrders.filter(w => ["DONE","DELIVERED"].includes(w.status) && ((w.updatedAt||w.createdAt||0) >= startTs) && ((w.updatedAt||w.createdAt||0) < endExcl));
  const woByStatus = {};
  for (const w of woCreated) woByStatus[w.status || "OPEN"] = (woByStatus[w.status || "OPEN"] || 0) + 1;

  // Daily summary
  const dayMap = new Map(); // ymd -> {paid, exp}
  const bumpDay = (k, patch) => {
    const cur = dayMap.get(k) || { paid: 0, exp: 0 };
    dayMap.set(k, { ...cur, ...patch, paid: (cur.paid||0) + (patch.paid||0), exp: (cur.exp||0) + (patch.exp||0) });
  };
  for (const inv of invRange) bumpDay(ymdFromTs(inv.createdAt||0), { paid: Number(inv.paid||0) });
  for (const x of expRange) bumpDay(ymdFromTs(x.whenTs||x.createdAt||0), { exp: Number(x.amount||0) });

  const daily = Array.from(dayMap.entries())
    .map(([day, v]) => ({ day, paid: v.paid||0, exp: v.exp||0, net: (v.paid||0) - (v.exp||0) }))
    .sort((a,b) => a.day.localeCompare(b.day));

  // Top services / parts from invoice items
  const svc = new Map(); // name -> total
  const parts = new Map(); // name -> qty
  for (const inv of invRange) {
    const items = Array.isArray(inv.items) ? inv.items : [];
    for (const it of items) {
      const name = (it.name || "").trim() || "—";
      const kind = String(it.kind || "").toLowerCase();
      const total = Number(it.total || 0);
      const qty = Number(it.qty || 0);

      svc.set(name, (svc.get(name) || 0) + total);

      if (kind === "part") parts.set(name, (parts.get(name) || 0) + (isFinite(qty) ? qty : 0));
    }
  }
  const topServices = Array.from(svc.entries()).map(([name, total]) => ({ name, total }))
    .sort((a,b) => b.total - a.total).slice(0, 8);
  const topParts = Array.from(parts.entries()).map(([name, qty]) => ({ name, qty }))
    .sort((a,b) => b.qty - a.qty).slice(0, 8);

  // Top customers / employees by paid
  const custPaid = new Map(); // customerId -> paid
  const empPaid = new Map();  // employeeId -> paid
  for (const inv of invRange) {
    const wo = woMap.get(inv.workOrderId);
    if (wo?.customerId) custPaid.set(wo.customerId, (custPaid.get(wo.customerId)||0) + Number(inv.paid||0));
    if (wo?.employeeId) empPaid.set(wo.employeeId, (empPaid.get(wo.employeeId)||0) + Number(inv.paid||0));
  }
  const topCustomers = Array.from(custPaid.entries()).map(([cid, paid]) => ({ cid, paid, name: cMap.get(cid)?.name || "—" }))
    .sort((a,b) => b.paid - a.paid).slice(0, 6);
  const topEmployees = Array.from(empPaid.entries()).map(([eid, paid]) => ({ eid, paid, name: eMap.get(eid)?.name || "—" }))
    .sort((a,b) => b.paid - a.paid).slice(0, 6);

  // Invoice rows (joined)
  const invRows = invRange.map(inv => {
    const wo = woMap.get(inv.workOrderId) || null;
    const c = wo ? cMap.get(wo.customerId) : null;
    const v = wo ? vMap.get(wo.vehicleId) : null;
    const remaining = Math.max(0, Number(inv.total||0) - Number(inv.paid||0));
    return {
      id: inv.id,
      at: inv.createdAt || 0,
      type: inv.invoiceType || "NORMAL",
      customer: c?.name || "—",
      phone: c?.phone || "",
      plate: v?.plate || "",
      total: Number(inv.total||0),
      paid: Number(inv.paid||0),
      remaining,
    };
  });

  return {
    startTs, endExcl,
    totals,
    woCreatedCount: woCreated.length,
    woDoneCount: woDone.length,
    woByStatus,
    daily,
    topServices,
    topParts,
    topCustomers,
    topEmployees,
    invRows,
    expRows: expRange,
  };
}

async function viewReportFull(params) {
  // dates from query
  let start = params.get("start") || ymdToday();
  let end = params.get("end") || start;

  let sTs = tsFromYMD(start);
  let eTs = tsFromYMD(end);

  // إذا انعكسوا بالغلط
  if (eTs < sTs) { const tmp = start; start = end; end = tmp; sTs = tsFromYMD(start); eTs = tsFromYMD(end); }

  const startTs = sTs;
  const endExcl = eTs + 86400e3; // inclusive end day
  const rep = await buildFullReport(startTs, endExcl);

  state.fullReport = { ...rep, startYMD: start, endYMD: end };

  const stMap = rep.woByStatus || {};
  const stLine = Object.entries(stMap).map(([k,v]) => `${k}:${v}`).join(" • ");

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div>
          <div class="section-title">تقرير كامل</div>
          <div class="small">اختاري يوم واحد أو فترة (من–إلى) ثم اضغطي عرض. يدعم الطباعة والتصدير.</div>
        </div>
        <a class="btn btn-soft" href="#/reports">رجوع للتقارير</a>
      </div>

      <div class="hr"></div>

      <div class="grid3">
        <div>
          <div class="small" style="margin:4px 2px">من</div>
          <input id="rfStart" class="input" type="date" value="${escapeHtml(start)}" />
        </div>
        <div>
          <div class="small" style="margin:4px 2px">إلى</div>
          <input id="rfEnd" class="input" type="date" value="${escapeHtml(end)}" />
        </div>
        <div style="display:flex; gap:8px; align-items:end; flex-wrap:wrap">
          <button class="btn btn-primary" data-act="reportFullRun">عرض</button>
          <button class="btn btn-soft" data-act="reportFullPrint">طباعة A4</button>
          <button class="btn" data-act="reportFullExport">تصدير CSV</button>
        </div>
      </div>

      <div class="hr"></div>

      <div class="cards">
        <div class="card"><div class="card-title">عدد الفواتير</div><div class="card-value">${rep.totals.invCount}</div></div>
        <div class="card"><div class="card-title">إجمالي الفواتير</div><div class="card-value">${money(rep.totals.invTotal)}</div></div>
        <div class="card"><div class="card-title">مدفوع</div><div class="card-value">${money(rep.totals.invPaid)}</div></div>
        <div class="card"><div class="card-title">مصروف</div><div class="card-value">${money(rep.totals.expTotal)}</div></div>
        <div class="card"><div class="card-title">صافي</div><div class="card-value">${money(rep.totals.net)}</div></div>
        <div class="card"><div class="card-title">متبقي (ديون)</div><div class="card-value">${money(rep.totals.invRemain)}</div></div>
      </div>

      <div class="hr"></div>

      <div class="row" style="gap:10px; flex-wrap:wrap">
        <div class="badge">أوامر شغل (فُتحت ضمن الفترة): <b>${rep.woCreatedCount}</b></div>
        <div class="badge">أوامر مُكتملة ضمن الفترة: <b>${rep.woDoneCount}</b></div>
        ${stLine ? `<div class="small">تفصيل حالات الفتح: ${escapeHtml(stLine)}</div>` : ``}
      </div>

      <div class="hr"></div>

      <div class="row" style="gap:10px; align-items:flex-start; flex-wrap:wrap">
        <div class="col">
          <div class="card subcard">
            <div class="section-title">ملخص يومي</div>
            <div class="small">مدفوع/مصروف/صافي حسب اليوم</div>
            <div class="hr"></div>
            ${rep.daily.length ? `
              <table class="table">
                <thead><tr><th>اليوم</th><th>مدفوع</th><th>مصروف</th><th>صافي</th></tr></thead>
                <tbody>
                  ${rep.daily.map(r => `
                    <tr>
                      <td>${escapeHtml(r.day)}</td>
                      <td>${money(r.paid)}</td>
                      <td>${money(r.exp)}</td>
                      <td>${money(r.net)}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            ` : `<div class="notice">لا توجد حركة ضمن هذه الفترة.</div>`}
          </div>
        </div>

        <div class="col">
          <div class="card subcard">
            <div class="section-title">الأكثر استخداماً</div>
            <div class="small">أعلى خدمات/بنود حسب إجمالي القيمة</div>
            <div class="hr"></div>

            <div class="small" style="margin-bottom:6px">أعلى بنود:</div>
            ${rep.topServices.length ? `
              <table class="table">
                <thead><tr><th>البند</th><th>الإجمالي</th></tr></thead>
                <tbody>
                  ${rep.topServices.map(x => `<tr><td>${escapeHtml(x.name)}</td><td>${money(x.total)}</td></tr>`).join("")}
                </tbody>
              </table>
            ` : `<div class="notice">—</div>`}

            <div class="hr"></div>
            <div class="small" style="margin-bottom:6px">أعلى قطع (كمية):</div>
            ${rep.topParts.length ? `
              <table class="table">
                <thead><tr><th>القطعة</th><th>الكمية</th></tr></thead>
                <tbody>
                  ${rep.topParts.map(x => `<tr><td>${escapeHtml(x.name)}</td><td>${Number(x.qty||0)}</td></tr>`).join("")}
                </tbody>
              </table>
            ` : `<div class="notice">—</div>`}
          </div>
        </div>
      </div>

      <div class="hr"></div>

      <div class="row" style="gap:10px; flex-wrap:wrap">
        <div class="col">
          <div class="card subcard">
            <div class="section-title">أعلى زباين</div>
            <div class="small">حسب مجموع المدفوع ضمن الفترة</div>
            <div class="hr"></div>
            ${rep.topCustomers.length ? `
              <table class="table">
                <thead><tr><th>الزبون</th><th>مدفوع</th></tr></thead>
                <tbody>
                  ${rep.topCustomers.map(x => `<tr><td>${escapeHtml(x.name)}</td><td>${money(x.paid)}</td></tr>`).join("")}
                </tbody>
              </table>
            ` : `<div class="notice">—</div>`}
          </div>
        </div>
        <div class="col">
          <div class="card subcard">
            <div class="section-title">أداء الفنيين</div>
            <div class="small">حسب مجموع المدفوع ضمن الفترة</div>
            <div class="hr"></div>
            ${rep.topEmployees.length ? `
              <table class="table">
                <thead><tr><th>الفني</th><th>مدفوع</th></tr></thead>
                <tbody>
                  ${rep.topEmployees.map(x => `<tr><td>${escapeHtml(x.name)}</td><td>${money(x.paid)}</td></tr>`).join("")}
                </tbody>
              </table>
            ` : `<div class="notice">—</div>`}
          </div>
        </div>
      </div>

      <div class="hr"></div>

      <div class="card subcard">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
          <div>
            <div class="section-title">الفواتير ضمن الفترة</div>
            <div class="small">تقدرين تطبعين فاتورة أو ترسلين متبقي للزبون مباشرة</div>
          </div>
          <div class="badge">عدد: <b>${rep.invRows.length}</b></div>
        </div>
        <div class="hr"></div>

        ${rep.invRows.length ? `
          <table class="table">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>النوع</th>
                <th>الزبون</th>
                <th>اللوحة</th>
                <th>الإجمالي</th>
                <th>المدفوع</th>
                <th>المتبقي</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${rep.invRows.map(r => `
                <tr>
                  <td class="small">${escapeHtml(fmtDay(r.at))}</td>
                  <td>${escapeHtml(r.type)}</td>
                  <td>${escapeHtml(r.customer)}</td>
                  <td>${escapeHtml(r.plate || "—")}</td>
                  <td>${money(r.total)}</td>
                  <td>${money(r.paid)}</td>
                  <td>${money(r.remaining)}</td>
                  <td style="white-space:nowrap">
                    <button class="btn btn-soft" data-act="printInvoice" data-id="${escapeHtml(r.id)}">طباعة</button>
                    ${r.remaining>0 ? `<button class="btn" data-act="msgPaymentInv" data-id="${escapeHtml(r.id)}">متبقي</button>` : ``}
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        ` : `<div class="notice">لا توجد فواتير ضمن الفترة.</div>`}
      </div>

      <div class="hr"></div>

      <div class="card subcard">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
          <div>
            <div class="section-title">المصروفات ضمن الفترة</div>
          </div>
          <div class="badge">عدد: <b>${rep.expRows.length}</b></div>
        </div>
        <div class="hr"></div>

        ${rep.expRows.length ? `
          <table class="table">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>الوصف</th>
                <th>المبلغ</th>
              </tr>
            </thead>
            <tbody>
              ${rep.expRows.map(x => `
                <tr>
                  <td class="small">${escapeHtml(fmtDay(x.whenTs||x.createdAt||0))}</td>
                  <td>${escapeHtml(x.title || x.note || "—")}</td>
                  <td>${money(x.amount)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        ` : `<div class="notice">لا توجد مصروفات ضمن الفترة.</div>`}
      </div>
    </div>
  `;
}

async function printFullReport() {
  // rebuild from inputs if needed
  let rep = state.fullReport;
  const start = ($("#rfStart")?.value || rep?.startYMD || ymdToday()).trim();
  const end = ($("#rfEnd")?.value || rep?.endYMD || start).trim();

  const startTs = tsFromYMD(start);
  const endExcl = tsFromYMD(end) + 86400e3;

  rep = await buildFullReport(startTs, endExcl);
  const shop = getShop();

  const html = `
<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>تقرير كامل</title>
<style>
  body{font-family:Tahoma,Arial; margin:24px; color:#111}
  h1{margin:0 0 6px; font-size:20px}
  .sub{font-size:12px; color:#444; margin-bottom:14px}
  .grid{display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin:14px 0}
  .card{border:1px solid #ddd; border-radius:10px; padding:10px}
  .k{font-size:11px; color:#555}
  .v{font-size:16px; font-weight:800}
  table{width:100%; border-collapse:collapse; margin-top:10px}
  th,td{border:1px solid #ddd; padding:6px 8px; font-size:12px}
  th{background:#f7f7f7}
  .mt{margin-top:16px}
</style>
</head>
<body>
  <h1>${escapeHtml(shop.name || "تقرير")}</h1>
  <div class="sub">تقرير كامل • الفترة: <b>${escapeHtml(start)}</b> إلى <b>${escapeHtml(end)}</b> • طباعة: ${new Date().toLocaleString("ar-IQ")}</div>

  <div class="grid">
    <div class="card"><div class="k">عدد الفواتير</div><div class="v">${rep.totals.invCount}</div></div>
    <div class="card"><div class="k">مدفوع</div><div class="v">${money(rep.totals.invPaid)}</div></div>
    <div class="card"><div class="k">مصروف</div><div class="v">${money(rep.totals.expTotal)}</div></div>
    <div class="card"><div class="k">صافي</div><div class="v">${money(rep.totals.net)}</div></div>
    <div class="card"><div class="k">إجمالي الفواتير</div><div class="v">${money(rep.totals.invTotal)}</div></div>
    <div class="card"><div class="k">متبقي (ديون)</div><div class="v">${money(rep.totals.invRemain)}</div></div>
  </div>

  <div class="mt"><b>ملخص يومي</b></div>
  ${rep.daily.length ? `
    <table>
      <thead><tr><th>اليوم</th><th>مدفوع</th><th>مصروف</th><th>صافي</th></tr></thead>
      <tbody>
        ${rep.daily.map(r => `<tr><td>${escapeHtml(r.day)}</td><td>${money(r.paid)}</td><td>${money(r.exp)}</td><td>${money(r.net)}</td></tr>`).join("")}
      </tbody>
    </table>
  ` : `<div class="sub">لا توجد حركة ضمن الفترة.</div>`}

  <div class="mt"><b>الفواتير</b></div>
  ${rep.invRows.length ? `
    <table>
      <thead><tr><th>اليوم</th><th>النوع</th><th>الزبون</th><th>اللوحة</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th></tr></thead>
      <tbody>
        ${rep.invRows.slice().sort((a,b)=>a.at-b.at).map(r => `<tr>
          <td>${escapeHtml(fmtDay(r.at))}</td>
          <td>${escapeHtml(r.type)}</td>
          <td>${escapeHtml(r.customer)}</td>
          <td>${escapeHtml(r.plate||"—")}</td>
          <td>${money(r.total)}</td>
          <td>${money(r.paid)}</td>
          <td>${money(r.remaining)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  ` : `<div class="sub">لا توجد فواتير ضمن الفترة.</div>`}

  <div class="mt"><b>المصروفات</b></div>
  ${rep.expRows.length ? `
    <table>
      <thead><tr><th>اليوم</th><th>الوصف</th><th>المبلغ</th></tr></thead>
      <tbody>
        ${rep.expRows.slice().sort((a,b)=>(a.whenTs||a.createdAt||0)-(b.whenTs||b.createdAt||0)).map(x => `<tr>
          <td>${escapeHtml(fmtDay(x.whenTs||x.createdAt||0))}</td>
          <td>${escapeHtml(x.title || x.note || "—")}</td>
          <td>${money(x.amount)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  ` : `<div class="sub">لا توجد مصروفات ضمن الفترة.</div>`}

  <script>window.onload=()=>{window.print();}</script>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) return alert("المتصفح منع فتح نافذة الطباعة.");
  win.document.open();
  win.document.write(html);
  win.document.close();
}

async function exportFullReportCSV() {
  const rep = state.fullReport;
  const start = ($("#rfStart")?.value || rep?.startYMD || ymdToday()).trim();
  const end = ($("#rfEnd")?.value || rep?.endYMD || start).trim();

  const startTs = tsFromYMD(start);
  const endExcl = tsFromYMD(end) + 86400e3;
  const data = await buildFullReport(startTs, endExcl);

  let csv = "";
  csv += `Report,${csvEscape(start)} -> ${csvEscape(end)}\n`;
  csv += `Invoices Count,${data.totals.invCount}\n`;
  csv += `Invoices Total,${data.totals.invTotal}\n`;
  csv += `Paid,${data.totals.invPaid}\n`;
  csv += `Expenses,${data.totals.expTotal}\n`;
  csv += `Net,${data.totals.net}\n`;
  csv += `Remaining,${data.totals.invRemain}\n\n`;

  csv += "Invoices\n";
  csv += "Date,Type,Customer,Plate,Total,Paid,Remaining,InvoiceId\n";
  for (const r of data.invRows.slice().sort((a,b)=>a.at-b.at)) {
    csv += `${csvEscape(ymdFromTs(r.at))},${csvEscape(r.type)},${csvEscape(r.customer)},${csvEscape(r.plate)},${r.total},${r.paid},${r.remaining},${csvEscape(r.id)}\n`;
  }

  csv += "\nExpenses\n";
  csv += "Date,Title,Amount\n";
  for (const x of data.expRows.slice().sort((a,b)=>(a.whenTs||a.createdAt||0)-(b.whenTs||b.createdAt||0))) {
    csv += `${csvEscape(ymdFromTs(x.whenTs||x.createdAt||0))},${csvEscape(x.title || x.note || "")},${Number(x.amount||0)}\n`;
  }

  downloadBlob(`report_${start}_to_${end}.csv`, csv, "text/csv;charset=utf-8");
}

/* ======================== VEHICLE REPORT (Day / Range) ======================== */
async function buildVehicleReport(vehicleId, startTs, endExcl) {
  const invoices = await dbAPI.getAll("invoices");
  const workOrders = await dbAPI.getAll("workOrders");
  const woMap = new Map(workOrders.map(w => [w.id, w]));

  const isVehicleInvoice = (inv) => {
    if (!inv) return false;
    if (inv.vehicleId && inv.vehicleId === vehicleId) return true;
    const wo = woMap.get(inv.workOrderId);
    return wo && wo.vehicleId === vehicleId;
  };

  const invRange = invoices
    .filter(i => isVehicleInvoice(i) && (i.createdAt || 0) >= startTs && (i.createdAt || 0) < endExcl)
    .sort((a,b)=> (b.createdAt||0) - (a.createdAt||0));

  const visits = workOrders
    .filter(w => w.vehicleId === vehicleId && (w.createdAt||0) >= startTs && (w.createdAt||0) < endExcl)
    .sort((a,b)=> (b.createdAt||0) - (a.createdAt||0));

  const totals = {
    invCount: invRange.length,
    invTotal: sum(invRange, i => Number(i.total || 0)),
    invPaid: sum(invRange, i => Number(i.paid || 0)),
    invRemain: sum(invRange, i => Math.max(0, Number(i.total || 0) - Number(i.paid || 0))),
  };

  // Top services/parts
  const svc = new Map(); // name -> total
  const parts = new Map(); // name -> qty
  for (const inv of invRange) {
    const items = Array.isArray(inv.items) ? inv.items : [];
    for (const it of items) {
      const name = (it.name || "").trim() || "—";
      const kind = String(it.kind || "").toLowerCase();
      const total = Number(it.total || 0);
      const qty = Number(it.qty || 0);

      svc.set(name, (svc.get(name) || 0) + total);
      if (kind === "part") parts.set(name, (parts.get(name) || 0) + (isFinite(qty) ? qty : 0));
    }
  }
  const topServices = Array.from(svc.entries()).map(([name, total]) => ({ name, total }))
    .sort((a,b)=>b.total-a.total).slice(0, 8);
  const topParts = Array.from(parts.entries()).map(([name, qty]) => ({ name, qty }))
    .sort((a,b)=>b.qty-a.qty).slice(0, 8);

  const invRows = invRange.map(inv => {
    const remaining = Math.max(0, Number(inv.total||0) - Number(inv.paid||0));
    return {
      id: inv.id,
      at: inv.createdAt || 0,
      type: inv.invoiceType || "NORMAL",
      total: Number(inv.total||0),
      paid: Number(inv.paid||0),
      remaining,
    };
  });

  return { startTs, endExcl, totals, visitsCount: visits.length, topServices, topParts, invRows };
}

async function printVehicleReport() {
  const rep = state.vehicleReport;
  if (!rep || !rep.vehicleId) return alert("افتحي تقرير السيارة أولاً.");

  const v = await dbAPI.get("vehicles", rep.vehicleId);
  const c = v?.customerId ? await dbAPI.get("customers", v.customerId) : null;
  const shop = await getShop();

  const start = rep.startYMD || ymdToday();
  const end = rep.endYMD || start;

  const titleLine = `${(c?.name || "—")} • ${(v?.plate || "—")} • ${[v?.make, v?.model, v?.year].filter(Boolean).join(" ")}`;

  const html = `<!doctype html><html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>تقرير السيارة</title>
<style>
  body{font-family:system-ui,Segoe UI,Arial; padding:18px}
  h1{margin:0 0 6px; font-size:20px}
  .sub{font-size:12px; color:#444; margin-bottom:14px}
  .grid{display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin:14px 0}
  .card{border:1px solid #ddd; border-radius:10px; padding:10px}
  .k{font-size:11px; color:#555}
  .v{font-size:16px; font-weight:800}
  table{width:100%; border-collapse:collapse; margin-top:10px}
  th,td{border:1px solid #ddd; padding:6px 8px; font-size:12px}
  th{background:#f7f7f7}
  .mt{margin-top:16px}
</style>
</head>
<body>
  <h1>${escapeHtml(shop.name || "تقرير السيارة")}</h1>
  <div class="sub">تقرير سيارة • ${escapeHtml(titleLine)}<br>
  الفترة: <b>${escapeHtml(start)}</b> إلى <b>${escapeHtml(end)}</b> • طباعة: ${new Date().toLocaleString("ar-IQ")}</div>

  <div class="grid">
    <div class="card"><div class="k">عدد الزيارات</div><div class="v">${rep.visitsCount || 0}</div></div>
    <div class="card"><div class="k">عدد الفواتير</div><div class="v">${rep.totals?.invCount || 0}</div></div>
    <div class="card"><div class="k">مدفوع</div><div class="v">${money(rep.totals?.invPaid || 0)}</div></div>
    <div class="card"><div class="k">متبقي (ديون)</div><div class="v">${money(rep.totals?.invRemain || 0)}</div></div>
  </div>

  <div class="mt"><b>الفواتير</b></div>
  ${(rep.invRows && rep.invRows.length) ? `
    <table>
      <thead><tr><th>اليوم</th><th>النوع</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>ID</th></tr></thead>
      <tbody>
        ${rep.invRows.slice().sort((a,b)=>a.at-b.at).map(r => `<tr>
          <td>${escapeHtml(fmtDay(r.at))}</td>
          <td>${escapeHtml(r.type)}</td>
          <td>${money(r.total)}</td>
          <td>${money(r.paid)}</td>
          <td>${money(r.remaining)}</td>
          <td>${escapeHtml(r.id)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  ` : `<div class="sub">لا توجد فواتير ضمن الفترة.</div>`}

  <div class="mt"><b>أعلى الخدمات</b></div>
  ${(rep.topServices && rep.topServices.length) ? `
    <table>
      <thead><tr><th>الخدمة</th><th>الإجمالي</th></tr></thead>
      <tbody>${rep.topServices.map(x => `<tr><td>${escapeHtml(x.name)}</td><td>${money(x.total)}</td></tr>`).join("")}</tbody>
    </table>
  ` : `<div class="sub">—</div>`}

  <script>window.onload=()=>{window.print();}</script>
</body></html>`;

  const win = window.open("", "_blank");
  if (!win) return alert("المتصفح منع فتح نافذة الطباعة.");
  win.document.open();
  win.document.write(html);
  win.document.close();
}


/* ------------------------ Vehicle QR + Vehicle File (PDF via Print) ------------------------ */
async function printVehicleQR(vehicleId) {
  const v = await dbAPI.get("vehicles", vehicleId);
  if (!v) return alert("ما لقيت السيارة.");
  const c = v.customerId ? await dbAPI.get("customers", v.customerId) : null;

  const mode = (await choosePrintMode("طباعة QR للسيارة")) || Settings.get("printMode","a4");

  const link = vehicleDeepLink(v.id);
  const qrDataUrl = await makeQRDataURL(link, mode === "thermal" ? 220 : 260);
  if (!qrDataUrl) return alert("مكتبة QR ما انحملت. جرّبي تحديث الصفحة أو تبديل الشبكة.");

  const line1 = `${v.plate || "—"} • ${[v.make, v.model, v.year].filter(Boolean).join(" ")}`.trim();
  const line2 = `${c?.name || "—"}${c?.phone ? " • "+c.phone : ""}`;

  const bodyHtml = `
    <div class="print-wrap">
      <div class="print-sticker">
        <div class="sticker-qr"><img src="${qrDataUrl}" alt="QR" /></div>
        <div class="sticker-meta">
          <div><b>${escapeHtml(line1 || "—")}</b></div>
          <div>${escapeHtml(line2 || "")}</div>
          <div class="small" style="margin-top:6px;direction:ltr">${escapeHtml(link)}</div>
        </div>
      </div>
    </div>
  `;

  openPrintWindowEx({ title: `QR ${v.plate || v.id}`, bodyHtml, mode });
  await writeActivity({ action: "PRINT", store: "vehicles", entityId: v.id, before: null, after: { mode, kind: "QR" }, note: "Print vehicle QR" });
}

// PDF = نافذة طباعة (Save as PDF)
async function printVehicleFilePDF(vehicleId) {
  const v = await dbAPI.get("vehicles", vehicleId);
  if (!v) return alert("ما لقيت السيارة.");
  const c = v.customerId ? await dbAPI.get("customers", v.customerId) : null;
  const shop = await getShop();

  // Default range: from first day of month to today
  const today = ymdToday();
  const monthStart = today.slice(0, 8) + "01";

  const out = await formModal({
    title: "ملف السيارة (PDF)",
    subtitle: "اختاري الفترة (من–إلى). بعدين تطبعين وتختارين Save as PDF.",
    submitText: "إنشاء",
    fields: [
      { name: "start", label: "من", type: "date", required: true, default: monthStart },
      { name: "end", label: "إلى", type: "date", required: true, default: today },
      { name: "includeActivity", label: "تضمين السجل (Activity) لآخر 80 حدث", type: "checkbox", default: false },
    ],
    initial: { start: monthStart, end: today, includeActivity: false },
  });
  if (!out) return;

  let start = String(out.start || monthStart);
  let end = String(out.end || today);
  let sTs = tsFromYMD(start);
  let eTs = tsFromYMD(end);
  if (eTs < sTs) { const tmp = start; start = end; end = tmp; sTs = tsFromYMD(start); eTs = tsFromYMD(end); }
  const startTs = sTs;
  const endExcl = eTs + 86400e3;

  const rep = await buildVehicleReport(v.id, startTs, endExcl);

  const workOrders = (await dbAPI.getAll("workOrders"))
    .filter(w => w && w.vehicleId === v.id && (w.createdAt||0) >= startTs && (w.createdAt||0) < endExcl)
    .sort((a,b)=> (a.createdAt||0) - (b.createdAt||0));

  const invAll = await dbAPI.getAll("invoices");
  const woMap = new Map((await dbAPI.getAll("workOrders")).map(w => [w.id, w]));
  const invRange = invAll
    .filter(inv => {
      if (!inv) return false;
      const ts = inv.createdAt || 0;
      if (ts < startTs || ts >= endExcl) return false;
      if (inv.vehicleId && inv.vehicleId === v.id) return true;
      const wo = woMap.get(inv.workOrderId);
      return wo && wo.vehicleId === v.id;
    })
    .sort((a,b)=> (a.createdAt||0) - (b.createdAt||0));

  const oilRange = invRange.filter(inv => String(inv.invoiceType||"").toUpperCase() === "OIL");

  const link = vehicleDeepLink(v.id);
  const qrDataUrl = await makeQRDataURL(link, 150);

  let activityRows = [];
  if (out.includeActivity) {
    try {
      const acts = await dbAPI.getAll("activity");
      activityRows = (acts || [])
        .filter(a => (a.vehicleId && a.vehicleId === v.id) || (a.refs && a.refs.vehicleId === v.id))
        .sort((a,b)=> (a.ts||0)-(b.ts||0))
        .slice(-80);
    } catch {}
  }

  const titleLine = `${(c?.name || "—")} • ${(v.plate || "—")} • ${[v.make, v.model, v.year].filter(Boolean).join(" ")}`;

  const html = `<!doctype html><html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ملف السيارة</title>
<style>
  body{font-family:system-ui,Segoe UI,Arial; padding:18px; color:#111}
  h1{margin:0 0 6px; font-size:20px}
  .sub{font-size:12px; color:#444; margin-bottom:14px; line-height:1.6}
  .top{display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap}
  .qr{width:120px; height:120px; border:1px solid #ddd; border-radius:12px; padding:8px; background:#fff}
  .qr img{width:100%; height:100%; object-fit:contain}
  .grid{display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin:14px 0}
  .card{border:1px solid #ddd; border-radius:10px; padding:10px}
  .k{font-size:11px; color:#555}
  .v{font-size:16px; font-weight:800}
  table{width:100%; border-collapse:collapse; margin-top:10px}
  th,td{border:1px solid #ddd; padding:6px 8px; font-size:12px; vertical-align:top}
  th{background:#f7f7f7}
  .mt{margin-top:16px}
  .small{font-size:11px; color:#555}
  .ltr{direction:ltr}
</style>
</head>
<body>
  <div class="top">
    <div>
      <h1>${escapeHtml(shop.name || "ملف السيارة")}</h1>
      <div class="sub">
        ملف سيارة • ${escapeHtml(titleLine)}<br>
        الفترة: <b>${escapeHtml(start)}</b> إلى <b>${escapeHtml(end)}</b> • طباعة: ${new Date().toLocaleString("ar-IQ")}
      </div>
      <div class="small">
        الهاتف: ${escapeHtml(shop.phone||"")} ${shop.address ? " • "+escapeHtml(shop.address) : ""}<br>
        الشاصي/VIN: <span class="ltr">${escapeHtml(v.vin||"—")}</span> • العداد: <b>${escapeHtml(String(v.odometer||"—"))}</b>
      </div>
    </div>
    ${qrDataUrl ? `<div class="qr"><img src="${qrDataUrl}" alt="QR" /></div>` : ``}
  </div>

  <div class="grid">
    <div class="card"><div class="k">عدد الزيارات (أوامر الشغل)</div><div class="v">${rep.visitsCount || 0}</div></div>
    <div class="card"><div class="k">عدد الفواتير</div><div class="v">${rep.totals?.invCount || 0}</div></div>
    <div class="card"><div class="k">مدفوع</div><div class="v">${money(rep.totals?.invPaid || 0)}</div></div>
    <div class="card"><div class="k">متبقي (ديون)</div><div class="v">${money(rep.totals?.invRemain || 0)}</div></div>
  </div>

  <div class="mt"><b>أوامر الشغل ضمن الفترة</b></div>
  ${workOrders.length ? `
    <table>
      <thead><tr><th>اليوم</th><th>الشكوى/العمل</th><th>الحالة</th><th>ID</th></tr></thead>
      <tbody>
        ${workOrders.map(w => `<tr>
          <td>${escapeHtml(fmtDay(w.createdAt||0))}</td>
          <td>${escapeHtml(w.complaint||"—")}</td>
          <td>${escapeHtml(w.status||"—")}</td>
          <td class="ltr">${escapeHtml(w.id)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  ` : `<div class="sub">لا توجد أوامر ضمن الفترة.</div>`}

  <div class="mt"><b>الفواتير ضمن الفترة</b></div>
  ${invRange.length ? `
    <table>
      <thead><tr><th>اليوم</th><th>النوع</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>ID</th></tr></thead>
      <tbody>
        ${invRange.map(inv => {
          const rem = Math.max(0, Number(inv.total||0) - Number(inv.paid||0));
          return `<tr>
            <td>${escapeHtml(fmtDay(inv.createdAt||0))}</td>
            <td>${escapeHtml(inv.invoiceType || "NORMAL")}</td>
            <td>${money(inv.total||0)}</td>
            <td>${money(inv.paid||0)}</td>
            <td>${money(rem)}</td>
            <td class="ltr">${escapeHtml(inv.id)}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  ` : `<div class="sub">لا توجد فواتير ضمن الفترة.</div>`}

  <div class="mt"><b>دهن/صيانة ضمن الفترة</b></div>
  ${oilRange.length ? `
    <table>
      <thead><tr><th>اليوم</th><th>الإجمالي</th><th>العداد</th><th>ملاحظات</th><th>ID</th></tr></thead>
      <tbody>
        ${oilRange.map(inv => `<tr>
          <td>${escapeHtml(fmtDay(inv.createdAt||0))}</td>
          <td>${money(inv.total||0)}</td>
          <td>${escapeHtml(String(inv.odometer||v.odometer||"—"))}</td>
          <td>${escapeHtml(inv.note||"")}</td>
          <td class="ltr">${escapeHtml(inv.id)}</td>
        </tr>`).join("")}
      </tbody>
    </table>
  ` : `<div class="sub">—</div>`}

  <div class="mt"><b>أعلى الخدمات</b></div>
  ${(rep.topServices && rep.topServices.length) ? `
    <table>
      <thead><tr><th>الخدمة</th><th>الإجمالي</th></tr></thead>
      <tbody>${rep.topServices.map(x => `<tr><td>${escapeHtml(x.name)}</td><td>${money(x.total)}</td></tr>`).join("")}</tbody>
    </table>
  ` : `<div class="sub">—</div>`}

  ${out.includeActivity ? `
    <div class="mt"><b>السجل (آخر ${activityRows.length} حدث)</b></div>
    ${activityRows.length ? `
      <table>
        <thead><tr><th>الوقت</th><th>الإجراء</th><th>الجدول</th><th>المعرف</th><th>المستخدم</th><th>ملاحظة</th></tr></thead>
        <tbody>
          ${activityRows.map(a => `<tr>
            <td>${escapeHtml(new Date(a.ts||0).toLocaleString("ar-IQ"))}</td>
            <td>${escapeHtml(a.action||"")}</td>
            <td>${escapeHtml(a.store||"")}</td>
            <td class="ltr">${escapeHtml(a.entityId||"")}</td>
            <td class="ltr">${escapeHtml(a.email||"")}</td>
            <td>${escapeHtml(a.note||"")}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    ` : `<div class="sub">—</div>`}
  ` : ``}

  <div class="mt small ltr">${escapeHtml(link)}</div>

  <script>window.onload=()=>{window.print();}</script>
</body></html>`;

  const win = window.open("", "_blank");
  if (!win) return alert("المتصفح منع فتح نافذة الطباعة.");
  win.document.open();
  win.document.write(html);
  win.document.close();

  await writeActivity({ action: "PRINT", store: "vehicles", entityId: v.id, before: null, after: { kind: "VEHICLE_FILE", start, end }, note: "Vehicle file PDF" });
}


async function exportVehicleReportCSV() {
  const vehicleId = ($("#crVehicleId")?.value || state.vehicleReport?.vehicleId || "").trim();
  if (!vehicleId) return alert("افتحي تقرير السيارة أولاً.");

  const start = ($("#crStart")?.value || state.vehicleReport?.startYMD || ymdToday()).trim();
  const end = ($("#crEnd")?.value || state.vehicleReport?.endYMD || start).trim();

  const startTs = tsFromYMD(start);
  const endExcl = tsFromYMD(end) + 86400e3;

  const data = await buildVehicleReport(vehicleId, startTs, endExcl);

  let csv = "";
  csv += `Vehicle Report,${csvEscape(start)} -> ${csvEscape(end)}\n`;
  csv += `Invoices Count,${data.totals.invCount}\n`;
  csv += `Invoices Total,${data.totals.invTotal}\n`;
  csv += `Paid,${data.totals.invPaid}\n`;
  csv += `Remaining,${data.totals.invRemain}\n`;
  csv += `Visits,${data.visitsCount}\n\n`;

  csv += "Invoices\n";
  csv += "Date,Type,Total,Paid,Remaining,InvoiceId\n";
  for (const r of data.invRows.slice().sort((a,b)=>a.at-b.at)) {
    csv += `${csvEscape(ymdFromTs(r.at))},${csvEscape(r.type)},${r.total},${r.paid},${r.remaining},${csvEscape(r.id)}\n`;
  }

  downloadBlob(`vehicle_report_${vehicleId}_${start}_to_${end}.csv`, csv, "text/csv;charset=utf-8");
}

/* ======================== ADMIN: Custom Pages (No-code) ======================== */

function normalizeSlug(s) {
  return String(s||"")
    .trim()
    .toLowerCase()
    .replace(/[^\w\u0600-\u06FF]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 36) || ("page_" + uid().slice(3, 9));
}

function fieldTypeLabel(t) {
  const map = { text:"نص", number:"رقم", date:"تاريخ", textarea:"ملاحظة", select:"اختيار", checkbox:"صح/خطأ" };
  return map[t] || t;
}

async function viewPageBuilder() {
  if (currentRole() !== "admin") {
    return `<div class="card"><div class="section-title">إدارة الصفحات</div><div class="notice">هالصفحة للمدير فقط.</div></div>`;
  }

  const pages = (await dbAPI.getAll("customPages")).sort((a,b)=>(a.title||"").localeCompare(b.title||"", "ar"));

  return `
    <div class="card">
      <div class="section-title">إدارة الصفحات (No‑code)</div>
      <div class="small">تقدرين تنشئين صفحات/نماذج جديدة داخل التطبيق بدون تعديل الكود. (حاليًا: صفحات CRUD بسيطة)</div>
      <div class="hr"></div>

      <div class="card subcard">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
          <div>
            <div style="font-weight:900">إنشاء صفحة جديدة</div>
            <div class="small">حددي اسم الصفحة، ونخلي صلاحياتها، وبعدين تضيفين الحقول.</div>
          </div>
          <button class="btn btn-primary" data-act="cpCreate">إنشاء</button>
        </div>

        <div style="height:10px"></div>
        <div class="grid2">
          <div>
            <div class="small" style="margin:4px 2px">اسم الصفحة</div>
            <input id="cpTitle" class="input" placeholder="مثال: مصروفات إضافية / كفالات / موردين ..." />
          </div>
          <div>
            <div class="small" style="margin:4px 2px">المعرف (اختياري)</div>
            <input id="cpId" class="input" placeholder="يتم توليده تلقائياً" />
          </div>
          <div style="grid-column:1/-1">
            <div class="small" style="margin:4px 2px">السماح للأدوار (افتراضي: مدير فقط)</div>
            <div class="row" style="gap:10px; flex-wrap:wrap">
              <label class="small"><input type="checkbox" id="cpRoleAdmin" checked /> مدير</label>
              <label class="small"><input type="checkbox" id="cpRoleAccountant" /> محاسب</label>
              <label class="small"><input type="checkbox" id="cpRoleReception" /> استقبال</label>
              <label class="small"><input type="checkbox" id="cpRoleTechnician" /> فني</label>
            </div>
          </div>
        </div>
      </div>

      <div class="hr"></div>

      ${pages.length ? pages.map(p => `
        <div class="card subcard">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
            <div>
              <div style="font-weight:900">${escapeHtml(p.title || p.id)}</div>
              <div class="small">ID: <code>${escapeHtml(p.id)}</code> • أدوار: <b>${escapeHtml((p.allowedRoles||["admin"]).map(roleLabel).join("، "))}</b></div>
            </div>
            <div class="mini" style="display:flex; gap:8px; flex-wrap:wrap">
              <a class="btn btn-soft" href="#/custom?id=${encodeURIComponent(p.id)}">فتح</a>
              <button class="btn" data-act="cpAddField" data-id="${escapeHtml(p.id)}">+ حقل</button>
              <button class="btn" data-act="cpEdit" data-id="${escapeHtml(p.id)}">تعديل</button>
              <button class="btn btn-danger" data-act="cpDelete" data-id="${escapeHtml(p.id)}">حذف</button>
            </div>
          </div>

          <div class="hr"></div>

          ${Array.isArray(p.fields) && p.fields.length ? `
            <table class="table">
              <thead><tr><th>المفتاح</th><th>الاسم</th><th>النوع</th><th>مطلوب</th><th></th></tr></thead>
              <tbody>
                ${p.fields.map((f, i) => `
                  <tr>
                    <td><code>${escapeHtml(f.name||"")}</code></td>
                    <td>${escapeHtml(f.label||"")}</td>
                    <td>${escapeHtml(fieldTypeLabel(f.type))}</td>
                    <td>${f.required ? "نعم" : "لا"}</td>
                    <td style="white-space:nowrap">
                      <button class="btn btn-danger" data-act="cpDelField" data-id="${escapeHtml(p.id)}" data-idx="${i}">حذف الحقل</button>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          ` : `<div class="notice">بعد ماكو حقول. اضغطي <b>+ حقل</b> حتى تبدي.</div>`}
        </div>
      `).join("") : `<div class="notice">لا توجد صفحات مخصصة بعد.</div>`}
    </div>
  `;
}

async function viewCustomPage(params) {
  const pageId = params.get("id") || "";
  if (!pageId) {
    const pages = (await dbAPI.getAll("customPages")).filter(p => (p.allowedRoles||["admin"]).includes(currentRole()));
    return `
      <div class="card">
        <div class="section-title">الصفحات المخصصة</div>
        <div class="small">اختاري صفحة</div>
        <div class="hr"></div>
        ${pages.length ? `<div class="grid2">
          ${pages.map(p => `<a class="btn btn-primary" href="#/custom?id=${encodeURIComponent(p.id)}">${escapeHtml(p.title||p.id)}</a>`).join("")}
        </div>` : `<div class="notice">لا توجد صفحات مخصصة متاحة لهالدور.</div>`}
        ${currentRole()==="admin" ? `<div style="height:10px"></div><a class="btn" href="#/pagebuilder">إدارة الصفحات</a>` : ``}
      </div>
    `;
  }

  const page = await dbAPI.get("customPages", pageId);
  if (!page) return `<div class="card"><div class="notice">ما لقينا الصفحة.</div><a class="btn" href="#/pagebuilder">إدارة الصفحات</a></div>`;

  const allowed = (page.allowedRoles || ["admin"]);
  if (!allowed.includes(currentRole())) {
    return `<div class="card"><div class="section-title">${escapeHtml(page.title||page.id)}</div><div class="notice">ما عندك صلاحية لهالصفحة.</div></div>`;
  }

  const all = await dbAPI.getAll("customData");
  const rows = all.filter(r => r.pageId === pageId).sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0));

  const fields = Array.isArray(page.fields) ? page.fields : [];
  const cols = fields.slice(0, 6);

  const q = String(state.search || "").trim().toLowerCase();
  const filtered = q ? rows.filter(r => {
    const v = r.values || {};
    return cols.some(f => String(v[f.name] ?? "").toLowerCase().includes(q)) ||
      String(r.id).toLowerCase().includes(q);
  }) : rows;

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div>
          <div class="section-title">${escapeHtml(page.title||page.id)}</div>
          <div class="small">صفحة مخصصة • CRUD بسيط • عدد السجلات: <b>${filtered.length}</b></div>
        </div>
        <div class="mini" style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" data-act="cdAdd" data-id="${escapeHtml(pageId)}">+ إضافة</button>
          <button class="btn" data-act="cdExport" data-id="${escapeHtml(pageId)}">تصدير CSV</button>
          ${currentRole()==="admin" ? `<a class="btn btn-soft" href="#/pagebuilder">إدارة</a>` : ``}
        </div>
      </div>

      <div class="hr"></div>

      <div class="row" style="gap:10px; align-items:center; flex-wrap:wrap">
        <div class="small">بحث:</div>
        <input id="customSearchHint" class="input" style="max-width:260px" value="${escapeHtml(state.search||"")}" placeholder="اكتب وراح يفلتر" disabled />
        <div class="small">استخدمي بحث الأعلى (Global Search).</div>
      </div>

      <div class="hr"></div>

      ${filtered.length ? `
        <table class="table">
          <thead>
            <tr>
              ${cols.map(f => `<th>${escapeHtml(f.label||f.name)}</th>`).join("")}
              <th>آخر تحديث</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(r => {
              const v = r.values || {};
              const t = r.updatedAt || r.createdAt || 0;
              return `
                <tr>
                  ${cols.map(f => {
                    let val = v[f.name];
                    if (f.type === "date" && val) val = fmtDay(Number(val));
                    if (f.type === "checkbox") val = val ? "نعم" : "لا";
                    return `<td>${escapeHtml(val ?? "—")}</td>`;
                  }).join("")}
                  <td class="small">${escapeHtml(fmtDate(t))}</td>
                  <td style="white-space:nowrap">
                    <button class="btn" data-act="cdEdit" data-id="${escapeHtml(pageId)}" data-rec="${escapeHtml(r.id)}">تعديل</button>
                    <button class="btn btn-danger" data-act="cdDelete" data-id="${escapeHtml(pageId)}" data-rec="${escapeHtml(r.id)}">حذف</button>
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      ` : `<div class="notice">لا توجد سجلات.</div>`}
    </div>
  `;
}

async function createCustomPage() {
  if (currentRole() !== "admin") return toast("غير مسموح", "bad");
  const title = ($("#cpTitle")?.value || "").trim();
  const rawId = ($("#cpId")?.value || "").trim();
  if (!title) return toast("اكتبي اسم الصفحة", "warn");

  const roles = [];
  if ($("#cpRoleAdmin")?.checked) roles.push("admin");
  if ($("#cpRoleAccountant")?.checked) roles.push("accountant");
  if ($("#cpRoleReception")?.checked) roles.push("reception");
  if ($("#cpRoleTechnician")?.checked) roles.push("technician");
  if (!roles.length) roles.push("admin");

  const id = rawId ? normalizeSlug(rawId) : normalizeSlug(title);
  const exists = await dbAPI.get("customPages", id);
  if (exists) return toast("هذا المعرف مستخدم قبل", "warn");

  const page = { id, title, allowedRoles: roles, fields: [], createdAt: Date.now(), updatedAt: Date.now() };
  await dbAPI.put("customPages", page);
  toast("تم إنشاء الصفحة ✅");
  $("#cpTitle").value = "";
  $("#cpId").value = "";
  renderRoute();
}

async function deleteCustomPage(pageId) {
  if (currentRole() !== "admin") return toast("غير مسموح", "bad");
  if (!confirm("حذف الصفحة وكل سجلاتها؟")) return;

  await dbAPI.del("customPages", pageId);
  // delete data rows
  const all = await dbAPI.getAll("customData");
  for (const r of all.filter(x => x.pageId === pageId)) await dbAPI.del("customData", r.id);

  toast("تم الحذف ✅");
  location.hash = "#/pagebuilder";
  renderRoute();
}

async function editCustomPageMeta(pageId) {
  if (currentRole() !== "admin") return toast("غير مسموح", "bad");
  const page = await dbAPI.get("customPages", pageId);
  if (!page) return;

  const allowed = page.allowedRoles || ["admin"];

  const out = await formModal({
    title: "تعديل الصفحة",
    submitText: "حفظ",
    fields: [
      { name: "title", label: "اسم الصفحة", type: "text", required: true, default: page.title || "" },
      { name: "roles", label: "الأدوار المسموحة (افصل بفاصلة)", type: "text", required: true, default: allowed.join(",") },
    ],
    initial: { title: page.title || "", roles: allowed.join(",") },
  });
  if (!out) return;

  page.title = String(out.title||"").trim() || page.title;
  page.allowedRoles = String(out.roles||"admin").split(",").map(s=>s.trim()).filter(Boolean);
  if (!page.allowedRoles.length) page.allowedRoles = ["admin"];
  page.updatedAt = Date.now();

  await dbAPI.put("customPages", page);
  toast("تم الحفظ ✅");
  renderRoute();
}

async function addCustomField(pageId) {
  if (currentRole() !== "admin") return toast("غير مسموح", "bad");
  const page = await dbAPI.get("customPages", pageId);
  if (!page) return;

  const out = await formModal({
    title: "إضافة حقل",
    submitText: "إضافة",
    fields: [
      { name: "name", label: "المفتاح (بالإنجليزي/أرقام/underscore)", type: "text", required: true },
      { name: "label", label: "اسم الحقل (يظهر للمستخدم)", type: "text", required: true },
      { name: "type", label: "النوع", type: "select", required: true, options: [
        { value:"text", label:"نص" },
        { value:"number", label:"رقم" },
        { value:"date", label:"تاريخ" },
        { value:"textarea", label:"ملاحظة" },
        { value:"select", label:"اختيار" },
        { value:"checkbox", label:"صح/خطأ" },
      ], default: "text" },
      { name: "required", label: "مطلوب؟ (اكتب 1 إذا نعم)", type: "number", cast: "number", default: 0 },
      { name: "options", label: "خيارات (فقط للـ Select) - افصل بفاصلة", type: "text", default: "" },
    ],
  });
  if (!out) return;

  const name = String(out.name||"").trim().replace(/[^\w]/g, "_");
  if (!name) return toast("اسم المفتاح غير صالح", "warn");
  if ((page.fields||[]).some(f => f.name === name)) return toast("هذا المفتاح موجود", "warn");

  const f = {
    name,
    label: String(out.label||name).trim() || name,
    type: out.type || "text",
    required: Number(out.required||0) ? true : false,
    options: String(out.options||"").split(",").map(s=>s.trim()).filter(Boolean),
  };

  page.fields = Array.isArray(page.fields) ? page.fields : [];
  page.fields.push(f);
  page.updatedAt = Date.now();
  await dbAPI.put("customPages", page);

  toast("تمت الإضافة ✅");
  renderRoute();
}

async function deleteCustomField(pageId, fieldIdx) {
  if (currentRole() !== "admin") return toast("غير مسموح", "bad");
  const page = await dbAPI.get("customPages", pageId);
  if (!page) return;
  page.fields = Array.isArray(page.fields) ? page.fields : [];
  if (!(fieldIdx>=0 && fieldIdx<page.fields.length)) return;
  if (!confirm("حذف الحقل؟ (لن نمسح القيم القديمة، بس ما راح تنعرض)")) return;
  page.fields.splice(fieldIdx, 1);
  page.updatedAt = Date.now();
  await dbAPI.put("customPages", page);
  toast("تم الحذف ✅");
  renderRoute();
}

async function addCustomRecord(pageId) {
  const page = await dbAPI.get("customPages", pageId);
  if (!page) return;

  const allowed = (page.allowedRoles || ["admin"]);
  if (!allowed.includes(currentRole())) return toast("ما عندك صلاحية", "bad");

  const fields = (Array.isArray(page.fields) ? page.fields : []);
  if (!fields.length) return toast("الصفحة ما بيها حقول بعد", "warn");

  const fmFields = fields.map(f => {
    if (f.type === "select") {
      return { name: f.name, label: f.label, type: "select", required: !!f.required, options: (f.options||[]).map(o => ({ value:o, label:o })) };
    }
    if (f.type === "textarea") return { name: f.name, label: f.label, type: "text", required: !!f.required };
    if (f.type === "checkbox") return { name: f.name, label: f.label + " (0/1)", type: "number", cast:"number", required: false, default: 0 };
    if (f.type === "date") return { name: f.name, label: f.label + " (YYYY-MM-DD)", type: "text", required: !!f.required, default: "" };
    return { name: f.name, label: f.label, type: f.type === "number" ? "number" : "text", cast: f.type === "number" ? "number" : undefined, required: !!f.required };
  });

  const out = await formModal({
    title: `إضافة: ${page.title || page.id}`,
    submitText: "حفظ",
    fields: fmFields,
  });
  if (!out) return;

  const values = {};
  for (const f of fields) {
    let v = out[f.name];
    if (f.type === "number") v = Number(v || 0);
    if (f.type === "checkbox") v = Number(v||0) ? true : false;
    if (f.type === "date") v = v ? tsFromYMD(String(v).trim()) : "";
    values[f.name] = v;
  }

  const now = Date.now();
  const rec = { id: "cd_" + uid().slice(3), pageId, values, createdAt: now, updatedAt: now };
  await dbAPI.put("customData", rec);
  toast("تمت الإضافة ✅");
  location.hash = `#/custom?id=${encodeURIComponent(pageId)}`;
  renderRoute();
}

async function editCustomRecord(pageId, recId) {
  const page = await dbAPI.get("customPages", pageId);
  if (!page) return;

  const allowed = (page.allowedRoles || ["admin"]);
  if (!allowed.includes(currentRole())) return toast("ما عندك صلاحية", "bad");

  const rec = await dbAPI.get("customData", recId);
  if (!rec || rec.pageId !== pageId) return;

  const fields = (Array.isArray(page.fields) ? page.fields : []);
  const vals = rec.values || {};

  const fmFields = fields.map(f => {
    let def = vals[f.name];
    if (f.type === "date" && def) def = ymdFromTs(Number(def));
    if (f.type === "checkbox") def = def ? 1 : 0;
    if (f.type === "select") {
      return { name: f.name, label: f.label, type: "select", required: !!f.required, options: (f.options||[]).map(o => ({ value:o, label:o })), default: def ?? "" };
    }
    if (f.type === "textarea") return { name: f.name, label: f.label, type: "text", required: !!f.required, default: def ?? "" };
    if (f.type === "checkbox") return { name: f.name, label: f.label + " (0/1)", type: "number", cast:"number", required: false, default: def ?? 0 };
    if (f.type === "date") return { name: f.name, label: f.label + " (YYYY-MM-DD)", type: "text", required: !!f.required, default: def ?? "" };
    return { name: f.name, label: f.label, type: f.type === "number" ? "number" : "text", cast: f.type === "number" ? "number" : undefined, required: !!f.required, default: def ?? "" };
  });

  const out = await formModal({
    title: `تعديل: ${page.title || page.id}`,
    submitText: "حفظ",
    fields: fmFields,
    initial: fmFields.reduce((a,f)=> (a[f.name]=f.default, a), {}),
  });
  if (!out) return;

  const values = {};
  for (const f of fields) {
    let v = out[f.name];
    if (f.type === "number") v = Number(v || 0);
    if (f.type === "checkbox") v = Number(v||0) ? true : false;
    if (f.type === "date") v = v ? tsFromYMD(String(v).trim()) : "";
    values[f.name] = v;
  }

  rec.values = values;
  rec.updatedAt = Date.now();
  await dbAPI.put("customData", rec);

  toast("تم الحفظ ✅");
  renderRoute();
}

async function deleteCustomRecord(pageId, recId) {
  const page = await dbAPI.get("customPages", pageId);
  if (!page) return;
  const allowed = (page.allowedRoles || ["admin"]);
  if (!allowed.includes(currentRole())) return toast("ما عندك صلاحية", "bad");
  if (!confirm("حذف السجل؟")) return;

  const rec = await dbAPI.get("customData", recId);
  if (rec && rec.pageId === pageId) await dbAPI.del("customData", recId);

  toast("تم الحذف ✅");
  renderRoute();
}

async function exportCustomPageCSV(pageId) {
  const page = await dbAPI.get("customPages", pageId);
  if (!page) return;
  const allowed = (page.allowedRoles || ["admin"]);
  if (!allowed.includes(currentRole())) return toast("ما عندك صلاحية", "bad");

  const fields = (Array.isArray(page.fields) ? page.fields : []);
  const rows = (await dbAPI.getAll("customData")).filter(r => r.pageId === pageId);

  let csv = "";
  csv += fields.map(f => csvEscape(f.label||f.name)).join(",") + ",CreatedAt,UpdatedAt,Id\n";
  for (const r of rows) {
    const v = r.values || {};
    const line = fields.map(f => {
      let val = v[f.name];
      if (f.type === "date" && val) val = ymdFromTs(Number(val));
      if (f.type === "checkbox") val = val ? "1" : "0";
      return csvEscape(val ?? "");
    }).join(",");
    csv += `${line},${csvEscape(fmtDate(r.createdAt||0))},${csvEscape(fmtDate(r.updatedAt||0))},${csvEscape(r.id)}\n`;
  }

  downloadBlob(`custom_${pageId}_${new Date().toISOString().slice(0,10)}.csv`, csv, "text/csv;charset=utf-8");
}

}



/* ------------------------ Activity Log ------------------------ */
async function fetchRecentActivity(limitN = 500) {
  const colPath = cloudColPath("activity");
  if (!colPath) return [];
  try {
    const colRef = collection(firestore, colPath);
    const q = query(colRef, orderBy("ts", "desc"), limit(limitN));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    // fallback
    try { return await dbAPI.getAll("activity"); } catch { return []; }
  }
}

function toISODate(ms) {
  try {
    const d = new Date(ms);
    return d.toISOString().slice(0,10);
  } catch { return ""; }
}

async function viewActivity(params) {
  const store = (params.get("store") || "").trim();
  const entityId = (params.get("id") || "").trim();
  const startStr = (params.get("start") || "").trim();
  const endStr = (params.get("end") || "").trim();

  const today = new Date();
  const todayStr = today.toISOString().slice(0,10);
  const startDefault = startStr || todayStr;
  const endDefault = endStr || startDefault;

  const startMs = Date.parse(startDefault + "T00:00:00Z");
  const endMs = Date.parse(endDefault + "T23:59:59Z");

  let items = await fetchRecentActivity(800);
  items = items.filter(a => {
    const ts = Number(a.ts || 0);
    if (isFinite(startMs) && ts < startMs) return false;
    if (isFinite(endMs) && ts > endMs) return false;
    if (store && String(a.store||"") !== store) return false;
    if (entityId && String(a.entityId||"") !== entityId) return false;
    return true;
  });

  // sort desc just in case
  items.sort((a,b)=>Number(b.ts||0)-Number(a.ts||0));

  const storeOptions = [''].concat(Object.keys(stores).filter(s=>!["activity"].includes(s))).map(s => {
    const label = s ? s : "الكل";
    const sel = s===store ? "selected" : "";
    return `<option value="${escapeHtml(s)}" ${sel}>${escapeHtml(label)}</option>`;
  }).join('');

  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div>
          <div class="section-title">سجل النشاط</div>
          <div class="small">يسجل كل إنشاء/تعديل/حذف/طباعة/رسائل…</div>
        </div>
        <a class="btn" href="#/more">رجوع</a>
      </div>

      <div class="hr"></div>

      <div class="grid3">
        <div>
          <div class="small" style="margin:4px 2px">من</div>
          <input id="acStart" class="input" type="date" value="${escapeHtml(startDefault)}" />
        </div>
        <div>
          <div class="small" style="margin:4px 2px">إلى</div>
          <input id="acEnd" class="input" type="date" value="${escapeHtml(endDefault)}" />
        </div>
        <div>
          <div class="small" style="margin:4px 2px">النوع</div>
          <select id="acStore" class="input">${storeOptions}</select>
        </div>
      </div>

      <div style="height:10px"></div>
      <div class="grid2">
        <div>
          <div class="small" style="margin:4px 2px">ID (اختياري)</div>
          <input id="acId" class="input" value="${escapeHtml(entityId)}" placeholder="مثال: wo_... أو inv_..." />
        </div>
        <div style="display:flex;align-items:flex-end;gap:10px">
          <button class="btn btn-primary" data-act="activityRun">عرض</button>
          <button class="btn" data-act="activityToday">اليوم</button>
        </div>
      </div>

      <div class="hr"></div>

      <div class="small" style="margin-bottom:8px">عدد السجلات: <b>${items.length}</b></div>

      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>الوقت</th><th>المستخدم</th><th>العملية</th><th>النوع</th><th>ID</th><th>ملاحظة</th>
          </tr></thead>
          <tbody>
            ${items.map(a => {
              const ts = new Date(Number(a.ts||0)).toLocaleString('ar-IQ');
              const who = (a.email||'') + (a.role?` (${roleLabel(a.role)})`: '');
              const act = escapeHtml(String(a.action||''));
              const st = escapeHtml(String(a.store||''));
              const eid = escapeHtml(String(a.entityId||''));
              const note = escapeHtml(String(a.note||''));
              return `<tr>
                <td class="mono">${escapeHtml(ts)}</td>
                <td>${escapeHtml(who||'')}</td>
                <td><span class="badge">${act||''}</span></td>
                <td>${st}</td>
                <td class="mono">${eid}</td>
                <td>${note}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>

      <div class="hr"></div>
      <div class="notice">
        تلميح: من داخل أمر الشغل/الفاتورة تگدرين تفتحين السجل مباشرة.
      </div>
    </div>
  `;
}

async function viewBackup() {
  return `
    <div class="card">
      <div class="section-title">نسخ احتياطي</div>
      <div class="small">سحب/استيراد نسخة سحابة (JSON)</div>
      <div class="hr"></div>

      <div class="row">
        <div class="col">
          <div class="card subcard">
            <div class="section-title">Export</div>
            <div class="small">تنزيل نسخة احتياطية</div>
            <div class="hr"></div>
            <label class="small" style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
              <input type="checkbox" id="includeActivity" checked /> تضمين سجل النشاط (قد يكبر حجم الملف)
            </label>
            <button class="btn btn-primary" data-act="export">سحب نسخة حالية</button>
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

  if (firebaseBlocked) {
    return `
      <div class="card">
        <div class="section-title">الحساب</div>
        <div class="notice">Firebase محجوب/فشل تحميله (CORB/شبكة). هذا الإصدار سحابي فقط، لازم تتأكدين أن gstatic/firebase مو محجوب.</div>
        <div class="hr"></div>
        <div class="small">جربي: DNS مختلف، إيقاف AdBlock/VPN، أو شبكة ثانية.</div>
      </div>
    `;
  }

  if (!u) {
    return `
      <div class="card">
        <div class="section-title">تسجيل الدخول</div>
        <div class="small">هذا الإصدار <b>سحابي فقط</b> (Firebase). لازم تسجلين دخول حتى يشتغل.</div>
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
          <b>مهم:</b> فعّلي Firestore وAuth بالمشروع، وخلي Rules تسمح لمستخدمي الكراج.
          (إذا تريدين، أكتب لج Rules جاهزة تناسب RBAC.)
        </div>
      </div>
    `;
  }

  const email = u.email || "(بدون ايميل)";

  return `
    <div class="card">
      <div class="section-title">الحساب</div>
      <div class="small">حالتك: سحابة ✅</div>
      <div class="hr"></div>

      <div class="row" style="align-items:center; gap:10px; flex-wrap:wrap">
        <span class="badge">${escapeHtml(email)}</span>
        <span class="small">UID: ${escapeHtml(String(u.uid).slice(0, 8))}…</span>
        <span class="badge">الدور: ${escapeHtml(roleLabel(currentRole()))}</span>
      </div>

      <div class="hr"></div>
      <div class="grid2">
        <a class="btn" href="#/roles">إدارة الصلاحيات</a>
        <a class="btn" href="#/activity">سجل النشاط</a>
      </div>

      <div class="hr"></div>
      <button class="btn btn-danger" data-act="authSignOut">تسجيل خروج</button>
    </div>
  `;
}

async function viewMore() {
  const myRole = currentRole();
  const allPages = await dbAPI.getAll("customPages");
  const pages = allPages.filter(p => (p.allowedRoles || ["admin"]).includes(myRole))
    .sort((a,b)=>(a.title||"").localeCompare(b.title||"", "ar"));

  const customSection = pages.length ? `
    <div class="hr"></div>
    <div class="card subcard">
      <div class="section-title">صفحات مخصصة</div>
      <div class="small">صفحات تم إنشاؤها من الادمن (بدون كود)</div>
      <div class="hr"></div>
      <div class="grid2">
        ${pages.map(p => `<a class="btn btn-primary" href="#/custom?id=${encodeURIComponent(p.id)}">${escapeHtml(p.title||p.id)}</a>`).join("")}
      </div>
    </div>
  ` : ``;

  const adminTools = myRole === "admin" ? `
    <a class="btn" href="#/pagebuilder">إدارة الصفحات (No‑code)</a>
  ` : ``;

  const fullReportLink = canAccessRoute("reportfull") ? `<a class="btn" href="#/reportfull">تقرير كامل</a>` : ``;

  return `
    <div class="card">
      <div class="section-title">المزيد</div>
      <div class="small">روابط للموبايل + أدوات الادمن</div>
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
        <a class="btn" href="#/activity">سجل النشاط</a>
        <a class="btn" href="#/reports">التقارير</a>
        ${fullReportLink}
        <a class="btn" href="#/backup">نسخ احتياطي</a>
        ${adminTools}
      </div>

      ${customSection}

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
        إذا تحبين نضيف: صلاحيات أدق لكل زر/ميزة، أو تقارير متقدمة PDF/Excel، أو منشئ صفحات أقوى (Tabs + Widgets).
      </div>
    </div>
  `;
}


/* ------------------------ Render ------------------------ */
async function renderRoute() {
  const { route, params } = parseHash();
  state.route = route;

  // Cloud-only: لازم تسجيل دخول
  if (!authState.user && route !== 'auth') {
    location.hash = '#/auth';
    return;
  }

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
  const label = 'سحابة';
  const who = authState.user ? (authState.user.email || String(authState.user.uid).slice(0, 6) + '…') : '';
  const rLabel = roleLabel(currentRole());
  $("#todayBadge").textContent = `اليوم: ${d.toLocaleDateString("ar-IQ")} • ${label}${who ? " • " + who : ""} • ${rLabel}`;

  const view = $("#view");
  view.innerHTML = `<div class="notice">... جاري التحميل</div>`;

  let html = "";
  if (route === "dashboard") html = await viewDashboard();
  if (route === "checkin") html = await viewCheckin(params);
  if (route === "orders") html = await viewOrders();
  if (route === "workboard") html = await viewWorkBoard(params);
  if (route === "order") html = await viewOrderDetails(params.get("id") || "");
  if (route === "customers") html = await viewCustomers(params);
  if (route === "customer") html = await viewCustomerDetails(params.get("id") || "");
  if (route === "vehicles") html = await viewVehicles();
  if (route === "vehicle") html = await viewVehicleDetails(params.get("id") || "");
  if (route === "oil") html = await viewOil(params);
  if (route === "inventory") html = await viewInventory(params);
  if (route === "invoices") html = await viewInvoices();
  if (route === "employees") html = await viewEmployees();
  if (route === "reports") html = await viewReports();
  if (route === "reportfull") html = await viewReportFull(params);
  if (route === "expenses") html = await viewExpenses();
  if (route === "appointments") html = await viewAppointments(params);
  if (route === "roles") html = await viewRoles();
  if (route === "pagebuilder") html = await viewPageBuilder();
  if (route === "custom") html = await viewCustomPage(params);
  if (route === "backup") html = await viewBackup();
  if (route === "dedupe") html = await viewDedupeCustomers();
  if (route === "activity") html = await viewActivity(params);
  if (route === "more") html = await viewMore();
  if (route === "auth") html = await viewAuth();

  view.innerHTML = html;


  // Workboard: Kanban interactions
  if (route === "workboard") {
    const cb = $("#wbShowDelivered");
    if (cb) cb.addEventListener("change", () => {
      const show = cb.checked ? "1" : "0";
      location.hash = `#/workboard?show=${show}`;
    });

    // Drag & drop
    $$(".kanban-card").forEach(card => {
      card.addEventListener("dragstart", (e) => {
        card.classList.add("is-dragging");
        e.dataTransfer.setData("text/plain", card.dataset.wo || "");
      });
      card.addEventListener("dragend", () => card.classList.remove("is-dragging"));
    });

    $$(".kanban-dropzone").forEach(zone => {
      zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("is-over"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
      zone.addEventListener("drop", async (e) => {
        e.preventDefault();
        zone.classList.remove("is-over");
        const woId = e.dataTransfer.getData("text/plain");
        const stage = zone.dataset.stage || "new";
        if (!woId) return;
        const wo = await dbAPI.get("workOrders", woId);
        if (!wo) return;
        const prev = wo.stage || "new";
        if (prev === stage) return;
        wo.stage = stage;
        wo.stageUpdatedAt = Date.now();
        wo.updatedAt = Date.now();
        await dbAPI.put("workOrders", wo, { note: `تغيير حالة أمر الشغل: ${prev} → ${stage}` });
        renderRoute();
      });
    });
  }

  // Oil: auto-calc next odo
  if (route === "oil") {
    const cur = $("#oilCurrentOdo");
    const interval = $("#oilInterval");
    const next = $("#oilNextOdo");

    // Fluids UI
    const kindSel = $("#oilServiceKind");
    const fluidSel = $("#oilFluidId");
    const litersInp = $("#oilLiters");
    const calcBox = $("#oilFluidCalc");
    const oilPriceInp = $("#oilPrice");

    const fluids = await dbAPI.getAll("fluids");
    const fMap = new Map(fluids.map(f => [f.id, f]));

    const applyFluidFilter = () => {
      const cat = kindSel?.value || "engine";
      if (!fluidSel) return;
      Array.from(fluidSel.options).forEach(opt => {
        const oc = opt.getAttribute("data-cat");
        if (!oc) return; // first option
        opt.hidden = (oc !== cat);
      });
      const selOpt = fluidSel.selectedOptions?.[0];
      if (selOpt?.getAttribute("data-cat") && selOpt.getAttribute("data-cat") !== cat) {
        fluidSel.value = "";
      }
      recalcFluid();
    };

    const recalcFluid = () => {
      if (!calcBox) return;
      const fid = (fluidSel?.value || "").trim();
      const liters = Number(litersInp?.value || 0);
      if (!fid || !(liters > 0)) {
        calcBox.style.display = "none";
        calcBox.textContent = "";
        return;
      }
      const f = fMap.get(fid);
      if (!f) {
        calcBox.style.display = "none";
        return;
      }
      const unit = Number(f.sellPerLiter||0);
      const total = liters * unit;
      const remaining = Number(f.liters||0) - liters;
      const warn = remaining < 0 ? ` ⚠️ الرصيد غير كافي (المتوفر ${fmtLiters(f.liters)}L)` : ``;
      calcBox.style.display = "block";
      calcBox.textContent = `${fluidCatLabel(f.category)} • ${f.name}${f.spec?" • "+f.spec:""} — ${fmtLiters(liters)}L × ${money(unit)} = ${money(total)}${warn}`;

      // لتجنب تكرار الحسبة: إذا مستخدمة سوائل، خلي سعر الدهن اليدوي صفر افتراضياً
      if (oilPriceInp && Number(oilPriceInp.value||0) > 0) {
        // ما نغيّره إجباري، بس ننبه بالـ placeholder
        oilPriceInp.placeholder = "تنبيه: اخترتي مادة من المخزون، لا تضيفين سعر يدوي إلا إذا تريدين";
      }
    };

    const recalc = () => {
      const c = Number(cur.value || 0);
      const it = Number(interval.value || 5000);
      if (c > 0) next.value = String(c + it);
    };

    cur?.addEventListener("input", recalc);
    interval?.addEventListener("change", recalc);

    kindSel?.addEventListener("change", applyFluidFilter);
    fluidSel?.addEventListener("change", recalcFluid);
    litersInp?.addEventListener("input", recalcFluid);

    // init
    applyFluidFilter();

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
  const rec = t?.dataset?.rec;

  // More: save garage info (print header)
  if (act === "saveShop") {
    const name = ($("#shopName")?.value || "").trim();
    const phone = ($("#shopPhone")?.value || "").trim();
    const address = ($("#shopAddress")?.value || "").trim();
    await setShop({ name: name || DEFAULT_SHOP.name, phone, address });
    toast("تم حفظ بيانات الكراج ✅");
    return;
  }


  // Report Full
  if (act === "reportFullRun") {
    const start = ($("#rfStart")?.value || "").trim();
    const end = ($("#rfEnd")?.value || start).trim();
    location.hash = `#/reportfull?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
    return;
  }
  if (act === "reportFullPrint") return printFullReport();
  if (act === "reportFullExport") return exportFullReportCSV();

  // Vehicle Report (inside vehicle page)
  if (act === "carReportRun") {
    const vehicleId = (t.dataset.id || ($("#crVehicleId")?.value) || "").trim();
    const start = ($("#crStart")?.value || ymdToday()).trim();
    const end = ($("#crEnd")?.value || start).trim();
    location.hash = `#/vehicle?id=${encodeURIComponent(vehicleId)}&tab=report&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
    return;
  }
  if (act === "carReportToday") {
    const vehicleId = (t.dataset.id || ($("#crVehicleId")?.value) || "").trim();
    const today = ymdToday();
    location.hash = `#/vehicle?id=${encodeURIComponent(vehicleId)}&tab=report&start=${encodeURIComponent(today)}&end=${encodeURIComponent(today)}`;
    return;
  }
  if (act === "carReportPrint") return printVehicleReport();
  if (act === "carReportExport") return exportVehicleReportCSV();

  // Vehicle QR + Vehicle File PDF
  if (act === "vehicleQR") return printVehicleQR(id);
  if (act === "vehicleFilePDF") return printVehicleFilePDF(id);



  // Custom Pages (Admin)
  if (act === "cpCreate") return createCustomPage();
  if (act === "cpDelete") return deleteCustomPage(id);
  if (act === "cpEdit") return editCustomPageMeta(id);
  if (act === "cpAddField") return addCustomField(id);
  if (act === "cpDelField") return deleteCustomField(id, Number(idx));

  // Custom Data
  if (act === "cdAdd") return addCustomRecord(id);
  if (act === "cdEdit") return editCustomRecord(id, rec);
  if (act === "cdDelete") return deleteCustomRecord(id, rec);
  if (act === "cdExport") return exportCustomPageCSV(id);



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
  if (act === "newFluid") return createFluid();
  if (act === "stockAdd") return adjustStock(id, +1);
  if (act === "stockSub") return adjustStock(id, -1);
  if (act === "deletePart") return deletePart(id);

  if (act === "fluidAdd") return adjustFluidLiters(id, +1);
  if (act === "fluidSub") return adjustFluidLiters(id, -1);
  if (act === "deleteFluid") return deleteFluid(id);

  if (act === "createWO") return createWorkOrderFromCheckin();
  if (act === "deleteWO") return deleteWorkOrder(id);
  if (act === "makeInvoice") return createInvoiceForWO(id);

  if (act === "openWO") { location.hash = `#/order?id=${encodeURIComponent(id)}`; return; }
  if (act === "woMsgReady") return messageWorkOrderReady(id);

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
  if (act === "excelExport") {
    const kind = t?.dataset?.kind;
    await writeActivity({ action: "EXPORT", store: "excel", entityId: String(kind||""), note: "Excel export" });
    return excelExport(kind);
  }
  if (act === "excelImport") {
    await writeActivity({ action: "IMPORT", store: "excel", entityId: String($("#excelKind")?.value||""), note: "Excel import" });
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
    const phoneKey = t?.dataset?.phone || "";
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
    if (!ok) return toast('تعذر تحميل Firebase (CORB/شبكة). هذا الإصدار سحابي فقط.', 'bad', 5200);

    try {
      await signInWithEmailAndPassword(auth, email, pass);
      toast("تم تسجيل الدخول ✅");
      toast('السحابة جاهزة ✅');
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
    if (!ok) return toast('تعذر تحميل Firebase (CORB/شبكة). هذا الإصدار سحابي فقط.', 'bad', 5200);

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

  // Cloud-only: لا يوجد محلي/مزامنة
  if (act === 'useCloud' || act === 'useLocal' || act === 'syncUp' || act === 'syncDown') {
    toast('هذا الإصدار سحابي فقط ✅', 'ok');
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
  // Cloud-only: ثبتينا Root (مقترح للـ RBAC وتعدد المستخدمين)
  Settings.set("cloudScope", "root");

  const ok = await startAuthListenerIfNeeded();
  if (!ok) {
    firebaseBlocked = true;
    // اعرض صفحة الحساب فوراً
    location.hash = "#/auth";
    return renderRoute();
  }

  if (!location.hash) location.hash = "#/auth";
  renderRoute();
})()
async function messageWorkOrderReady(workOrderId) {
  const wo = await dbAPI.get("workOrders", workOrderId);
  if (!wo) return alert("أمر الشغل غير موجود.");
  const c = await dbAPI.get("customers", wo.customerId);
  const v = await dbAPI.get("vehicles", wo.vehicleId);
  const phone = c?.phone || c?.mobile || "";
  const plate = v?.plate || v?.plateNo || v?.plateNumber || "—";
  const shop = getShop();
  const msg = `السلام عليكم 🌿\n${c?.name || "زبوننا العزيز"}\nسيارتك (${plate}) أصبحت جاهزة للاستلام ✅\nإذا تحتاج أي استفسار: ${shop.phone || ""}\n— ${shop.name || "RPM"}`;
  await writeActivity({ action:"MESSAGE", store:"workOrders", entityId: workOrderId, note:"رسالة جاهزية (WhatsApp/SMS)", meta:{ phone, vehicleId: wo.vehicleId, customerId: wo.customerId } });
  openMessageChooser(phone, msg);
}

;