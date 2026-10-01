// 나의 허브 서비스 워커: 연결이 끊겼을 때만 안내 화면을 보여 준다.
// 허브의 내용(문서·검색 결과)은 기기에 저장하지 않는다.
const CACHE = "hub-offline-v1";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add(new Request("/offline.html", { cache: "reload" }))));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;
  e.respondWith(fetch(e.request).catch(() => caches.match("/offline.html")));
});
