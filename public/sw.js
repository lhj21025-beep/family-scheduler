const CACHE='family-scheduler-v2'
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['./','./manifest.webmanifest']))) ;self.skipWaiting()})
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()))
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith(fetch(event.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));return r}).catch(()=>caches.match(event.request)))})
self.addEventListener('push',event=>{let data={title:'우리 가족 스케줄러',body:'새로운 가족 알림이 있습니다.'};try{data=event.data?.json()??data}catch{};event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'./favicon.svg',badge:'./favicon.svg'}))})
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{for(const c of cs)if('focus'in c)return c.focus();return clients.openWindow('./')}))})
