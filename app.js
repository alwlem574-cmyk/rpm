/* نظام الوليم RPM - V3 (Front-end only)
   - زباين + سيارات + سجل
   - تبديل دهن + عداد حالي/جاي + طباعة
   - تفاصيل أمر شغل + صرف قطع + أجور + فاتورة
   - موظفين
   - تقارير
   - نسخ احتياطي
*/

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

const dbAPI = {
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

/* ------------------------ State & Router ------------------------ */
const state = {
  route: "dashboard",
  search: "",
};

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
  };
  return map[route] || route;
}

function setTitle(route) {
  const map = {
    dashboard: "لوحة التحكم",
    checkin: "الاستقبال",
    orders: "أوامر الشغل",
    order: "تفاصيل أمر شغل",
    customers: "الزباين",
    customer: "سجل الزبون",
    vehicles: "السيارات",
    vehicle: "سجل السيارة",
    oil: "تبديل دهن",
    inventory: "المخزون",
    invoices: "الفواتير",
    employees: "الموظفين",
    reports: "التقارير",
    backup: "نسخ احتياطي",
    more: "المزيد",
  };
  $("#pageTitle").textContent = map[route] || "نظام الوليم RPM";
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

/* ------------------------ Print (HTML) ------------------------ */
function openPrintWindow(title, bodyHtml) {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return alert("المتصفح منع فتح نافذة الطباعة. فعّلي Popups.");
  w.document.open();
  w.document.write(`
    <html lang="ar" dir="rtl">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          body{ margin:0; }
          ${document.querySelector("style")?.textContent || ""}
        </style>
      </head>
      <body>
        ${bodyHtml}
        <script>
          window.onload = () => { window.print(); };
        </script>
      </body>
    </html>
  `);
  w.document.close();
}

function printInvoice(inv, ctx) {
  const { customer, vehicle, employee, wo } = ctx;
  const items = Array.isArray(inv.items) ? inv.items : [];
  const remaining = Math.max(0, Number(inv.total||0)-Number(inv.paid||0));

  // Special: Oil Change invoice
  if (inv.invoiceType === "OIL") {
    const oil = inv.oil || {};
    const html = `
      <div class="print-wrap">
        <div class="print-header">
          <div>
            <div class="print-brand">نظام الوليم RPM</div>
            <div class="print-sub">فاتورة تبديل دهن</div>
            <div class="print-sub">التاريخ: ${fmtDate(inv.createdAt)}</div>
          </div>
          <div style="text-align:left">
            <div class="print-sub">رقم الفاتورة: <b>${escapeHtml(inv.id)}</b></div>
            <div class="print-sub">رقم أمر الشغل: <b>${escapeHtml(inv.workOrderId || "—")}</b></div>
          </div>
        </div>

        <div class="print-grid">
          <div><b>الزبون</b><br>${escapeHtml(customer?.name || "—")}<br><span style="color:#555">${escapeHtml(customer?.phone || "—")}</span></div>
          <div><b>السيارة</b><br>${escapeHtml([vehicle?.make, vehicle?.model, vehicle?.year].filter(Boolean).join(" ") || "—")}<br><span style="color:#555">لوحة: ${escapeHtml(vehicle?.plate || "—")}</span></div>
          <div><b>الفني</b><br>${escapeHtml(employee?.name || "—")}<br><span style="color:#555">${escapeHtml(employee?.specialty || "")}</span></div>
          <div><b>عدادات الدهن</b><br>الحالي: <b>${oil.currentOdo ?? "—"}</b><br>الجاي: <b>${oil.nextOdo ?? "—"}</b> <span style="color:#555">(بعد ${oil.interval ?? "—"} كم)</span></div>
        </div>

        <div class="print-box">
          <b>تفاصيل الخدمة</b>
          <table class="print-table">
            <thead><tr><th>الوصف</th><th>الكمية</th><th>سعر</th><th>المجموع</th></tr></thead>
            <tbody>
              ${items.map(it => `
                <tr>
                  <td>${escapeHtml(it.name)}</td>
                  <td>${it.qty}</td>
                  <td>${it.unit}</td>
                  <td>${it.total}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>

          <div class="print-foot">
            <div>
              <div>المجموع: <b>${inv.total} IQD</b></div>
              <div>مدفوع: <b>${inv.paid} IQD</b></div>
              <div>متبقي: <b>${remaining} IQD</b></div>
            </div>
            <div style="text-align:left">
              <div>توقيع الزبون: __________________</div>
              <div style="margin-top:8px">ختم الكراج: __________________</div>
            </div>
          </div>
        </div>

        <div class="print-sub" style="margin-top:10px;color:#555">
          ملاحظة: العداد الجاي مجرد تذكير حسب فترة التبديل، ويختلف حسب استعمال السيارة.
        </div>
      </div>
    `;
    openPrintWindow("فاتورة تبديل دهن - نظام الوليم RPM", html);
    return;
  }

  // General invoice
  const html = `
    <div class="print-wrap">
      <div class="print-header">
        <div>
          <div class="print-brand">نظام الوليم RPM</div>
          <div class="print-sub">فاتورة</div>
          <div class="print-sub">التاريخ: ${fmtDate(inv.createdAt)}</div>
        </div>
        <div style="text-align:left">
          <div class="print-sub">رقم الفاتورة: <b>${escapeHtml(inv.id)}</b></div>
          <div class="print-sub">رقم أمر الشغل: <b>${escapeHtml(inv.workOrderId || "—")}</b></div>
        </div>
      </div>

      <div class="print-grid">
        <div><b>الزبون</b><br>${escapeHtml(customer?.name || "—")}<br><span style="color:#555">${escapeHtml(customer?.phone || "—")}</span></div>
        <div><b>السيارة</b><br>${escapeHtml([vehicle?.make, vehicle?.model, vehicle?.year].filter(Boolean).join(" ") || "—")}<br><span style="color:#555">لوحة: ${escapeHtml(vehicle?.plate || "—")}</span></div>
        <div><b>الفني</b><br>${escapeHtml(employee?.name || "—")}<br><span style="color:#555">${escapeHtml(employee?.specialty || "")}</span></div>
        <div><b>ملاحظة</b><br>${escapeHtml(wo?.complaint || "—")}</div>
      </div>

      <div class="print-box">
        <b>تفاصيل</b>
        <table class="print-table">
          <thead><tr><th>الوصف</th><th>الكمية</th><th>سعر</th><th>المجموع</th></tr></thead>
          <tbody>
            ${items.map(it => `
              <tr>
                <td>${escapeHtml(it.name)}</td>
                <td>${it.qty}</td>
                <td>${it.unit}</td>
                <td>${it.total}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>

        <div class="print-foot">
          <div>
            <div>المجموع: <b>${inv.total} IQD</b></div>
            <div>مدفوع: <b>${inv.paid} IQD</b></div>
            <div>متبقي: <b>${remaining} IQD</b></div>
          </div>
          <div style="text-align:left">
            <div>توقيع الزبون: __________________</div>
            <div style="margin-top:8px">ختم الكراج: __________________</div>
          </div>
        </div>
      </div>
    </div>
  `;
  openPrintWindow("فاتورة - نظام الوليم RPM", html);
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
  const name = prompt("اسم الزبون:");
  if (!name) return;
  const phone = prompt("الهاتف (اختياري):") || "";
  const address = prompt("العنوان (اختياري):") || "";
  const notes = prompt("ملاحظات (اختياري):") || "";
  const obj = { id:"cust_"+uid().slice(3), name:name.trim(), phone:phone.trim(), address:address.trim(), notes:notes.trim(), createdAt:Date.now() };
  await dbAPI.put("customers", obj);
  alert("تم إضافة الزبون ✅");
  renderRoute();
}

async function editCustomer(id) {
  const c = await dbAPI.get("customers", id);
  if (!c) return;
  const name = prompt("اسم الزبون:", c.name || "") ?? c.name;
  const phone = prompt("الهاتف:", c.phone || "") ?? c.phone;
  const address = prompt("العنوان:", c.address || "") ?? c.address;
  const notes = prompt("ملاحظات:", c.notes || "") ?? c.notes;
  c.name = (name || c.name).trim();
  c.phone = (phone || "").trim();
  c.address = (address || "").trim();
  c.notes = (notes || "").trim();
  await dbAPI.put("customers", c);
  alert("تم التعديل ✅");
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

  alert("تم الحذف ✅");
  renderRoute();
}

async function createVehicle(prefCustomerId = "") {
  const customers = await dbAPI.getAll("customers");
  if (!customers.length) return alert("سوي زبون أولاً.");

  let customerId = prefCustomerId;
  if (!customerId) {
    const list = customers.map((c,i)=> `${i+1}) ${c.name} ${c.phone? "• "+c.phone:""}`).join("\n");
    const pick = prompt("اختاري رقم الزبون:\n" + list);
    const idx = Number(pick) - 1;
    if (!(idx>=0 && idx<customers.length)) return;
    customerId = customers[idx].id;
  }

  const plate = prompt("رقم اللوحة:") || "";
  const make = prompt("الشركة (Toyota):") || "";
  const model = prompt("الموديل:") || "";
  const year = Number(prompt("السنة (اختياري):","") || 0) || undefined;
  const vin = prompt("VIN (اختياري):") || "";
  const odometer = Number(prompt("عداد حالي (اختياري):","") || 0) || undefined;

  const v = { id:"veh_"+uid().slice(3), customerId, plate:plate.trim(), make:make.trim(), model:model.trim(), year, vin:vin.trim(), odometer, nextOilOdo: undefined, createdAt: Date.now() };
  await dbAPI.put("vehicles", v);
  alert("تم إضافة السيارة ✅");
  renderRoute();
}

async function editVehicle(id) {
  const v = await dbAPI.get("vehicles", id);
  if (!v) return;
  const plate = prompt("رقم اللوحة:", v.plate || "") ?? v.plate;
  const make = prompt("الشركة:", v.make || "") ?? v.make;
  const model = prompt("الموديل:", v.model || "") ?? v.model;
  const year = prompt("السنة:", String(v.year || "")) ?? String(v.year || "");
  const vin = prompt("VIN:", v.vin || "") ?? v.vin;
  const od = prompt("العداد الحالي:", String(v.odometer ?? "")) ?? String(v.odometer ?? "");
  const nextOil = prompt("العداد الجاي للدهن (اختياري):", String(v.nextOilOdo ?? "")) ?? String(v.nextOilOdo ?? "");

  v.plate = (plate || "").trim();
  v.make = (make || "").trim();
  v.model = (model || "").trim();
  v.year = year ? (Number(year)||undefined) : undefined;
  v.vin = (vin || "").trim();
  v.odometer = od ? (Number(od)||undefined) : undefined;
  v.nextOilOdo = nextOil ? (Number(nextOil)||undefined) : undefined;

  await dbAPI.put("vehicles", v);
  alert("تم التعديل ✅");
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

  alert("تم الحذف ✅");
  renderRoute();
}

/* ------------------------ Employees ------------------------ */
async function createEmployee() {
  const name = prompt("اسم الموظف:");
  if (!name) return;
  const phone = prompt("الهاتف (اختياري):") || "";
  const specialty = prompt("الاختصاص (ميكانيك/كهرباء/سمكرة...):") || "";
  const salaryType = prompt("نوع الراتب (شهري/يومي/بالنسبة):","شهري") || "شهري";
  const salaryAmount = Number(prompt("قيمة الراتب (رقم):","0") || "0");

  const e = { id:"emp_"+uid().slice(3), name:name.trim(), phone:phone.trim(), specialty:specialty.trim(), salaryType:salaryType.trim(), salaryAmount, active:true, createdAt:Date.now() };
  await dbAPI.put("employees", e);
  alert("تم إضافة الموظف ✅");
  renderRoute();
}

async function editEmployee(id) {
  const e = await dbAPI.get("employees", id);
  if (!e) return;
  const name = prompt("الاسم:", e.name || "") ?? e.name;
  const phone = prompt("الهاتف:", e.phone || "") ?? e.phone;
  const specialty = prompt("الاختصاص:", e.specialty || "") ?? e.specialty;
  const salaryType = prompt("نوع الراتب:", e.salaryType || "شهري") ?? e.salaryType;
  const salaryAmount = Number(prompt("قيمة الراتب:", String(e.salaryAmount||0)) || String(e.salaryAmount||0));

  e.name = (name || e.name).trim();
  e.phone = (phone || "").trim();
  e.specialty = (specialty || "").trim();
  e.salaryType = (salaryType || e.salaryType || "شهري").trim();
  e.salaryAmount = salaryAmount;
  await dbAPI.put("employees", e);

  alert("تم التعديل ✅");
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
  const name = prompt("اسم القطعة:");
  if (!name) return;
  const sku = prompt("SKU/رقم (اختياري):") || "";
  const buy = Number(prompt("سعر الشراء:","0") || "0");
  const sell = Number(prompt("سعر البيع:","0") || "0");
  const stock = Number(prompt("الرصيد الحالي:","0") || "0");
  const min = Number(prompt("الحد الأدنى:","0") || "0");
  const p = { id:"part_"+uid().slice(3), name:name.trim(), sku:sku.trim(), buy, sell, stock, min, createdAt:Date.now() };
  await dbAPI.put("parts", p);
  alert("تمت إضافة القطعة ✅");
  renderRoute();
}

async function adjustStock(partId, delta) {
  const p = await dbAPI.get("parts", partId);
  if (!p) return;
  const amount = Number(prompt(delta>0 ? "شكد إضافة؟" : "شكد صرف؟","1") || "0");
  if (!amount || amount<=0) return;
  const next = Number(p.stock||0) + (delta>0 ? amount : -amount);
  if (next < 0) return alert("ما يصير الرصيد يصير سالب.");
  p.stock = next;
  await dbAPI.put("parts", p);
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

  const stock = Number(part.stock || 0);
  if (stock < qty) return alert(`الرصيد ما يكفي. الرصيد الحالي: ${stock}`);

  // خصم مخزون
  part.stock = stock - qty;
  await dbAPI.put("parts", part);

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
  // رجّع للمخزون
  const part = await dbAPI.get("parts", line.partId);
  if (part) {
    part.stock = Number(part.stock||0) + Number(line.qty||0);
    await dbAPI.put("parts", part);
  }

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
    items.push({ name, qty, unit, total: qty*unit, kind:"part" });
  }

  for (const ll of laborLines) {
    const amt = Number(ll.amount||0);
    if (amt>0) items.push({ name: ll.title || "أجور", qty: 1, unit: amt, total: amt, kind:"labor" });
  }

  const subtotal = sum(items, it => Number(it.total||0));
  return { items, subtotal };
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

  alert("تم إنشاء الفاتورة ✅");
  location.hash = "#/invoices";
}

async function payInvoice(invId) {
  const inv = await dbAPI.get("invoices", invId);
  if (!inv) return;
  const rem = Math.max(0, Number(inv.total||0) - Number(inv.paid||0));
  const add = Number(prompt(`المتبقي: ${rem}\nشكد دفعة إضافية؟`,"0") || "0");
  if (!add || add<=0) return;
  inv.paid = Math.min(Number(inv.total||0), Number(inv.paid||0) + add);
  await dbAPI.put("invoices", inv);
  renderRoute();
}

async function deleteInvoice(invId) {
  if (!confirm("حذف الفاتورة؟")) return;
  await dbAPI.del("invoices", invId);
  renderRoute();
}

async function printInvoiceById(invId) {
  const inv = await dbAPI.get("invoices", invId);
  if (!inv) return;

  const wo = await dbAPI.get("workOrders", inv.workOrderId);
  const customer = wo ? await dbAPI.get("customers", wo.customerId) : null;
  const vehicle = wo ? await dbAPI.get("vehicles", wo.vehicleId) : null;
  const employee = wo?.employeeId ? await dbAPI.get("employees", wo.employeeId) : null;

  printInvoice(inv, { wo, customer, vehicle, employee });
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
  data._meta = { exportedAt: Date.now(), app: "نظام الوليم RPM", dbVer: DB_VER };
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

      ${filtered.length ? `
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
          ${filtered.map(w => {
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

  const customer = await dbAPI.get("customers", wo.customerId);
  const vehicle = await dbAPI.get("vehicles", wo.vehicleId);
  const employees = (await dbAPI.getAll("employees")).filter(e => e.active);
  const parts = await dbAPI.getAll("parts");

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

  const today = new Date();
  const startDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  const startMonth = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
  const endDay = startDay + 86400e3;

  const todayPaid = invoices.filter(i => i.createdAt>=startDay && i.createdAt<endDay).reduce((s,i)=> s + Number(i.paid||0), 0);
  const monthPaid = invoices.filter(i => i.createdAt>=startMonth).reduce((s,i)=> s + Number(i.paid||0), 0);

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
        <div class="card"><div class="card-title">مدفوع هذا الشهر</div><div class="card-value">${money(monthPaid)}</div></div>
        <div class="card"><div class="card-title">مبالغ متبقية (ديون)</div><div class="card-value">${money(totalRemaining)}</div></div>
        <div class="card"><div class="card-title">عدد تبديل دهن هذا الشهر</div><div class="card-value">${oilCountMonth}</div></div>
      </div>

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

      <div class="card subcard" style="border:1px solid #fecaca">
        <div class="section-title" style="color:var(--bad)">Reset</div>
        <div class="small">حذف كل البيانات</div>
        <div class="hr"></div>
        <button class="btn btn-danger" data-act="reset">حذف الكل</button>
      </div>
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
        <a class="btn" href="#/customers">الزباين</a>
        <a class="btn" href="#/vehicles">السيارات</a>
        <a class="btn" href="#/invoices">الفواتير</a>
        <a class="btn" href="#/employees">الموظفين</a>
        <a class="btn" href="#/reports">التقارير</a>
        <a class="btn" href="#/backup">نسخ احتياطي</a>
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

  setTitle(route);
  setActiveNav(route);

  const d = new Date();
  $("#todayBadge").textContent = `اليوم: ${d.toLocaleDateString("ar-IQ")}`;

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
  if (route === "backup") html = await viewBackup();
  if (route === "more") html = await viewMore();

  view.innerHTML = html;

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
    if (q === "customer") return createCustomer();
    if (q === "vehicle") return createVehicle();
    if (q === "employee") return createEmployee();
    if (q === "part") return createPart();
  }

  // Sidebar mobile toggle
  if (t?.id === "btnMenu") return $("#sidebar").classList.toggle("open");

  const act = t?.dataset?.act;
  const id = t?.dataset?.id;
  const idx = t?.dataset?.idx;

  if (act === "newCustomer") return createCustomer();
  if (act === "editCustomer") return editCustomer(id);
  if (act === "deleteCustomer") return deleteCustomer(id);
  if (act === "newVehicle") return createVehicle();
  if (act === "newVehicleForCustomer") return createVehicle(id);
  if (act === "editVehicle") return editVehicle(id);
  if (act === "deleteVehicle") return deleteVehicle(id);

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
  if (["orders","customers","vehicles","inventory"].includes(r)) renderRoute();
});

$("#btnSeed").addEventListener("click", seedDemo);
window.addEventListener("hashchange", () => { $("#sidebar").classList.remove("open"); renderRoute(); });

/* ------------------------ Init ------------------------ */
(async function init() {
  await openDB();
  if (!location.hash) location.hash = "#/dashboard";
  renderRoute();
})();
