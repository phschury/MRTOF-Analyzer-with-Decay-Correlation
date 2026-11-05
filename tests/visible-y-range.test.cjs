const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const context=vm.createContext({window:{addEventListener(){}},document:{addEventListener(){}}});
vm.runInContext(fs.readFileSync('public/js/histogram-page.js','utf8'),context);
function range(traces,low,high,log=false){context.traces=traces;context.range={min:low,max:high};context.log=log;return Array.from(vm.runInContext('visibleYRange(traces,range,log)',context))}
const step=(x,y)=>({x,y,line:{shape:'hvh'}});
test('visible histogram data determines Y maximum rather than the offscreen peak',()=>{
 assert.deepEqual(range([step([0,1,2,3],[10000,5,10,20000])],1,2),[0,11]);
});
test('empty, zero-only, hidden and nonfinite data use exact fallback ranges',()=>{
 for(const traces of [[],[step([0,1],[0,0])],[step([0,1],[NaN,null])],[{...step([0,1],[10,20]),visible:'legendonly'}]]){
  assert.deepEqual(range(traces,0,1),[0,1]);
  const log=range(traces,0,1,true);assert.equal(log[0],Math.log10(0.8));assert.equal(log[1],1);
 }
 assert.deepEqual(range([step([0,1],[5,10])],2,3),[0,1]);
});
test('logarithmic range fits positive visible data and ignores zeros',()=>{
 assert.deepEqual(range([step([0,1,2],[0,10,100])],0,2,true),[Math.log10(0.8),Math.log10(110)]);
 assert.deepEqual(range([step([0,1],[0.01,0.1])],0,1,true),[Math.log10(0.8),0]);
});
test('zooming inside a step uses the visible bin height without including the neighboring peak',()=>{
 assert.deepEqual(range([step([0,1],[5,10000])],0.1,0.4),[0,5.5]);
 assert.deepEqual(range([step([0,1],[5,10000])],0.6,0.8),[0,11000]);
});
test('partially visible fit curves use interpolated endpoints',()=>{
 assert.deepEqual(range([{x:[0,10],y:[0,100],line:{shape:'linear'}}],1,2),[0,22]);
});
test('multiple TAGs and visible fit overlays contribute to the range',()=>{
 assert.deepEqual(range([step([50,51],[4,8]),step([0,1],[1000,2000]),{x:[50,51],y:[10,20]}],50,51),[0,22]);
});

test('histogram zoom events update Y limits and preserve empty linear/log fallbacks',async()=>{
 const handlers={},plot={on:(name,fn)=>handlers[name]=fn,clientWidth:800};
 const elements={plotWidthUs:{value:''},histogramChart:plot,timeMode:{value:'relative'},tofLowUs:{value:'0'},tofHighUs:{value:'3'},yScale:{value:'linear'},binWidth:{value:'320'},tag:{value:'3'}};
 let layout;
 const c=vm.createContext({window:{addEventListener(){}},document:{addEventListener(){},getElementById:id=>elements[id]},
  Plotly:{react:async(p,traces,l)=>{p.data=traces;p.layout=l;layout=l}}});
 vm.runInContext(fs.readFileSync('public/js/histogram-page.js','utf8'),c);
 vm.runInContext(`scheduleWorkspaceSave=()=>{};updateDriftCorrectButton=()=>{};updateStatus=()=>{};syncDriftWindow=()=>{};
 activeFitPreview=null;plottedTags.set(3,{chartData:{datasets:[{TAGnum:3,ejectUs:10,data:[{x:0,y:10000},{x:1,y:5},{x:2,y:10},{x:3,y:20000}]}]}});drawCombinedChart()`,c);
 await Promise.resolve();
 assert.equal(layout.yaxis.range[1],22000);
 assert.equal(elements.plotWidthUs.value,'3.0000');
 handlers.plotly_relayout({'xaxis.range[0]':1,'xaxis.range[1]':2});await Promise.resolve();
 assert.deepEqual(Array.from(layout.yaxis.range),[0,11]);
 assert.equal(elements.plotWidthUs.value,'1.0000');
 handlers.plotly_relayout({'xaxis.range':[5,6]});await Promise.resolve();
 assert.deepEqual(Array.from(layout.yaxis.range),[0,1]);
 handlers.plotly_relayout({'xaxis.range':[5,7.5]});await Promise.resolve();
 assert.equal(elements.plotWidthUs.value,'2.5000');
 elements.timeMode.value='absolute';vm.runInContext('drawCombinedChart()',c);await Promise.resolve();
 handlers.plotly_relayout({'xaxis.range':[10,14.25123456]});await Promise.resolve();
 assert.equal(elements.plotWidthUs.value,'4.2512');
 elements.yScale.value='logarithmic';vm.runInContext('drawCombinedChart()',c);await Promise.resolve();
 assert.deepEqual(Array.from(layout.yaxis.range),[Math.log10(0.8),1]);
});
