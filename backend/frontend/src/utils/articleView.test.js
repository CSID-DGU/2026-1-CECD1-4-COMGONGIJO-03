import {test} from 'node:test';
import assert from 'node:assert/strict';
import {kstDateKey,formatKoreanDate,buildDisplayItems,flattenDisplayItems} from './articleView.js';
test('Korean midnight and timezone-less publication dates',()=>{
 assert.equal(kstDateKey('2026-11-12T15:30:00Z'),'2026-11-13');
 assert.equal(formatKoreanDate('2026-11-12T15:30:00Z'),'2026-11-13 00:30:00 (KST)');
 assert.equal(formatKoreanDate('2026-11-12 12:30:00'),'2026-11-12 12:30:00 (KST)');
 assert.equal(formatKoreanDate(null),'');
});
test('filtered-out cluster representatives never leak; export follows visible groups without duplicates',()=>{
 const a={article_id:1,risk_score:0.8},b={article_id:2,risk_score:0.2},c={article_id:3,risk_score:0.9};
 const clusters=[{representative_article_id:99,articles:[{article_id:99},a,a,b]},{articles:[a]}];
 const items=buildDisplayItems([a,b,c],clusters,'riskDesc');
 assert.deepEqual(flattenDisplayItems(items).map(a=>a.article_id),[3,1,2]);
 assert.equal(items[1].representative.article_id,1);
 assert.deepEqual(flattenDisplayItems(buildDisplayItems([b],clusters,'riskAsc')).map(a=>a.article_id),[2]);
});
