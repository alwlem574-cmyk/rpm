const VERSION="rpm-v1-2026-02-13";
const CORE=["./","./index.html","./styles.css","./app.js","./manifest.json","./icon-192.png","./icon-512.png"];

self.addEventListener("install",(e)=>e.waitUntil((async()=>{
  const c=await caches.open(VERSION);
  await c.addAll(CORE);
  await self.skipWaiting();
})()));

self.addEventListener("activate",(e)=>e.waitUntil((async()=>{
  const keys=await caches.keys();
  await Promise.all(keys.map(k=>(k.startsWith("rpm-v1-")&&k!==VERSION)?caches.delete(k):null));
  await self.clients.claim();
})()));

self.addEventListener("fetch",(e)=>{
  const req=e.request;
  const url=new URL(req.url);
  if(url.hostname.includes("googleapis.com")||url.hostname.includes("gstatic.com")) return;

  const isNav=req.mode==="navigate"||(req.headers.get("accept")||"").includes("text/html");
  if(isNav){
    e.respondWith((async()=>{
      const c=await caches.open(VERSION);
      try{
        const r=await fetch(req);
        if(r&&r.ok) c.put("./index.html", r.clone());
        return r;
      }catch{
        return (await c.match("./index.html")) || (await c.match("./"));
      }
    })());
    return;
  }

  e.respondWith((async()=>{
    const c=await caches.open(VERSION);
    const cached=await c.match(req);
    if(cached) return cached;
    const r=await fetch(req);
    if(r&&r.ok && url.origin===self.location.origin) c.put(req, r.clone());
    return r;
  })());
});
