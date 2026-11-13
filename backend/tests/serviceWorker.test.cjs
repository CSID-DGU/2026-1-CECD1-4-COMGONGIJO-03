// Node VM simulation of browser APIs. These tests do NOT claim real device receipt.
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function harness(windows=[]){
 const handlers={},shown=[],opened=[],focused=[],navigated=[];
 const clients=windows.map(url=>({url,navigate:async target=>navigated.push(target),focus:async()=>focused.push(url)}));
 const self={location:{origin:'https://push-test.example'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{},registration:{showNotification:async(title,options)=>shown.push({title,options})},clients:{claim:async()=>{},matchAll:async()=>clients,openWindow:async url=>opened.push(url)}};
 vm.runInNewContext(fs.readFileSync(__dirname+'/../frontend/public/sw.js','utf8'),{self,URL});
 async function fire(name,extra){let promise;handlers[name]({...extra,waitUntil:p=>promise=p});if(promise)await promise;}
 return {fire,shown,opened,focused,navigated};
}
test('push shows OS notification without an open website window (simulated)',async()=>{
 const h=harness();await h.fire('push',{data:{json:()=>({title:'위험',body:'테스트',tag:'cluster:1',url:'/?page=alerts&article=1'})}});
 assert.equal(h.shown.length,1);assert.equal(h.shown[0].title,'위험');assert.equal(h.shown[0].options.tag,'cluster:1');assert.equal(h.opened.length,0);
});
test('closed-window notification click opens local alert screen (simulated)',async()=>{
 const h=harness();let closed=false;await h.fire('notificationclick',{notification:{close:()=>closed=true,data:{url:'/?page=alerts'}}});
 assert(closed);assert.deepEqual(h.opened,['https://push-test.example/?page=alerts']);
});
test('existing app window is navigated and focused instead of duplicated (simulated)',async()=>{
 const h=harness(['https://push-test.example/']);await h.fire('notificationclick',{notification:{close(){},data:{url:'/?page=alerts&article=5'}}});
 assert.equal(h.opened.length,0);assert.equal(h.focused.length,1);assert.deepEqual(h.navigated,['https://push-test.example/?page=alerts&article=5']);
});
test('malformed push payload falls back; cross-origin click never opens a site',async()=>{
 const h=harness();await h.fire('push',{data:{json(){throw Error('bad');}}});assert.equal(h.shown[0].title,'뉴스 위험 알림');
 await h.fire('notificationclick',{notification:{close(){},data:{url:'https://outside.invalid/'}}});assert.equal(h.opened.length,0);
});
