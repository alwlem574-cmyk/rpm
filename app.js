// RPM Workshop ERP — Rebuild v1 (Lean but working)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, setDoc, addDoc, getDocs,
  query, where, orderBy, limit, serverTimestamp, runTransaction, enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  "apiKey": "AIzaSyC0p4cqNHuqZs9_gNuKLl7nEY0MqRXbf_A",
  "authDomain": "rpm574.firebaseapp.com",
  "databaseURL": "https://rpm574-default-rtdb.firebaseio.com",
  "projectId": "rpm574",
  "storageBucket": "rpm574.firebasestorage.app",
  "messagingSenderId": "150918603525",
  "appId": "1:150918603525:web:95c93b1498d869d46c4d6c"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

try { await enableIndexedDbPersistence(db); }
catch(e){ console.warn("persistence", e?.code||e); }

const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const esc=(s)=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt=(n)=>Number(n||0).toLocaleString("ar-IQ");

const authScreen=$("#authScreen");
const appShell=$("#appShell");
const view=$("#view");
const nav=$("#nav");
const crumbs=$("#crumbs");
const titleEl=$("#pageTitle");

const State={
  user:null,
  profile:null,
  settings:{ shopName:"RPM Workshop", invoicePrefix:"INV-" }
};

function toast(t,d=""){
  const host=$("#toastHost");
  const el=document.createElement("div");
  el.className="toast";
  el.innerHTML=`<div style="font-weight:900">${esc(t)}</div><div style="opacity:.8;margin-top:4px;font-size:13px">${esc(d)}</div>`;
  host.appendChild(el);
  setTimeout(()=>el.remove(),3500);
}

function showAuth(){ authScreen.classList.remove("hidden"); appShell.classList.add("hidden"); }
function showApp(){ authScreen.classList.add("hidden"); appShell.classList.remove("hidden"); }

async function ensureSettings(){
  const ref=doc(db,"settings","main");
  const s=await getDoc(ref);
  if(!s.exists()) await setDoc(ref, State.settings, {merge:true});
  State.settings={...State.settings, ...(s.exists()?s.data():{})};
  $("#shopNameBadge").textContent = State.settings.shopName||"RPM";
}

async function readProfile(u){
  const ref=doc(db,"users",u.uid);
  const s=await getDoc(ref);
  if(!s.exists()){
    const p={
      uid:u.uid,
      email:u.email||"",
      name:(u.email||"").split("@")[0]||"User",
      role:"viewer",
      active:true,
      createdAt:serverTimestamp()
    };
    await setDoc(ref,p,{merge:true});
    return p;
  }
  return s.data();
}

async function nextNo(counterId,start=1000){
  const ref=doc(db,"meta",counterId);
  return await runTransaction(db, async(tx)=>{
    const s=await tx.get(ref);
    const cur=s.exists()?Number(s.data().value||start-1):(start-1);
    const next=cur+1;
    tx.set(ref,{value:next},{merge:true});
    return next;
  });
}

function setUserChip(){
  $("#userName").textContent = State.profile?.name || State.user?.email || "—";
  $("#userRole").textContent = State.profile?.role || "viewer";
  $("#userAvatar").textContent = (State.profile?.name||"U").slice(0,1).toUpperCase();
  $("#roleBadge").textContent = State.profile?.role || "viewer";
}

function setNavActive(route){ $$(".nav-item").forEach(b=>b.classList.toggle("active", b.dataset.route===route)); }
function setCrumbs(a){ crumbs.textContent=a.join("  ›  "); }
function setTitle(t){ titleEl.textContent=t; }

function navBtn(label,icon,route){
  const b=document.createElement("button");
  b.className="nav-item";
  b.dataset.route=route;
  b.innerHTML=`<div style="display:flex;align-items:center;gap:10px"><div class="nav-ico">${icon}</div><div class="nav-label">${esc(label)}</div></div>`;
  b.onclick=()=>location.hash=route;
  return b;
}

function buildNav(){
  nav.innerHTML="";
  nav.appendChild(navBtn("لوحة التحكم","📊","#/dashboard"));
  nav.appendChild(navBtn("الزبائن","👤","#/customers"));
  nav.appendChild(navBtn("الفواتير","🧮","#/invoices"));
}

async function pageDashboard(){
  setCrumbs(["الرئيسية","لوحة التحكم"]); setTitle("لوحة التحكم");
  const inv = await getDocs(query(collection(db,"invoices"), orderBy("createdAt","desc"), limit(5)));
  const rows = inv.docs.map(d=>{
    const x=d.data();
    return `<tr><td>${esc(x.invoiceNo||d.id.slice(0,6))}</td><td>${esc(x.customerName||"—")}</td><td>${fmt(x.total||0)}</td></tr>`;
  }).join("");
  view.innerHTML = `
    <div class="card">
      <h3>آخر فواتير</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>رقم</th><th>الزبون</th><th>الإجمالي</th></tr></thead>
          <tbody>${rows||"<tr><td colspan=3>لا يوجد</td></tr>"}</tbody>
        </table>
      </div>
    </div>`;
}

