// Proof of Duty service worker: shows push notifications (game news, events, updates)
// and opens the game when one is tapped. It does not cache anything.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { title: 'Proof of Duty', body: e.data ? e.data.text() : '' };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || 'Proof of Duty', {
      body: d.body || '',
      icon: d.icon || '/img/icon-192.png',
      badge: '/img/icon-192.png',
      image: d.image,
      data: { url: d.url || '/' },
      tag: 'pod-news',
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', self.location.origin).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if (new URL(c.url).origin === self.location.origin && 'focus' in c) return url.startsWith(self.location.origin) && c.url !== url && !url.endsWith('/') ? c.navigate(url).then((w) => w?.focus()) : c.focus();
      return self.clients.openWindow(url);
    })
  );
});
