// Push notifications, loaded into the app's service worker (vite.config.ts: workbox.importScripts).
// The server (supabase/functions/shift-alerts) sends { title, body, tag, url }; tapping the notification opens that day.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'ARDS Operations', {
    body: data.body || '',
    tag: data.tag || undefined,
    icon: 'icon-192.png',
    badge: 'favicon-32.png',
    data: { url: data.url || './' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if ('focus' in c) {
        if ('navigate' in c) c.navigate(url);
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
