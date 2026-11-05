const {test}=require('node:test');
const assert=require('node:assert/strict');
const {makeEnergyCorrelatedData}=require('../energy-correlation');
const {parseEnergyListmode,combineEnergyData}=require('../energy-listmode');
function tof(times){
  return {sweepPeriodUs:1000000,stats:{acceptedEvents:times.length},events:{length:times.length,
    tof:Float64Array.from(times,t=>(t-Math.floor(t))*1e10),sweep:Int32Array.from(times,Math.floor),
    tag:Int32Array.from(times,(_,i)=>i%4),channel:Int16Array.from(times,()=>1),edge:Int8Array.from(times,()=>1),raw:times.map((_,i)=>'event-'+i)}};
}
const opts={roi:{low:100,high:200},preTime:0.25,postTime:0.5,module:1,channel:11};
const energy=text=>parseEnergyListmode(text,{filename:'energy.dat'});
test('Box detector sum correlates with every channel from 11 through 15 within the selected module',()=>{
  const data=energy('1,10,150,0\n1,11,150,100000000\n1,12,150,200000000\n1,13,150,300000000\n1,14,150,400000000\n1,15,150,500000000\n1,16,150,600000000\n0,11,150,700000000');
  const source=tof([0,1,2,3,4,5,6,7]),selection={...opts,channel:'box-sum',preTime:0,postTime:0};
  const calibrations=Object.fromEntries(data.channels.map(row=>[row.module+':'+row.channel,{gain:1,offset:0}]));
  const sum=selection=>makeEnergyCorrelatedData(source,data,selection,calibrations);
  const result=sum(selection);
  assert.deepEqual([...result.lm.events.sweep],[1,2,3,4,5]);assert.equal(result.correlation.channel,'box-sum');
  assert.deepEqual([...sum({...selection,module:''}).lm.events.sweep],[1,2,3,4,5,7]);
  assert.deepEqual([...sum({...selection,timeLow:2,timeHigh:5}).lm.events.sweep],[2,3,4]);
});
test('summed correlation ROI selects calibrated energies independently for each detector',()=>{
  const data=energy('1,0,0,0\n1,11,100,100000000\n1,12,50,200000000\n1,15,100,300000000');
  const calibrations={'1:11':{gain:2,offset:10},'1:12':{gain:4,offset:10},'1:15':{gain:3,offset:10}};
  const selection={...opts,channel:'box-sum',roi:{low:210,high:310},preTime:0,postTime:0};
  const result=makeEnergyCorrelatedData(tof([1,2,3]),data,selection,calibrations);
  assert.deepEqual([...result.lm.events.sweep],[1,2]);assert.equal(result.correlation.roiUnit,'keV');
  assert.throws(()=>makeEnergyCorrelatedData(tof([1,2,3]),data,selection),/requires an energy calibration/);
});
test('inclusive pre/post windows are relative to energy ROI events and retain each ToF event once in source order',()=>{
  const data=energy('1,0,0,0\n1,11,100,100000000\n1,11,150,125000000\n1,11,200,200000000\n1,12,150,300000000');
  const source=tof([1.75,0.749,1,0.75,1.5,1.751,2,3]),before=structuredClone(source);
  const result=makeEnergyCorrelatedData(source,data,opts);
  assert.deepEqual(result.lm.events.raw,['event-0','event-2','event-3','event-4']);
  assert.equal(result.correlation.energyEvents,2);assert.equal(result.correlation.totalEvents,4);
  assert.deepEqual(source,before);
  for(const key of ['tof','sweep','tag','channel','edge'])assert.deepEqual([...result.lm.events[key]],[0,2,3,4].map(i=>source.events[key][i]));
});
test('elapsed filters, USB-MCA timebase overrides, empty results and zero-width windows',()=>{
  const data=parseEnergyListmode('0,2,1\n100,2,100\n200,2,100');
  const source=tof([0,1,2,2.01]);
  const selection={...opts,module:-1,channel:2,timebaseNs:10000000,timeLow:1,timeHigh:2,preTime:0,postTime:0};
  assert.deepEqual([...makeEnergyCorrelatedData(source,data,selection).lm.events.sweep],[1]);
  assert.equal(makeEnergyCorrelatedData(source,data,{...selection,roi:{low:500,high:600}}).lm.events.length,0);
  assert.equal(makeEnergyCorrelatedData(tof([]),data,selection).lm.events.length,0);
  assert.throws(()=>makeEnergyCorrelatedData(source,data,{...selection,timebaseNs:''}),/timebase/);
});
test('numbered energy parts use their common elapsed zero and timestamp offsets',()=>{
  const data=combineEnergyData([energy('1,0,0,0\n1,11,150,100000000'),energy('1,11,150,200000000')]);
  assert.deepEqual([...makeEnergyCorrelatedData(tof([1,2,3]),data,{...opts,preTime:0,postTime:0}).lm.events.sweep],[1,2]);
  const wrapped=combineEnergyData([energy('1,0,0,1099511627770\n1,11,150,1099511627772'),energy('1,11,150,4')]);
  assert.equal(makeEnergyCorrelatedData(tof([0.0000001]),wrapped,{...opts,preTime:0,postTime:0}).lm.events.length,1);
});
test('invalid selections and missing ToF timing are rejected',()=>{
  const data=energy('1,11,150,0');
  for(const invalid of [{roi:null},{roi:{low:200,high:100}},{preTime:-1},{postTime:Infinity},{preTime:'1'},{timebaseNs:0},{timeHigh:-1},{module:1.5},{timeLow:2,timeHigh:1}]){
    assert.throws(()=>makeEnergyCorrelatedData(tof([0]),data,{...opts,...invalid}));
  }
  assert.throws(()=>makeEnergyCorrelatedData({...tof([0]),sweepPeriodUs:null},data,opts),/sweep period/);
});
test('binary lookup matches an exhaustive time-window comparison',()=>{
  let seed=17;const next=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  for(let round=0;round<20;round++){
    const ticks=Array.from({length:50},()=>next()%1000000000);
    const data=energy('1,0,0,0\n'+ticks.map(t=>'1,11,150,'+t).join('\n'));
    const times=Array.from({length:100},()=>next()%10000/1000),source=tof(times);
    const preTime=next()%100/100,postTime=next()%100/100;
    const expected=source.events.raw.filter((_,i)=>ticks.some(t=>times[i]>=t/1e8-preTime-1e-12 && times[i]<=t/1e8+postTime+1e-12));
    assert.deepEqual(makeEnergyCorrelatedData(source,data,{...opts,preTime,postTime}).lm.events.raw,expected);
  }
});
test('HTTP correlation creates and selects an independent, exportable ToF spectrum',async t=>{
  const {app}=require('../main'),server=app.listen(0,'127.0.0.1');
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
  t.after(()=>{server.closeAllConnections();server.close()});const root=`http://127.0.0.1:${server.address().port}`;
  const request=async(path,body)=>{const res=await fetch(root+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:res.status,body:await res.json()};};
  const sessionId=(await request('/api/session')).body.sessionId;
  const hex=(tof,sweep)=>(BigInt(sweep)<<32n|BigInt(tof)<<4n|1n).toString(16).padStart(12,'0');
  const records=[[100,0],[100000000,1],[100,2]].map(([t,s])=>hex(t,s));
  const text='time_patch=1a\ncmline3=P:1000000\n[DATA]\n'+records.join('\n');
  const parent=await(await fetch(root+'/api/listmode-file',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':'tof.lst'},body:text})).json();assert.equal(parent.ok,true);
  const data=await(await fetch(root+'/api/energy/files',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':'energy.dat'},body:'1,0,0,0\n1,11,150,100000000\n1,12,100,101000000\n1,11,150,105000000'})).json();
  const path='/api/energy/files/'+data.dataset.id;
  const selection={...opts,preTime:0.1,postTime:0.1,sessionId,tofDatasetId:parent.datasetId};
  assert.equal((await request(path+'/correlate',selection)).status,400);
  assert.equal((await request(path+'/tof-connection',{sessionId,tofDatasetId:parent.datasetId})).status,200);
  assert.equal((await request(path+'/correlation-reference',selection)).status,200);
  assert.equal((await request(path+'/histogram?module=1&channel=box-sum')).status,200);
  for(const [channel,gain]of [[11,2],[12,3]]){
    const upload=await fetch(root+'/api/energy/files',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':'BoxSi_ch'+channel+'_calib'},body:'a:10\nb:'+gain});assert.equal(upload.status,200);
  }
  const directQuery=new URLSearchParams({datasetId:parent.datasetId,energyDatasetId:data.dataset.id,channel:1,edge:0,tag:0,tofLowUs:0,tofHighUs:10001});
  const directTime=await request('/api/correlation-time?'+directQuery);assert.equal(directTime.status,200);assert.equal(directTime.body.totalEvents,2);assert.equal(directTime.body.missingSuccessor,1);
  const fittedTime=await request('/api/correlation-time?'+directQuery+'&fitExponential=true');assert.equal(fittedTime.status,200);assert.equal(fittedTime.body.fit.ok,true);assert.equal(fittedTime.body.fit.events,2);assert.ok(fittedTime.body.fit.halfLife>0);assert.equal(directTime.body.fit,undefined);
  const schmidtTime=await request('/api/correlation-time?'+directQuery+'&xScale=log&fitSchmidt=true');assert.equal(schmidtTime.status,200);assert.equal(typeof schmidtTime.body.schmidtFit.ok,'boolean');assert.equal(directTime.body.schmidtFit,undefined);
  const connectedState=(await request('/api/session')).body.states.find(ds=>ds.datasetId===parent.datasetId);assert.equal(connectedState.correlationEnergySources[0].id,data.dataset.id);
  assert.equal((await request(path+'/correlate',{...selection,tofDatasetId:'changed'})).status,400);
  assert.equal((await request(path+'/correlate',{...selection,sessionId:'stale'})).status,409);
  const result=await request(path+'/correlate',selection);assert.equal(result.status,200);assert.equal(result.body.correlation.totalEvents,1);assert.equal(result.body.correlation.sourceEvents,3);
  const state=(await request('/api/session')).body;
  assert.equal(state.activeDatasetId,result.body.dataset.id);assert.equal(state.states.length,2);
  const child=state.states.find(ds=>ds.datasetId===result.body.dataset.id);assert.equal(child.kind,'energy-correlated');assert.equal(child.parentId,parent.datasetId);assert.deepEqual(child.fits,[]);assert.equal(child.roi,null);assert.equal(child.sweepRange,null);
  const saved=await fetch(root+'/api/listmode-datasets/'+child.datasetId+'/file');assert.equal(saved.status,200);
  const exported=await saved.text();assert.match(exported,/correlyzer_processing=energy-correlated/);
  const parsed=require('../listmode').parseListModeText(exported);assert.equal(parsed.events.length,1);assert.equal(parsed.events.sweep[0],1);assert.equal(parsed.events.tof[0],100000000);
  assert.equal(parsed.events.energyDelaySeconds[0],0);assert.equal(parsed.energyDelayDirection,'next');assert.equal(parsed.energyDelaySource,'box-sum');
  const timeQuery=new URLSearchParams({datasetId:child.datasetId,channel:1,edge:0,tag:0,tofLowUs:9999,tofHighUs:10001,binWidth:0.005});
  const time=await request('/api/correlation-time?'+timeQuery);assert.equal(time.status,200);assert.equal(time.body.totalEvents,1);assert.equal(time.body.missingSuccessor,0);assert.equal(time.body.counts.reduce((a,b)=>a+b),1);
  timeQuery.set('datasetId',parent.datasetId);assert.equal((await request('/api/correlation-time?'+timeQuery)).status,200);timeQuery.set('datasetId',child.datasetId);
  const summed=(await request(path+'/histogram?module=1&channel=box-sum&unit=ch&gain=999&offset=999&low=999&high=1000')).body;
  assert.equal(summed.unit,'keV');assert.equal(summed.plottedEvents,3);assert.equal(summed.counts[310],3);
  const summedCorrelation=await request(path+'/correlate',{...selection,channel:'box-sum',roi:{low:310,high:311}});
  assert.equal(summedCorrelation.status,200);assert.equal(summedCorrelation.body.correlation.energyEvents,3);assert.equal(summedCorrelation.body.correlation.totalEvents,1);assert.equal(summedCorrelation.body.correlation.roiUnit,'keV');
  const parentFile=(await request('/api/listmode-datasets')).body;assert.equal(parentFile.datasets.length,3);
  const reloaded=await(await fetch(root+'/api/listmode-file',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':'saved-correlated.lst'},body:exported})).json();
  timeQuery.set('datasetId',reloaded.datasetId);const reloadedTime=(await request('/api/correlation-time?'+timeQuery)).body;assert.equal(reloadedTime.totalEvents,1);assert.equal(reloadedTime.singleEvents.find(Boolean).energyKeV,310);assert.equal(reloadedTime.singleEvents.find(Boolean).detector,'Box Right-Si');
  const oldExport=exported.replace(/^correlyzer_energy_delay_direction=next\r?\n/m,'');
  const oldFile=await(await fetch(root+'/api/listmode-file',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':'old-correlated.lst'},body:oldExport})).json();
  const oldQuery=new URLSearchParams(timeQuery);oldQuery.set('datasetId',oldFile.datasetId);
  const oldTime=await request('/api/correlation-time?'+oldQuery);assert.equal(oldTime.status,400);assert.match(oldTime.body.error,/previous timing direction/);
  const narrowed=new URLSearchParams(timeQuery);narrowed.set('tofHighUs','9999.5');assert.equal((await request('/api/correlation-time?'+narrowed)).body.totalEvents,0);
  const empty=await request(path+'/correlate',{...selection,roi:{low:500,high:600}});assert.equal(empty.status,200);assert.equal(empty.body.correlation.totalEvents,0);
  assert.equal((await request(path+'/tof-connection',{sessionId,tofDatasetId:null})).status,200);
  assert.equal((await request('/api/correlation-time?'+directQuery)).status,400);
  assert.equal((await request('/api/correlation-time?'+timeQuery)).body.totalEvents,1);
  assert.equal((await request(path+'/correlate',selection)).status,400);
  await request('/api/session/new',{});assert.equal((await request(path+'/correlate',selection)).status,409);
});
