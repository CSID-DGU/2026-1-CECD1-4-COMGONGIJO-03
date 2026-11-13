// Production uses web-push. Tests inject only the remote transport, never a live endpoint.
function retryDelay(error,attempt){
 const raw=error.headers?.['retry-after'];
 const seconds=raw&&/^\d+$/.test(String(raw))?Number(raw):raw?(Date.parse(raw)-Date.now())/1000:0;
 return Math.ceil(Math.min(3600,Math.max(30*2**(attempt-1),Number.isFinite(seconds)?seconds:0)));
}
async function recoverExhausted(connection){
 // A crash on the last attempt must not leave a delivery stuck as 'sending' forever.
 await connection.query("UPDATE push_deliveries SET status='failed' WHERE status='sending' AND attempts>=3 AND updated_at<DATE_SUB(NOW(),INTERVAL 60 SECOND)");
}
async function deliver(row,{connection,send}){
 const [[subscription]]=await connection.query('SELECT active FROM push_subscriptions WHERE id=?',[row.subscription_id]);
 if(!subscription?.active){await connection.query("UPDATE push_deliveries SET status='cancelled' WHERE id=? AND status IN ('queued','sending')",[row.id]);return 'cancelled';}
 const [claim]=await connection.query("UPDATE push_deliveries SET status='sending',attempts=attempts+1 WHERE id=? AND attempts<3 AND ((status='queued' AND next_attempt<=NOW()) OR (status='sending' AND updated_at<DATE_SUB(NOW(),INTERVAL 60 SECOND)))",[row.id]);
 if(!claim.affectedRows)return 'unclaimed';
 const [[current]]=await connection.query('SELECT attempts FROM push_deliveries WHERE id=?',[row.id]);
 let sent;
 try{sent=await send(JSON.parse(row.subscription_json),row.payload_json,{TTL:300,timeout:10000});}
 catch(error){
  const http=Number(error.statusCode)||null,expired=http===404||http===410;
  const transient=http===null||http===408||http===429||http>=500;
  const status=!expired&&transient&&current.attempts<3?'queued':'failed';
  if(expired)await connection.query('UPDATE push_subscriptions SET active=0 WHERE id=?',[row.subscription_id]);
  await connection.query('UPDATE push_deliveries SET status=?,last_http_status=?,next_attempt=DATE_ADD(NOW(),INTERVAL ? SECOND) WHERE id=?',[status,http,retryDelay(error,current.attempts),row.id]);
  return status;
 }
 // A DB write failure after remote acceptance is NOT misclassified as a transport rejection.
 await connection.query("UPDATE push_deliveries SET status='sent',last_http_status=? WHERE id=?",[sent.statusCode,row.id]);
 return 'sent';
}
module.exports={retryDelay,recoverExhausted,deliver};