async function pageCustomers(){
  setCrumbs(["الرئيسية","الزبائن"]); setTitle("الزبائن");
  const snap = await getDocs(query(collection(db,"customers"), orderBy("createdAt","desc"), limit(50)));
  const rows = snap.docs.map(d=>{
    const x=d.data();
    return `<tr><td>${esc(x.name||"—")}</td><td>${esc(x.phone||"")}</td></tr>`;
  }).join("");
  view.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
        <h3 style="margin:0">قائمة الزبائن</h3>
        <button class="btn primary" id="addCust">إضافة</button>
      </div>
      <div class="divider"></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>الاسم</th><th>الهاتف</th></tr></thead>
          <tbody>${rows||"<tr><td colspan=2>لا يوجد</td></tr>"}</tbody>
        </table>
      </div>
    </div>
  `;
  $("#addCust").onclick=async()=>{
    const name=prompt("اسم الزبون؟")||""; if(!name.trim()) return;
    const phone=prompt("الهاتف؟")||"";
    await addDoc(collection(db,"customers"),{
      name:name.trim(),
      phone:phone.trim(),
      createdAt:serverTimestamp(),
      createdBy:State.user.uid
    });
    toast("تم","تمت الإضافة");
    await pageCustomers();
  };
}

async function pageInvoices(){
  setCrumbs(["الرئيسية","الفواتير"]); setTitle("الفواتير");
  const snap = await getDocs(query(collection(db,"invoices"), orderBy("createdAt","desc"), limit(50)));
  const rows = snap.docs.map(d=>{
    const x=d.data();
    return `<tr><td>${esc(x.invoiceNo||d.id.slice(0,6))}</td><td>${esc(x.customerName||"—")}</td><td>${fmt(x.total||0)}</td></tr>`;
  }).join("");
  view.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
        <h3 style="margin:0">الفواتير</h3>
        <button class="btn primary" id="newInv">فاتورة جديدة</button>
      </div>
      <div class="divider"></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>رقم</th><th>الزبون</th><th>الإجمالي</th></tr></thead>
          <tbody>${rows||"<tr><td colspan=3>لا يوجد</td></tr>"}</tbody>
        </table>
      </div>
    </div>
  `;
  $("#newInv").onclick=async()=>{
    const customerName=prompt("اسم الزبون؟")||""; if(!customerName.trim()) return;
    const total=Number(prompt("الإجمالي؟")||0);
    const invNo = await nextNo("invoiceCounter", 1000);
    const invoiceNo=(State.settings.invoicePrefix||"INV-")+invNo;
    await addDoc(collection(db,"invoices"),{
      invoiceNo,
      customerName:customerName.trim(),
      total,
      createdAt:serverTimestamp(),
      createdBy:State.user.uid
    });
    toast("تم","تم إنشاء فاتورة");
    await pageInvoices();
  };
}

const routes = {
  "#/dashboard": pageDashboard,
  "#/customers": pageCustomers,
  "#/invoices": pageInvoices
};

async function renderRoute(){
  const path = location.hash || "#/dashboard";
  const fn = routes[path] || routes["#/dashboard"];
  setNavActive(path);
  await fn();
}

window.addEventListener("hashchange", renderRoute);

$("#btnLogin").onclick=async()=>{
  const email=$("#loginEmail").value.trim();
  const pass=$("#loginPass").value;
  if(!email||!pass) return toast("خطأ","أدخل الإيميل والباسورد");
  try{ await signInWithEmailAndPassword(auth,email,pass); }
  catch(e){ toast("فشل", e?.message||e?.code||""); }
};

$("#btnSignOut").onclick=()=>signOut(auth);

$("#btnMakeMeAdmin").onclick=async()=>{
  if(!State.user) return toast("خطأ","سجلي دخول أولاً");
  await setDoc(doc(db,"users",State.user.uid),{role:"admin",active:true,updatedAt:serverTimestamp()},{merge:true});
  toast("تم","أصبحتِ أدمن");
  setTimeout(()=>location.reload(), 700);
};

$("#btnOfflineInfo").onclick=()=>alert("PWA يعمل بعد أول زيارة Online. ثبتيه من المتصفح Add to Home Screen.");

onAuthStateChanged(auth, async(user)=>{
  State.user=user||null;
  if(!user){ showAuth(); return; }
  State.profile = await readProfile(user);
  if(State.profile.active===false){ toast("الحساب موقوف"); await signOut(auth); return; }
  await ensureSettings();
  setUserChip();
  buildNav();
  showApp();
  if(!location.hash) location.hash="#/dashboard";
  await renderRoute();
});
