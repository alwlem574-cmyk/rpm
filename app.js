// app.js
// RPM Front-end (9 ميزات) — 3 ملفات فقط
// - SPA Router + Dashboard + Kanban + Invoices/Print/QR + Services/Cart
// - Ctrl+K (Command Palette) + Draft AutoSave + Undo/Redo
// - IndexedDB + Export/Import/CSV
// - PWA Offline (Service Worker داخل نفس الملف)
// - Voice Commands + Startup Sound (WebAudio) + QR Scanner (Camera)

const IS_SERVICE_WORKER = (typeof window === "undefined") || (typeof self !== "undefined" && !("document" in self));
if (IS_SERVICE_WORKER) {
  // =========================
  // Service Worker (Offline)
  // =========================
  const CACHE = "rpm-cache-v1";
  const CORE = [
    "./",
    "./index.html",
    "./styles.css",
    "./app.js",
  ];

  self.addEventListener("install", (e) => {
    e.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(CORE);
      self.skipWaiting();
    })());
  });

  self.addEventListener("activate", (e) => {
    e.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => (k === CACHE ? null : caches.delete(k))));
      self.clients.claim();
    })());
  });

  self.addEventListener("fetch", (e) => {
    const req = e.request;
    // network-first للـ HTML، cache-first للباقي
    const isHTML = req.headers.get("accept")?.includes("text/html");
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      if (isHTML) {
        try {
          const fresh = await fetch(req);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          return (await cache.match(req)) || (await cache.match("./index.html"));
        }
      } else {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const fresh = await fetch(req);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          return hit || Response.error();
        }
      }
    })());
  });

  // إنهاء مبكر: لا تكمل كود الواجهة
} else {
  // =========================
  // App (UI + Logic)
  // =========================
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  const fmtIQD = (n) => `${Math.round(n).toLocaleString("ar-IQ")} د.ع`;
  const fmtDate = (d = Date.now()) => new Intl.DateTimeFormat("ar-IQ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(d));
  const nowISO = () => new Date().toISOString();

  const uid = () => {
    try { return crypto.randomUUID(); } catch { return "id_" + Math.random().toString(16).slice(2) + "_" + Date.now(); }
  };

  // ---------- IndexedDB (بسيط) ----------
  const DB_NAME = "rpm_db";
  const DB_VER = 1;
  const STORE = "kv";

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const st = tx.objectStore(STORE);
      const req = st.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(key, val) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      const req = st.put(val, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbDel(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      const req = st.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  // ---------- State ----------
  const state = {
    settings: {
      theme: "dark",
      sound: true,
      voice: true,
      accent: "#7c5cff",
    },
    data: {
      customers: [],
      cars: [],
      workOrders: [],
      invoices: [],
      services: [],
    },
    cart: [],
    history: { undo: [], redo: [] },
    bootPlayed: false,
  };

  // ---------- Toast ----------
  function toast(title, msg = "", kind = "info") {
    const host = $("#toasts");
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `
      <div>
        <div class="toastTitle">${escapeHTML(title)}</div>
        <div class="toastMsg">${escapeHTML(msg)}</div>
      </div>
      <button class="iconBtn" style="width:36px;height:36px;border-radius:14px" aria-label="إغلاق">✕</button>
    `;
    el.querySelector("button").onclick = () => el.remove();
    host.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  // ---------- Modal ----------
  function openModal({ title, bodyNode, actions = [] }) {
    const host = $("#modalHost");
    host.hidden = false;
    host.innerHTML = "";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modalTop">
        <div class="modalTitle">${escapeHTML(title || "")}</div>
        <button class="iconBtn" id="mClose" title="إغلاق">✕</button>
      </div>
      <div class="modalBody" id="mBody"></div>
      <div class="modalActions" id="mActions"></div>
    `;
    host.appendChild(modal);
    $("#mBody", modal).appendChild(bodyNode);

    const actionsEl = $("#mActions", modal);
    actions.forEach(a => {
      const b = document.createElement("button");
      b.className = `btn ${a.kind || "ghost"}`;
      b.textContent = a.text;
      b.onclick = async () => {
        const res = await a.onClick?.();
        if (res !== false) closeModal();
      };
      actionsEl.appendChild(b);
      if (a.primary) b.dataset.primary = "1";
    });

    const close = () => closeModal();
    $("#mClose", modal).onclick = close;
    host.onclick = (e) => { if (e.target === host) close(); };
    window.addEventListener("keydown", escCloseOnce, { once: true });

    function escCloseOnce(e) {
      if (e.key === "Escape") close();
    }

    // Ctrl+S = primary
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const p = modal.querySelector('[data-primary="1"]');
        if (p) p.click();
      }
    };
    window.addEventListener("keydown", onKey);
    modal.dataset.keyListener = "1";
    modal._cleanup = () => window.removeEventListener("keydown", onKey);

    return modal;
  }

  function closeModal() {
    const host = $("#modalHost");
    const modal = $(".modal", host);
    if (modal?._cleanup) modal._cleanup();
    host.hidden = true;
    host.innerHTML = "";
  }

  // ---------- Escape HTML ----------
  function escapeHTML(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ---------- Undo/Redo ----------
  function pushHistory(label, undoFn, redoFn) {
    state.history.undo.push({ label, undoFn, redoFn });
    state.history.redo.length = 0;
  }
  async function undo() {
    const a = state.history.undo.pop();
    if (!a) return toast("لا يوجد تراجع", "نفذت عمليات التراجع");
    await a.undoFn();
    state.history.redo.push(a);
    toast("تراجع", a.label);
    render();
  }
  async function redo() {
    const a = state.history.redo.pop();
    if (!a) return toast("لا يوجد إعادة", "نفذت عمليات الإعادة");
    await a.redoFn();
    state.history.undo.push(a);
    toast("إعادة", a.label);
    render();
  }

  // ---------- Draft Autosave ----------
  function bindDraft(formEl, key) {
    const k = `draft:${key}`;
    const saved = localStorage.getItem(k);
    if (saved) {
      try {
        const obj = JSON.parse(saved);
        $$("[name]", formEl).forEach(inp => {
          if (obj[inp.name] != null) inp.value = obj[inp.name];
        });
      } catch {}
    }
    const save = () => {
      const obj = {};
      $$("[name]", formEl).forEach(inp => { obj[inp.name] = inp.value; });
      localStorage.setItem(k, JSON.stringify(obj));
    };
    formEl.addEventListener("input", save);
    return {
      clear() { localStorage.removeItem(k); }
    };
  }

  // ---------- Storage load/save ----------
  async function loadAll() {
    const [settings, customers, cars, workOrders, invoices, services, cart] = await Promise.all([
      idbGet("settings"),
      idbGet("customers"),
      idbGet("cars"),
      idbGet("workOrders"),
      idbGet("invoices"),
      idbGet("services"),
      idbGet("cart"),
    ]);

    if (settings) state.settings = { ...state.settings, ...settings };
    state.data.customers = customers || [];
    state.data.cars = cars || [];
    state.data.workOrders = workOrders || [];
    state.data.invoices = invoices || [];
    state.data.services = services || [];
    state.cart = cart || [];

    // Seed أول مرة
    if (!services || services.length === 0) {
      state.data.services = seedServices();
    }
    if (!customers || customers.length === 0) {
      const seeded = seedCustomers();
      state.data.customers = seeded.customers;
      state.data.cars = seeded.cars;
      state.data.workOrders = seeded.workOrders;
      state.data.invoices = seeded.invoices;
    }

    applyTheme(state.settings.theme);
    applyAccent(state.settings.accent);
  }

  async function saveAll() {
    await Promise.all([
      idbSet("settings", state.settings),
      idbSet("customers", state.data.customers),
      idbSet("cars", state.data.cars),
      idbSet("workOrders", state.data.workOrders),
      idbSet("invoices", state.data.invoices),
      idbSet("services", state.data.services),
      idbSet("cart", state.cart),
    ]);
  }

  // ---------- Seeds ----------
  function seedServices() {
    return [
      { id: uid(), name: "تبديل دهن", price: 15000, minutes: 15, icon: "🛢️" },
      { id: uid(), name: "تبديل فلتر", price: 8000, minutes: 10, icon: "🧼" },
      { id: uid(), name: "فحص كمبيوتر", price: 25000, minutes: 20, icon: "💻" },
      { id: uid(), name: "فرامل", price: 30000, minutes: 30, icon: "🛑" },
      { id: uid(), name: "تبديل بواجي", price: 18000, minutes: 25, icon: "⚡" },
      { id: uid(), name: "ميزان/ترصيص", price: 20000, minutes: 25, icon: "🛞" },
    ];
  }

  function seedCustomers() {
    const c1 = { id: uid(), name: "علي كريم", phone: "07701234567", createdAt: Date.now() - 86400000 * 4 };
    const c2 = { id: uid(), name: "سارة حسن", phone: "07809876543", createdAt: Date.now() - 86400000 * 2 };
    const car1 = { id: uid(), customerId: c1.id, plate: "بغداد 12345", model: "Toyota Camry 2014" };
    const car2 = { id: uid(), customerId: c2.id, plate: "بابل 67890", model: "Kia Sportage 2018" };

    const wo1 = {
      id: uid(),
      createdAt: Date.now() - 86400000,
      updatedAt: Date.now() - 3600000,
      status: "in_progress",
      customerId: c1.id,
      carId: car1.id,
      customerName: c1.name,
      plate: car1.plate,
      notes: "صوت خفيف بالمحرك، يحتاج فحص سريع.",
      items: [{ name: "تبديل دهن", price: 15000 }, { name: "تبديل فلتر", price: 8000 }],
      total: 23000
    };

    const inv1 = {
      id: uid(),
      invoiceNo: "INV-" + String(Math.floor(Math.random() * 90000) + 10000),
      date: Date.now() - 3600000 * 6,
      customerName: c1.name,
      customerPhone: c1.phone,
      plate: car1.plate,
      carModel: car1.model,
      items: wo1.items,
      discount: 0,
      subtotal: 23000,
      total: 23000,
      paid: 23000,
      notes: "شكراً لزيارتكم ❤️",
    };

    return {
      customers: [c1, c2],
      cars: [car1, car2],
      workOrders: [wo1],
      invoices: [inv1],
    };
  }

  // ---------- Theme ----------
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    state.settings.theme = theme;
    idbSet("settings", state.settings).catch(()=>{});
  }
  function applyAccent(accent) {
    document.documentElement.style.setProperty("--accent", accent);
    state.settings.accent = accent;
    idbSet("settings", state.settings).catch(()=>{});
  }

  // ---------- PWA register ----------
  async function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    try {
      await navigator.serviceWorker.register("./app.js?sw=1", { scope: "./" });
      // لا نزعج المستخدم بتوست كل مرة
    } catch {
      // ignore
    }
  }

  // ---------- Startup sound (WebAudio) ----------
  function playStartupSound() {
    if (!state.settings.sound) return;
    if (state.bootPlayed) return;
    state.bootPlayed = true;

    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ctx.currentTime;

      // "engine-ish" sound
      const o1 = ctx.createOscillator();
      const o2 = ctx.createOscillator();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();

      o1.type = "sawtooth";
      o2.type = "square";
      o1.frequency.setValueAtTime(110, t0);
      o2.frequency.setValueAtTime(55, t0);

      f.type = "lowpass";
      f.frequency.setValueAtTime(600, t0);

      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);

      o1.connect(f); o2.connect(f);
      f.connect(g); g.connect(ctx.destination);

      o1.start(t0); o2.start(t0);
      o1.stop(t0 + 0.6); o2.stop(t0 + 0.6);
    } catch {}
  }

  // ---------- Command Palette (Ctrl+K) ----------
  function openPalette(prefill = "") {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="row" style="gap:10px;align-items:stretch">
        <div class="field" style="flex:1;min-width:260px">
          <label>ابحث أو نفّذ أمر</label>
          <input name="q" placeholder="مثال: فاتورة علي… | افتح الفواتير | أمر عمل جديد" autocomplete="off" />
        </div>
        <div class="card" style="padding:10px;display:flex;align-items:center;gap:10px">
          <span class="pill">Enter</span>
          <span class="muted">فتح</span>
        </div>
      </div>
      <div class="hr"></div>
      <div id="results"></div>
    `;
    const inp = $('input[name="q"]', wrap);
    inp.value = prefill;

    const commands = [
      { title: "افتح الرئيسية", run: () => goto("#/dashboard") },
      { title: "افتح أوامر العمل", run: () => goto("#/workorders") },
      { title: "افتح الخدمات والسلة", run: () => goto("#/services") },
      { title: "افتح الزبائن", run: () => goto("#/customers") },
      { title: "افتح الفواتير", run: () => goto("#/invoices") },
      { title: "أمر عمل جديد", run: () => openCreateWorkOrder() },
      { title: "فاتورة جديدة (من السلة)", run: () => goto("#/services") },
      { title: "مسح QR بالكاميرا", run: () => openScanner() },
      { title: "الإعدادات", run: () => openSettings() },
      { title: "تراجع (Ctrl+Z)", run: () => undo() },
      { title: "إعادة (Ctrl+Y)", run: () => redo() },
    ];

    function renderResults(q) {
      const resEl = $("#results", wrap);
      const term = (q || "").trim().toLowerCase();
      const items = [];

      // commands
      commands
        .filter(c => !term || c.title.toLowerCase().includes(term))
        .slice(0, 7)
        .forEach(c => items.push({ type: "cmd", title: c.title, sub: "أمر", run: c.run }));

      // search customers
      const cust = state.data.customers
        .filter(c => (c.name + " " + c.phone).toLowerCase().includes(term))
        .slice(0, 6)
        .map(c => ({ type: "cust", title: c.name, sub: c.phone, run: () => openCustomer(c.id) }));
      items.push(...cust);

      // work orders
      const wos = state.data.workOrders
        .filter(w => (w.customerName + " " + w.plate).toLowerCase().includes(term))
        .slice(0, 6)
        .map(w => ({ type: "wo", title: `أمر عمل — ${w.plate}`, sub: w.customerName, run: () => openWorkOrder(w.id) }));
      items.push(...wos);

      // invoices
      const inv = state.data.invoices
        .filter(i => (i.invoiceNo + " " + i.customerName + " " + i.plate).toLowerCase().includes(term))
        .slice(0, 6)
        .map(i => ({ type: "inv", title: `فاتورة ${i.invoiceNo}`, sub: i.customerName, run: () => goto(`#/invoice/${i.id}`) }));
      items.push(...inv);

      if (items.length === 0) {
        resEl.innerHTML = `<div class="muted">لا نتائج…</div>`;
        return;
      }

      resEl.innerHTML = "";
      items.slice(0, 14).forEach((it, idx) => {
        const row = document.createElement("div");
        row.className = "cartItem";
        row.style.cursor = "pointer";
        row.innerHTML = `
          <div>
            <div class="woTitle">${escapeHTML(it.title)}</div>
            <div class="muted">${escapeHTML(it.sub || "")}</div>
          </div>
          <span class="pill">${escapeHTML(it.type)}</span>
        `;
        row.onclick = () => it.run();
        resEl.appendChild(row);
        if (idx === 0) row.dataset.first = "1";
      });
    }

    renderResults(inp.value);

    inp.addEventListener("input", () => renderResults(inp.value));
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const first = wrap.querySelector('[data-first="1"]');
        if (first) first.click();
      }
    });

    openModal({
      title: "لوحة الأوامر والبحث (Ctrl+K)",
      bodyNode: wrap,
      actions: [
        { text: "إغلاق", kind: "ghost" }
      ]
    });

    setTimeout(() => inp.focus(), 50);
  }

  // ---------- Router ----------
  function currentRoute() {
    const h = location.hash || "#/dashboard";
    const raw = h.replace(/^#/, "");
    const parts = raw.split("/").filter(Boolean);
    const name = parts[0] || "dashboard";
    const param = parts[1] || "";
    return { name, param };
  }

  function goto(hash) {
    location.hash = hash;
  }

  function setActiveNav(routeName) {
    $$(".navItem").forEach(a => a.classList.toggle("active", a.dataset.route === routeName));
    $$("#bottomNav a").forEach(a => a.classList.toggle("active", a.dataset.route === routeName));
  }

  // ---------- Render ----------
  function render() {
    const { name, param } = currentRoute();
    setActiveNav(name);

    const view = $("#view");
    view.innerHTML = "";

    if (name === "dashboard") view.appendChild(pageDashboard());
    else if (name === "workorders") view.appendChild(pageWorkOrders());
    else if (name === "services") view.appendChild(pageServices());
    else if (name === "customers") view.appendChild(pageCustomers());
    else if (name === "invoices") view.appendChild(pageInvoices());
    else if (name === "invoice") view.appendChild(pageInvoice(param));
    else view.appendChild(pageNotFound());
  }

  function pageNotFound() {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<div class="cardTitle">الصفحة غير موجودة</div><div class="muted">ارجعي للرئيسية.</div>`;
    return el;
  }

  // ---------- Dashboard ----------
  function pageDashboard() {
    const el = document.createElement("div");

    const today = new Date();
    const startDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const invToday = state.data.invoices.filter(i => i.date >= startDay);
    const sumToday = invToday.reduce((a, b) => a + (b.total || 0), 0);

    const wosOpen = state.data.workOrders.filter(w => w.status !== "delivered");
    const topService = mostUsedService();

    el.innerHTML = `
      <div class="grid">
        <div class="card" style="grid-column: span 4">
          <div class="cardHeader">
            <div class="cardTitle">دخل اليوم</div>
            <span class="pill good">${fmtIQD(sumToday)}</span>
          </div>
          <div class="muted">عدد فواتير اليوم: ${invToday.length}</div>
        </div>

        <div class="card" style="grid-column: span 4">
          <div class="cardHeader">
            <div class="cardTitle">أوامر العمل المفتوحة</div>
            <span class="pill warn">${wosOpen.length}</span>
          </div>
          <div class="muted">سحّبي الكروت بالكانبان لتغيير الحالة.</div>
        </div>

        <div class="card" style="grid-column: span 4">
          <div class="cardHeader">
            <div class="cardTitle">الأكثر طلباً</div>
            <span class="pill">${escapeHTML(topService?.name || "—")}</span>
          </div>
          <div class="muted">مستخرج من السجل المحلي.</div>
        </div>
      </div>

      <div class="grid">
        <div class="card" style="grid-column: span 7">
          <div class="cardHeader">
            <div class="cardTitle">آخر أوامر العمل</div>
            <div class="row">
              <button class="btn" id="dashNewWO">+ أمر عمل</button>
              <button class="btn ghost" id="dashUndo">تراجع</button>
              <button class="btn ghost" id="dashRedo">إعادة</button>
            </div>
          </div>
          <div class="hr"></div>
          <div id="dashWO"></div>
        </div>

        <div class="card" style="grid-column: span 5">
          <div class="cardHeader">
            <div class="cardTitle">آخر الفواتير</div>
            <button class="btn ghost" id="dashCSV">تصدير CSV</button>
          </div>
          <div class="hr"></div>
          <div id="dashInv"></div>
        </div>
      </div>
    `;

    $("#dashNewWO", el).onclick = () => openCreateWorkOrder();
    $("#dashUndo", el).onclick = () => undo();
    $("#dashRedo", el).onclick = () => redo();
    $("#dashCSV", el).onclick = () => exportCSV();

    // list WOs
    const woWrap = $("#dashWO", el);
    const wos = [...state.data.workOrders].sort((a,b)=> (b.updatedAt||0)-(a.updatedAt||0)).slice(0, 6);
    if (wos.length === 0) woWrap.innerHTML = `<div class="muted">لا يوجد أوامر عمل…</div>`;
    else {
      woWrap.innerHTML = "";
      wos.forEach(w => {
        const row = document.createElement("div");
        row.className = "cartItem";
        row.style.cursor = "pointer";
        row.innerHTML = `
          <div>
            <div class="woTitle">${escapeHTML(w.plate)} — ${escapeHTML(w.customerName)}</div>
            <div class="muted">${escapeHTML(statusLabel(w.status))} • ${fmtDate(w.updatedAt || w.createdAt)}</div>
          </div>
          <span class="pill">${fmtIQD(w.total || 0)}</span>
        `;
        row.onclick = () => openWorkOrder(w.id);
        woWrap.appendChild(row);
      });
    }

    // list invoices
    const invWrap = $("#dashInv", el);
    const invs = [...state.data.invoices].sort((a,b)=> (b.date||0)-(a.date||0)).slice(0, 6);
    if (invs.length === 0) invWrap.innerHTML = `<div class="muted">لا يوجد فواتير…</div>`;
    else {
      invWrap.innerHTML = "";
      invs.forEach(i => {
        const row = document.createElement("div");
        row.className = "cartItem";
        row.style.cursor = "pointer";
        row.innerHTML = `
          <div>
            <div class="woTitle">${escapeHTML(i.invoiceNo)} — ${escapeHTML(i.customerName)}</div>
            <div class="muted">${escapeHTML(i.plate)} • ${fmtDate(i.date)}</div>
          </div>
          <span class="pill good">${fmtIQD(i.total || 0)}</span>
        `;
        row.onclick = () => goto(`#/invoice/${i.id}`);
        invWrap.appendChild(row);
      });
    }

    return el;
  }

  function mostUsedService() {
    const m = new Map();
    const all = [
      ...state.data.invoices.flatMap(i => i.items || []),
      ...state.data.workOrders.flatMap(w => w.items || []),
    ];
    all.forEach(it => {
      const k = it.name || "";
      m.set(k, (m.get(k) || 0) + 1);
    });
    let best = null;
    for (const [name, count] of m.entries()) {
      if (!best || count > best.count) best = { name, count };
    }
    return best;
  }

  // ---------- Work Orders (Kanban) ----------
  function pageWorkOrders() {
    const el = document.createElement("div");
    el.innerHTML = `
      <div class="card">
        <div class="cardHeader">
          <div>
            <div class="cardTitle">أوامر العمل (Kanban)</div>
            <div class="muted">اسحبي البطاقة لتغيير الحالة. (يدعم Undo/Redo)</div>
          </div>
          <div class="row">
            <button class="btn" id="woNew">+ أمر عمل</button>
            <button class="btn ghost" id="woUndo">تراجع</button>
            <button class="btn ghost" id="woRedo">إعادة</button>
          </div>
        </div>
      </div>

      <div class="kanban" id="kanban">
        ${kanbanColumn("new", "جديد")}
        ${kanbanColumn("in_progress", "قيد العمل")}
        ${kanbanColumn("waiting_parts", "بانتظار قطع")}
        ${kanbanColumn("ready", "جاهز")}
      </div>

      <div class="card">
        <div class="cardHeader">
          <div class="cardTitle">المنجزة/المُسلّمة</div>
          <span class="muted">تظهر هنا للتاريخ.</span>
        </div>
        <div class="hr"></div>
        <div id="deliveredList"></div>
      </div>
    `;

    $("#woNew", el).onclick = () => openCreateWorkOrder();
    $("#woUndo", el).onclick = () => undo();
    $("#woRedo", el).onclick = () => redo();

    const board = $("#kanban", el);
    const makeCard = (w) => {
      const c = document.createElement("div");
      c.className = "cardWO";
      c.draggable = true;
      c.dataset.id = w.id;
      c.innerHTML = `
        <div class="woTitle">${escapeHTML(w.plate)}</div>
        <div class="muted">${escapeHTML(w.customerName)}</div>
        <div class="woMeta">
          <span class="pill">${escapeHTML(statusLabel(w.status))}</span>
          <span class="pill good">${fmtIQD(w.total || 0)}</span>
          <span class="pill">${escapeHTML((w.items?.[0]?.name) || "—")}</span>
        </div>
      `;
      c.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", w.id);
      });
      c.onclick = () => openWorkOrder(w.id);
      return c;
    };

    const byStatus = (s) => state.data.workOrders.filter(w => w.status === s).sort((a,b)=> (b.updatedAt||0)-(a.updatedAt||0));

    const colMap = {
      new: $('[data-col="new"]', board),
      in_progress: $('[data-col="in_progress"]', board),
      waiting_parts: $('[data-col="waiting_parts"]', board),
      ready: $('[data-col="ready"]', board),
    };

    Object.entries(colMap).forEach(([status, col]) => {
      const list = $(".colList", col);
      list.innerHTML = "";
      byStatus(status).forEach(w => list.appendChild(makeCard(w)));

      col.addEventListener("dragover", (e) => e.preventDefault());
      col.addEventListener("drop", async (e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/plain");
        const w = state.data.workOrders.find(x => x.id === id);
        if (!w) return;

        const prev = w.status;
        if (prev === status) return;

        w.status = status;
        w.updatedAt = Date.now();
        await saveAll();

        pushHistory(
          `تغيير حالة أمر العمل (${w.plate})`,
          async () => { w.status = prev; w.updatedAt = Date.now(); await saveAll(); },
          async () => { w.status = status; w.updatedAt = Date.now(); await saveAll(); }
        );

        toast("تم", `تم نقل ${w.plate} إلى: ${statusLabel(status)}`);
        render();
      });
    });

    // delivered list
    const delivered = state.data.workOrders.filter(w => w.status === "delivered").sort((a,b)=> (b.updatedAt||0)-(a.updatedAt||0));
    const dHost = $("#deliveredList", el);
    if (delivered.length === 0) dHost.innerHTML = `<div class="muted">لا يوجد…</div>`;
    else {
      dHost.innerHTML = "";
      delivered.slice(0, 12).forEach(w => {
        const row = document.createElement("div");
        row.className = "cartItem";
        row.style.cursor = "pointer";
        row.innerHTML = `
          <div>
            <div class="woTitle">${escapeHTML(w.plate)} — ${escapeHTML(w.customerName)}</div>
            <div class="muted">${fmtDate(w.updatedAt || w.createdAt)}</div>
          </div>
          <span class="pill good">${fmtIQD(w.total || 0)}</span>
        `;
        row.onclick = () => openWorkOrder(w.id);
        dHost.appendChild(row);
      });
    }

    return el;
  }

  function kanbanColumn(key, title) {
    return `
      <div class="column" data-col="${key}">
        <div class="columnHeader">
          <div class="columnTitle">${escapeHTML(title)}</div>
          <div class="dropHint">اسحبي هنا</div>
        </div>
        <div class="colList"></div>
      </div>
    `;
  }

  function statusLabel(s) {
    return ({
      new: "جديد",
      in_progress: "قيد العمل",
      waiting_parts: "بانتظار قطع",
      ready: "جاهز",
      delivered: "مُسلّم"
    })[s] || s;
  }

  // ---------- Services + Cart ----------
  function pageServices() {
    const el = document.createElement("div");
    el.innerHTML = `
      <div class="grid">
        <div class="card" style="grid-column: span 8">
          <div class="cardHeader">
            <div>
              <div class="cardTitle">كتالوج الخدمات</div>
              <div class="muted">اضغطي “إضافة” لتدخل للسلة</div>
            </div>
            <div class="row">
              <button class="btn ghost" id="clearCart">تفريغ السلة</button>
              <button class="btn" id="goInvoice">إنشاء فاتورة</button>
            </div>
          </div>
          <div class="hr"></div>
          <div class="servicesGrid" id="servicesGrid"></div>
        </div>

        <div class="cart" style="grid-column: span 4">
          <div class="cardHeader">
            <div class="cardTitle">السلة</div>
            <span class="pill" id="cartCount"></span>
          </div>
          <div class="hr"></div>
          <div id="cartList"></div>
          <div class="hr"></div>
          <div class="row" style="justify-content:space-between">
            <div class="muted">المجموع</div>
            <div class="pill good" id="cartTotal"></div>
          </div>
          <div style="margin-top:12px" class="row">
            <button class="btn full" id="btnMakeInvoice">إنشاء فاتورة من السلة</button>
          </div>
          <div class="muted" style="margin-top:10px">💡 تقدرِين تسوين فاتورة حتى بدون زبون (مؤقتاً).</div>
        </div>
      </div>
    `;

    const grid = $("#servicesGrid", el);
    state.data.services.forEach(s => {
      const it = document.createElement("div");
      it.className = "serviceItem";
      it.innerHTML = `
        <div class="row" style="justify-content:space-between;align-items:flex-start">
          <div>
            <div class="serviceName">${escapeHTML(s.icon || "🔧")} ${escapeHTML(s.name)}</div>
            <div class="muted">مدة: ${s.minutes || 0} دقيقة</div>
          </div>
          <span class="pill good">${fmtIQD(s.price || 0)}</span>
        </div>
        <div style="margin-top:12px" class="row">
          <button class="btn full" data-add="${s.id}">إضافة للسلة</button>
        </div>
      `;
      grid.appendChild(it);
    });

    grid.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-add]");
      if (!btn) return;
      const s = state.data.services.find(x => x.id === btn.dataset.add);
      if (!s) return;
      state.cart.push({ id: uid(), name: s.name, price: s.price });
      await idbSet("cart", state.cart);
      pushHistory(
        `إضافة للسلة: ${s.name}`,
        async () => { state.cart.pop(); await idbSet("cart", state.cart); },
        async () => { state.cart.push({ id: uid(), name: s.name, price: s.price }); await idbSet("cart", state.cart); }
      );
      toast("تم", `تمت إضافة ${s.name} للسلة`);
      render();
    });

    $("#clearCart", el).onclick = async () => {
      const prev = [...state.cart];
      state.cart = [];
      await idbSet("cart", state.cart);
      pushHistory(
        "تفريغ السلة",
        async () => { state.cart = prev; await idbSet("cart", state.cart); },
        async () => { state.cart = []; await idbSet("cart", state.cart); }
      );
      toast("تم", "تم تفريغ السلة");
      render();
    };

    const makeInvoice = () => openCreateInvoiceFromCart();
    $("#goInvoice", el).onclick = makeInvoice;
    $("#btnMakeInvoice", el).onclick = makeInvoice;

    // render cart
    renderCart(el);
    return el;
  }

  function renderCart(root) {
    const list = $("#cartList", root);
    const count = $("#cartCount", root);
    const totalEl = $("#cartTotal", root);

    count.textContent = `${state.cart.length} عنصر`;
    const total = state.cart.reduce((a,b)=> a + (b.price||0), 0);
    totalEl.textContent = fmtIQD(total);

    list.innerHTML = "";
    if (state.cart.length === 0) {
      list.innerHTML = `<div class="muted">السلة فارغة…</div>`;
      return;
    }

    state.cart.forEach((it, idx) => {
      const row = document.createElement("div");
      row.className = "cartItem";
      row.innerHTML = `
        <div>
          <div class="woTitle">${escapeHTML(it.name)}</div>
          <div class="muted">${fmtIQD(it.price || 0)}</div>
        </div>
        <button class="iconBtn" data-del="${idx}" title="حذف">🗑️</button>
      `;
      list.appendChild(row);
    });

    list.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-del]");
      if (!b) return;
      const idx = Number(b.dataset.del);
      const removed = state.cart[idx];
      state.cart.splice(idx, 1);
      await idbSet("cart", state.cart);

      pushHistory(
        `حذف من السلة: ${removed?.name || ""}`,
        async () => { state.cart.splice(idx, 0, removed); await idbSet("cart", state.cart); },
        async () => { state.cart.splice(idx, 1); await idbSet("cart", state.cart); }
      );

      render();
    });
  }

  // ---------- Customers ----------
  function pageCustomers() {
    const el = document.createElement("div");
    el.innerHTML = `
      <div class="card">
        <div class="cardHeader">
          <div>
            <div class="cardTitle">الزبائن</div>
            <div class="muted">Front-end فقط — البيانات محفوظة محلياً (IndexedDB)</div>
          </div>
          <button class="btn" id="custNew">+ زبون</button>
        </div>
        <div class="hr"></div>
        <div class="row">
          <div class="field" style="min-width:260px">
            <label>فلتر</label>
            <input id="custFilter" placeholder="اسم/هاتف…" />
          </div>
        </div>
        <div class="hr"></div>
        <div id="custTable"></div>
      </div>
    `;

    $("#custNew", el).onclick = () => openCreateCustomer();
    const filter = $("#custFilter", el);
    const table = $("#custTable", el);

    const renderTable = () => {
      const term = filter.value.trim().toLowerCase();
      const rows = state.data.customers
        .filter(c => !term || (c.name + " " + c.phone).toLowerCase().includes(term))
        .sort((a,b)=> (b.createdAt||0)-(a.createdAt||0));

      if (rows.length === 0) {
        table.innerHTML = `<div class="muted">لا يوجد نتائج…</div>`;
        return;
      }

      table.innerHTML = `
        <table class="table">
          <thead>
            <tr>
              <th>الاسم</th>
              <th>الهاتف</th>
              <th>آخر تحديث</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(c => `
              <tr data-id="${c.id}">
                <td>${escapeHTML(c.name)}</td>
                <td>${escapeHTML(c.phone || "")}</td>
                <td>${escapeHTML(fmtDate(c.createdAt || Date.now()))}</td>
                <td><button class="btn ghost" data-open="${c.id}">فتح</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    };

    filter.addEventListener("input", renderTable);
    table.addEventListener("click", (e) => {
      const b = e.target.closest("[data-open]");
      if (!b) return;
      openCustomer(b.dataset.open);
    });

    renderTable();
    return el;
  }

  // ---------- Invoices ----------
  function pageInvoices() {
    const el = document.createElement("div");
    el.innerHTML = `
      <div class="card">
        <div class="cardHeader">
          <div>
            <div class="cardTitle">الفواتير</div>
            <div class="muted">طباعة + PDF من المتصفح + QR</div>
          </div>
          <div class="row">
            <button class="btn ghost" id="invCSV">تصدير CSV</button>
            <button class="btn" id="invNew">+ فاتورة</button>
          </div>
        </div>
        <div class="hr"></div>
        <div class="row">
          <div class="field" style="min-width:260px">
            <label>بحث</label>
            <input id="invFilter" placeholder="رقم/اسم/لوحة…" />
          </div>
        </div>
        <div class="hr"></div>
        <div id="invTable"></div>
      </div>
    `;

    $("#invNew", el).onclick = () => openCreateInvoiceFromCart();
    $("#invCSV", el).onclick = () => exportCSV();

    const filter = $("#invFilter", el);
    const table = $("#invTable", el);

    const renderTable = () => {
      const term = filter.value.trim().toLowerCase();
      const rows = [...state.data.invoices]
        .filter(i => !term || (i.invoiceNo + " " + i.customerName + " " + i.plate).toLowerCase().includes(term))
        .sort((a,b)=> (b.date||0)-(a.date||0));

      if (rows.length === 0) {
        table.innerHTML = `<div class="muted">لا يوجد…</div>`;
        return;
      }

      table.innerHTML = `
        <table class="table">
          <thead>
            <tr>
              <th>رقم</th>
              <th>الزبون</th>
              <th>اللوحة</th>
              <th>التاريخ</th>
              <th>الإجمالي</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(i => `
              <tr>
                <td>${escapeHTML(i.invoiceNo)}</td>
                <td>${escapeHTML(i.customerName || "—")}</td>
                <td>${escapeHTML(i.plate || "—")}</td>
                <td>${escapeHTML(fmtDate(i.date))}</td>
                <td>${escapeHTML(fmtIQD(i.total || 0))}</td>
                <td><button class="btn ghost" data-open="${i.id}">فتح</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    };

    filter.addEventListener("input", renderTable);
    table.addEventListener("click", (e) => {
      const b = e.target.closest("[data-open]");
      if (!b) return;
      goto(`#/invoice/${b.dataset.open}`);
    });

    renderTable();
    return el;
  }

  // ---------- Invoice view / print ----------
  function pageInvoice(id) {
    const inv = state.data.invoices.find(x => x.id === id);
    const el = document.createElement("div");
    if (!inv) {
      el.className = "card";
      el.innerHTML = `<div class="cardTitle">الفاتورة غير موجودة</div>`;
      return el;
    }

    const qrText = `${location.origin}${location.pathname}#/invoice/${inv.id}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=170x170&data=${encodeURIComponent(qrText)}`;

    el.innerHTML = `
      <div class="card">
        <div class="cardHeader">
          <div>
            <div class="cardTitle">فاتورة: ${escapeHTML(inv.invoiceNo)}</div>
            <div class="muted">${escapeHTML(fmtDate(inv.date))}</div>
          </div>
          <div class="row">
            <button class="btn ghost" id="invBack">رجوع</button>
            <button class="btn" id="invPrint">طباعة / PDF</button>
            <button class="btn danger" id="invDel">حذف</button>
          </div>
        </div>
      </div>

      <div class="card" id="printArea">
        <div style="display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap">
          <div>
            <h2 style="margin:0 0 6px 0">فاتورة خدمة — RPM</h2>
            <div class="muted">رقم الفاتورة: <b>${escapeHTML(inv.invoiceNo)}</b> • التاريخ: ${escapeHTML(fmtDate(inv.date))}</div>
          </div>
          <div style="text-align:center">
            <img id="qrImg" src="${qrUrl}" alt="QR" style="width:140px;height:140px;border-radius:14px;border:1px solid var(--border);background:#fff;padding:6px" />
            <div class="muted" style="margin-top:6px">QR لفتح الفاتورة</div>
          </div>
        </div>

        <div class="hr"></div>

        <div class="grid">
          <div class="card" style="grid-column: span 6; box-shadow:none">
            <div class="cardTitle" style="margin-bottom:6px">الزبون</div>
            <div>الاسم: <b>${escapeHTML(inv.customerName || "—")}</b></div>
            <div>الهاتف: ${escapeHTML(inv.customerPhone || "—")}</div>
          </div>
          <div class="card" style="grid-column: span 6; box-shadow:none">
            <div class="cardTitle" style="margin-bottom:6px">السيارة</div>
            <div>اللوحة: <b>${escapeHTML(inv.plate || "—")}</b></div>
            <div>الموديل: ${escapeHTML(inv.carModel || "—")}</div>
          </div>
        </div>

        <div class="hr"></div>

        <table class="table">
          <thead>
            <tr>
              <th>البند</th>
              <th>السعر</th>
            </tr>
          </thead>
          <tbody>
            ${(inv.items || []).map(it => `
              <tr>
                <td>${escapeHTML(it.name || "")}</td>
                <td>${escapeHTML(fmtIQD(it.price || 0))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>

        <div class="hr"></div>

        <div class="row" style="justify-content:space-between">
          <div class="muted">المجموع الفرعي</div>
          <div class="pill">${fmtIQD(inv.subtotal || 0)}</div>
        </div>
        <div class="row" style="justify-content:space-between">
          <div class="muted">الخصم</div>
          <div class="pill">${fmtIQD(inv.discount || 0)}</div>
        </div>
        <div class="row" style="justify-content:space-between">
          <div class="cardTitle">الإجمالي</div>
          <div class="pill good">${fmtIQD(inv.total || 0)}</div>
        </div>

        <div class="hr"></div>
        <div class="muted">${escapeHTML(inv.notes || "شكراً لزيارتكم ❤️")}</div>
      </div>
    `;

    $("#invBack", el).onclick = () => history.back();
    $("#invPrint", el).onclick = () => window.print();

    $("#invDel", el).onclick = async () => {
      const prev = inv;
      state.data.invoices = state.data.invoices.filter(x => x.id !== id);
      await saveAll();

      pushHistory(
        `حذف فاتورة ${prev.invoiceNo}`,
        async () => { state.data.invoices.push(prev); await saveAll(); },
        async () => { state.data.invoices = state.data.invoices.filter(x => x.id !== id); await saveAll(); }
      );

      toast("تم", "تم حذف الفاتورة");
      goto("#/invoices");
    };

    // إذا انقطع النت: نعرض بديل شكلي
    const img = $("#qrImg", el);
    img.onerror = () => {
      img.removeAttribute("src");
      img.style.background = "repeating-linear-gradient(45deg,#000,#000 6px,#fff 6px,#fff 12px)";
      img.style.border = "1px solid #ddd";
    };

    return el;
  }

  // ---------- Create Customer ----------
  function openCreateCustomer() {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="row">
        <div class="field">
          <label>اسم الزبون</label>
          <input name="name" placeholder="مثال: محمد علي" />
        </div>
        <div class="field">
          <label>الهاتف</label>
          <input name="phone" placeholder="07xxxxxxxxx" />
        </div>
      </div>
      <div class="hr"></div>
      <div class="muted">✅ يتم الحفظ محلياً — يدعم Draft تلقائي.</div>
    `;

    const draft = bindDraft(wrap, "createCustomer");

    openModal({
      title: "إضافة زبون",
      bodyNode: wrap,
      actions: [
        { text: "إلغاء", kind: "ghost" },
        {
          text: "حفظ",
          kind: "good",
          primary: true,
          onClick: async () => {
            const name = $('[name="name"]', wrap).value.trim();
            const phone = $('[name="phone"]', wrap).value.trim();
            if (!name) return toast("تنبيه", "اكتبي الاسم") || false;

            const c = { id: uid(), name, phone, createdAt: Date.now() };
            state.data.customers.unshift(c);
            await saveAll();

            pushHistory(
              `إضافة زبون: ${name}`,
              async () => { state.data.customers = state.data.customers.filter(x => x.id !== c.id); await saveAll(); },
              async () => { state.data.customers.unshift(c); await saveAll(); }
            );

            draft.clear();
            toast("تم", "تم إضافة الزبون");
            render();
          }
        }
      ]
    });
  }

  // ---------- Open Customer ----------
  function openCustomer(customerId) {
    const c = state.data.customers.find(x => x.id === customerId);
    if (!c) return toast("خطأ", "الزبون غير موجود");

    const cars = state.data.cars.filter(x => x.customerId === c.id);
    const wos = state.data.workOrders.filter(w => w.customerId === c.id);
    const invs = state.data.invoices.filter(i => i.customerName === c.name);

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="grid">
        <div class="card" style="grid-column: span 6; box-shadow:none">
          <div class="cardTitle">معلومات</div>
          <div class="hr"></div>
          <div>الاسم: <b>${escapeHTML(c.name)}</b></div>
          <div>الهاتف: ${escapeHTML(c.phone || "—")}</div>
          <div class="muted">أُضيف: ${escapeHTML(fmtDate(c.createdAt || Date.now()))}</div>
        </div>

        <div class="card" style="grid-column: span 6; box-shadow:none">
          <div class="cardHeader">
            <div class="cardTitle">السيارات</div>
            <button class="btn ghost" id="addCar">+ سيارة</button>
          </div>
          <div class="hr"></div>
          <div id="carList"></div>
        </div>
      </div>

      <div class="card" style="box-shadow:none">
        <div class="cardTitle">آخر أوامر العمل</div>
        <div class="hr"></div>
        <div id="woList"></div>
      </div>

      <div class="card" style="box-shadow:none">
        <div class="cardTitle">آخر الفواتير</div>
        <div class="hr"></div>
        <div id="invList"></div>
      </div>
    `;

    const carList = $("#carList", wrap);
    carList.innerHTML = cars.length ? "" : `<div class="muted">لا سيارات…</div>`;
    cars.forEach(car => {
      const row = document.createElement("div");
      row.className = "cartItem";
      row.innerHTML = `
        <div>
          <div class="woTitle">${escapeHTML(car.plate)}</div>
          <div class="muted">${escapeHTML(car.model || "")}</div>
        </div>
      `;
      carList.appendChild(row);
    });

    const woList = $("#woList", wrap);
    woList.innerHTML = wos.length ? "" : `<div class="muted">لا أوامر…</div>`;
    wos.slice(0, 6).forEach(w => {
      const row = document.createElement("div");
      row.className = "cartItem";
      row.style.cursor = "pointer";
      row.innerHTML = `
        <div>
          <div class="woTitle">${escapeHTML(w.plate)}</div>
          <div class="muted">${escapeHTML(statusLabel(w.status))} • ${fmtDate(w.updatedAt || w.createdAt)}</div>
        </div>
        <span class="pill">${fmtIQD(w.total || 0)}</span>
      `;
      row.onclick = () => { closeModal(); openWorkOrder(w.id); };
      woList.appendChild(row);
    });

    const invList = $("#invList", wrap);
    invList.innerHTML = invs.length ? "" : `<div class="muted">لا فواتير…</div>`;
    invs.slice(0, 6).forEach(i => {
      const row = document.createElement("div");
      row.className = "cartItem";
      row.style.cursor = "pointer";
      row.innerHTML = `
        <div>
          <div class="woTitle">${escapeHTML(i.invoiceNo)}</div>
          <div class="muted">${fmtDate(i.date)} • ${escapeHTML(i.plate || "")}</div>
        </div>
        <span class="pill good">${fmtIQD(i.total || 0)}</span>
      `;
      row.onclick = () => { closeModal(); goto(`#/invoice/${i.id}`); };
      invList.appendChild(row);
    });

    $("#addCar", wrap).onclick = () => openAddCar(c.id);

    openModal({
      title: `زبون: ${c.name}`,
      bodyNode: wrap,
      actions: [
        { text: "إغلاق", kind: "ghost" }
      ]
    });
  }

  function openAddCar(customerId) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="row">
        <div class="field">
          <label>اللوحة</label>
          <input name="plate" placeholder="مثال: بغداد 12345" />
        </div>
        <div class="field">
          <label>الموديل</label>
          <input name="model" placeholder="مثال: Toyota Camry 2014" />
        </div>
      </div>
    `;
    const draft = bindDraft(wrap, "addCar");

    openModal({
      title: "إضافة سيارة",
      bodyNode: wrap,
      actions: [
        { text: "إلغاء", kind: "ghost" },
        {
          text: "حفظ",
          kind: "good",
          primary: true,
          onClick: async () => {
            const plate = $('[name="plate"]', wrap).value.trim();
            const model = $('[name="model"]', wrap).value.trim();
            if (!plate) return toast("تنبيه", "اكتبي اللوحة") || false;

            const car = { id: uid(), customerId, plate, model };
            state.data.cars.unshift(car);
            await saveAll();

            pushHistory(
              `إضافة سيارة: ${plate}`,
              async () => { state.data.cars = state.data.cars.filter(x => x.id !== car.id); await saveAll(); },
              async () => { state.data.cars.unshift(car); await saveAll(); }
            );

            draft.clear();
            toast("تم", "تمت إضافة السيارة");
            render();
          }
        }
      ]
    });
  }

  // ---------- Create Work Order ----------
  function openCreateWorkOrder() {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="row">
        <div class="field">
          <label>اسم الزبون</label>
          <input name="customerName" placeholder="مثال: علي كريم" />
        </div>
        <div class="field">
          <label>الهاتف (اختياري)</label>
          <input name="customerPhone" placeholder="07xxxxxxxxx" />
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>لوحة السيارة</label>
          <input name="plate" placeholder="مثال: بغداد 12345" />
        </div>
        <div class="field">
          <label>موديل السيارة</label>
          <input name="carModel" placeholder="مثال: Toyota Camry 2014" />
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>الخدمات (افصلها بفواصل)</label>
          <input name="items" placeholder="تبديل دهن, تبديل فلتر" />
        </div>
        <div class="field">
          <label>المبلغ الإجمالي</label>
          <input name="total" type="number" placeholder="23000" />
        </div>
      </div>

      <div class="field">
        <label>ملاحظات</label>
        <textarea name="notes" placeholder="اكتبي ملاحظات…"></textarea>
      </div>

      <div class="muted">✅ Draft تلقائي • ✅ Ctrl+S للحفظ • ✅ يدعم التراجع Undo</div>
    `;
    const draft = bindDraft(wrap, "createWO");

    openModal({
      title: "أمر عمل جديد",
      bodyNode: wrap,
      actions: [
        { text: "إلغاء", kind: "ghost" },
        {
          text: "حفظ",
          kind: "good",
          primary: true,
          onClick: async () => {
            const customerName = $('[name="customerName"]', wrap).value.trim() || "زبون";
            const customerPhone = $('[name="customerPhone"]', wrap).value.trim();
            const plate = $('[name="plate"]', wrap).value.trim() || "—";
            const carModel = $('[name="carModel"]', wrap).value.trim();
            const itemsRaw = $('[name="items"]', wrap).value.trim();
            const total = Number($('[name="total"]', wrap).value || 0);
            const notes = $('[name="notes"]', wrap).value.trim();

            const items = itemsRaw
              ? itemsRaw.split(",").map(s => s.trim()).filter(Boolean).map(name => ({ name, price: 0 }))
              : [];

            // نحاول نطابق الأسعار من كتالوج الخدمات
            items.forEach(it => {
              const svc = state.data.services.find(s => s.name === it.name);
              if (svc) it.price = svc.price || 0;
            });

            const computedTotal = total || items.reduce((a,b)=>a+(b.price||0),0);

            const wo = {
              id: uid(),
              createdAt: Date.now(),
              updatedAt: Date.now(),
              status: "new",
              customerId: null,
              carId: null,
              customerName,
              customerPhone,
              plate,
              carModel,
              notes,
              items,
              total: computedTotal,
            };

            state.data.workOrders.unshift(wo);
            await saveAll();

            pushHistory(
              `إضافة أمر عمل: ${plate}`,
              async () => { state.data.workOrders = state.data.workOrders.filter(x => x.id !== wo.id); await saveAll(); },
              async () => { state.data.workOrders.unshift(wo); await saveAll(); }
            );

            draft.clear();
            toast("تم", "تم إنشاء أمر العمل");
            goto("#/workorders");
          }
        }
      ]
    });
  }

  // ---------- Open Work Order ----------
  function openWorkOrder(id) {
    const w = state.data.workOrders.find(x => x.id === id);
    if (!w) return toast("خطأ", "أمر العمل غير موجود");

    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="grid">
        <div class="card" style="grid-column: span 7; box-shadow:none">
          <div class="cardHeader">
            <div>
              <div class="cardTitle">${escapeHTML(w.plate)} — ${escapeHTML(w.customerName)}</div>
              <div class="muted">${escapeHTML(statusLabel(w.status))} • ${fmtDate(w.updatedAt || w.createdAt)}</div>
            </div>
            <span class="pill good">${fmtIQD(w.total || 0)}</span>
          </div>
          <div class="hr"></div>
          <div class="row">
            <div class="field">
              <label>الحالة</label>
              <select name="status">
                <option value="new">جديد</option>
                <option value="in_progress">قيد العمل</option>
                <option value="waiting_parts">بانتظار قطع</option>
                <option value="ready">جاهز</option>
                <option value="delivered">مُسلّم</option>
              </select>
            </div>
            <div class="field">
              <label>المبلغ</label>
              <input name="total" type="number" />
            </div>
          </div>

          <div class="field">
            <label>الخدمات</label>
            <input name="items" />
          </div>

          <div class="field">
            <label>ملاحظات</label>
            <textarea name="notes"></textarea>
          </div>
        </div>

        <div class="card" style="grid-column: span 5; box-shadow:none">
          <div class="cardTitle">إجراءات</div>
          <div class="hr"></div>
          <button class="btn full" id="makeInv">تحويل إلى فاتورة</button>
          <div style="height:10px"></div>
          <button class="btn ghost full" id="copyLink">نسخ رابط</button>
          <div style="height:10px"></div>
          <button class="btn danger full" id="delWO">حذف أمر العمل</button>

          <div class="hr"></div>
          <div class="muted">✅ يدعم Undo/Redo على تغيير الحالة والحذف.</div>
        </div>
      </div>
    `;

    const sel = $('[name="status"]', wrap);
    const total = $('[name="total"]', wrap);
    const items = $('[name="items"]', wrap);
    const notes = $('[name="notes"]', wrap);

    sel.value = w.status;
    total.value = w.total || 0;
    items.value = (w.items || []).map(x => x.name).join(", ");
    notes.value = w.notes || "";

    const draft = bindDraft(wrap, "editWO:" + w.id);

    const saveEdit = async () => {
      const prev = { ...w, items: [...(w.items||[])] };
      const newStatus = sel.value;
      const newTotal = Number(total.value || 0);
      const itemsRaw = items.value.trim();
      const newItems = itemsRaw
        ? itemsRaw.split(",").map(s => s.trim()).filter(Boolean).map(name => {
          const svc = state.data.services.find(s => s.name === name);
          return { name, price: svc?.price || 0 };
        })
        : [];

      w.status = newStatus;
      w.total = newTotal || newItems.reduce((a,b)=>a+(b.price||0),0);
      w.items = newItems;
      w.notes = notes.value.trim();
      w.updatedAt = Date.now();

      await saveAll();

      pushHistory(
        `تعديل أمر العمل (${w.plate})`,
        async () => { Object.assign(w, prev); await saveAll(); },
        async () => {
          Object.assign(w, { status: newStatus, total: w.total, items: newItems, notes: w.notes, updatedAt: Date.now() });
          await saveAll();
        }
      );

      draft.clear();
      toast("تم", "تم حفظ التعديلات");
      render();
    };

    $("#makeInv", wrap).onclick = async () => {
      const inv = await makeInvoiceFromWorkOrder(w.id);
      if (!inv) return;
      closeModal();
      goto(`#/invoice/${inv.id}`);
    };

    $("#copyLink", wrap).onclick = async () => {
      const link = `${location.origin}${location.pathname}#/workorders`;
      try {
        await navigator.clipboard.writeText(link);
        toast("تم", "تم نسخ رابط النظام");
      } catch {
        toast("ملاحظة", "ما نكدر ننسخ بهالمتصفح");
      }
    };

    $("#delWO", wrap).onclick = async () => {
      const prev = w;
      state.data.workOrders = state.data.workOrders.filter(x => x.id !== w.id);
      await saveAll();

      pushHistory(
        `حذف أمر العمل ${prev.plate}`,
        async () => { state.data.workOrders.unshift(prev); await saveAll(); },
        async () => { state.data.workOrders = state.data.workOrders.filter(x => x.id !== prev.id); await saveAll(); }
      );

      toast("تم", "تم حذف أمر العمل");
      closeModal();
      render();
    };

    openModal({
      title: "تفاصيل أمر العمل",
      bodyNode: wrap,
      actions: [
        { text: "إغلاق", kind: "ghost" },
        { text: "حفظ (Ctrl+S)", kind: "good", primary: true, onClick: saveEdit }
      ]
    });
  }

  async function makeInvoiceFromWorkOrder(workOrderId) {
    const w = state.data.workOrders.find(x => x.id === workOrderId);
    if (!w) return null;

    const subtotal = (w.items || []).reduce((a,b)=>a+(b.price||0),0) || (w.total || 0);
    const inv = {
      id: uid(),
      invoiceNo: "INV-" + String(Math.floor(Math.random() * 90000) + 10000),
      date: Date.now(),
      customerName: w.customerName,
      customerPhone: w.customerPhone || "",
      plate: w.plate,
      carModel: w.carModel || "",
      items: (w.items || []).map(x => ({ name: x.name, price: x.price || 0 })),
      discount: 0,
      subtotal,
      total: subtotal,
      paid: subtotal,
      notes: "شكراً لزيارتكم ❤️",
    };

    state.data.invoices.unshift(inv);
    await saveAll();

    pushHistory(
      `تحويل أمر عمل إلى فاتورة (${w.plate})`,
      async () => { state.data.invoices = state.data.invoices.filter(x => x.id !== inv.id); await saveAll(); },
      async () => { state.data.invoices.unshift(inv); await saveAll(); }
    );

    toast("تم", `تم إنشاء فاتورة: ${inv.invoiceNo}`);
    return inv;
  }

  // ---------- Create Invoice from Cart ----------
  function openCreateInvoiceFromCart() {
    if (state.cart.length === 0) {
      toast("السلة فارغة", "روحي للخدمات واضيفي عناصر");
      goto("#/services");
      return;
    }

    const wrap = document.createElement("div");
    const total = state.cart.reduce((a,b)=>a+(b.price||0),0);
    wrap.innerHTML = `
      <div class="row">
        <div class="field">
          <label>اسم الزبون</label>
          <input name="customerName" placeholder="مثال: علي كريم" />
        </div>
        <div class="field">
          <label>الهاتف</label>
          <input name="customerPhone" placeholder="07xxxxxxxxx" />
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>لوحة السيارة</label>
          <input name="plate" placeholder="بغداد 12345" />
        </div>
        <div class="field">
          <label>موديل السيارة</label>
          <input name="carModel" placeholder="Toyota Camry 2014" />
        </div>
      </div>

      <div class="row">
        <div class="field">
          <label>خصم</label>
          <input name="discount" type="number" value="0" />
        </div>
        <div class="field">
          <label>مدفوع</label>
          <input name="paid" type="number" value="${total}" />
        </div>
      </div>

      <div class="field">
        <label>ملاحظة</label>
        <input name="notes" value="شكراً لزيارتكم ❤️" />
      </div>

      <div class="hr"></div>
      <div class="card" style="box-shadow:none">
        <div class="cardTitle">محتوى السلة</div>
        <div class="hr"></div>
        <div>${state.cart.map(it => `
          <div class="row" style="justify-content:space-between">
            <span>${escapeHTML(it.name)}</span>
            <span class="pill">${fmtIQD(it.price||0)}</span>
          </div>
        `).join("")}</div>
        <div class="hr"></div>
        <div class="row" style="justify-content:space-between">
          <span class="cardTitle">المجموع</span>
          <span class="pill good">${fmtIQD(total)}</span>
        </div>
      </div>
    `;

    const draft = bindDraft(wrap, "createInvoice");

    openModal({
      title: "إنشاء فاتورة من السلة",
      bodyNode: wrap,
      actions: [
        { text: "إلغاء", kind: "ghost" },
        {
          text: "حفظ",
          kind: "good",
          primary: true,
          onClick: async () => {
            const customerName = $('[name="customerName"]', wrap).value.trim() || "زبون";
            const customerPhone = $('[name="customerPhone"]', wrap).value.trim();
            const plate = $('[name="plate"]', wrap).value.trim() || "—";
            const carModel = $('[name="carModel"]', wrap).value.trim();
            const discount = Number($('[name="discount"]', wrap).value || 0);
            const paid = Number($('[name="paid"]', wrap).value || 0);
            const notes = $('[name="notes"]', wrap).value.trim();

            const subtotal = state.cart.reduce((a,b)=>a+(b.price||0),0);
            const totalFinal = Math.max(0, subtotal - discount);

            const inv = {
              id: uid(),
              invoiceNo: "INV-" + String(Math.floor(Math.random() * 90000) + 10000),
              date: Date.now(),
              customerName,
              customerPhone,
              plate,
              carModel,
              items: state.cart.map(x => ({ name: x.name, price: x.price || 0 })),
              discount,
              subtotal,
              total: totalFinal,
              paid,
              notes,
            };

            state.data.invoices.unshift(inv);

            const prevCart = [...state.cart];
            state.cart = [];
            await saveAll();

            pushHistory(
              `إنشاء فاتورة من السلة (${inv.invoiceNo})`,
              async () => {
                state.data.invoices = state.data.invoices.filter(x => x.id !== inv.id);
                state.cart = prevCart;
                await saveAll();
              },
              async () => {
                state.data.invoices.unshift(inv);
                state.cart = [];
                await saveAll();
              }
            );

            draft.clear();
            toast("تم", `تم إنشاء الفاتورة: ${inv.invoiceNo}`);
            goto(`#/invoice/${inv.id}`);
          }
        }
      ]
    });
  }

  // ---------- Settings ----------
  function openSettings() {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="grid">
        <div class="card" style="grid-column: span 6; box-shadow:none">
          <div class="cardTitle">المظهر</div>
          <div class="hr"></div>
          <div class="row">
            <button class="btn ghost" id="setDark">Dark</button>
            <button class="btn ghost" id="setLight">Light</button>
          </div>
          <div class="hr"></div>
          <div class="field">
            <label>لون رئيسي (Accent)</label>
            <input type="color" id="accentPick" value="${escapeHTML(state.settings.accent)}" style="height:44px;padding:6px" />
          </div>
        </div>

        <div class="card" style="grid-column: span 6; box-shadow:none">
          <div class="cardTitle">ميزات</div>
          <div class="hr"></div>
          <div class="row">
            <button class="btn ghost" id="toggleSound">${state.settings.sound ? "🔊 الصوت: ON" : "🔇 الصوت: OFF"}</button>
            <button class="btn ghost" id="toggleVoice">${state.settings.voice ? "🎙️ الصوتي: ON" : "🎙️ الصوتي: OFF"}</button>
          </div>
          <div class="hr"></div>
          <div class="muted">Ctrl+K لوحة أوامر • Ctrl+Z تراجع • Ctrl+Y إعادة • Ctrl+S حفظ داخل النوافذ</div>
        </div>

        <div class="card" style="grid-column: span 12; box-shadow:none">
          <div class="cardTitle">البيانات</div>
          <div class="hr"></div>
          <div class="row">
            <button class="btn" id="exportJSON">تصدير JSON</button>
            <button class="btn ghost" id="importJSON">استيراد JSON</button>
            <button class="btn ghost" id="exportCSV">تصدير CSV (فواتير)</button>
            <button class="btn danger" id="resetAll">تصفير كل شيء</button>
          </div>
          <div class="hr"></div>
          <div class="muted">ملاحظة: الاستيراد يستبدل البيانات الحالية.</div>
        </div>
      </div>
    `;

    $("#setDark", wrap).onclick = async () => { applyTheme("dark"); await saveAll(); toast("تم", "Dark"); };
    $("#setLight", wrap).onclick = async () => { applyTheme("light"); await saveAll(); toast("تم", "Light"); };

    $("#accentPick", wrap).oninput = async (e) => {
      applyAccent(e.target.value);
      await saveAll();
    };

    $("#toggleSound", wrap).onclick = async () => {
      state.settings.sound = !state.settings.sound;
      await saveAll();
      toast("تم", `الصوت: ${state.settings.sound ? "ON" : "OFF"}`);
      openSettings(); // تحديث سريع
    };

    $("#toggleVoice", wrap).onclick = async () => {
      state.settings.voice = !state.settings.voice;
      await saveAll();
      toast("تم", `الصوتي: ${state.settings.voice ? "ON" : "OFF"}`);
      openSettings();
    };

    $("#exportJSON", wrap).onclick = () => exportJSON();
    $("#importJSON", wrap).onclick = () => triggerImport();
    $("#exportCSV", wrap).onclick = () => exportCSV();

    $("#resetAll", wrap).onclick = async () => {
      // تأكيد بسيط
      if (!confirm("متأكدة تريدين تصفير كل البيانات؟")) return;
      await Promise.all(["customers","cars","workOrders","invoices","services","cart"].map(k => idbDel(k)));
      state.data.customers = [];
      state.data.cars = [];
      state.data.workOrders = [];
      state.data.invoices = [];
      state.data.services = seedServices();
      state.cart = [];
      await saveAll();
      toast("تم", "تم تصفير البيانات");
      render();
    };

    openModal({
      title: "الإعدادات",
      bodyNode: wrap,
      actions: [{ text: "إغلاق", kind: "ghost" }]
    });
  }

  // ---------- Export / Import ----------
  function exportJSON() {
    const payload = {
      exportedAt: nowISO(),
      settings: state.settings,
      data: state.data,
      cart: state.cart,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    downloadBlob(blob, `rpm-export-${Date.now()}.json`);
    toast("تم", "تم تصدير JSON");
  }

  function triggerImport() {
    const inp = $("#fileImport");
    inp.value = "";
    inp.click();
  }

  async function importJSONFile(file) {
    const txt = await file.text();
    const obj = JSON.parse(txt);

    if (!obj?.data) throw new Error("ملف غير صالح");

    const prev = {
      settings: { ...state.settings },
      data: JSON.parse(JSON.stringify(state.data)),
      cart: [...state.cart],
    };

    state.settings = { ...state.settings, ...(obj.settings || {}) };
    state.data = obj.data;
    state.cart = obj.cart || [];

    await saveAll();

    pushHistory(
      "استيراد بيانات",
      async () => { state.settings = prev.settings; state.data = prev.data; state.cart = prev.cart; await saveAll(); },
      async () => { state.settings = { ...state.settings, ...(obj.settings || {}) }; state.data = obj.data; state.cart = obj.cart || []; await saveAll(); }
    );

    applyTheme(state.settings.theme);
    applyAccent(state.settings.accent);

    toast("تم", "تم الاستيراد");
    render();
  }

  function exportCSV() {
    const rows = [...state.data.invoices].sort((a,b)=> (b.date||0)-(a.date||0));
    const header = ["invoiceNo","date","customerName","customerPhone","plate","carModel","subtotal","discount","total","paid"];
    const lines = [header.join(",")];

    rows.forEach(i => {
      const line = [
        i.invoiceNo,
        new Date(i.date).toISOString(),
        csvEscape(i.customerName),
        csvEscape(i.customerPhone),
        csvEscape(i.plate),
        csvEscape(i.carModel),
        i.subtotal || 0,
        i.discount || 0,
        i.total || 0,
        i.paid || 0,
      ].join(",");
      lines.push(line);
    });

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `rpm-invoices-${Date.now()}.csv`);
    toast("تم", "تم تصدير CSV");
  }

  function csvEscape(v) {
    const s = String(v ?? "");
    if (/[,"\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  // ---------- QR Scanner (Camera) ----------
  async function openScanner() {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="card" style="box-shadow:none">
        <div class="cardTitle">مسح QR بالكاميرا</div>
        <div class="muted">سيطلب إذن الكاميرا. إذا المتصفح ما يدعم BarcodeDetector راح يظهر تنبيه.</div>
        <div class="hr"></div>
        <div style="position:relative; border-radius:22px; overflow:hidden; border:1px solid var(--border); background:#000">
          <video id="v" autoplay playsinline style="width:100%; height:360px; object-fit:cover"></video>
          <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none">
            <div style="width:min(240px,70%); height:min(240px,70%); border-radius:18px; border:2px solid rgba(124,92,255,.8); box-shadow:0 0 0 999px rgba(0,0,0,.25) inset"></div>
          </div>
        </div>
        <div class="hr"></div>
        <div class="row">
          <span class="pill" id="scanStatus">جاهز…</span>
        </div>
      </div>
    `;

    let stream = null;
    let stopped = false;

    const modal = openModal({
      title: "ماسح QR",
      bodyNode: wrap,
      actions: [
        { text: "إغلاق", kind: "ghost", onClick: async () => { stopped = true; stop(); } }
      ]
    });

    const statusEl = $("#scanStatus", wrap);

    const hasDetector = "BarcodeDetector" in window;
    if (!hasDetector) {
      statusEl.textContent = "المتصفح لا يدعم BarcodeDetector";
      toast("تنبيه", "جرّبي Chrome حديث");
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      const video = $("#v", wrap);
      video.srcObject = stream;
      statusEl.textContent = "يتم المسح…";
      const detector = new BarcodeDetector({ formats: ["qr_code"] });

      const tick = async () => {
        if (stopped) return;
        try {
          const codes = await detector.detect(video);
          if (codes?.length) {
            const raw = codes[0].rawValue || "";
            statusEl.textContent = "تم العثور على QR ✅";
            toast("QR", raw);
            // إذا الرابط يحتوي #/invoice/<id> ننقله
            const m = raw.match(/#\/invoice\/([a-zA-Z0-9_-]+)/);
            if (m) {
              closeModal();
              goto(`#/invoice/${m[1]}`);
              stop();
              return;
            }
          }
        } catch {}
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);

    } catch (e) {
      statusEl.textContent = "تعذّر فتح الكاميرا";
      toast("خطأ", "تحققي من إذن الكاميرا");
    }

    function stop() {
      try {
        stream?.getTracks()?.forEach(t => t.stop());
      } catch {}
    }
  }

  // ---------- Voice Commands ----------
  function startVoice() {
    if (!state.settings.voice) {
      toast("الصوتي OFF", "فعّليه من الإعدادات");
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      toast("غير مدعوم", "المتصفح لا يدعم SpeechRecognition");
      return;
    }

    const rec = new SR();
    rec.lang = "ar-IQ";
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    toast("🎙️", "تكلّمي… مثال: افتح الفواتير | أمر عمل جديد | ابحث عن علي");

    rec.onresult = (e) => {
      const text = e.results?.[0]?.[0]?.transcript?.trim() || "";
      if (!text) return;
      handleVoice(text);
    };
    rec.onerror = () => toast("خطأ", "تعذر استخدام المايك");
    rec.start();
  }

  function handleVoice(text) {
    const t = text.replace(/[ًٌٍَُِّْ]/g, "").trim();
    const low = t.toLowerCase();

    if (low.includes("افتح") && low.includes("الرئيسية")) return goto("#/dashboard");
    if (low.includes("افتح") && (low.includes("اوامر") || low.includes("العمل"))) return goto("#/workorders");
    if (low.includes("افتح") && low.includes("الخدمات")) return goto("#/services");
    if (low.includes("افتح") && low.includes("الزبائن")) return goto("#/customers");
    if (low.includes("افتح") && low.includes("الفواتير")) return goto("#/invoices");

    if (low.includes("امر عمل") && (low.includes("جديد") || low.includes("اضافة"))) return openCreateWorkOrder();
    if (low.includes("ابحث")) {
      const q = t.replace(/ابحث( عن)?/g, "").trim();
      return openPalette(q);
    }

    // fallback
    openPalette(t);
  }

  // ---------- Global bindings ----------
  function bindGlobal() {
    // sidebar toggle
    $("#btnToggleSidebar").onclick = () => document.body.classList.toggle("sidebarOpen");
    $("#sidebar").addEventListener("click", (e) => {
      const a = e.target.closest("a");
      if (a && window.matchMedia("(max-width: 980px)").matches) {
        document.body.classList.remove("sidebarOpen");
      }
    });

    // quick actions
    $("#btnQuickWO").onclick = () => openCreateWorkOrder();
    $("#btnQuickInvoice").onclick = () => openCreateInvoiceFromCart();
    $("#btnScan").onclick = () => openScanner();
    $("#btnVoice").onclick = () => startVoice();
    $("#btnSettings").onclick = () => openSettings();
    $("#btnSettingsSide").onclick = () => openSettings();

    // theme toggle
    $("#btnTheme").onclick = async () => {
      const next = (state.settings.theme === "dark") ? "light" : "dark";
      applyTheme(next);
      await saveAll();
      toast("تم", `الثيم: ${next}`);
    };

    // global search input: يفتح palette
    $("#globalSearch").addEventListener("focus", () => openPalette($("#globalSearch").value));
    $("#globalSearch").addEventListener("keydown", (e) => {
      if (e.key === "Enter") openPalette($("#globalSearch").value);
    });

    // export/import quick
    $("#btnExport").onclick = () => exportJSON();
    $("#btnImport").onclick = () => triggerImport();

    // Import file handler
    $("#fileImport").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        await importJSONFile(file);
      } catch {
        toast("خطأ", "ملف الاستيراد غير صالح");
      }
    });

    // keyboard shortcuts
    window.addEventListener("keydown", (e) => {
      // Ctrl+K
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
      }
      // Ctrl+Z / Ctrl+Y
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    });

    // first interaction -> startup sound
    window.addEventListener("pointerdown", () => playStartupSound(), { once: true });
  }

  // ---------- Init ----------
  async function init() {
    $("#loading").style.display = "flex";

    await registerSW();
    await loadAll();

    bindGlobal();

    // أول رندر
    if (!location.hash) location.hash = "#/dashboard";
    render();
    window.addEventListener("hashchange", render);

    // close loading with small delay (skeleton effect)
    setTimeout(() => { $("#loading").style.display = "none"; }, 450);

    // إظهار حالة Offline/Online
    window.addEventListener("online", () => toast("Online", "اتصال موجود"));
    window.addEventListener("offline", () => toast("Offline", "بدون إنترنت — النظام يشتغل محلياً"));
  }

  init();
}
