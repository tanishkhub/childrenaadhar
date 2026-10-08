self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : { title: 'Children Aadhar Foundation', body: 'Time for a progress check-in.' }
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    requireInteraction: true,
    data: { url: data.url || '/' }
  }))
})
self.addEventListener('notificationclick', event => { event.notification.close(); event.waitUntil(clients.openWindow(event.notification.data?.url || '/')) })
