const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fitSweepTranches}=require('../drift-fit');
function synthetic(){
 const tof=[],sweep=[];
 for(const [sw,center]of [[1000,0.4],[6000,0.45],[11000,0.5]]) {
  for(let i=0;i<100;i++) {
   const x=(i+0.5)*0.01,n=Math.round(2+80*Math.exp(-0.5*((x-center)/0.05)**2));
   for(let k=0;k<n;k++){tof.push(100000+(i+0.5)*100);sweep.push(sw)}
  }
 }
 return {events:{length:tof.length,tof,sweep},ejectBin:100000,sweepLow:1000,sweepHigh:12000,tofLowUs:0,tofHighUs:1,binWidth:100};
}
test('fits sequential 5000-sweep tranches including a partial final tranche',()=>{
 const request=synthetic(),r=fitSweepTranches(request);
 assert.equal(r.successful,3);
 assert.deepEqual(r.results.map(row=>[row.sweepLow,row.sweepHigh]),[[1000,6000],[6000,11000],[11000,12000]]);
 assert.equal(r.results.reduce((sum,row)=>sum+row.counts,0),request.events.length);
 r.results.forEach((row,i)=>{assert.ok(Math.abs(row.centerUs-(0.4+i*0.05))<0.001);assert.ok(row.centerSigmaUs>0)});
});
test('empty tranche remains failed without stopping subsequent fits',()=>{
 const request=synthetic();
 for(let i=0;i<request.events.length;i++)if(request.events.sweep[i]===6000)request.events.sweep[i]=-1;
 const r=fitSweepTranches(request);
 assert.equal(r.successful,2);assert.equal(r.results[1].success,false);assert.match(r.results[1].error,/No events/);
 assert.equal(r.results[2].success,true);
});
test('sweep endpoints are exclusive and events outside ROI are excluded',()=>{
 const q=synthetic();q.events={length:6,tof:[100050,100050,100050,100050,110050,99950],sweep:[5999,6000,10999,11000,1000,1000]};
 const r=fitSweepTranches(q);assert.deepEqual(r.results.map(row=>row.counts),[1,2,1]);
});
test('rejects an ROI too narrow for fitting',()=>{
 const q=synthetic();q.tofHighUs=0.01;assert.throws(()=>fitSweepTranches(q),/6 TOF bins/);
});

test('honors a custom tranche size with a partial final tranche',()=>{
 const q=synthetic();q.trancheSize=4000;
 const r=fitSweepTranches(q);
 assert.equal(r.trancheSize,4000);
 assert.deepEqual(r.results.map(row=>[row.sweepLow,row.sweepHigh]),[[1000,5000],[5000,9000],[9000,12000]]);
 assert.equal(r.results.reduce((sum,row)=>sum+row.counts,0),q.events.length);
});
test('rejects invalid tranche sizes',()=>{
 for(const trancheSize of [0,-1,1.5,Infinity,NaN,'5000',null,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>fitSweepTranches({...synthetic(),trancheSize}),/Tranche size/);
});

test('fits a 2,496,856-sweep run with more than 2,000 tranches',()=>{
 const q={...synthetic(),sweepLow:0,sweepHigh:2496856,trancheSize:1000};
 const r=fitSweepTranches(q);
 assert.equal(r.results.length,2497);
 assert.equal(r.successful,3);
 assert.equal(r.results.at(-1).sweepHigh,2496856);
 assert.equal(r.results.reduce((sum,row)=>sum+row.counts,0),q.events.length);
});

test('allows more than two million total histogram bins',()=>{
 const q={...synthetic(),sweepLow:0,sweepHigh:2496856,binWidth:2};
 const r=fitSweepTranches(q);
 assert.equal(r.results.length,500);
 assert.equal(r.successful,3);
 assert.equal(r.results.reduce((sum,row)=>sum+row.counts,0),q.events.length);
});

test('resource limits explain which setting can reduce the request',()=>{
 const q={...synthetic(),events:{length:0,tof:[],sweep:[]}};
 assert.throws(()=>fitSweepTranches({...q,tofHighUs:1001}),/fit bins per tranche.*Bin Width/);
 assert.throws(()=>fitSweepTranches({...q,sweepLow:0,sweepHigh:20001,trancheSize:1}),/sweep tranches.*Slice/);
 assert.throws(()=>fitSweepTranches({...q,sweepLow:0,sweepHigh:16250000,binWidth:1}),/total fit bins.*Slice or Bin Width/);
});

test('drift fits and correction cross long empty acquisition gaps without aborting',()=>{
 const q=synthetic();
 for(let i=0;i<q.events.length;i++)q.events.sweep[i]=q.events.sweep[i]===1000?1000:q.events.sweep[i]===6000?41000:81000;
 q.sweepHigh=82000;
 const fit=fitSweepTranches(q);
 assert.equal(fit.successful,3);assert.equal(fit.emptyTranches,14);
 assert.ok(fit.results.filter(row=>row.empty).every(row=>row.counts===0 && !row.success));
 const lm={events:{...q.events,tag:new Int32Array(q.events.length),channel:new Int16Array(q.events.length),edge:new Int8Array(q.events.length)}};
 const {lm:corrected,correction}=require('../drift-correction').makeDriftCorrectedData(lm,fit);
 assert.equal(corrected.events.length,q.events.length);assert.equal(correction.emptyTranches,14);
 assert.equal(correction.failedTranches,0);assert.equal(correction.discardedEvents,0);assert.equal(correction.maxConsecutiveFailedSweeps,0);
 assert.equal(corrected.events.sweep.at(-1),81000);
});
