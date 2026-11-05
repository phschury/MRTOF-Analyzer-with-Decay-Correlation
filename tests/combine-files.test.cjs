const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseListModeText}=require('../listmode');
const {serializeListmode}=require('../listmode-export');
const {canCombineDataset,makeCombinedData}=require('../combine-files');
const {makeDebouncedData}=require('../debounce');
const vm=require('node:vm');
const fs=require('node:fs');
const hex=(tof,sweep)=>((BigInt(sweep)<<32n)|(BigInt(tof)<<4n)|9n).toString(16).padStart(12,'0');
function file(values,start='11/03/2026 00:00:00.000'){return ['cmline0='+start,'time_patch=1a','cmline3=P:1000','custom_header=preserve','[DATA]',...values.map(([tof,sweep])=>hex(tof,sweep))].join('\n');}
function dataset(id,values){return {id,filename:id+'.lst',kind:'original',bytes:100,lm:parseListModeText(file(values,id==='b'?'11/03/2026 00:00:00.003':'11/03/2026 00:00:00.000'))};}

test('combining appends all events and offsets sweeps without changing TOFs, raw records or originals',()=>{
 const a=dataset('a',[[100,0],[200,2]]),b=dataset('b',[[300,0],[400,1]]);
 const result=makeCombinedData([a,b]);
 assert.equal(result.events.length,4);assert.deepEqual([...result.events.tof],[100,200,300,400]);
 assert.deepEqual([...result.events.sweep],[0,2,3,4]);assert.deepEqual([...b.lm.events.sweep],[0,1]);
 assert.deepEqual(result.events.raw,[...a.lm.events.raw,...b.lm.events.raw]);
 assert.equal(result.header.custom_header,'preserve');assert.equal(result.stats.acceptedEvents,4);
 const restored=parseListModeText(serializeListmode(result));
 assert.deepEqual([...restored.events.sweep],[0,2,3,4]);assert.deepEqual([...restored.events.tof],[100,200,300,400]);
 assert.equal(restored.header.correlyzer_processing,'combined');
 assert.equal(canCombineDataset({kind:'combined',lm:restored}),true);
 const debounce=makeDebouncedData(restored,20,1000).lm;
 assert.equal(canCombineDataset({kind:'debounced',lm:debounce}),false);
});
test('processed files are rejected even when renamed or mislabeled as originals',()=>{
 const a=dataset('a',[[100,0]]),b=dataset('b',[[200,0]]);
 for(const kind of ['debounced','drift-corrected','processed']){
  const processed={...b,kind};assert.equal(canCombineDataset(processed),false);
  assert.throws(()=>makeCombinedData([a,processed]),/cannot be combined/);
 }
 const saved=parseListModeText(serializeListmode(makeDebouncedData(b.lm,20,1000).lm));
 assert.equal(canCombineDataset({...b,kind:'original',filename:'renamed.lst',lm:saved}),false);
 const legacy={...b,lm:{...b.lm,header:{correlyzer_processed:'1'}}};assert.equal(canCombineDataset(legacy),false);
 assert.equal(canCombineDataset({...b,pending:true}),false);
});
test('combining rejects mismatched timing, duplicate sources and sweep overflow',()=>{
 const a=dataset('a',[[100,0]]),b=dataset('b',[[200,0]]);
 for(const patch of [{timePatch:'5b'},{sweepPeriodUs:2000}])assert.throws(()=>makeCombinedData([a,{...b,lm:{...b.lm,...patch}}]),/matching/);
 assert.throws(()=>makeCombinedData([a]),/at least two/);assert.throws(()=>makeCombinedData([a,a]),/different/);
 a.lm.events.sweep[0]=2147483647;assert.throws(()=>makeCombinedData([a,b]),/supported range/);
});

