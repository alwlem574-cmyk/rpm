// app_new.js
// SPA + Firebase Auth + Firestore
// ضعي apiKey الخاص بمشروعك داخل firebaseConfig.

const firebaseConfig = {
  apiKey: "PUT_YOUR_API_KEY_HERE",
  authDomain: "rpm574.firebaseapp.com",
  projectId: "rpm574",
  storageBucket: "rpm574.firebasestorage.app",
  messagingSenderId: "150918603525",
  appId: "1:150918603525:web:95c93b1498d869d46c4d6c",
};

let auth, db;
let currentRole = "guest";

let selectedCustomer = null;
let selectedCar = null;

let woSelectedCustomer = null;
let woSelectedCar = null;

let custEditingId = null;
let carEditingId = null;
let empEditingId = null;

const $ = (id) => document.getElementById(id);
const qs = (sel, root=document) => root.querySelector(sel);
const qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function setMsg(el, text, type="") {
  if (!el) return;
  el.className = "msg" + (type ? " " + type : "");
  el.textContent = text || "";
}
function clean(s){ return (s || "").trim(); }
function normalizePlate(s){ return (s || "").trim().toUpperCase(); }

function escapeHtml(s){
  return String(s||"").replace(/[&<>"']/g, (m)=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));
}
function formatDate(ts){
  try{
    const d = ts?.toDate ? ts.toDate() : null;
    if(!d) return "—";
    return d.toLocaleString("ar-IQ");
  }catch{ return "—"; }
}
function debounce(fn, ms=250){
  let t=null;
  return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}

function ensureFirebase(){
  try{
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    $("firebaseBadge").textContent = "Firebase: مرتبط";
    $("firebaseBadge").classList.add("badge-ok");
    return true;
  }catch(e){
    console.error(e);
    $("firebaseBadge").textContent = "Firebase: فشل الربط";
    return false;
  }
}

function showAuth(show){
  $("authCard").classList.toggle("hidden", !show);
  qsa(".page").forEach(p=> p.classList.toggle("hidden", show));
}

function setRoleBadge(role){
  $("roleBadge").textContent = role === "admin" ? "أدمن" : (role === "user" ? "موظف" : "زائر");
  $("adminNav").style.display = (role === "admin") ? "" : "none";
}

async function loadRole(uid){
  currentRole = "user";
  try{
    const snap = await db.collection("users").doc(uid).get();
    const data = snap.exists ? snap.data() : null;
    currentRole = data?.role || "user";
  }catch(e){ console.warn(e); }
  setRoleBadge(currentRole);
  await applyUIConfig();
}

function bindNav(){
  qsa(".nav-item").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      navigate(btn.dataset.route);
      $("sidebar").classList.remove("open");
    });
  });
  $("btnToggleSidebar").addEventListener("click", ()=> $("sidebar").classList.toggle("open"));
  $("btnSignOut").addEventListener("click", ()=> auth?.signOut());
}

function setActiveNav(route){
  qsa(".nav-item").forEach(b=> b.classList.toggle("active", b.dataset.route === route));
}

function navigate(route){
  const titles = {
    dashboard:"لوحة التحكم", reception:"الاستقبال", workorders:"أمر تشغيلي",
    customers:"الزبائن", cars:"السيارات", admin:"إعدادات الأدمن",
  };
  $("pageTitle").textContent = titles[route] || "RPM";
  setActiveNav(route);
  qsa(".page").forEach(p=> p.classList.add("hidden"));
  const el = $("page-" + route);
  if(el) el.classList.remove("hidden");

  if(route==="dashboard") refreshKPIs();
  if(route==="reception") loadRecentOrders("reception");
  if(route==="workorders"){ loadDepartmentsToSelect(); loadRecentOrders("work"); }
  if(route==="admin"){ if(currentRole!=="admin") return navigate("dashboard"); loadAdmin(); }
}

async function applyUIConfig(){
  const defaults = {dashboard:true,reception:true,workorders:true,customers:true,cars:true,admin:true};
  let sections = {...defaults};
  try{
    const snap = await db.collection("uiConfig").doc("main").get();
    if(snap.exists){
      const d = snap.data();
      if(d?.sections) sections = {...sections, ...d.sections};
    }
  }catch(e){}

  const map = {
    dashboard: qsa('[data-route="dashboard"]')[0],
    reception: qsa('[data-route="reception"]')[0],
    workorders: qsa('[data-route="workorders"]')[0],
    customers: qsa('[data-route="customers"]')[0],
    cars: qsa('[data-route="cars"]')[0],
    admin: $("adminNav"),
  };
  Object.entries(map).forEach(([k,btn])=>{
    if(!btn) return;
    btn.style.display = (sections[k] !== false) ? "" : "none";
  });
}

function uniqById(arr){
  const m = new Map();
  for(const x of arr){
    const id = x?.id || JSON.stringify(x);
    if(!m.has(id)) m.set(id,x);
  }
  return Array.from(m.values());
}

