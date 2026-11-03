/* O.HOME 웹푸시 서비스 워커 (커플홈) — 푸시가 오면 알림을 띄우고, 누르면 그 주소를 연다.
   페이지 캐시는 하지 않는다 (오프라인 기능 없음). 서버가 보내는 내용: { title, body, url, tag } */
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  const title = d.title || 'O.HOME';
  const opts = {
    body: d.body || '',
    icon: d.icon || '/icon-192.png',   // 보내는 쪽이 홈의 탭 아이콘(파비콘)을 실어 보낸다 — 없으면 기본 아이콘
    badge: '/icon-192.png',
    tag: d.tag || undefined,          // 같은 방·같은 글의 알림은 하나로 겹친다
    renotify: !!d.tag,
    silent: false,
    // 데스크톱에서 짧은 알림이 바로 사라지는 것을 줄인다 (실제 표시 방식은 OS가 결정).
    requireInteraction: true,
    data: { url: d.url || '/' },
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  let target;
  try { target = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin); } catch { target = new URL('/', self.location.origin); }
  const url = target.origin === self.location.origin ? target.href : self.location.origin + '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (list) => {
    for (const c of list) {
      if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
        try {
          if ('navigate' in c) await c.navigate(url);
          return await c.focus();
        } catch { /* 닫히는 중인 창이면 새 창 경로로 진행한다. */ }
      }
    }
    return self.clients.openWindow(url);
  }));
});
