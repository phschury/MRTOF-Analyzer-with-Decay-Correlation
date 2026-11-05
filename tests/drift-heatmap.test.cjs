const {test}=require('node:test');
const assert=require('node:assert/strict');
const {makeDriftHeatmap}=require('../drift');
test('automatic overview respects cell budget with fine TOF bins; explicit row sizes remain explicit',()=>{
 const lm={ejectBins:[0,100000],events:{channel:[],edge:[],tag:[],sweep:[],tof:[],length:0}};
 const options={channel:2,edge:1,tag:3,binWidth:80,tofLowUs:0,tofHighUs:40,sweepLow:0,sweepHigh:125870};
 const result=makeDriftHeatmap(lm,options);
 assert.equal(result.columns,5000);
 assert.ok(result.columns*result.rows<=2000000);
 assert.equal(result.sweepBinWidth,315);
 assert.throws(()=>makeDriftHeatmap(lm,{...options,sweepBinWidth:1}),/Heatmap too large/);
});
