const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {makeDebouncedData}=require('../debounce');

function fixture(tof,sweeps=tof.map(()=>0)) {
  return {header:{example:'preserved'},stats:{acceptedEvents:tof.length},events:{length:tof.length,
    tof:Float64Array.from(tof),sweep:Int32Array.from(sweeps),rawSweep:Int32Array.from(sweeps),
    tag:Int32Array.from(tof,(_,i)=>i%4),channel:Int16Array.from(tof,(_,i)=>i%2),
    edge:Int8Array.from(tof,(_,i)=>i%2),raw:tof.map((_,i)=>'event-'+i)}};
}
test('inclusive ns boundaries, full source anchors, same-sweep isolation, and original order',()=>{
  // 0.1 ns bins: removed events still anchor later removals (10000 -> 15000).
  const lm=fixture([15000,100,10000,199,200,10001,20000,100,200],[0,0,0,0,0,0,0,1,2]);
  const before=structuredClone(lm);
  const result=makeDebouncedData(lm);
  assert.deepEqual(Array.from(result.lm.events.tof),[100,199,200,100,200]);
  assert.deepEqual(result.lm.events.raw,['event-1','event-3','event-4','event-7','event-8']);
  for(const key of ['sweep','rawSweep','tag','channel','edge']) {
    assert.deepEqual(Array.from(result.lm.events[key]),[1,3,4,7,8].map(i=>lm.events[key][i]));
    assert.equal(result.lm.events[key].constructor,lm.events[key].constructor);
  }
  assert.deepEqual(lm,before);
  assert.equal(result.debouncing.removedEvents,4);
  assert.equal(result.lm.stats.acceptedEvents,5);
  assert.deepEqual([...result.lm.observedTags],[1,3,0]);
});
test('both limits are inclusive; events outside them and simultaneous events survive',()=>{
  const lm=fixture([100000,100199,100200,110000,110001],[0,0,0,0,1]);
  assert.deepEqual(Array.from(makeDebouncedData(lm).lm.events.tof),[100000,100199,110001]);
  assert.equal(makeDebouncedData(fixture([100,100]),0,1).lm.events.length,2);
  assert.equal(makeDebouncedData(fixture([])).lm.events.length,0);
});
test('scan matches an exhaustive comparison on unsorted, interleaved sweeps',()=>{
  let seed=42;
  const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let round=0;round<30;round++) {
    const tof=Array.from({length:80},()=>next()%100000);
    const sweeps=tof.map(()=>next()%7);
    const lm=fixture(tof,sweeps),min=next()%100,max=min+1+next()%1000;
    const expected=tof.filter((value,i)=>!tof.some((earlier,j)=>sweeps[j]===sweeps[i] && value>earlier && value-earlier>=min*10 && value-earlier<=max*10));
    assert.deepEqual(Array.from(makeDebouncedData(lm,min,max).lm.events.tof),expected);
  }
});
test('invalid ranges are rejected',()=>{
  for(const [min,max] of [[-1,100],[20,20],[100,20],[NaN,100],[20,Infinity],['20',100],[null,100]]) {
    assert.throws(()=>makeDebouncedData(fixture([100]),min,max),/min < max/);
  }
});
test('button sends only the full source ID and window, then selects a new spectrum without fits or sweep filtering',async()=>{
  const elements={},requests=[];
  const context=vm.createContext({window:{addEventListener(){}},document:{addEventListener(){},getElementById:id=>elements[id]??={value:'',textContent:''}},
    fetch:async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true,dataset:{id:'child',filename:'debounced',parentId:'parent',kind:'debounced'},debouncing:{removedEvents:2,sourceEvents:10}})};}});
  vm.runInContext(fs.readFileSync('public/js/histogram-page.js','utf8'),context);
  vm.runInContext(`loadedFileStates=[{datasetId:'parent',settings:{binWidth:'40'},fits:[{id:'fit'}]}];activeFileStateIndex=0;
    saveCurrentViewerState=()=>{};restoreLoadedFileState=async index=>{activeFileStateIndex=index};`,context);
  elements.debounceMinNs={value:'20'};elements.debounceMaxNs={value:'1000'};
  await vm.runInContext('debounceSpectrum()',context);
  assert.deepEqual(requests,[{url:'/api/debounce',body:{datasetId:'parent',minNs:20,maxNs:1000,sessionId:'',viewerSettings:{binWidth:'40'}}}]);
  const state=JSON.parse(vm.runInContext('JSON.stringify(loadedFileStates[activeFileStateIndex])',context));
  assert.equal(state.datasetId,'child');assert.equal(state.sweepRange,null);assert.deepEqual(state.fits,[]);
  assert.match(elements.debounceStatus.textContent,/2 of 10/);
  elements.debounceMinNs.value='';await vm.runInContext('debounceSpectrum()',context);
  assert.equal(requests.length,1);assert.match(elements.debounceStatus.textContent,/Enter a range/);
});

test('HTTP debouncing creates a persistent derived spectrum and preserves its parent',async t=>{
  const {app}=require('../main');
  const server=app.listen(0,'127.0.0.1');
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
  t.after(()=>{server.closeAllConnections();server.close()});
  const root=`http://127.0.0.1:${server.address().port}`;
  const json=async(path,body)=>{const res=await fetch(root+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:res.status,body:await res.json()};};
  const session=(await json('/api/session')).body;
  const hex=(tof,sweep)=>(BigInt(sweep)<<32n|BigInt(tof)<<4n|1n).toString(16).padStart(12,'0');
  const text='time_patch=1a\n[DATA]\n'+[[100,0],[300,0],[10300,0],[300,1]].map(([tof,sweep])=>hex(tof,sweep)).join('\n');
  const upload=await fetch(root+'/api/listmode-file',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:text});
  const parent=await upload.json();assert.equal(parent.ok,true);
  const viewerSettings={timeMode:'absolute',tofLowUs:'12',tofHighUs:'16',absoluteViewRange:{min:52.123456789,max:52.234567891}};
  const result=await json('/api/debounce',{datasetId:parent.datasetId,minNs:20,maxNs:1000,sessionId:session.sessionId,viewerSettings,tofLowUs:999,sweepLow:999,channel:99});
  assert.equal(result.status,200);assert.equal(result.body.debouncing.removedEvents,2);
  const states=(await json('/api/session')).body.states;
  assert.equal(states.length,2);assert.equal(states[1].kind,'debounced');assert.equal(states[1].parentId,parent.datasetId);
  assert.deepEqual(states[1].fits,[]);assert.equal(states[1].sweepRange,null);
  assert.deepEqual(states[1].settings,viewerSettings);
  assert.deepEqual(result.body.dataset.viewerSettings,viewerSettings);
  const repeated=await json('/api/debounce',{datasetId:result.body.dataset.id,minNs:20,maxNs:1000});
  assert.equal(repeated.body.debouncing.sourceEvents,2);assert.equal(repeated.body.debouncing.removedEvents,0);
  const invalid=await json('/api/debounce',{datasetId:parent.datasetId,minNs:100,maxNs:20});
  assert.equal(invalid.status,400);
  const stale=await json('/api/debounce',{datasetId:parent.datasetId,sessionId:'old'});assert.equal(stale.status,409);
});
