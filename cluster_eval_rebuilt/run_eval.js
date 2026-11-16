'use strict';
// Run from backend directory: node ../cluster_eval_package/run_eval.js labels.json
const fs=require('fs');
const path=require('path');
const mysql=require('mysql2/promise');
const {performance}=require('perf_hooks');
const { saveHtmlReport } = require('./evaluation_report');

const backend='/app';
const data=JSON.parse(fs.readFileSync(process.argv[2]||'/eval/test_cases.json','utf8'));
const DB='news_test_db';
if(data.some(a=>typeof a.expected_related!=='boolean'))throw Error('Invalid or missing relatedness labels');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const base={host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD};

function metrics(tp,fp,fn,tn=0){
 let p=tp+fp?tp/(tp+fp):0,r=tp+fn?tp/(tp+fn):0;
 return {tp,fp,fn,tn,precision:p,recall:r,f1:p+r?2*p*r/(p+r):0,accuracy:tp+fp+fn+tn?(tp+tn)/(tp+fp+fn+tn):0};
}

async function main(){
 if(process.env.DB_NAME!==DB) throw Error('Refusing to run outside news_test_db');
 if(!data.length||data.length!==100||new Set(data.map(a=>a.url)).size!==100)
  throw Error('Expected exactly 100 labels');

 const admin=await mysql.createConnection({...base,database:DB});
 let db;
 let stop=()=>{};
 let workerStopped=false;

 try {
  const [[{name}]]=await admin.query('SELECT DATABASE() name');
  if(name!==DB) throw Error('Wrong database');

  const [stored]=await admin.query(
   'SELECT article_id,url,title,content,source,author,published_at FROM articles'
  );

  if(stored.length!==data.length)
   throw Error(`Expected ${data.length} original articles; found ${stored.length}`);

  const storedByUrl=new Map(stored.map(r=>[r.url,r]));

  for(const item of data){
   const r=storedByUrl.get(item.url);
   if(!r) throw Error('Missing original article: '+item.url);

   const date=v=>v?new Date(v).toISOString().slice(0,19):null;

   if(r.title!==item.title ||
      r.content!==item.content ||
      r.source!==item.source ||
      r.author!==item.author ||
      date(r.published_at)!==date(item.published_at))
    throw Error('Original article differs: '+item.url);

   item.article_id=r.article_id;
  }

  // 테스트 시작 전 기존 분석 데이터 초기화
    await admin.beginTransaction();

    try {
        await admin.query('DELETE FROM cluster_links');
        await admin.query('DELETE FROM alerts');
        await admin.query('DELETE FROM article_analysis');
        await admin.query('DELETE FROM clusters');

        await admin.commit();
        console.log('Test data cleared. Starting 100-article evaluation.');
    } catch(e) {
        await admin.rollback();
        throw e;
    }

  db=require(path.join(backend,'db.js'));

  const {
    startArticleAnalysisWorker,
    getFailedArticles
  }=require(
    path.join(backend,'services/articleAnalysisWorker.js')
  );

  const start=performance.now();
  const perArticle=new Map();
  const clusterDecisions = new Map();

  const { subscribeClusterDecisions } = require(
      path.join(backend, 'services/clusterService.js')
  );

  const unsubscribeDecisions = subscribeClusterDecisions(
      decision => {
          clusterDecisions.set(
              Number(decision.article_id),
              decision
          );
      }
  );



  stop=startArticleAnalysisWorker();

  const timeoutMs=Number(process.env.EVAL_TIMEOUT_MINUTES||180)*60000;
  let completed=0;

  while(performance.now()-start<timeoutMs){
   const [rows]=await db.query(
    'SELECT article_id,analyzed_at FROM article_analysis'
   );

   const elapsed=(performance.now()-start)/1000;

   for(const r of rows)
    if(!perArticle.has(r.article_id))
     perArticle.set(r.article_id,elapsed);

   if(rows.length!==completed){
    completed=rows.length;
    console.log(`Analyzed ${completed}/${data.length} in ${elapsed.toFixed(1)}s`);
   }

    const failures = getFailedArticles();

    const failedCount = [...failures.keys()]
        .filter(articleId => !perArticle.has(articleId))
        .length;

    if (completed + failedCount >= data.length) {
        console.log(
            `Evaluation finished: ${completed} completed, ` +
            `${failedCount} failed`
        );
        break;
    }

   await sleep(2000);
  }

  await Promise.resolve(stop());
  workerStopped=true;
  const finalFailures = getFailedArticles();
  unsubscribeDecisions();

  const [rows]=await db.query(`
   SELECT
    a.article_id,
    a.title,
    a.content,
    a.source,
    a.published_at,
    aa.*
   FROM articles a
   LEFT JOIN article_analysis aa
    ON aa.article_id=a.article_id
  `);

  const byId=new Map(rows.map(r=>[r.article_id,r]));
  let tp=0,fp=0,fn=0,tn=0;

  for(const a of data){
   const r=byId.get(a.article_id);

   a.predicted_related=
    r?.target_related===null||r?.target_related===undefined
     ?null:!!r.target_related;

   a.predicted_cluster=r?.cluster_id??null;
   a.elapsed_seconds=perArticle.get(a.article_id)??null;
   a.analysis_status=r?.analysis_status??'missing';
   const failure = finalFailures.get(Number(a.article_id));

    if (failure) {
        a.analysis_status = 'failed';
        a.analysis_failure = {
            attempts: failure.attempts,
            reason: failure.error
        };
    } else {
        a.analysis_failure = null;
    }
   a.cluster_decision =
    clusterDecisions.get(Number(a.article_id)) ?? null;

   // 기사 원문과 AI 분석 결과를 함께 보존합니다.
   a.analysis=r?.analysis_id!=null?r:null;

   if(a.expected_related&&a.predicted_related===true) tp++;
   else if(!a.expected_related&&a.predicted_related===true) fp++;
   else if(a.expected_related) fn++;
   else tn++;
  }

  const related=data.filter(a=>a.expected_related);
  let ctp=0,cfp=0,cfn=0,ctn=0,errors=[];

  for(let i=0;i<related.length;i++)
   for(let j=i+1;j<related.length;j++){
    const a=related[i],b=related[j];
    const same=a.expected_event===b.expected_event;
    const joined=
     a.predicted_related===true&&
     b.predicted_related===true&&
     a.predicted_cluster!=null&&
     a.predicted_cluster===b.predicted_cluster;

    if(same&&joined) ctp++;
    else if(same) cfn++;
    else if(joined) cfp++;
    else ctn++;

    if(same!==joined)
     errors.push({
      a:a.original_number,
      b:b.original_number,
      expected_same:same,
      predicted_same:joined,
      event_a:a.expected_event,
      event_b:b.expected_event,
      cluster_a:a.predicted_cluster,
      cluster_b:b.predicted_cluster,
      decision_a: a.cluster_decision,
      decision_b: b.cluster_decision
     });
   }

    const output={
      tested_at:new Date().toISOString(),
      total:data.length,
      failed_count:finalFailures.size,
      failed_articles:[...finalFailures.entries()].map(
        ([articleId, failure]) => ({
        article_id:articleId,
        attempts:failure.attempts,
        reason:failure.error
      })
    ),
   completed:data.filter(a=>a.elapsed_seconds!=null).length,
   total_seconds:(performance.now()-start)/1000,
   classification:metrics(tp,fp,fn,tn),
   clustering_pairwise:metrics(ctp,cfp,cfn,ctn),
   articles:data,
   cluster_pair_errors:errors
  };

  // 저장이 성공해야만 초기화 단계로 진행합니다.
  const out=process.env.EVAL_OUTPUT||
   '/results/evaluation_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';

  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,JSON.stringify(output,null,2),'utf8');

  // 저장된 결과를 다시 읽어 JSON 유효성을 확인합니다.
  const saved=JSON.parse(fs.readFileSync(out,'utf8'));

  if(saved.articles.length!==100)
   throw Error('Saved evaluation verification failed');

  const htmlPath = saveHtmlReport(output, out);
  console.log('HTML report saved:', htmlPath);
  console.log('Saved:',out);
  console.log('Classification:',output.classification);
  console.log('Clustering:',output.clustering_pairwise);

  // 결과 저장 이후에만 분석 데이터 초기화
  await admin.beginTransaction();

  try {
   await admin.query('DELETE FROM cluster_links');
   await admin.query('DELETE FROM alerts');
   await admin.query('DELETE FROM article_analysis');
   await admin.query('DELETE FROM clusters');

   await admin.commit();

   console.log('Test analysis data cleared. Original articles preserved.');
  } catch(e){
   await admin.rollback();
   throw e;
  }

 } finally {
  if(!workerStopped) await Promise.resolve(stop());
  if(db) await db.end();
  await admin.end();
 }
}

main().catch(e=>{
 console.error(e);
 process.exitCode=1;
});