test('Combine Files chooser disables processed files and creates a selectable combined spectrum',async()=>{
 const elements={},requests=[];
 function element(){return {children:[],handlers:{},style:{},value:'',disabled:false,textContent:'',addEventListener(n,fn){this.handlers[n]=fn},
  append(...items){this.children.push(...items)},appendChild(item){this.children.push(item)},replaceChildren(){this.children=[]},
  showModal(){this.open=true},close(){this.open=false},querySelectorAll(){return this.children.flatMap(label=>label.children).filter(input=>input.type==='checkbox' && input.checked)}};}
 for(const id of ['combineFilesDialog','combineFilesChoices','combineFilesStatus','combineFilesSubmit','combineFilesCancel','combineFilesButton'])elements[id]=element();
 const datasets=[{id:'a',filename:'a.lst',canCombine:true},{id:'b',filename:'b.lst',canCombine:true},
  {id:'bad',filename:'processed.lst',kind:'debounced',canCombine:false}];
 const context=vm.createContext({document:{getElementById:id=>elements[id],createElement:element},
  loadedFileStates:[{datasetId:'a',settings:{timeMode:'relative',tofLowUs:'7',tofHighUs:'9'}}],saveCurrentViewerState(){},restoreLoadedFileState:async index=>{context.selected=index},
  fetch:async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>url==='/api/listmode-datasets'?{ok:true,datasets}
   :{ok:true,dataset:{id:'combined',kind:'combined',filename:'a + b [combined].lst',viewerSettings:{timeMode:'relative',tofLowUs:'7',tofHighUs:'9'}}}}}});
 vm.runInContext(fs.readFileSync('public/js/combine-files.js','utf8'),context);vm.runInContext('initializeCombineFiles()',context);
 await elements.combineFilesButton.handlers.click();
 const inputs=elements.combineFilesChoices.children.map(label=>label.children[0]);assert.equal(inputs[2].disabled,true);
 inputs[0].checked=true;elements.combineFilesChoices.handlers.change();assert.equal(elements.combineFilesSubmit.disabled,true);
 inputs[1].checked=true;elements.combineFilesChoices.handlers.change();assert.equal(elements.combineFilesSubmit.disabled,false);
 await elements.combineFilesSubmit.handlers.click();
 assert.deepEqual(JSON.parse(requests[1].options.body).datasetIds,['a','b']);
 assert.equal(context.loadedFileStates[1].kind,'combined');assert.equal(context.loadedFileStates[1].settings.tofLowUs,'7');
 assert.equal(context.selected,1);assert.equal(elements.combineFilesDialog.open,false);
});

