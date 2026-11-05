const {test}=require('node:test');
const assert=require('node:assert/strict');
const {prepareEnergySeries}=require('../energy-series');
const {parseEnergyListmode,energyHistogram,COUNTER_MODULUS}=require('../energy-listmode');
function part(filename,tick,pulse){return {filename,bytes:20,data:parseEnergyListmode(`1,11,${pulse},${tick},6`)};}
test('later series files retain one spectrum ID, sort numerically and use original arrays without compounding time offsets',()=>{
 const datasets=new Map();
 const third=part('file_003.dat',50,300);const [initial]=prepareEnergySeries(datasets,[third],{});datasets.set(initial.id,initial);
 const first=part('file_001.dat',COUNTER_MODULUS-10,100);const [afterFirst]=prepareEnergySeries(datasets,[first],{});datasets.set(afterFirst.id,afterFirst);
 const second=part('file_002.dat',5,200);const [complete]=prepareEnergySeries(datasets,[second],{});
 assert.equal(complete.id,initial.id);assert.deepEqual(complete.sourceFiles,['file_001.dat','file_002.dat','file_003.dat']);assert.equal(complete.data.events.length,3);
 assert.equal(complete.data.maxTick-complete.data.minTick,60);assert.equal(complete.data.rollovers,1);
 assert.equal(complete.data.parts[0].events,first.data.events);assert.equal(complete.data.parts[2].events,third.data.events);
 assert.equal(energyHistogram(complete.data).plottedEvents,3);
 datasets.set(complete.id,complete);assert.throws(()=>prepareEnergySeries(datasets,[first],{}),/file_001.dat.*already part/);
 assert.equal(datasets.size,1);assert.equal(datasets.get(complete.id).data.events.length,3);
 const [other]=prepareEnergySeries(datasets,[part('different_004.dat',100,400)],{});assert.notEqual(other.id,initial.id);
});
test('invalid complete records identify the filename, physical line and offending record',()=>{
 assert.throws(()=>parseEnergyListmode('# comment\n\n1,11,100,200,6\n1,11,bad,300,6',{filename:'file_004.dat'}),error=>{
  assert.equal(error.filename,'file_004.dat');assert.equal(error.line,4);assert.equal(error.record,'1,11,bad,300,6');
  assert.match(error.message,/file_004\.dat: Invalid energy record/);assert.match(error.message,/line 4/);assert.match(error.message,/4–5 Niki columns/);return true;
 });
});
test('single-file and batch imports append to a series; malformed additions leave successful files unchanged',async t=>{
 const {app}=require('../main');const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
 t.after(()=>{server.closeAllConnections();server.close()});const root=`http://127.0.0.1:${server.address().port}`;
 const post=async(url,body)=>{const response=await fetch(root+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 const upload=async(name,text,headers={})=>{const response=await fetch(root+'/api/energy/files',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':name,...headers},body:text});return {status:response.status,body:await response.json()};};
 const first=await upload('file_001.dat','1,11,100,100,6');assert.equal(first.status,200);const id=first.body.dataset.id;
 const batch=await post('/api/energy/imports',{files:[{filename:'file_002.dat'},{filename:'file_003.dat'}]});const importId=batch.body.importId;
 const second=await upload('file_002.dat','1,11,200,200,6',{'X-Energy-Import':importId,'X-Energy-File-Index':'0'});assert.equal(second.status,200);
 const broken=await upload('file_003.dat','1,11,300,300,6\n1,11,invalid,400,6',{'X-Energy-Import':importId,'X-Energy-File-Index':'1'});
 assert.equal(broken.status,400);assert.equal(broken.body.file,'file_003.dat');assert.equal(broken.body.line,2);assert.match(broken.body.error,/line 2/);
 const unchanged=await(await fetch(root+'/api/energy/files')).json();assert.equal(unchanged.datasets.length,1);assert.equal(unchanged.datasets[0].events,1);
 await fetch(root+'/api/energy/imports/'+importId,{method:'DELETE'});
 const added=await upload('file_002.dat','1,11,200,200,6');assert.equal(added.body.dataset.id,id);assert.equal(added.body.dataset.events,2);
 const thirdBatch=await post('/api/energy/imports',{files:[{filename:'file_003.dat'}]});
 await upload('file_003.dat','1,11\n1,11,300,300,6\n1,11,400,',{'X-Energy-Import':thirdBatch.body.importId,'X-Energy-File-Index':'0'});
 const finished=await post('/api/energy/imports/'+thirdBatch.body.importId+'/finish');assert.equal(finished.status,200);assert.equal(finished.body.datasets.length,1);assert.equal(finished.body.datasets[0].id,id);assert.equal(finished.body.datasets[0].events,3);assert.equal(finished.body.datasets[0].incompleteLines,2);
 assert.deepEqual(finished.body.datasets[0].sourceFiles,['file_001.dat','file_002.dat','file_003.dat']);
 const duplicate=await upload('file_002.dat','1,11,200,200,6');assert.equal(duplicate.status,400);assert.match(duplicate.body.error,/already part/);
 const histogram=await(await fetch(root+'/api/energy/files/'+id+'/histogram')).json();assert.equal(histogram.plottedEvents,3);assert.equal(histogram.counts[100],1);assert.equal(histogram.counts[200],1);assert.equal(histogram.counts[300],1);
});
