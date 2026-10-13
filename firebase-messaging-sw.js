// 화면이 꺼져 있거나 앱이 닫혀 있을 때 서버가 보낸 푸시를 받아 알림으로 띄우는 서비스 워커
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyDi0OOVgGxItHEGATw1qgOvU10y5wxzyjU",
  authDomain: "water-cycle-381dd.firebaseapp.com",
  projectId: "water-cycle-381dd",
  storageBucket: "water-cycle-381dd.firebasestorage.app",
  messagingSenderId: "500263893719",
  appId: "1:500263893719:web:f66bea58fc8f965aaece92",
});

const messaging = firebase.messaging();

// 서버는 data 전용 메시지를 보내므로 알림 표시를 여기서 직접 한다.
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  return self.registration.showNotification(d.title || '💧 Water-Cycle', {
    body: d.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'water-alarm',      // 같은 태그면 알림이 쌓이지 않고 교체됨
    renotify: true,          // 교체될 때마다 다시 소리·진동
    requireInteraction: true,
    vibrate: [500, 150, 500, 150, 500],
    data: { url: d.url || '/' },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return clients.openWindow(url);
    })
  );
});