async function queryPrefix(col, field, term, limitN=10, upper=false){
  const t = upper ? normalizePlate(term) : clean(term);
  if(!t) return [];
  const snap = await db.collection(col)
    .orderBy(field)
    .startAt(t)
    .endAt(t + "\uf8ff")
    .limit(limitN)
    .get()
    .catch(()=>null);
  if(!snap || snap.empty) return [];
  return snap.docs.map(d=>({id:d.id, ...d.data()}));
}

async function searchCustomerSmart(term){
  term = clean(term);
  if(!term) return [];

  // 1) اذا لوحة: ابحث cars ثم ارجع owner
  const plate = normalizePlate(term);
  if(plate.length >= 4 && /[0-9]/.test(plate)){
    const carSnap = await db.collection("cars").where("plate","==", plate).limit(5).get().catch(()=>null);
    if(carSnap && !carSnap.empty){
      const owners = [];
      for(const doc of carSnap.docs){
        const car = doc.data();
        if(car.customerId){
          const cdoc = await db.collection("customers").doc(car.customerId).get().catch(()=>null);
          if(cdoc?.exists){
            const c = cdoc.data();
            owners.push({id: cdoc.id, name: c.name || car.customerName || "—", phone: c.phone || car.customerPhone || "", fromPlate: plate});
          }else{
            owners.push({id: car.customerId, name: car.customerName || "—", phone: car.customerPhone || "", fromPlate: plate});
          }
        }
      }
      if(owners.length) return uniqById(owners);
    }
  }

  const out = [];
  if(/[0-9]/.test(term)){
    out.push(...await queryPrefix("customers","phone", term, 10));
  }
  out.push(...await queryPrefix("customers","name", term, 10));
  return uniqById(out).slice(0,10);
}

async function searchCarsSmart(term){
  term = clean(term);
  if(!term) return [];
  const out = [];

  const plate = normalizePlate(term);
  out.push(...(await queryPrefix("cars","plate", plate, 10, true)).map(c=>({...c,_hit:"plate"})));
  out.push(...(await queryPrefix("cars","model", term, 10)).map(c=>({...c,_hit:"model"})));

  const cust = await searchCustomerSmart(term);
  const ids = cust.map(x=>x.id).slice(0,10);
  if(ids.length){
    const snap = await db.collection("cars").where("customerId","in", ids).limit(10).get().catch(()=>null);
    if(snap && !snap.empty){
      snap.docs.forEach(d=> out.push({id:d.id, ...d.data(), _hit:"owner"}));
    }
  }

  return uniqById(out).slice(0,10);
}

function renderResults(container, items, onPick, kind){
  container.innerHTML = "";
  if(!items.length){
    container.innerHTML = '<div class="result-item"><div>لا توجد نتائج</div><div class="result-meta">—</div></div>';
    return;
  }
  items.forEach(it=>{
    const el = document.createElement("div");
    el.className = "result-item";
    const left = document.createElement("div");
    const right = document.createElement("div");
    right.className = "result-meta";

    if(kind==="customer"){
      left.innerHTML = `<b>${escapeHtml(it.name||"—")}</b><div class="result-meta">${escapeHtml(it.phone||"")}${it.fromPlate ? " • لوحة: "+escapeHtml(it.fromPlate) : ""}</div>`;
      right.textContent = "اختيار";
    }else{
      left.innerHTML = `<b>${escapeHtml(it.plate||"—")}</b><div class="result-meta">${escapeHtml(it.model||"")} • ${escapeHtml(it.customerName||"")} ${it.customerPhone?("• "+escapeHtml(it.customerPhone)):""}</div>`;
      right.textContent = "اختيار";
    }

    el.appendChild(left); el.appendChild(right);
    el.addEventListener("click", ()=> onPick(it));
    container.appendChild(el);
  });
}

