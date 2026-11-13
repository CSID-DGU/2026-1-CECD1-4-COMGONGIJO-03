import {useState,useEffect} from 'react';
async function api(path,method='GET',body){
 const r=await fetch('/api/push'+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json().catch(()=>({message:'요청에 실패했습니다.'}));if(!r.ok)throw Error(data.message||'푸시 요청 실패');return data;
}
export default function PushControls(){
 const [token,setToken]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[unlocked,setUnlocked]=useState(false);
 useEffect(()=>{api('/config').then(()=>setUnlocked(true)).catch(()=>{});},[]);
 async function action(fn){setBusy(true);try{await fn();}catch(e){setMessage(e.message);}finally{setBusy(false);}}
 async function registration(){if(!window.isSecureContext||!('serviceWorker'in navigator)||!('PushManager'in window))throw Error('HTTPS 또는 localhost의 지원 브라우저가 필요합니다. iPhone은 홈 화면 앱에서 여세요.');await navigator.serviceWorker.register('/sw.js');return navigator.serviceWorker.ready;}
 return <section className="pushControls" aria-label="기기 푸시 알림">
  <strong>기기 푸시 알림</strong>
  {!unlocked&&<form onSubmit={e=>{e.preventDefault();action(async()=>{await api('/session','POST',{token});setToken('');setUnlocked(true);setMessage('인증되었습니다. 이 기기의 알림을 구독할 수 있습니다.');});}}>
   <label>푸시 관리 인증키 <input type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)} required/></label><button disabled={busy}>인증</button>
  </form>}
  {unlocked&&<div>
   <button disabled={busy} onClick={()=>action(async()=>{
    // Permission request is directly initiated by the user click.
    if(!window.isSecureContext)throw Error('푸시는 신뢰된 HTTPS 또는 localhost 접속에서만 사용할 수 있습니다.');
    if(!('Notification'in window))throw Error('알림을 지원하지 않습니다.');
    const denied='알림 권한이 차단되어 있습니다. 주소 왼쪽 사이트 정보 → 사이트 사용 권한 → 알림을 허용한 뒤 새로고침하세요. Edge는 edge://settings/content/notifications에서도 확인할 수 있습니다.';
    if(Notification.permission==='denied')throw Error(denied);
    const permission=await Notification.requestPermission();if(permission!=='granted')throw Error(denied);
    const reg=await registration(),config=await api('/config');
    const raw=atob(config.publicKey.replace(/-/g,'+').replace(/_/g,'/'));
    const sub=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(raw,c=>c.charCodeAt(0))});
    await api('/subscriptions','POST',sub.toJSON());setMessage('이 기기의 알림 구독을 저장했습니다. 테스트 발송으로 실제 수신을 확인하세요.');
   })}>알림 구독</button>
   <button disabled={busy} onClick={()=>action(async()=>{const reg=await registration(),sub=await reg.pushManager.getSubscription();if(sub){await api('/subscriptions','DELETE',{endpoint:sub.endpoint});await sub.unsubscribe();}setMessage('이 기기의 구독을 해제했습니다.');})}>알림 구독 해제</button>
   <button disabled={busy} onClick={()=>action(async()=>{const reg=await registration(),sub=await reg.pushManager.getSubscription();if(!sub)throw Error('먼저 이 기기에서 구독하세요.');const data=await api('/test','POST',sub.toJSON());setMessage(data.message);})}>이 기기로 테스트 발송</button>
  </div>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
