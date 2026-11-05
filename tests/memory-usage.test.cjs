const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('public/js/memory-usage.js','utf8');
test('memory indicator samples immediately, refreshes every minute and retains the last reading on errors',async()=>{
 const indicator={},events={};let tick,delay,requests=0,fail=false,cleared=0;
 const context=vm.createContext({AbortController,document:{querySelectorAll:()=>[indicator]},window:{addEventListener:(name,fn)=>events[name]=fn},
  setInterval:(fn,ms)=>{tick=fn;delay=ms;return 1},clearInterval:()=>cleared++,setTimeout:()=>2,clearTimeout(){},
  fetch:async(url,options)=>{assert.equal(url,'/api/memory-usage');assert.equal(options.cache,'no-store');requests++;if(fail)throw new Error('Offline');
   return {ok:true,json:async()=>({ok:true,sampledAt:'2026-11-03T00:00:00Z',rssBytes:requests===1?64*1024**2:1.5*1024**3,heapUsedBytes:10*1024**2,arrayBuffersBytes:20*1024**2})};}});
 await vm.runInContext(source,context);assert.equal(requests,1);assert.equal(delay,60000);assert.equal(indicator.textContent,'Server RAM: 64.0 MiB');assert.match(indicator.title,/Browser memory is not included/);
 await tick();assert.equal(indicator.textContent,'Server RAM: 1.50 GiB');
 fail=true;await tick();assert.equal(indicator.textContent,'Server RAM: 1.50 GiB (update failed)');
 events.pagehide();await tick();assert.equal(requests,3);assert.equal(cleared,1);
 fail=false;events.pageshow();await Promise.resolve();await Promise.resolve();assert.equal(requests,4);
});
test('unavailable memory readings are reported without breaking the page',async()=>{
 const indicator={};
 await vm.runInContext(source,vm.createContext({AbortController,document:{querySelectorAll:()=>[indicator]},window:{addEventListener(){}},setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){},fetch:async()=>({ok:false,json:async()=>({ok:false})})}));
 assert.equal(indicator.textContent,'Server RAM: unavailable');
});
test('memory endpoint reports process RSS and buffer/heap measurements with caching disabled',async t=>{
 const {app}=require('../main');const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
 t.after(()=>{server.closeAllConnections();server.close()});const root=`http://127.0.0.1:${server.address().port}`;
 const response=await fetch(root+'/api/memory-usage');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const result=await response.json();assert.equal(result.ok,true);assert.ok(Number.isFinite(Date.parse(result.sampledAt)));
 for(const key of ['rssBytes','heapUsedBytes','heapTotalBytes','externalBytes','arrayBuffersBytes'])assert.ok(Number.isFinite(result[key]) && result[key]>=0,key);
 assert.ok(result.rssBytes>0);assert.ok(result.heapTotalBytes>=result.heapUsedBytes);
 for(const page of ['/','/energy.html','/histogram.html']){const html=await(await fetch(root+page)).text();assert.match(html,/data-memory-usage/);assert.match(html,/\/js\/memory-usage\.js/);}
});
