const db = require('../db');
const webpush = require('web-push');
const crypto = require('node:crypto');
const {deliver,recoverExhausted}=require('./pushDelivery');
let timer, working = false;
function configured(){return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.PUSH_ADMIN_TOKEN);}
function validateSubscription(s){
 if(!s || typeof s.endpoint!=='string' || s.endpoint.length>2000)return false;
 try{
  const u=new URL(s.endpoint);
  if(u.protocol!=='https:' || u.username || u.password || (u.port && u.port!=='443'))return false;
  const h=u.hostname;
  if(!(h==='fcm.googleapis.com'||h==='updates.push.services.mozilla.com'||h.endsWith('.push.services.mozilla.com')||h==='web.push.apple.com'||h.endsWith('.push.apple.com')||h.endsWith('.notify.windows.com')))return false;
  return /^[A-Za-z0-9_-]+$/.test(s.keys?.p256dh||'') && Buffer.from(s.keys.p256dh,'base64url').length===65 && /^[A-Za-z0-9_-]+$/.test(s.keys?.auth||'') && Buffer.from(s.keys.auth,'base64url').length===16;
 }catch{return false;}
}
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
async function subscribe(s){
 await db.query('INSERT INTO push_subscriptions(endpoint_hash,subscription_json,active) VALUES (?,?,1) ON DUPLICATE KEY UPDATE subscription_json=VALUES(subscription_json),active=1',[hash(s.endpoint),JSON.stringify({endpoint:s.endpoint,keys:s.keys})]);
}
async function unsubscribe(endpoint){await db.query('UPDATE push_subscriptions SET active=0 WHERE endpoint_hash=?',[hash(endpoint)]);}
async function enqueueAlert(alertId,connection=db){
 const [rows]=await connection.query('SELECT alert_id,cluster_id,alert_topic,alert_message,article_id FROM alerts WHERE alert_id=?',[alertId]);
 if(!rows.length)return;
 const a=rows[0],key=a.cluster_id==null?`alert:${a.alert_id}`:`cluster:${a.cluster_id}`;
 const payload={title:a.alert_topic||'새 위험 알림',body:a.alert_message||'위험 기사를 확인하세요.',tag:key,url:`/?page=alerts&article=${a.article_id}`};
 await connection.query('INSERT IGNORE INTO push_deliveries(subscription_id,event_key,payload_json) SELECT id,?,? FROM push_subscriptions WHERE active=1',[key,JSON.stringify(payload)]);
}
async function enqueueTest(endpoint){
 const [rows]=await db.query('SELECT id FROM push_subscriptions WHERE endpoint_hash=? AND active=1',[hash(endpoint)]);
 if(!rows.length)return false;
 const key=`test:${crypto.randomUUID()}`;
 await db.query('INSERT INTO push_deliveries(subscription_id,event_key,payload_json) VALUES (?,?,?)',[rows[0].id,key,JSON.stringify({title:'개발용 푸시 테스트',body:'AI 분석 없이 발송한 테스트입니다. 눌러서 알림 화면을 여세요.',tag:key,url:'/?page=alerts'})]);
 return true;
}
async function tick(){
 if(working||!configured())return;working=true;
 try{
  // Durable cursor recovers enqueue failures without replaying pre-migration alerts.
  const c=await db.getConnection();
  try{await c.beginTransaction();const [[state]]=await c.query('SELECT last_alert_id FROM push_state WHERE id=1 FOR UPDATE');
   const [alerts]=await c.query('SELECT alert_id FROM alerts WHERE alert_id>? ORDER BY alert_id LIMIT 20',[state.last_alert_id]);
   for(const a of alerts){await enqueueAlert(a.alert_id,c);await c.query('UPDATE push_state SET last_alert_id=? WHERE id=1',[a.alert_id]);}
   await c.commit();
  }catch(e){await c.rollback();throw e;}finally{c.release();}
  await recoverExhausted(db);
  const [rows]=await db.query("SELECT d.*,s.subscription_json,s.active FROM push_deliveries d JOIN push_subscriptions s ON s.id=d.subscription_id WHERE d.attempts<3 AND ((d.status='queued' AND d.next_attempt<=NOW()) OR (d.status='sending' AND d.updated_at<DATE_SUB(NOW(),INTERVAL 60 SECOND))) ORDER BY d.id LIMIT 10");
  webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@example.com',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
  for(const row of rows){
   await deliver(row,{connection:db,send:(...args)=>webpush.sendNotification(...args)});
  }
 }catch(e){console.error('[PUSH] queue processing failed:',e.code||'ERROR');}finally{working=false;}
}
async function startPushWorker(){if(timer||!configured())return;
 try{const sql=require('node:fs').readFileSync(require('node:path').join(__dirname,'../sql/pushMigration.sql'),'utf8');
  for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.query(statement);
  timer=setInterval(tick,5000);timer.unref();tick();
 }catch(e){console.error('[PUSH] initialization failed:',e.code||'ERROR');}
}
async function notifyAlert(alertId){if(!configured())return;try{await enqueueAlert(alertId);}catch(e){console.error('[PUSH] enqueue deferred to cursor:',e.code||'ERROR');}}
module.exports={configured,validateSubscription,subscribe,unsubscribe,enqueueAlert,enqueueTest,startPushWorker,notifyAlert,tick};
