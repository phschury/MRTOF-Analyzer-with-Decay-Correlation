const {test}=require('node:test');
const assert=require('node:assert/strict');
const {request}=require('../public/js/energy-gaussian-fit');
const {fitPeak}=require('../fit-engine');
test('Energy ROI Gaussian fit recovers centroid and FWHM in ADC and calibrated units',()=>{
 for(const [gain,offset]of [[1,0],[2.5,-10]]){
  const x=Array.from({length:151},(_,i)=>(100+i)*gain+offset);
  const counts=x.map(v=>8+300*Math.exp(-0.5*((v-(175*gain+offset))/(8*gain))**2));
  const result=fitPeak(request({x,counts},110*gain+offset,240*gain+offset));
  assert.ok(Math.abs(result.params.center.value-(175*gain+offset))<1e-5);
  assert.ok(Math.abs(result.params.fwhm.value-2.3548200450309493*8*gain)<1e-5);
  assert.equal(result.uncertaintiesValid,true);
  assert.ok(result.params.center.sigma>0);
 }
});
test('Energy Gaussian fit rejects empty, short and flat ROIs',()=>{
 const x=Array.from({length:10},(_,i)=>i);
 assert.throws(()=>request({x,counts:x.map(()=>0)},0,9),/no events/);
 assert.throws(()=>request({x,counts:x},0,3),/6–100/);
 assert.throws(()=>request({x,counts:x.map(()=>2)},0,9),/no resolved peak/);
});
