// Administrator CLI: works after the website tab is closed. No AI/crawler invoked.
const db=require('../db');
const {enqueueTest}=require('../services/pushService');
const id=Number(process.argv[2]);
(async()=>{
 if(process.env.PUSH_TEST_ENABLED!=='1')throw Error('개발용 발송이 비활성화되어 있습니다.');
 if(process.argv[2]==='--list'){
  const [rows]=await db.query('SELECT id,active,created_at,updated_at FROM push_subscriptions ORDER BY id DESC LIMIT 100');
  console.table(rows);return;
 }
 if(!Number.isSafeInteger(id)||id<=0)throw Error('사용법: node scripts/queuePushTest.js <활성 구독 ID>');
 const [rows]=await db.query('SELECT subscription_json FROM push_subscriptions WHERE id=? AND active=1',[id]);
 if(!rows.length)throw Error('활성 구독이 없습니다. 브라우저에서 먼저 알림을 구독하세요.');
 if(!await enqueueTest(JSON.parse(rows[0].subscription_json).endpoint))throw Error('구독을 찾지 못했습니다.');
 console.log('테스트 알림을 서버 대기열에 등록했습니다. 탭이 닫힌 기기에서 실제 수신을 확인하세요.');
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>db.end());
