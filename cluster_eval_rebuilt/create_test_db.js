'use strict';
const fs=require('fs');
const mysql=require('mysql2/promise');
const path=require('path');
const DB='news_test_db';
const ident=s=>'`'+s.replace(/`/g,'``')+'`';
async function main(){
 if(process.env.DB_NAME!==DB)throw Error('Refusing to run: DB_NAME must equal news_test_db');
 if(process.env.ALLOW_TEST_DB_CREATE!=='YES')throw Error('ALLOW_TEST_DB_CREATE=YES required');
 const user=process.env.DOCKER_DB_USER||process.env.DB_USER;
 const password=process.env.DOCKER_MYSQL_ROOT_PASSWORD||process.env.MYSQL_ROOT_PASSWORD;
 if(!password)throw Error('DOCKER_MYSQL_ROOT_PASSWORD required');
 const c=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:'root',password,multipleStatements:true});
 try{
  const [existing]=await c.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[DB]);
  if(existing.length)throw Error('news_test_db already exists: no changes made');
  const schema=fs.readFileSync(path.join('/app','sql','schema2.sql'),'utf8');
  if(!/^\s*CREATE DATABASE IF NOT EXISTS news_db\s*;\s*USE news_db\s*;/i.test(schema))throw Error('Unexpected schema header; refusing creation');
  const safe=schema.replace(/^\s*CREATE DATABASE IF NOT EXISTS news_db\s*;\s*USE news_db\s*;/i,'CREATE DATABASE '+ident(DB)+'; USE '+ident(DB)+';');
  await c.query(safe);
  // MySQL Docker image grants the configured application user privileges only on news_db.
  await c.query('GRANT ALL PRIVILEGES ON '+ident(DB)+'.* TO '+mysql.escape(user)+'@\'%\'');
  console.log('Created news_test_db, schema and application-user grant');
 }finally{await c.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
