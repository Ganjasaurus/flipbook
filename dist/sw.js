const CACHE='flipbook-static-v3';
const ASSETS=['./','./index.html','./style.css','./app.js','./model.js','./drawing.js','./studio.js','./starter.js','./storage.js','./audio.js','./export.js','./gif-worker.js','./console.js','./console-kit.js','./vendor/gifenc.js','./favicon.svg','./icons.svg','./manifest.webmanifest','./fonts/dm-sans.woff2'];
self.addEventListener('install',event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('flipbook-static-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  const base=new URL('./',self.location.href);if(!ASSETS.some(asset=>new URL(asset,base).pathname===url.pathname))return;
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});
