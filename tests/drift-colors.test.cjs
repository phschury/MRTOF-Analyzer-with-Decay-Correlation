const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
async function render(mode,z=[[0,1,10,100]]){
 const elements={};for(const id of ['status','source','sweepBinWidth','driftControls'])elements[id]={value:'',addEventListener(){}};
 const grid={ok:true,z,x:[0,1,2,3,4],y:[0,1],filename:'test',settings:{channel:2,edge:1,tag:3,tofLowUs:0,tofHighUs:4},sweepBinWidth:1,rows:1,columns:4,acceptedEvents:111};
 let trace;
 const context=vm.createContext({URLSearchParams,AbortController,
  window:{location:{search:'?yScale='+mode,origin:'http://localhost:3000'},parent:{postMessage(){}},addEventListener(){}},
  document:{getElementById:id=>elements[id]},fetch:async()=>({ok:true,json:async()=>grid}),
  Plotly:{react:async(id,traces)=>{trace=traces[0]},purge(){}},
 });
 vm.runInContext(fs.readFileSync('public/js/drift.js','utf8'),context);
 await vm.runInContext('loadDrift()',context);
 return {trace,elements,grid};
}
test('logarithmic heatmap transforms positive colors and retains raw counts for hover',async()=>{
 const {trace,elements,grid}=await render('logarithmic');
 assert.deepEqual(JSON.parse(JSON.stringify(trace.z)),[[null,0,1,2]]);
 assert.deepEqual(trace.customdata,grid.z);
 assert.deepEqual(JSON.parse(JSON.stringify(trace.colorbar.ticktext)),['1','10','100']);
 assert.match(trace.hovertemplate,/%\{customdata\}/);
 assert.match(elements.status.textContent,/zero-count cells are blank/);
 assert.deepEqual(grid.z,[[0,1,10,100]]);
});
test('linear colors keep zero cells and raw values',async()=>{
 const {trace}=await render('linear');assert.deepEqual(trace.z,[[0,1,10,100]]);
 assert.equal(trace.zmax,undefined);assert.equal(trace.colorbar.title.text,'Events / cell');
});
test('logarithmic colors handle empty and one-count grids without infinities',async()=>{
 for(const z of [[[0,0]],[[0,1]]]){
  const {trace}=await render('logarithmic',z);
  assert.ok(trace.z.flat().every(value=>value===null||Number.isFinite(value)));
  assert.ok(Number.isFinite(trace.zmax)&&trace.zmax>trace.zmin);
 }
});

test('heatmap axis uses absolute center in nanoseconds rounded to 100 ps with matching offsets',()=>{
 const context=vm.createContext({URLSearchParams,
  window:{location:{search:'',origin:'http://localhost:3000'},parent:{postMessage(){}},addEventListener(){}},
  document:{getElementById:id=>id==='driftTag'?null:({value:'',addEventListener(){}})}});
 vm.runInContext(fs.readFileSync('public/js/drift.js','utf8'),context);
 const axis=JSON.parse(vm.runInContext('JSON.stringify(driftTimeAxis(7.000064,9.000064,27072.172))',context));
 assert.equal(axis.title.text,'ToF - 27080172.1 [ns]');
 assert.ok(axis.ticktext.includes('0'));
 for(let i=0;i<axis.tickvals.length;i++){
  assert.ok(Math.abs((axis.tickvals[i]+27072.172)*1000-27080172.1-Number(axis.ticktext[i]))<1e-5);
 }
 const zoomed=JSON.parse(vm.runInContext('JSON.stringify(driftTimeAxis(7.8,8,27072.172))',context));
 assert.equal(zoomed.title.text,'ToF - 27080072.0 [ns]');
});
