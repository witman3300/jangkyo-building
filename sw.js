// sw.js - 최소 서비스 워커 (설치 가능한 PWA 요건 충족 + 오프라인 폴백용 캐시)
// CACHE_NAME은 sw.js 자체가 바뀌었다고 브라우저에 알리는 표시다. 이 값이 달라지면
// 브라우저가 새 서비스워커로 알아보고 갈아 끼운 뒤, activate에서 낡은 캐시를 지운다.
// 손으로 고치지 않는다 — scripts/hooks/pre-commit이 배포 파일이 바뀔 때마다 찍어 준다.
const CACHE_NAME = "janggyo-20261006-095426";
const PRECACHE = [
  "about.html",
  "style.css",
  "auth.js",
  "manifest.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    // cache: "no-store" — 브라우저의 HTTP 디스크 캐시를 건너뛰고 항상 네트워크에서 최신 파일을 받는다.
    // (이걸 안 하면 배포해도 브라우저가 예전 응답을 그대로 재사용해 새 코드가 반영되지 않을 수 있다.)
    fetch(e.request, { cache: "no-store" })
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, resClone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
