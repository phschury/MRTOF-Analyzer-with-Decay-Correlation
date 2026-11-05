const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseEnergyListmode,energyHistogram}=require('../energy-listmode');
const {boxSumReferenceTimes}=require('../energy-correlation');
test('deleted calibrated regions remove matching Box events with half-open module/time bounds',()=>{
 const data=parseEnergyListmode('1,0,0,0\n1,11,50,10\n1,12,25,20\n1,11,50,30\n0,11,50,20\n1,13,100,40');
 const calibrations={'1:11':{gain:2,offset:0},'1:12':{gain:4,offset:0},'1:13':{gain:1,offset:1},'0:11':{gain:2,offset:0}};
 const regions=[{module:1,low:100,high:101,timebaseNs:10,timeLow:0.0000001,timeHigh:0.0000003}];
 const result=energyHistogram(data,{channel:'box-sum'},calibrations,regions);assert.equal(result.plottedEvents,3);
 const times=boxSumReferenceTimes(data,{module:'',channel:11,roi:{low:0,high:1}},calibrations,regions);
 assert.deepEqual([...times],[0.0000002,0.0000003,0.0000004]);
 assert.deepEqual([...boxSumReferenceTimes(data,{module:null,timeLow:null,timeHigh:null},calibrations,regions)],[...times]);
 assert.equal(energyHistogram(data,{channel:11,module:1}).plottedEvents,2);
 assert.equal(energyHistogram(data,{channel:'box-sum'},calibrations,[]).plottedEvents,5);
});
test('noise deletion and restore persist per Energy file and correlation time uses all cleaned Box channels',async t=>{
 const {app}=require('../main'),server=app.listen(0,'127.0.0.1');
 await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
 t.after(()=>{server.closeAllConnections();server.close()});const root=`http://127.0.0.1:${server.address().port}`;
 const request=async(path,body)=>{const res=await fetch(root+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:res.status,body:await res.json()};};
 const upload=async(path,filename,text)=>{const res=await fetch(root+path,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':filename},body:text});assert.equal(res.status,200);return res.json();};
 const sessionId=(await request('/api/session')).body.sessionId;
 const parent=(await upload('/api/listmode-file','tof.lst','time_patch=1a\ncmline3=P:1000000\n[DATA]\n000000000641')).datasetId;
 const energy=(await upload('/api/energy/files','run_001.dat','1,0,0,0\n1,11,50,10\n1,12,100,20\n1,13,150,30\n1,10,5,15')).dataset;
 for(const [channel,gain]of [[11,2],[12,3],[13,2]])await upload('/api/energy/files','BoxSi_ch'+channel+'_calib','a:0\nb:'+gain);
 const path='/api/energy/files/'+energy.id;
 assert.equal((await request(path+'/tof-connection',{sessionId,tofDatasetId:parent})).status,200);
 // Deliberately select a different detector and an ROI excluding all Box events.
 await request(path+'/correlation-reference',{sessionId,channel:10,module:1,roi:{low:0,high:10}});
 const query=new URLSearchParams({datasetId:parent,channel:1,edge:0,tag:0,tofLowUs:0,tofHighUs:1,binWidth:1e-8});
 const timing=()=>request('/api/correlation-time?'+query),histogram=()=>request(path+'/histogram?module=1&channel=box-sum');
 const first=(await timing()).body;assert.equal(first.totalEvents,1);const firstBin=first.counts.findIndex(n=>n>0);assert.equal(first.singleEvents[firstBin].energyKeV,100);assert.equal(first.singleEvents[firstBin].detector,'Box Bottom-Si');
 const derived=await request(path+'/correlate',{sessionId,tofDatasetId:parent,preTime:1,postTime:1,module:1,channel:11,roi:{low:40,high:60}});assert.equal(derived.status,200);
 const cut={sessionId,channel:'box-sum',module:1,roi:{low:100,high:101},timeLow:'',timeHigh:''};
 assert.equal((await request(path+'/box-deleted-regions',{...cut,channel:11})).status,400);
 assert.equal((await request(path+'/box-deleted-regions',{...cut,sessionId:'stale'})).status,409);
 assert.equal((await request(path+'/box-deleted-regions',cut)).status,200);
 const cleaned=(await histogram()).body;assert.equal(cleaned.plottedEvents,2);assert.equal(cleaned.counts[100],0);assert.equal(cleaned.counts[300],2);
 const next=(await timing()).body;assert.equal(next.totalEvents,1);const nextBin=next.counts.findIndex(n=>n>0);assert.ok(nextBin>firstBin);assert.equal(next.singleEvents[nextBin].energyKeV,300);assert.equal(next.singleEvents[nextBin].detector,'Box Right-Si');
 const saved=await(await fetch(root+'/api/listmode-datasets/'+derived.body.dataset.id+'/file')).text();
 const parsed=require('../listmode').parseListModeText(saved);assert.equal(parsed.energyDelaySource,'box-sum');assert.ok(Math.abs(parsed.events.energyDelaySeconds[0]-0.00000019)<1e-15);
 assert.equal(parsed.events.energyDecayKeV[0],300);assert.equal(parsed.events.energyDecayChannel[0],12);
 const listed=(await request('/api/energy/files')).body.datasets.find(ds=>ds.id===energy.id);assert.equal(listed.boxDeletedRegions.length,1);
 const appended=(await upload('/api/energy/files','run_002.dat','1,11,50,50')).dataset;assert.equal(appended.id,energy.id);assert.equal(appended.boxDeletedRegions.length,1);assert.equal((await histogram()).body.plottedEvents,2);
 assert.equal((await request(path+'/box-deleted-regions',{...cut,roi:{low:0,high:1000}})).status,200);
 const none=(await timing()).body;assert.equal(none.totalEvents,0);assert.equal(none.missingSuccessor,1);
 assert.equal((await request(path+'/box-deleted-regions',{sessionId,restore:true})).status,200);
 assert.equal((await histogram()).body.plottedEvents,4);assert.equal((await timing()).body.counts.findIndex(n=>n>0),firstBin);
 const savedRois=[
  {id:'box-300',name:'Box sum 300 keV',channel:'box-sum',module:1,roi:{low:299,high:301}},
  {id:'channel-13',name:'Channel 13 300 keV',channel:13,module:1,roi:{low:149,high:151}},
 ];
 assert.equal((await request(path+'/correlation-reference',{sessionId,channel:10,module:1,roi:{low:0,high:10},savedRois})).status,200);
 const all=(await timing()).body;
 assert.deepEqual(all.energyRois,savedRois.map(({id,name})=>({id,name})));assert.equal(all.energyRoiId,null);
 assert.equal(all.singleEvents.find(Boolean).energyKeV,100);
 query.set('energyRoiId','box-300');const boxSelected=(await timing()).body;
 assert.equal(boxSelected.energyRoiId,'box-300');assert.equal(boxSelected.singleEvents.find(Boolean).energyKeV,300);
 assert.equal(boxSelected.singleEvents.find(Boolean).channel,12);
 query.set('energyRoiId','channel-13');const channelSelected=(await timing()).body;
 assert.equal(channelSelected.singleEvents.find(Boolean).channel,13);
 assert.ok(channelSelected.counts.findIndex(n=>n>0)>boxSelected.counts.findIndex(n=>n>0));
 // Derived ToF spectra expose the same saved ROIs, including after disconnecting the source.
 query.set('datasetId',derived.body.dataset.id);assert.equal((await timing()).body.singleEvents.find(Boolean).channel,13);
 await request(path+'/tof-connection',{sessionId,tofDatasetId:null});
 assert.equal((await timing()).body.energyRois.length,2);assert.equal((await timing()).body.singleEvents.find(Boolean).channel,13);
 await request(path+'/correlation-reference',{sessionId,channel:10,module:1,savedRois:[]});
 assert.equal((await timing()).status,400);
 query.delete('energyRoiId');assert.equal((await timing()).body.singleEvents.find(Boolean).energyKeV,100);
});
