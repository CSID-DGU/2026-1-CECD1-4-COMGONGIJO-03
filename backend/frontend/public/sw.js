self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// Do not cache API responses, auth sessions or stale article lists.
self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{};}catch{}
 event.waitUntil(self.registration.showNotification(data.title||'뉴스 위험 알림',{
  body:data.body||'알림 화면에서 확인하세요.',tag:data.tag||'news-risk',icon:'/icon-192.png',
  data:{url:typeof data.url==='string'&&data.url.startsWith('/?')?data.url:'/?page=alerts'}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const url=new URL(event.notification.data?.url||'/?page=alerts',self.location.origin);
 if(url.origin!==self.location.origin)return;
 event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
  for(const client of windows){if(new URL(client.url).origin===url.origin){await client.navigate(url.href);return client.focus();}}
  return self.clients.openWindow(url.href);
 }));
});
