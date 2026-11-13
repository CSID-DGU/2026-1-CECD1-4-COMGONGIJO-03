const express=require('express');
const crypto=require('node:crypto');
const push=require('../services/pushService');
const db=require('../db');
const router=express.Router();
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const signature=value=>crypto.createHmac('sha256',process.env.PUSH_ADMIN_TOKEN||'disabled').update(value).digest('hex');
const attempts=new Map();
router.use((req,res,next)=>{
 res.set('Cache-Control','no-store');
 if(!push.configured())return res.status(503).json({message:'푸시 환경 설정이 필요합니다.'});
 const allowed=(process.env.PUSH_ALLOWED_ORIGINS||'http://127.0.0.1:18080,http://localhost:18080').split(',');
 if(req.headers.origin&&!allowed.includes(req.headers.origin))return res.status(403).json({message:'허용되지 않은 출처입니다.'});
 const now=Date.now(),ip=req.ip;for(const [key,v] of attempts)if(v.until<now)attempts.delete(key);
 const bucket=attempts.get(ip)||{count:0,until:now+60000};bucket.count++;attempts.set(ip,bucket);
 if(bucket.count>60)return res.status(429).json({message:'잠시 후 다시 시도하세요.'});next();
});
router.post('/session',(req,res)=>{
 if(!equal(req.body?.token,process.env.PUSH_ADMIN_TOKEN))return res.status(401).json({message:'푸시 관리 인증키가 올바르지 않습니다.'});
 const expires=String(Date.now()+8*60*60*1000),value=expires+'.'+signature(expires);
 res.set('Set-Cookie',`push_session=${value}; HttpOnly; SameSite=Strict; Path=/api/push; Max-Age=28800${req.secure||req.headers['x-forwarded-proto']==='https'?'; Secure':''}`);
 res.json({success:true});
});
router.use((req,res,next)=>{
 const cookie=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('push_session='))?.slice(13)||'';
 const [expiry,sig]=cookie.split('.');
 const bearer=req.headers.authorization?.replace(/^Bearer /,'');
 if(!equal(bearer,process.env.PUSH_ADMIN_TOKEN)&&!(Number(expiry)>Date.now()&&equal(sig,signature(expiry))))return res.status(401).json({message:'푸시 관리 인증이 필요합니다.'});next();
});
const run=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(()=>res.status(500).json({message:'푸시 처리 중 오류가 발생했습니다.'}));
router.get('/config',(req,res)=>res.json({publicKey:process.env.VAPID_PUBLIC_KEY,testEnabled:process.env.PUSH_TEST_ENABLED==='1'}));
router.post('/subscriptions',run(async(req,res)=>{if(!push.validateSubscription(req.body))return res.status(400).json({message:'유효하지 않은 브라우저 구독입니다.'});await push.subscribe(req.body);res.status(201).json({success:true});}));
router.delete('/subscriptions',run(async(req,res)=>{if(typeof req.body?.endpoint!=='string')return res.status(400).json({message:'endpoint가 필요합니다.'});await push.unsubscribe(req.body.endpoint);res.json({success:true});}));
router.post('/test',run(async(req,res)=>{if(process.env.PUSH_TEST_ENABLED!=='1')return res.sendStatus(403);if(!push.validateSubscription(req.body))return res.status(400).json({message:'현재 기기 구독이 필요합니다.'});if(!await push.enqueueTest(req.body.endpoint))return res.status(404).json({message:'등록된 구독이 없습니다.'});res.status(202).json({message:'전송 대기열에 등록했습니다. 실제 기기 수신을 확인하세요.'});}));
router.get('/status',run(async(req,res)=>{const [rows]=await db.query('SELECT status,COUNT(*) count FROM push_deliveries GROUP BY status');const [subscriptions]=await db.query('SELECT id,active,created_at,updated_at FROM push_subscriptions ORDER BY id DESC LIMIT 100');res.json({deliveries:rows,subscriptions,note:'sent는 푸시 서버 접수이며 기기 수신 확인이 아닙니다. endpoint와 구독 키는 반환하지 않습니다.'});}));
module.exports=router;
