const {test}=require('node:test');
const assert=require('node:assert/strict');
test('energy upload, histogram, selection, removal and session reset stay separate from ToF data',async t=>{
 const {app}=require('../main');const server=app.listen(0,'127.0.0.1');
 await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
 t.after(()=>{server.closeAllConnections();server.close()});const root=`http://127.0.0.1:${server.address().port}`;
 const original=await(await fetch(root+'/api/session')).json();
 const upload=async(text,name='sample.lst',session=original.sessionId)=>{
  const response=await fetch(root+'/api/energy/files',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(name),'X-Filename-Encoded':'uri','X-Workspace-Session':session},body:text});
  return {status:response.status,body:await response.json()};
 };
 const a=await upload('2280,1,148\n8480,1,266\n9000,4,500','測定.lst');assert.equal(a.status,200);assert.equal(a.body.dataset.filename,'測定.lst');assert.equal(a.body.dataset.events,3);
 const b=await upload('1,12,2052,577119862987,4');assert.equal(b.status,200);assert.equal(b.body.dataset.channels[0].label,'Box Right-Si');
 const list=await(await fetch(root+'/api/energy/files')).json();assert.equal(list.datasets.length,2);assert.equal(list.activeId,b.body.dataset.id);
 const histogram=await(await fetch(root+'/api/energy/files/'+a.body.dataset.id+'/histogram?channel=1')).json();assert.equal(histogram.plottedEvents,2);assert.equal(histogram.recordedSpanSec,null);
 assert.equal((await fetch(root+'/api/energy/files/'+a.body.dataset.id+'/histogram?timeLow=0')).status,400);
 const selected=await fetch(root+'/api/energy/files/'+a.body.dataset.id+'/select',{method:'POST'});assert.equal(selected.status,200);
 const unchanged=await(await fetch(root+'/api/session')).json();assert.equal(unchanged.states.length,original.states.length);
 assert.equal((await upload('malformed')).status,400);
 assert.equal((await fetch(root+'/api/energy/files/'+b.body.dataset.id,{method:'DELETE'})).status,200);
 assert.equal((await fetch(root+'/api/energy/files/'+b.body.dataset.id+'/histogram')).status,400);
 await fetch(root+'/api/session/new',{method:'POST'});
 const reset=await(await fetch(root+'/api/energy/files')).json();assert.equal(reset.datasets.length,0);assert.equal(reset.activeId,null);
 assert.equal((await upload('2280,1,148','stale.lst',original.sessionId)).status,409);
 const home=await(await fetch(root+'/')).text();assert.match(home,/href="\/energy.html"/);
 assert.equal((await fetch(root+'/energy.html')).status,200);
});