async function upsertCustomer({name, phone}){
  name = clean(name); phone = clean(phone);
  if(!name) throw new Error("اسم الزبون إجباري");
  let existing = null;
  if(phone){
    const snap = await db.collection("customers").where("phone","==", phone).limit(1).get().catch(()=>null);
    if(snap && !snap.empty) existing = {id:snap.docs[0].id, ...snap.docs[0].data()};
  }
  if(existing){
    await db.collection("customers").doc(existing.id).set({name, phone, updatedAt: firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
    return {id: existing.id, name, phone};
  }
  const ref = await db.collection("customers").add({name, phone, createdAt: firebase.firestore.FieldValue.serverTimestamp()});
  return {id: ref.id, name, phone};
}

async function upsertCar({plate, model, year, customer}){
  plate = normalizePlate(plate);
  model = clean(model);
  year = year ? Number(year) : null;
  if(!plate) throw new Error("رقم اللوحة مطلوب");

  const snap = await db.collection("cars").where("plate","==", plate).limit(1).get().catch(()=>null);
  if(snap && !snap.empty){
    const doc = snap.docs[0];
    const old = doc.data();
    await db.collection("cars").doc(doc.id).set({
      plate, model, year: year || null,
      customerId: customer?.id || old.customerId || null,
      customerName: customer?.name || old.customerName || "",
      customerPhone: customer?.phone || old.customerPhone || "",
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    },{merge:true});
    return {id: doc.id, ...old, plate, model, year};
  }
  const ref = await db.collection("cars").add({
    plate, model, year: year || null,
    customerId: customer?.id || null,
    customerName: customer?.name || "",
    customerPhone: customer?.phone || "",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  return {id: ref.id, plate, model, year, customerId: customer?.id || null};
}

async function createOrder(type, payload){
  await db.collection("orders").add({
    type, status:"open",
    ...payload,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

function bindReception(){
  $("rxCustomerSearch").addEventListener("input", debounce(async ()=>{
    const items = await searchCustomerSmart($("rxCustomerSearch").value);
    renderResults($("rxCustomerResults"), items, (it)=>{
      selectedCustomer = it;
      $("rxCustomerName").value = it.name || "";
      $("rxCustomerPhone").value = it.phone || "";
      setMsg($("rxMsg"), "تم اختيار الزبون.", "ok");
    }, "customer");
  }));

  $("rxCarSearch").addEventListener("input", debounce(async ()=>{
    const items = await searchCarsSmart($("rxCarSearch").value);
    renderResults($("rxCarResults"), items, async (it)=>{
      selectedCar = it;
      $("rxPlate").value = it.plate || "";
      $("rxCarModel").value = it.model || "";
      $("rxCarYear").value = it.year || "";
      if(it.customerId){
        const cdoc = await db.collection("customers").doc(it.customerId).get().catch(()=>null);
        if(cdoc?.exists){
          const c = cdoc.data();
          selectedCustomer = {id: cdoc.id, name: c.name || it.customerName || "", phone: c.phone || it.customerPhone || ""};
        }else{
          selectedCustomer = {id: it.customerId, name: it.customerName || "", phone: it.customerPhone || ""};
        }
        $("rxCustomerName").value = selectedCustomer.name || "";
        $("rxCustomerPhone").value = selectedCustomer.phone || "";
      }
      setMsg($("rxMsg"), "تم اختيار السيارة.", "ok");
    }, "car");
  }));

  $("rxCustomerClear").addEventListener("click", ()=>{
    selectedCustomer=null;
    $("rxCustomerName").value=""; $("rxCustomerPhone").value="";
    $("rxCustomerSearch").value=""; $("rxCustomerResults").innerHTML="";
  });
  $("rxCarClear").addEventListener("click", ()=>{
    selectedCar=null;
    $("rxPlate").value=""; $("rxCarModel").value=""; $("rxCarYear").value="";
    $("rxCarSearch").value=""; $("rxCarResults").innerHTML="";
  });

  $("btnCreateReception").addEventListener("click", async ()=>{
    setMsg($("rxMsg"), "جارٍ الحفظ...");
    try{
      const name = $("rxCustomerName").value;
      const phone = $("rxCustomerPhone").value;
      if(!clean(name)) throw new Error("اسم الزبون إجباري");

      const customer = selectedCustomer?.id
        ? (await (async()=>{
            await db.collection("customers").doc(selectedCustomer.id).set({name: clean(name), phone: clean(phone), updatedAt: firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
            return {id:selectedCustomer.id, name:clean(name), phone:clean(phone)};
          })())
        : await upsertCustomer({name, phone});

      const plate = $("rxPlate").value;
      const model = $("rxCarModel").value;
      const year = $("rxCarYear").value;

      let car = null;
      if(clean(plate)) car = await upsertCar({plate, model, year, customer});

      await createOrder("reception", {
        customerId: customer.id, customerName: customer.name, customerPhone: customer.phone || "",
        carId: car?.id || null,
        plate: car?.plate || normalizePlate(plate) || "",
        carModel: car?.model || clean(model) || "",
        carYear: car?.year || (year?Number(year):null),
        notes: clean($("rxNotes").value)
      });

      setMsg($("rxMsg"), "تم إنشاء الاستقبال ✅", "ok");
      await loadRecentOrders("reception");
      await refreshKPIs();
    }catch(e){
      console.error(e);
      setMsg($("rxMsg"), e.message || "فشل", "err");
    }
  });
}

function bindWorkOrders(){
  $("woCustomerSearch").addEventListener("input", debounce(async ()=>{
    const items = await searchCustomerSmart($("woCustomerSearch").value);
    renderResults($("woCustomerResults"), items, (it)=>{
      woSelectedCustomer = it;
      $("woCustomerName").value = it.name || "";
      $("woCustomerPhone").value = it.phone || "";
      setMsg($("woMsg"), "تم اختيار الزبون.", "ok");
    }, "customer");
  }));

  $("woCarSearch").addEventListener("input", debounce(async ()=>{
    const items = await searchCarsSmart($("woCarSearch").value);
    renderResults($("woCarResults"), items, async (it)=>{
      woSelectedCar = it;
      $("woPlate").value = it.plate || "";
      $("woCarModel").value = it.model || "";
      $("woCarYear").value = it.year || "";
      if(it.customerId){
        const cdoc = await db.collection("customers").doc(it.customerId).get().catch(()=>null);
        if(cdoc?.exists){
          const c = cdoc.data();
          woSelectedCustomer = {id: cdoc.id, name: c.name || it.customerName || "", phone: c.phone || it.customerPhone || ""};
        }else{
          woSelectedCustomer = {id: it.customerId, name: it.customerName || "", phone: it.customerPhone || ""};
        }
        $("woCustomerName").value = woSelectedCustomer.name || "";
        $("woCustomerPhone").value = woSelectedCustomer.phone || "";
      }
      setMsg($("woMsg"), "تم اختيار السيارة.", "ok");
    }, "car");
  }));

  $("woCustomerClear").addEventListener("click", ()=>{
    woSelectedCustomer=null;
    $("woCustomerName").value=""; $("woCustomerPhone").value="";
    $("woCustomerSearch").value=""; $("woCustomerResults").innerHTML="";
  });
  $("woCarClear").addEventListener("click", ()=>{
    woSelectedCar=null;
    $("woPlate").value=""; $("woCarModel").value=""; $("woCarYear").value="";
    $("woCarSearch").value=""; $("woCarResults").innerHTML="";
  });

  const recalc = ()=>{
    const labor = Number($("woLabor").value || 0);
    const parts = Number($("woParts").value || 0);
    $("woTotal").value = labor + parts;
  };
  $("woLabor").addEventListener("input", recalc);
  $("woParts").addEventListener("input", recalc);

  $("btnCreateWorkOrder").addEventListener("click", async ()=>{
    setMsg($("woMsg"), "جارٍ الحفظ...");
    try{
      const name = $("woCustomerName").value;
      const phone = $("woCustomerPhone").value;
      if(!clean(name)) throw new Error("اسم الزبون إجباري");

      const customer = woSelectedCustomer?.id
        ? (await (async()=>{
            await db.collection("customers").doc(woSelectedCustomer.id).set({name: clean(name), phone: clean(phone), updatedAt: firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
            return {id:woSelectedCustomer.id, name:clean(name), phone:clean(phone)};
          })())
        : await upsertCustomer({name, phone});

      const plate = $("woPlate").value;
      const model = $("woCarModel").value;
      const year = $("woCarYear").value;

      let car = null;
      if(clean(plate)) car = await upsertCar({plate, model, year, customer});

      const deptId = $("woDept").value || "";
      const deptName = $("woDept").selectedOptions?.[0]?.textContent || "";

      const labor = Number($("woLabor").value || 0);
      const parts = Number($("woParts").value || 0);
      const total = labor + parts;

      await createOrder("work", {
        customerId: customer.id, customerName: customer.name, customerPhone: customer.phone || "",
        carId: car?.id || null,
        plate: car?.plate || normalizePlate(plate) || "",
        carModel: car?.model || clean(model) || "",
        carYear: car?.year || (year?Number(year):null),
        deptId, deptName,
        labor, parts, total,
        notes: clean($("woNotes").value)
      });

      setMsg($("woMsg"), "تم إنشاء أمر تشغيلي ✅", "ok");
      await loadRecentOrders("work");
      await refreshKPIs();
    }catch(e){
      console.error(e);
      setMsg($("woMsg"), e.message || "فشل", "err");
    }
  });
}

async function loadRecentOrders(type){
  const table = type==="reception" ? $("rxTable") : $("woTable");
  table.innerHTML = "جارٍ التحميل...";
  const snap = await db.collection("orders")
    .where("type","==", type)
    .orderBy("createdAt","desc")
    .limit(10)
    .get()
    .catch(()=>null);

  const rows = [];
  const head = document.createElement("div");
  head.className = "table-row head";
  head.innerHTML = `<div>الزبون</div><div>السيارة</div><div>${type==="work" ? "القسم" : "ملاحظات"}</div><div>تاريخ</div>`;
  rows.push(head);

  if(!snap || snap.empty){
    const r = document.createElement("div");
    r.className = "table-row";
    r.style.gridTemplateColumns = "1fr";
    r.innerHTML = "<div>لا توجد بيانات</div>";
    rows.push(r);
  }else{
    snap.docs.forEach(doc=>{
      const o = doc.data();
      const r = document.createElement("div");
      r.className = "table-row";
      const c = `${o.customerName||"—"} ${o.customerPhone?("• "+o.customerPhone):""}`;
      const car = `${o.plate||"—"} • ${o.carModel||""}`;
      const mid = type==="work" ? (o.deptName||"—") : (o.notes||"—");
      r.innerHTML = `<div>${escapeHtml(c)}</div><div>${escapeHtml(car)}</div><div>${escapeHtml(mid)}</div><div>${escapeHtml(formatDate(o.createdAt))}</div>`;
      rows.push(r);
    });
  }
  table.innerHTML = "";
  rows.forEach(r=> table.appendChild(r));
}

function bindCustomers(){
  $("btnCustNew").addEventListener("click", ()=>{
    custEditingId=null;
    $("custFormTitle").textContent="إضافة زبون";
    $("custName").value=""; $("custPhone").value="";
    setMsg($("custMsg"), "");
  });

  const run = async ()=>{
    const res = await searchCustomerSmart($("custSearch").value);
    const box = $("custResults");
    box.innerHTML = "";
    if(!res.length){
      box.innerHTML = '<div class="result-item"><div>لا توجد نتائج</div><div class="result-meta">—</div></div>';
      return;
    }
    res.forEach(it=>{
      const el = document.createElement("div");
      el.className = "result-item";
      el.innerHTML = `<div><b>${escapeHtml(it.name||"—")}</b><div class="result-meta">${escapeHtml(it.phone||"")}</div></div><div class="result-meta">تحرير</div>`;
      el.addEventListener("click", ()=>{
        custEditingId = it.id;
        $("custFormTitle").textContent="تعديل زبون";
        $("custName").value = it.name || "";
        $("custPhone").value = it.phone || "";
        setMsg($("custMsg"), "تم اختيار الزبون للتحرير.", "ok");
      });
      box.appendChild(el);
    });
  };

  $("btnCustSearch").addEventListener("click", run);
  $("custSearch").addEventListener("input", debounce(async ()=>{
    if(clean($("custSearch").value).length<2){ $("custResults").innerHTML=""; return; }
    await run();
  }));

  $("btnCustSave").addEventListener("click", async ()=>{
    setMsg($("custMsg"), "جارٍ الحفظ...");
    try{
      const name = $("custName").value;
      const phone = $("custPhone").value;
      if(!clean(name)) throw new Error("الاسم مطلوب");
      if(custEditingId){
        await db.collection("customers").doc(custEditingId).set({name:clean(name), phone:clean(phone), updatedAt: firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
        setMsg($("custMsg"), "تم التحديث ✅", "ok");
      }else{
        const c = await upsertCustomer({name, phone});
        custEditingId = c.id;
        setMsg($("custMsg"), "تمت الإضافة ✅", "ok");
      }
      await refreshKPIs();
    }catch(e){
      setMsg($("custMsg"), e.message || "فشل", "err");
    }
  });

  $("btnCustDelete").addEventListener("click", async ()=>{
    if(!custEditingId) return setMsg($("custMsg"), "اختاري زبون أولاً", "err");
    if(!confirm("حذف الزبون؟")) return;
    await db.collection("customers").doc(custEditingId).delete();
    custEditingId=null;
    $("custName").value=""; $("custPhone").value="";
    setMsg($("custMsg"), "تم الحذف", "ok");
    await refreshKPIs();
  });
}

function bindCars(){
  $("btnCarNew").addEventListener("click", ()=>{
    carEditingId=null;
    $("carFormTitle").textContent="إضافة سيارة";
    $("carPlate").value=""; $("carModel").value=""; $("carYear").value="";
    $("carOwnerSearch").value=""; $("carOwnerSearch").dataset.customerId="";
    $("carOwnerResults").innerHTML="";
    setMsg($("carMsg"), "");
  });

  const run = async ()=>{
    const res = await searchCarsSmart($("carSearch").value);
    const box = $("carResults");
    box.innerHTML = "";
    if(!res.length){
      box.innerHTML = '<div class="result-item"><div>لا توجد نتائج</div><div class="result-meta">—</div></div>';
      return;
    }
    res.forEach(it=>{
      const el = document.createElement("div");
      el.className = "result-item";
      el.innerHTML = `<div><b>${escapeHtml(it.plate||"—")}</b><div class="result-meta">${escapeHtml(it.model||"")} • ${escapeHtml(it.customerName||"")}${it.customerPhone?(" • "+escapeHtml(it.customerPhone)):""}</div></div><div class="result-meta">تحرير</div>`;
      el.addEventListener("click", ()=>{
        carEditingId = it.id;
        $("carFormTitle").textContent="تعديل سيارة";
        $("carPlate").value = it.plate || "";
        $("carModel").value = it.model || "";
        $("carYear").value = it.year || "";
        $("carOwnerSearch").value = `${it.customerName||""} ${it.customerPhone||""}`.trim();
        $("carOwnerSearch").dataset.customerId = it.customerId || "";
        $("carOwnerSearch").dataset.customerName = it.customerName || "";
        $("carOwnerSearch").dataset.customerPhone = it.customerPhone || "";
        setMsg($("carMsg"), "تم اختيار السيارة للتحرير.", "ok");
      });
      box.appendChild(el);
    });
  };

  $("btnCarSearch").addEventListener("click", run);
  $("carSearch").addEventListener("input", debounce(async ()=>{
    if(clean($("carSearch").value).length<2){ $("carResults").innerHTML=""; return; }
    await run();
  }));

  $("carOwnerSearch").addEventListener("input", debounce(async ()=>{
    const term = $("carOwnerSearch").value;
    if(clean(term).length<2){ $("carOwnerResults").innerHTML=""; return; }
    const res = await searchCustomerSmart(term);
    renderResults($("carOwnerResults"), res, (c)=>{
      $("carOwnerSearch").value = `${c.name||""} ${c.phone||""}`.trim();
      $("carOwnerSearch").dataset.customerId = c.id;
      $("carOwnerSearch").dataset.customerName = c.name || "";
      $("carOwnerSearch").dataset.customerPhone = c.phone || "";
      setMsg($("carMsg"), "تم اختيار المالك.", "ok");
    }, "customer");
  }));

  $("btnCarSave").addEventListener("click", async ()=>{
    setMsg($("carMsg"), "جارٍ الحفظ...");
    try{
      const plate = $("carPlate").value;
      const model = $("carModel").value;
      const year = $("carYear").value;

      const ownerId = $("carOwnerSearch").dataset.customerId || null;
      const owner = ownerId ? {id:ownerId, name:$("carOwnerSearch").dataset.customerName||"", phone:$("carOwnerSearch").dataset.customerPhone||""} : null;

      if(carEditingId){
        await db.collection("cars").doc(carEditingId).set({
          plate: normalizePlate(plate),
          model: clean(model),
          year: year?Number(year):null,
          customerId: owner?.id || null,
          customerName: owner?.name || "",
          customerPhone: owner?.phone || "",
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        },{merge:true});
        setMsg($("carMsg"), "تم التحديث ✅", "ok");
      }else{
        const c = await upsertCar({plate, model, year, customer: owner});
        carEditingId = c.id;
        setMsg($("carMsg"), "تمت الإضافة ✅", "ok");
      }
      await refreshKPIs();
    }catch(e){
      setMsg($("carMsg"), e.message || "فشل", "err");
    }
  });

  $("btnCarDelete").addEventListener("click", async ()=>{
    if(!carEditingId) return setMsg($("carMsg"), "اختاري سيارة أولاً", "err");
    if(!confirm("حذف السيارة؟")) return;
    await db.collection("cars").doc(carEditingId).delete();
    carEditingId=null;
    $("carPlate").value=""; $("carModel").value=""; $("carYear").value="";
    $("carOwnerSearch").value=""; $("carOwnerSearch").dataset.customerId="";
    $("carOwnerResults").innerHTML="";
    setMsg($("carMsg"), "تم الحذف", "ok");
    await refreshKPIs();
  });
}

async function ensureAdminDefaults(){
  const snap = await db.collection("departments").limit(1).get().catch(()=>null);
  if(snap && snap.empty){
    const defaults = ["ميكانيك","كهرباء","تبريد","إطارات","فحص","حدادة/دهن"];
    for(const name of defaults){
      await db.collection("departments").add({name, active:true, createdAt: firebase.firestore.FieldValue.serverTimestamp()});
    }
  }
  const cfg = await db.collection("uiConfig").doc("main").get().catch(()=>null);
  if(cfg && !cfg.exists){
    await db.collection("uiConfig").doc("main").set({
      sections:{dashboard:true,reception:true,workorders:true,customers:true,cars:true,admin:true},
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
}

async function loadDepartmentsToSelect(){
  const sel = $("woDept");
  sel.innerHTML = "";
  const snap = await db.collection("departments").orderBy("name").get().catch(()=>null);
  if(!snap || snap.empty){ sel.innerHTML = '<option value="">—</option>'; return; }
  snap.docs.forEach(d=>{
    const dep = d.data();
    if(dep.active === false) return;
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = dep.name || "—";
    sel.appendChild(opt);
  });
}

async function loadAdmin(){
  await ensureAdminDefaults();
  await loadDeptTable();
  await loadSectionsBox();
  await loadEmpTable();
}

async function loadDeptTable(){
  const table = $("deptTable");
  table.innerHTML = "جارٍ التحميل...";
  const snap = await db.collection("departments").orderBy("name").get().catch(()=>null);
  const rows = [];
  const head = document.createElement("div");
  head.className = "table-row head";
  head.innerHTML = "<div>القسم</div><div>الحالة</div><div>—</div><div>إجراءات</div>";
  rows.push(head);

  if(!snap || snap.empty){
    const r = document.createElement("div");
    r.className="table-row"; r.style.gridTemplateColumns="1fr";
    r.innerHTML="<div>لا توجد أقسام</div>";
    rows.push(r);
  }else{
    snap.docs.forEach(doc=>{
      const d = doc.data();
      const active = d.active !== false;
      const r = document.createElement("div");
      r.className="table-row";
      r.innerHTML = `
        <div>${escapeHtml(d.name||"—")}</div>
        <div>${active ? "مفعل" : "موقف"}</div>
        <div class="result-meta">${escapeHtml(formatDate(d.createdAt))}</div>
        <div class="table-actions">
          <button class="btn btn-mini btn-secondary" data-act="toggle">تفعيل/إيقاف</button>
          <button class="btn btn-mini btn-ghost" data-act="rename">تعديل</button>
          <button class="btn btn-mini" style="border-color:rgba(255,77,109,.55);background:rgba(255,77,109,.15)" data-act="del">حذف</button>
        </div>`;
      qsa("button", r).forEach(b=>{
        b.addEventListener("click", async ()=>{
          const act = b.dataset.act;
          if(act==="toggle"){
            await db.collection("departments").doc(doc.id).set({active: !active},{merge:true});
            await loadDeptTable(); await loadDepartmentsToSelect();
          }
          if(act==="rename"){
            const nn = prompt("اسم جديد للقسم:", d.name||"");
            if(nn && clean(nn)){ await db.collection("departments").doc(doc.id).set({name: clean(nn)},{merge:true}); await loadDeptTable(); await loadDepartmentsToSelect(); }
          }
          if(act==="del"){
            if(confirm("حذف القسم؟")){ await db.collection("departments").doc(doc.id).delete(); await loadDeptTable(); await loadDepartmentsToSelect(); }
          }
        });
      });
      rows.push(r);
    });
  }

  table.innerHTML="";
  rows.forEach(r=> table.appendChild(r));

  $("btnDeptAdd").onclick = async ()=>{
    const name = $("deptName").value;
    if(!clean(name)) return setMsg($("adminMsg"), "اسم القسم مطلوب", "err");
    await db.collection("departments").add({name: clean(name), active:true, createdAt: firebase.firestore.FieldValue.serverTimestamp()});
    $("deptName").value="";
    setMsg($("adminMsg"), "تمت إضافة قسم ✅", "ok");
    await loadDeptTable(); await loadDepartmentsToSelect();
  };
}

async function loadSectionsBox(){
  const box = $("sectionsBox");
  box.innerHTML = "جارٍ التحميل...";
  const defaults = {dashboard:true,reception:true,workorders:true,customers:true,cars:true,admin:true};
  let sections = {...defaults};
  const snap = await db.collection("uiConfig").doc("main").get().catch(()=>null);
  if(snap?.exists){
    const d = snap.data();
    if(d?.sections) sections = {...sections, ...d.sections};
  }
  const labels = {
    dashboard:"لوحة التحكم", reception:"الاستقبال", workorders:"أمر تشغيلي",
    customers:"الزبائن", cars:"السيارات", admin:"إعدادات الأدمن"
  };
  box.innerHTML="";
  Object.keys(labels).forEach(k=>{
    const wrap = document.createElement("div");
    wrap.className="card"; wrap.style.padding="12px"; wrap.style.boxShadow="none";
    wrap.innerHTML = `
      <div class="row" style="justify-content:space-between;margin:0">
        <div><b>${labels[k]}</b><div class="muted small">إظهار/إخفاء في القائمة</div></div>
        <label style="display:flex;align-items:center;gap:10px;margin:0">
          <input type="checkbox" ${sections[k]!==false ? "checked":""} data-key="${k}" style="width:auto;transform:scale(1.2)"/>
        </label>
      </div>`;
    box.appendChild(wrap);
  });

  $("btnSaveSections").onclick = async ()=>{
    const out = {};
    qsa('input[type="checkbox"]', box).forEach(ch=> out[ch.dataset.key] = ch.checked);
    await db.collection("uiConfig").doc("main").set({sections: out, updatedAt: firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
    setMsg($("adminMsg"), "تم حفظ الإعدادات ✅", "ok");
    await applyUIConfig();
  };
}

async function loadEmpTable(){
  const table = $("empTable");
  table.innerHTML = "جارٍ التحميل...";
  const snap = await db.collection("employees").orderBy("name").get().catch(()=>null);

  const rows = [];
  const head = document.createElement("div");
  head.className="table-row head";
  head.innerHTML="<div>الموظف</div><div>الراتب</div><div>هاتف</div><div>إجراءات</div>";
  rows.push(head);

  if(!snap || snap.empty){
    const r = document.createElement("div");
    r.className="table-row"; r.style.gridTemplateColumns="1fr";
    r.innerHTML="<div>لا توجد بيانات موظفين</div>";
    rows.push(r);
  }else{
    snap.docs.forEach(doc=>{
      const e = doc.data();
      const r = document.createElement("div");
      r.className="table-row";
      r.innerHTML = `
        <div>${escapeHtml(e.name||"—")}</div>
        <div>${escapeHtml((e.salaryType||"") + " • " + (e.salaryAmount ?? "—"))}</div>
        <div>${escapeHtml(e.phone||"")}</div>
        <div class="table-actions"><button class="btn btn-mini btn-secondary">تحرير</button></div>`;
      qs("button", r).addEventListener("click", ()=>{
        empEditingId = doc.id;
        $("empName").value = e.name || "";
        $("empPhone").value = e.phone || "";
        $("empType").value = e.salaryType || "monthly";
        $("empAmount").value = e.salaryAmount ?? "";
        $("empNotes").value = e.notes || "";
        setMsg($("adminMsg"), "تم اختيار موظف للتحرير.", "ok");
      });
      rows.push(r);
    });
  }
  table.innerHTML="";
  rows.forEach(r=> table.appendChild(r));

  $("btnEmpSave").onclick = async ()=>{
    try{
      const payload = {
        name: clean($("empName").value),
        phone: clean($("empPhone").value),
        salaryType: $("empType").value,
        salaryAmount: Number($("empAmount").value || 0),
        notes: clean($("empNotes").value),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if(!payload.name) throw new Error("اسم الموظف مطلوب");
      if(empEditingId){
        await db.collection("employees").doc(empEditingId).set(payload,{merge:true});
      }else{
        payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        const ref = await db.collection("employees").add(payload);
        empEditingId = ref.id;
      }
      setMsg($("adminMsg"), "تم حفظ بيانات الموظف ✅", "ok");
      await loadEmpTable();
    }catch(e){
      setMsg($("adminMsg"), e.message || "فشل", "err");
    }
  };

  $("btnEmpDelete").onclick = async ()=>{
    if(!empEditingId) return setMsg($("adminMsg"), "اختاري موظف أولاً", "err");
    if(!confirm("حذف الموظف؟")) return;
    await db.collection("employees").doc(empEditingId).delete();
    empEditingId=null;
    $("empName").value=""; $("empPhone").value=""; $("empAmount").value=""; $("empNotes").value="";
    setMsg($("adminMsg"), "تم الحذف", "ok");
    await loadEmpTable();
  };
}

async function refreshKPIs(){
  try{
    const [c1,c2,c3] = await Promise.all([
      db.collection("customers").get(),
      db.collection("cars").get(),
      db.collection("orders").where("status","==","open").get()
    ]);
    $("kpiCustomers").textContent = c1.size;
    $("kpiCars").textContent = c2.size;
    $("kpiOpenOrders").textContent = c3.size;
  }catch(e){}
}

function bindDashboardQuickSearch(){
  const run = async ()=>{
    const term = $("quickSearch").value;
    const box = $("quickResults");
    box.innerHTML = "جارٍ البحث...";
    const cust = await searchCustomerSmart(term);
    const cars = await searchCarsSmart(term);
    const items = [];
    cust.forEach(c=> items.push({type:"customer", ...c}));
    cars.forEach(c=> items.push({type:"car", ...c}));
    box.innerHTML="";
    if(!items.length){
      box.innerHTML = '<div class="result-item"><div>لا توجد نتائج</div><div class="result-meta">—</div></div>';
      return;
    }
    items.slice(0,12).forEach(it=>{
      const el = document.createElement("div");
      el.className="result-item";
      if(it.type==="customer"){
        el.innerHTML = `<div><b>زبون:</b> ${escapeHtml(it.name||"—")}<div class="result-meta">${escapeHtml(it.phone||"")}</div></div><div class="result-meta">فتح</div>`;
        el.addEventListener("click", ()=>{
          navigate("customers");
          custEditingId = it.id;
          $("custFormTitle").textContent="تعديل زبون";
          $("custName").value = it.name || "";
          $("custPhone").value = it.phone || "";
        });
      }else{
        el.innerHTML = `<div><b>سيارة:</b> ${escapeHtml(it.plate||"—")}<div class="result-meta">${escapeHtml(it.model||"")} • ${escapeHtml(it.customerName||"")}</div></div><div class="result-meta">فتح</div>`;
        el.addEventListener("click", ()=>{
          navigate("cars");
          carEditingId = it.id;
          $("carFormTitle").textContent="تعديل سيارة";
          $("carPlate").value = it.plate || "";
          $("carModel").value = it.model || "";
          $("carYear").value = it.year || "";
          $("carOwnerSearch").value = `${it.customerName||""} ${it.customerPhone||""}`.trim();
          $("carOwnerSearch").dataset.customerId = it.customerId || "";
          $("carOwnerSearch").dataset.customerName = it.customerName || "";
          $("carOwnerSearch").dataset.customerPhone = it.customerPhone || "";
        });
      }
      box.appendChild(el);
    });
  };
  $("btnQuickSearch").addEventListener("click", run);
  $("quickSearch").addEventListener("keydown", (e)=>{ if(e.key==="Enter") run(); });
}

function bindAuth(){
  $("btnLogin").addEventListener("click", async ()=>{
    setMsg($("authMsg"), "جارٍ تسجيل الدخول...");
    try{
      const email = clean($("loginEmail").value);
      const pass = $("loginPassword").value;
      await auth.signInWithEmailAndPassword(email, pass);
      setMsg($("authMsg"), "تم ✅", "ok");
    }catch(e){
      console.error(e);
      setMsg($("authMsg"), e.message || "فشل", "err");
    }
  });

  $("btnRegister").addEventListener("click", async ()=>{
    setMsg($("authMsg"), "جارٍ إنشاء الحساب...");
    try{
      const email = clean($("loginEmail").value);
      const pass = $("loginPassword").value;
      const res = await auth.createUserWithEmailAndPassword(email, pass);
      await db.collection("users").doc(res.user.uid).set({
        email, role:"user",
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      },{merge:true});
      setMsg($("authMsg"), "تم إنشاء الحساب ✅", "ok");
    }catch(e){
      console.error(e);
      setMsg($("authMsg"), e.message || "فشل", "err");
    }
  });

  auth.onAuthStateChanged(async (u)=>{
    if(!u){
      $("userEmail").textContent = "غير مسجل";
      currentRole = "guest";
      setRoleBadge(currentRole);
      showAuth(true);
      return;
    }
    $("userEmail").textContent = u.email || u.uid;
    showAuth(false);
    await loadRole(u.uid);
    navigate("dashboard");
  });
}

function bindAll(){
  bindNav();
  bindAuth();
  bindReception();
  bindWorkOrders();
  bindCustomers();
  bindCars();
  bindDashboardQuickSearch();
}

(async function init(){
  const ok = ensureFirebase();
  bindAll();
  if(!ok){
    showAuth(true);
    setMsg($("authMsg"), "تأكدي من apiKey داخل app_new.js", "err");
    return;
  }
  showAuth(true);
})();
