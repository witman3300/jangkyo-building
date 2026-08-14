// sw.js - 최소 서비스 워커 (설치 가능한 PWA 요건 충족 + 오프라인 폴백용 캐시)
// CACHE_NAME 끝의 v번호는 sw.js 자체가 바뀔 때마다 브라우저가 새 서비스워커로 인식하게 만드는 값이다.
// sw.js 파일을 수정했다면(이 파일 포함) 배포 전에 숫자를 하나 올려서, 접속 중이던 사용자의 낡은 캐시를 정리하게 한다.
const CACHE_NAME = "jangkyo-v2";
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
