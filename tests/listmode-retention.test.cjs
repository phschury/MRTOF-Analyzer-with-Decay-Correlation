const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseListModeText}=require('../listmode');

// 5b timestamps use 100 ps bins; TAG parity selects the ejection time.
function event(tag,tof,sweep=1,channel=1,edge=1){
 return ((BigInt(tag)<<48n)|(BigInt(sweep)<<32n)|(BigInt(tof)<<4n)|(BigInt(edge)<<3n)|BigInt(channel)).toString(16).padStart(16,'0');
}
function file(events,ejections='cmline2=TP:0,100,300'){
 return ['time_patch=5b',ejections,'[DATA]',...events].join('\n');
}
function assertCompact(events){
 for(const key of ['tof','sweep','rawSweep','tag','channel','edge']){
  assert.equal(events[key].buffer.byteLength,events.length*events[key].BYTES_PER_ELEMENT,key);
 }
 assert.equal(events.raw.length,events.length);
}

test('retention cutoff is inclusive and relative to each TAG ejection, including channel-offset TAGs',()=>{
 const text=file([event(0,1005000),event(0,1125000),event(0,1125001),event(1,3125000),event(1,3125001),event(2,1125000)]);
 const lm=parseListModeText(text,{ejectionBreakUs:12.5});
 assert.deepEqual([...lm.events.tof],[1005000,1125000,3125000,1125000]);
 assert.deepEqual([...lm.events.tag],[2,2,3,4]);
 assert.equal(lm.stats.rejectedByEjectWindow,2);
 assert.equal(lm.stats.acceptedEvents,4);
 assertCompact(lm.events);
});

test('cutoff can increase beyond 40 us, defaults to 40 us, and preserves channel/edge filtering',()=>{
 const text=file([event(0,1400000),event(0,1400001),event(0,1550000),event(0,1550001),event(0,1500000,1,2),event(0,1500000,1,1,0)]);
 assert.deepEqual([...parseListModeText(text).events.tof],[1400000]);
 const lm=parseListModeText(text,{ejectionBreakUs:55,channel:1,edge:1});
 assert.deepEqual([...lm.events.tof],[1400000,1400001,1550000]);
 assert.equal(lm.stats.rejectedByChannel,1);
 assert.equal(lm.stats.rejectedByEdge,1);
 assertCompact(lm.events);
 assert.equal(parseListModeText(text,1,1).events.length,1);
});

test('empty retained arrays release buffers and missing ejection metadata retains existing behavior',()=>{
 const text=file([event(0,1500000)]);
 assertCompact(parseListModeText(text,{ejectionBreakUs:10}).events);
 assert.equal(parseListModeText(file([event(0,1500000)],''),{ejectionBreakUs:10}).events.length,1);
 for(const ejectionBreakUs of [0,-1,Infinity,NaN,'invalid',null,'']){
  assert.throws(()=>parseListModeText(text,{ejectionBreakUs}),/positive finite/);
 }
});

test('upload uses the current saved ejection break preference',async t=>{
 const store=require('../preferences');
 const originalSave=store.save;
 // Exercise the preferences API without changing the user's XML file.
 store.save=values=>store.validate(values);
 t.after(()=>{store.save=originalSave});
 const {app}=require('../main');
 const server=app.listen(0,'127.0.0.1');
 await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
 t.after(()=>{server.closeAllConnections();server.close()});
 const root=`http://127.0.0.1:${server.address().port}`;
 for(const [cutoff,expected] of [[12.5,1],[55,3]]){
  const saved=await fetch(root+'/api/preferences',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...store.DEFAULTS,ejectionBreakUs:cutoff})});
  assert.equal(saved.status,200);
  const uploaded=await fetch(root+'/api/listmode-file',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file([event(0,1125000),event(0,1400001),event(0,1550000)])});
  assert.equal(uploaded.status,200);
  const {datasetId}=await uploaded.json();
  const response=await fetch(root+'/api/histogram?datasetId='+datasetId+'&tag=2&tofLowUs=0&tofHighUs=60');
  assert.equal(response.status,200);
  const histogram=await response.json();
  assert.equal(histogram.parserStats.acceptedEvents,expected);
  assert.equal(histogram.histogram.acceptedEvents,expected);
 }
});
