export function kstDateKey(value){
 if(!value)return '';
 const date=parseDate(value);if(!date)return '';
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
}
function parseDate(value){
 // Zone-less SQL/local input is interpreted as Korean local time.
 const text=String(value).trim();
 const zoned=/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/.test(text)?text.replace(' ','T')+(text.length===10?'T00:00:00':'')+'+09:00':value;
 const date=new Date(zoned);return Number.isNaN(date.getTime())?null:date;
}
export function formatKoreanDate(value){
 if(!value)return '';
 const date=parseDate(value);if(!date)return String(value);
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(date);
 const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} (KST)`;
}
export function buildDisplayItems(visibleArticles,clusters,sortOrder){
 const map=new Map(visibleArticles.map(a=>[String(a.article_id),a])),assigned=new Set(),items=[];
 const time=a=>new Date(a.published_at||a.collected_at||a.analyzed_at).getTime()||0;
 const compare=(a,b)=>sortOrder==='oldest'?time(a)-time(b):sortOrder==='riskDesc'?Number(b.risk_score||0)-Number(a.risk_score||0):sortOrder==='riskAsc'?Number(a.risk_score||0)-Number(b.risk_score||0):time(b)-time(a);
 for(const cluster of clusters){
  const uniqueMembers=new Map((cluster.articles||[]).map(a=>[String(a.article_id),map.get(String(a.article_id))]));
  const members=[...uniqueMembers.values()].filter(a=>a&&!assigned.has(String(a.article_id))).sort(compare);
  if(!members.length)continue;members.forEach(a=>assigned.add(String(a.article_id)));
  // Representative is the first matching article under the current sort, never a hidden member.
  items.push({type:'cluster',cluster,representative:members[0],members});
 }
 for(const article of visibleArticles)if(!assigned.has(String(article.article_id))){assigned.add(String(article.article_id));items.push({type:'article',article});}
 items.sort((a,b)=>compare(a.type==='cluster'?a.members[0]:a.article,b.type==='cluster'?b.members[0]:b.article));
 return items;
}
export const flattenDisplayItems=items=>items.flatMap(item=>item.type==='cluster'?item.members:[item.article]);
