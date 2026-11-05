const {test}=require('node:test');
const assert=require('node:assert/strict');
test('live correlation connections prevent removal of both spectra and reject bulk removal atomically',async t=>{
 const {app}=require('../main'),server=app.listen(0,'127.0.0.1');
 await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
 t.after(()=>{server.closeAllConnections();server.close()});const root=`http://127.0.0.1:${server.address().port}`;
 const request=async(path,body,method=body===undefined?'GET':'POST')=>{
  const res=await fetch(root+path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  return {status:res.status,body:await res.json()};
 };
 const upload=async(path,filename,text)=>{
  const res=await fetch(root+path,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':filename},body:text});assert.equal(res.status,200);return res.json();
 };
 const sessionId=(await request('/api/session')).body.sessionId;
 const parent=(await upload('/api/listmode-file','parent.lst','time_patch=1a\n[DATA]\n000000000641')).datasetId;
 const other=(await upload('/api/listmode-file','other.lst','time_patch=1a\n[DATA]\n000000000641')).datasetId;
 const a=(await upload('/api/energy/files','a.dat','1,11,150,0')).dataset.id;
 const b=(await upload('/api/energy/files','b.dat','1,11,150,0')).dataset.id;
 const connection=(id,tofDatasetId)=>request('/api/energy/files/'+id+'/tof-connection',{sessionId,tofDatasetId});
 assert.equal((await connection(a,parent)).status,200);assert.equal((await connection(b,parent)).status,200);
 let state=(await request('/api/session')).body;
 assert.match(state.states.find(ds=>ds.datasetId===parent).removalBlockedReason,/Disconnect/);
 const removeEnergy=await request('/api/energy/files/'+a,undefined,'DELETE');assert.equal(removeEnergy.status,400);assert.match(removeEnergy.body.error,/Disconnect/);
 const blocked=await request('/api/session',{sessionId,removeDatasetIds:[parent,other],changes:[{datasetId:other,settings:{binWidth:'1'}}]},'PATCH');
 assert.equal(blocked.status,400);assert.match(blocked.body.error,/Disconnect/);
 const unchanged=(await request('/api/session')).body;assert.deepEqual(unchanged,state);
 assert.equal((await connection(a,null)).status,200);
 assert.equal((await request('/api/energy/files/'+a,undefined,'DELETE')).status,200);
 assert.equal((await request('/api/session',{sessionId,removeDatasetIds:[parent]},'PATCH')).status,400);
 // Reconnecting the last linked energy spectrum unlocks the old ToF and locks the new one.
 assert.equal((await connection(b,other)).status,200);
 state=(await request('/api/session')).body;
 assert.equal(state.states.find(ds=>ds.datasetId===parent).removalBlockedReason,null);
 assert.match(state.states.find(ds=>ds.datasetId===other).removalBlockedReason,/Disconnect/);
 assert.equal((await request('/api/session',{sessionId,removeDatasetIds:[parent]},'PATCH')).status,200);
 assert.equal((await connection(b,null)).status,200);
 assert.equal((await request('/api/session')).body.states[0].removalBlockedReason,null);
 assert.equal((await request('/api/session',{sessionId,removeDatasetIds:[other]},'PATCH')).status,200);
 assert.equal((await request('/api/energy/files/'+b,undefined,'DELETE')).status,200);
});
