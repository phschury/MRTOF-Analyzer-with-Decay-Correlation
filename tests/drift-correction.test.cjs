const {test}=require('node:test');
const assert=require('node:assert/strict');
const {makeDriftCorrectedData}=require('../drift-correction');
function fixture(){
 const lm={ejectBins:[20,30],stats:{acceptedEvents:7},events:{length:7,
   tof:new Float64Array([5,100,999,20,110,1000,42]),sweep:new Int32Array([0,4999,1,5000,9999,5001,10000]),
   tag:new Int32Array([2,3,2,3,2,3,2]),channel:new Int16Array([2,2,12,12,2,2,12]),
   edge:new Int8Array([1,0,1,0,1,1,1]),raw:['a','b','c','d','e','f','g']}};
 const fit={trancheSize:5000,settings:{sweepLow:0,sweepHigh:10000},results:[
   {sweepLow:0,sweepHigh:5000,success:true,params:{center:{value:100}}},
   {sweepLow:5000,sweepHigh:10000,success:true,params:{center:{value:110}}},
 ]};return {lm,fit};
}
test('retains all events and metadata; first tranche is unchanged; subsequent absolute TOFs use first/current',()=>{
 const {lm,fit}=fixture();const original=Array.from(lm.events.tof);
 const r=makeDriftCorrectedData(lm,fit);
 assert.equal(r.lm.events.length,7);assert.deepEqual(Array.from(r.lm.events.tof.slice(0,3)),original.slice(0,3));
 for(const index of [3,4,5])assert.ok(Math.abs(r.lm.events.tof[index]-original[index]*100/110)<1e-10);
 assert.equal(r.lm.events.tof[6],42); // outside requested sweep range
 assert.deepEqual(Array.from(lm.events.tof),original);assert.notEqual(r.lm.events.tof,lm.events.tof);
 for(const key of ['sweep','tag','channel','edge','raw'])assert.deepEqual(r.lm.events[key],lm.events[key]);
 assert.equal(r.correction.referenceEvents,3);assert.equal(r.correction.scaledEvents,3);assert.equal(r.correction.outsideEvents,1);
 assert.equal(r.lm.events.tof[4],100); // 110 peak aligned to the 100 reference
});
test('failed later tranche discards every event across all TAGs and channels',()=>{
 const {lm,fit}=fixture();fit.results[1]={...fit.results[1],success:false,error:'No convergence'};
 const r=makeDriftCorrectedData(lm,fit);
 assert.deepEqual(Array.from(r.lm.events.tof),[5,100,999,42]);
 assert.equal(r.lm.events.length,4);
 assert.deepEqual(Array.from(r.lm.events.sweep),[0,4999,1,10000]);
 assert.deepEqual(Array.from(r.lm.events.tag),[2,3,2,2]);
 assert.deepEqual(Array.from(r.lm.events.channel),[2,2,12,12]);
 assert.deepEqual(r.lm.events.raw,['a','b','c','g']);
 assert.equal(r.lm.stats.acceptedEvents,4);
 assert.equal(lm.events.length,7);assert.equal(lm.stats.acceptedEvents,7);
 assert.equal(r.correction.discardedEvents,3);assert.equal(r.correction.failedTranches,1);
});
test('failed initial tranche is discarded and the first successful tranche becomes the reference',()=>{
 const {lm,fit}=fixture();fit.results[0].success=false;
 const r=makeDriftCorrectedData(lm,fit);
 assert.deepEqual(Array.from(r.lm.events.tof),[20,110,1000,42]);
 assert.equal(r.correction.referenceTranche,1);assert.equal(r.correction.referenceTofUs,110);
 assert.equal(r.correction.discardedEvents,3);assert.equal(r.correction.referenceEvents,3);
});
test('no successful tranche prevents creation even below the failure-span limit',()=>{
 const {lm,fit}=fixture();fit.results.forEach(row=>row.success=false);
 assert.throws(()=>makeDriftCorrectedData(lm,fit),/no successful tranche/);
});
test('partial final tranche and nonzero starting sweep preserve events outside range',()=>{
 const {lm,fit}=fixture();fit.settings={sweepLow:5000,sweepHigh:10001};
 fit.results=[{sweepLow:5000,sweepHigh:10000,success:true,params:{center:{value:110}}},
 {sweepLow:10000,sweepHigh:10001,success:true,params:{center:{value:100}}}];
 const r=makeDriftCorrectedData(lm,fit);
 assert.deepEqual(Array.from(r.lm.events.tof.slice(0,6)),Array.from(lm.events.tof.slice(0,6)));
 assert.equal(r.lm.events.tof[6],42*1.1);
});

function failureRun(states,trancheSize=8192,lastSize=trancheSize){
 const rows=[];let next=0;
 for(let i=0;i<states.length;i++){
  const high=next+(i===states.length-1?lastSize:trancheSize);
  rows.push({sweepLow:next,sweepHigh:high,success:states[i],params:{center:{value:100}}});next=high;
 }
 return {trancheSize,settings:{sweepLow:0,sweepHigh:next},results:rows};
}
const empty={events:{length:0,tof:new Float64Array(),sweep:new Int32Array(),tag:new Int32Array(),channel:new Int16Array(),edge:new Int8Array()}};
test('exactly 32768 consecutive failed sweeps is allowed even with no events',()=>{
 const r=makeDriftCorrectedData(empty,failureRun([true,false,false,false,false]));
 assert.equal(r.correction.maxConsecutiveFailedSweeps,32768);
});
test('32769 consecutive failed sweeps aborts correction, counting a partial final tranche',()=>{
 assert.throws(()=>makeDriftCorrectedData(empty,failureRun([true,false,false,false,false,false],8192,1)),/32769.*32768/);
});
test('a successful tranche resets the failure streak',()=>{
 const r=makeDriftCorrectedData(empty,failureRun([true,false,false,false,false,true,false,false,false,false]));
 assert.equal(r.correction.failedTranches,8);
 assert.equal(r.correction.maxConsecutiveFailedSweeps,32768);
});
test('scaling applies across every TAG, channel, and edge, including events outside fit ROI',()=>{
 const lm={events:{length:6,tof:new Float64Array([100,200,300,400,500,600]),
  sweep:new Int32Array([0,5000,5000,5000,5000,5000]),
  tag:new Int32Array([3,0,1,2,3,7]),channel:new Int16Array([2,2,2,12,12,1]),edge:new Int8Array([1,0,1,0,1,0])}};
 const {fit}=fixture();const r=makeDriftCorrectedData(lm,fit);
 assert.equal(r.lm.events.tof[0],100);
 for(let i=1;i<6;i++)assert.ok(Math.abs(r.lm.events.tof[i]-lm.events.tof[i]*(100/110))<1e-10);
 assert.deepEqual(Array.from(r.lm.events.tag),[3,0,1,2,3,7]);
 assert.equal(r.correction.scaledEvents,5);
});

test('an empty fitting ROI with events elsewhere still counts towards the failed-sweep limit',()=>{
 const fit=failureRun([true,false,false,false,false,false]);
 fit.results.forEach(row=>{if(!row.success){row.empty=true;row.counts=0;}});
 const lm={events:{length:5,sweep:Int32Array.from([8192,16384,24576,32768,40960]),tof:new Float64Array(5)}};
 assert.throws(()=>makeDriftCorrectedData(lm,fit),/exceeding/);
});
