'use strict';
const fs=require('fs');
const mysql=require('mysql2/promise');
const DB='news_test_db';
async function main(){
 if(process.env.DB_NAME!==DB)throw Error('Refusing to run outside news_test_db');
 const data=JSON.parse(fs.readFileSync(process.argv[2]||'/eval/test_cases.json','utf8'));
 if(data.length!==100||new Set(data.map(x=>x.url)).size!==100)throw Error('Expected 100 unique URLs');
 const db=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:DB});
 try{
  const [[{name}]]=await db.query('SELECT DATABASE() name');if(name!==DB)throw Error('Wrong database');
  const [[{n}]]=await db.query('SELECT COUNT(*) n FROM articles');
  if(n!==0)throw Error('Articles already present; original data unchanged');
  await db.beginTransaction();
  try{
   for(const a of data){if(!a.url||!a.title)throw Error('Missing URL/title');await db.execute('INSERT INTO articles(title,content,url,source,author,published_at,collected_at) VALUES(?,?,?,?,?,?,NOW())',[a.title,a.content??null,a.url,a.source??null,a.author??null,a.published_at??null]);}
   await db.commit();
  }catch(e){await db.rollback();throw e;}
  console.log('Imported 100 original articles once');
 }finally{await db.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