test('HTTP combination preserves parents and view settings; reloaded processed files stay excluded',async t=>{
 const {app}=require('../main');const server=app.listen(0,'127.0.0.1');
 await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
 t.after(()=>{server.closeAllConnections();server.close()});
 const root=`http://127.0.0.1:${server.address().port}`;
 const post=async(url,body)=>{const res=await fetch(root+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:res.status,body:await res.json()}};
 async function upload(name,text){const res=await fetch(root+'/api/listmode-file',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':name},body:text});return (await res.json()).datasetId;}
 const a=await upload('a.lst',file([[100,0],[200,2]])),b=await upload('b.lst',file([[300,0],[400,1]],'11/03/2026 00:00:00.003'));
 const viewerSettings={timeMode:'absolute',tofLowUs:'12',tofHighUs:'16',absoluteViewRange:{min:7.123,max:8.345}};
 const combined=await post('/api/combine-files',{datasetIds:[a,b],viewerSettings});assert.equal(combined.status,200);
 const ds=combined.body.dataset;assert.equal(ds.kind,'combined');assert.equal(ds.canCombine,true);assert.deepEqual(ds.viewerSettings,viewerSettings);
 const response=await fetch(root+'/api/listmode-datasets/'+ds.id+'/file');assert.equal(response.status,200);
 const restored=parseListModeText(await response.text());assert.deepEqual([...restored.events.sweep],[0,2,3,4]);
 const saved=await upload('combined.lst',serializeListmode(restored));
 assert.equal((await post('/api/combine-files',{datasetIds:[a,saved]})).status,200);
 const debounced=await post('/api/debounce',{datasetId:a,minNs:20,maxNs:1000});
 assert.equal((await post('/api/combine-files',{datasetIds:[b,debounced.body.dataset.id]})).status,400);
 const exported=await fetch(root+'/api/listmode-datasets/'+debounced.body.dataset.id+'/file');
 const reloaded=await upload('renamed.lst',await exported.text());
 assert.equal((await post('/api/combine-files',{datasetIds:[b,reloaded]})).status,400);
 const legacy=serializeListmode(restored).replace('correlyzer_processing=combined\r\n','');
 const old=await upload('old-processed.lst',legacy);assert.equal((await post('/api/combine-files',{datasetIds:[b,old]})).status,400);
 assert.equal((await post('/api/combine-files',{datasetIds:[a,b],sessionId:'stale'})).status,409);
 assert.equal((await post('/api/combine-files',{datasetIds:[a,a]})).status,400);
 assert.equal((await post('/api/combine-files',{datasetIds:[a,'missing']})).status,400);
 const list=await (await fetch(root+'/api/listmode-datasets')).json();assert.equal(list.datasets.find(ds=>ds.id===reloaded).canCombine,false);
 assert.ok(list.datasets.some(ds=>ds.id===a));assert.ok(list.datasets.some(ds=>ds.id===b));
 const timingFile=(e0,e1)=>file([[1100000,0]]).replace('[DATA]','cmline2=TP:0,'+e0+','+e1+'\n[DATA]');
 const timedA=await upload('timed-a.lst',timingFile(100,300)),timedB=await upload('timed-b.lst',timingFile(100.6,300.8));
 const averaged=await post('/api/combine-files',{datasetIds:[timedA,timedB]});assert.equal(averaged.status,200);
 const averageFile=await fetch(root+'/api/listmode-datasets/'+averaged.body.dataset.id+'/file');
 const averageData=parseListModeText(await averageFile.text());
 assert.ok(Math.abs(averageData.ejectNs[0]/1000-100.3)<1e-10);
 assert.ok(Math.abs(averageData.ejectNs[1]/1000-300.4)<1e-10);
 assert.equal(averageData.events.length,2);
 const timedBad=await upload('timed-bad.lst',timingFile(101.0001,300));
 const rejected=await post('/api/combine-files',{datasetIds:[timedA,timedBad]});
 assert.equal(rejected.status,400);assert.equal(rejected.body.code,'EJECTION_MISMATCH');

});

test('combining uses start times including milliseconds to leave acquisition gaps and orders files chronologically',()=>{
 const a=dataset('a',[[100,0],[200,2]]),b=dataset('b',[[300,0],[400,1]]);
 b.lm.startTime=new Date(a.lm.startTime.getTime()+10000);
 const result=makeCombinedData([b,a]);
 assert.deepEqual([...result.events.sweep],[0,2,10000,10001]);
 assert.deepEqual(result.combination.sourceIds,['a','b']);assert.equal(result.combination.totalSweeps,10002);
 const restored=parseListModeText(serializeListmode(result));
 assert.equal(restored.startTime.getTime(),a.lm.startTime.getTime());
 assert.deepEqual([...restored.events.sweep],[0,2,10000,10001]);
 const c={...a,id:'c',lm:restored};
 const next=makeCombinedData([b,c]);assert.deepEqual([...next.events.sweep],[0,2,10000,10001,10000,10001]);
});
test('start-time parsing retains fractional seconds across day boundaries and rounds to the nearest sweep',()=>{
 const a=dataset('a',[[100,0]]),b=dataset('b',[[200,0]]);
 a.lm=parseListModeText(file([[100,0]],'11/03/2026 23:59:59.999'));
 b.lm=parseListModeText(file([[200,0]],'11/04/2026 00:00:00.002'));
 assert.equal(a.lm.startTime.getMilliseconds(),999);
 assert.deepEqual([...makeCombinedData([a,b]).events.sweep],[0,3]);
 a.lm.sweepPeriodUs=2000;b.lm.sweepPeriodUs=2000;
 assert.deepEqual([...makeCombinedData([a,b]).events.sweep],[0,2]);
});
test('missing or invalid start-time and sweep-period metadata prevents guessing a combined timeline',()=>{
 const a=dataset('a',[[100,0]]),b=dataset('b',[[200,0]]);
 for(const patch of [{startTime:null},{startTime:new Date(NaN)},{sweepPeriodUs:null},{sweepPeriodUs:0},{sweepPeriodUs:-1}])assert.throws(()=>makeCombinedData([a,{...b,lm:{...b.lm,...patch}}]),/valid start times/);
});

test('drift-corrected combined files remain excluded after saving and reloading',()=>{
 const combined=makeCombinedData([dataset('a',[[100,0]]),dataset('b',[[200,0]])]);
 const fit={trancheSize:10,settings:{sweepLow:0,sweepHigh:10},results:[{sweepLow:0,sweepHigh:10,success:true,params:{center:{value:100}}}]};
 const {lm}=require('../drift-correction').makeDriftCorrectedData(combined,fit);
 const restored=parseListModeText(serializeListmode(lm));
 assert.equal(restored.header.correlyzer_processing,'drift-corrected');
 assert.equal(canCombineDataset({kind:'combined',lm:restored}),false);
});

test('ejection times use per-file averages up to 1 us and persist through export and reload',()=>{
 const a=dataset('a',[[100,0]]),b=dataset('b',[[200,0]]),c=dataset('c',[[300,0]]);
 a.lm.ejectBins=[1000000,3000000];b.lm.ejectBins=[1005001,3008000];c.lm.ejectBins=[1007000,3004000];
 const result=makeCombinedData([a,b,c]);
 assert.deepEqual(result.ejectBins,[(1000000+1005001+1007000)/3,3004000]);
 assert.deepEqual(result.ejectNs,result.ejectBins.map(bin=>bin/10));
 assert.deepEqual(a.lm.ejectBins,[1000000,3000000]);
 const restored=parseListModeText(serializeListmode(result));
 result.ejectBins.forEach((value,index)=>assert.ok(Math.abs(restored.ejectBins[index]-value)<1e-6));
 b.lm.ejectBins=[1010000,3000000];assert.doesNotThrow(()=>makeCombinedData([a,b]));
 b.lm.ejectBins=[1010001,3000000];assert.throws(()=>makeCombinedData([a,b]),error=>error.code==='EJECTION_MISMATCH');
 b.lm.ejectBins=[1000000,3010001];assert.throws(()=>makeCombinedData([a,b]),/more than 1 µs/);
});
test('ejection tolerance compares the entire file selection rather than only its average',()=>{
 const a=dataset('a',[[100,0]]),b=dataset('b',[[200,0]]),c=dataset('c',[[300,0]]);
 a.lm.ejectBins=[1000000,3000000];b.lm.ejectBins=[1006000,3000000];c.lm.ejectBins=[1012000,3000000];
 assert.throws(()=>makeCombinedData([a,b,c]),/more than 1 µs/);
});

test('master-cycle metadata uses half the period per sweep, avoiding overlap in the reported four-file run',()=>{
 const recordings=[
  ['31','11/02/2026 13:11:00.789',2072996],
  ['33','11/03/2026 04:15:51.831',6035],
  ['35','11/03/2026 04:26:04.392',542141],
  ['36','11/03/2026 08:15:04.218',544813],
 ];
 const sources=recordings.map(([id,start,total])=>{
  const ds=dataset(id,[[100,0],[200,1]]);
  ds.lm=parseListModeText(file([[100,0],[200,1]],start).replace('P:1000','MP:50000.000'));
  ds.lm.events.sweep[1]=total-1;
  assert.equal(ds.lm.masterPeriodUs,50000);assert.equal(ds.lm.sweepPeriodUs,25000);assert.equal(ds.lm.sweepRateHz,40);
  return ds;
 });
 const result=makeCombinedData(sources);
 assert.deepEqual(result.combination.sourceOffsets.map(row=>row.sweepOffset),[0,2171642,2196144,2745737]);
 assert.deepEqual([...result.events.sweep],[0,2072995,2171642,2177676,2196144,2738284,2745737,3290549]);
 for(let i=1;i<sources.length;i++)assert.ok(result.events.sweep[2*i]>result.events.sweep[2*i-1]);
 const restored=parseListModeText(serializeListmode(result));
 assert.equal(restored.sweepPeriodUs,25000);assert.deepEqual([...restored.events.sweep],[...result.events.sweep]);
});
test('legacy P remains a per-sweep period and invalid period metadata stays unavailable',()=>{
 const legacy=parseListModeText(file([[100,0]]).replace('P:1000','R:12,34, P:80000'));
 assert.equal(legacy.sweepPeriodUs,80000);assert.equal(legacy.masterPeriodUs,null);assert.equal(legacy.sweepRateHz,12.5);
 for(const value of ['MP:0','MP:-50000','MP:NaN','MP:Infinity']){
  const lm=parseListModeText(file([[100,0]]).replace('P:1000',value));assert.equal(lm.sweepPeriodUs,null);
 }
});
