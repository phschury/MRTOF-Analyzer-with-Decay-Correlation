const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {createWorkspaceSession}=require('../workspace-session');
const {workspaceChanges}=require('../public/js/workspace-state');
function viewer(){
 const fields={channel:'2',edge:'1',tag:'3',driftCorrectionTag:'3',binWidth:'80',binWidthNs:'8',plotWidthUs:'22.5',tofLowUs:'2.5',tofHighUs:'25',yScale:'linear',timeMode:'absolute',sliceInput:'5000'};
 const elements=Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,{value}]));
 const listeners=[];
 const context=vm.createContext({window:{location:{origin:'http://localhost:3000'},addEventListener(name,fn){if(name==='message')listeners.push(fn)}},document:{addEventListener(){},getElementById:id=>elements[id]}});
 vm.runInContext(fs.readFileSync('public/js/histogram-page.js','utf8'),context);
 vm.runInContext(`loadedFileStates=[{datasetId:'a',settings:null},{datasetId:'b',settings:null}];activeFileStateIndex=0;
 plottedTags=new Map([[2,{chartData:{datasets:[{ejectUs:27072.172}]}}]]);`,context);
 const run=code=>vm.runInContext(code,context);
 return {run,context,elements,listeners,read:code=>JSON.parse(run('JSON.stringify('+code+')'))};
}
test('accepting correction selects it at the latest parent viewport, including when already broadcast',async()=>{
 for(const mode of ['absolute','relative'])for(const broadcast of [false,true]){
  const v=viewer();v.elements.timeMode.value=mode;
  const frame={contentWindow:{}};
  v.context.document.querySelector=()=>frame;
  v.context.taskDepth=0;
  v.context.workspaceSession={localTask:async task=>{v.context.taskDepth++;try{return await task()}finally{v.context.taskDepth--}}};
  v.run(`loadedFileStates.splice(1);visibleTofRange();
   chart={layout:{xaxis:{range:[52.123456789,52.234567891]}}};
   chartViewContext={datasetId:'a',mode:document.getElementById('timeMode').value,relativeKey:JSON.stringify(relativeTofRange())};
   restoreLoadedFileState=async index=>{
    if(!taskDepth)throw new Error('Selection must be protected from workspace broadcasts');
    saveCurrentViewerState();activeFileStateIndex=index;applyViewerSettings(loadedFileStates[index].settings);
   };`);
  if(broadcast)v.run(`loadedFileStates.push({datasetId:'corrected',settings:{timeMode:'relative',tofLowUs:'12',tofHighUs:'16'},fits:[],sweepRange:null,roi:{lowUs:7,highUs:8}})`);
  const dataset={id:'corrected',parentId:'a',filename:'corrected.lst',kind:'drift-corrected',
   viewerSettings:{timeMode:'relative',tofLowUs:'12',tofHighUs:'16',absoluteViewRange:null},
   fitSettings:{channel:2,edge:1,tag:3,binWidth:80,tofLowUs:7,tofHighUs:8}};
  await Promise.all(v.listeners.map(fn=>fn({origin:'http://localhost:3000',source:frame.contentWindow,data:{type:'drift-corrected-dataset',dataset}})));
  assert.equal(v.run('activeFileStateIndex'),1);
  assert.equal(v.run('loadedFileStates.length'),2);
  assert.equal(v.run('loadedFileStates[0].datasetId'),'a');
  assert.deepEqual(v.read('visibleTofRange()'),{min:52.123456789,max:52.234567891});
  assert.equal(v.elements.timeMode.value,mode);
  assert.deepEqual(v.read('loadedFileStates[1].roi'),{lowUs:7,highUs:8});
  assert.equal(v.run('loadedFileStates[1].settings.binWidth'),'80');
  v.run(`if(loadedFileStates[1].settings.absoluteViewRange)loadedFileStates[1].settings.absoluteViewRange.min=99`);
  if(mode==='absolute')assert.equal(v.run('loadedFileStates[0].settings.absoluteViewRange.min'),52.123456789);
 }
});
test('each spectrum retains its own absolute zoom through selection and partial TAG reloads',()=>{
 const v=viewer();
 v.run(`visibleTofRange(); absoluteViewRange={min:7.832123456,max:7.955987654};saveCurrentViewerState();`);
 const a=v.read('loadedFileStates[0].settings');
 assert.deepEqual(a.absoluteViewRange,{min:7.832123456,max:7.955987654});
 v.run(`activeFileStateIndex=1;applyViewerSettings({tofLowUs:'12',tofHighUs:'16',timeMode:'absolute'});visibleTofRange();absoluteViewRange={min:50.25,max:50.75};saveCurrentViewerState();`);
 v.run(`activeFileStateIndex=0;applyViewerSettings(loadedFileStates[0].settings);plottedTags.clear();plottedTags.set(2,{chartData:{datasets:[{ejectUs:27072.172}]}});`);
 assert.deepEqual(v.read('visibleTofRange()'),a.absoluteViewRange);
 v.run(`plottedTags.set(3,{chartData:{datasets:[{ejectUs:30885.159}]}});`);
 assert.deepEqual(v.read('visibleTofRange()'),a.absoluteViewRange);
 v.run(`activeFileStateIndex=1;applyViewerSettings(loadedFileStates[1].settings)`);
 assert.deepEqual(v.read('visibleTofRange()'),{min:50.25,max:50.75});
});
test('saved absolute range survives server workspace round-trip and a fresh viewer',()=>{
 const v=viewer();v.run('visibleTofRange();absoluteViewRange={min:7.833,max:7.955};saveCurrentViewerState()');
 const saved=v.read('loadedFileStates[0]');
 const datasets=new Map([['a',{id:'a',filename:'test.lst',viewerState:{datasetId:'a',settings:{}}}]]);
 let active='a';const session=createWorkspaceSession({datasets,runs:new Map(),getActive:()=>active,setActive:id=>active=id});
 const initial=session.snapshot();session.update({sessionId:initial.sessionId,changes:workspaceChanges(initial.states,[saved])});
 const restored=session.snapshot().states[0];
 const fresh=viewer();fresh.context.saved=restored;
 fresh.run('loadedFileStates=[saved];activeFileStateIndex=0;applyViewerSettings(saved.settings)');
 assert.deepEqual(fresh.read('visibleTofRange()'),{min:7.833,max:7.955});
});
test('relative range precision is retained across saves and restores',()=>{
 const v=viewer();v.elements.timeMode.value='relative';v.elements.tofLowUs.value='7.833123456';v.elements.tofHighUs.value='7.955987654';
 v.run('saveCurrentViewerState();resetVisibleTofRange();restoreVisibleTofRange()');
 assert.equal(v.elements.tofLowUs.value,'7.833123456');assert.equal(v.elements.tofHighUs.value,'7.955987654');
});
test('pan and zoom stop at ejection in either time mode without limiting the upper range',()=>{
 for(const mode of ['relative','absolute']){
  const v=viewer();v.elements.timeMode.value=mode;
  v.context.Plotly={relayout:()=>{}};
  v.run('drawCombinedChart=()=>{};chart={clientWidth:800};globalMaxRangeUs=1000');
  v.run('applyVisibleTofRange(-5,15)');
  assert.deepEqual(v.read('visibleTofRange()'),{min:0,max:20});
  v.run('panVisibleTofRange(-800)');
  assert.deepEqual(v.read('visibleTofRange()'),{min:0,max:20});
  v.run('zoomOutByHalfRange()');
  assert.deepEqual(v.read('visibleTofRange()'),{min:0,max:40});
  v.run('zoomOutByTenthRange()');
  assert.deepEqual(v.read('visibleTofRange()'),{min:0,max:48});
  v.run('applyVisibleTofRange(100,200)');
  assert.deepEqual(v.read('visibleTofRange()'),{min:100,max:200});
 }
});
test('restored ranges before ejection are bounded in both time modes',()=>{
 const v=viewer();
 v.run(`loadedFileStates[0].settings={absoluteViewRange:{min:-10,max:30}}`);
 assert.deepEqual(v.read('visibleTofRange()'),{min:0,max:40});
 v.elements.timeMode.value='relative';v.elements.tofLowUs.value='-5';v.elements.tofHighUs.value='15';
 assert.deepEqual(v.read('visibleTofRange()'),{min:0,max:20});
});
test('server rejects nonfinite and reversed persisted ranges',()=>{
 const {applyWorkspaceChanges}=require('../public/js/workspace-state');
 for(const range of [{min:NaN,max:1},{min:2,max:1},{min:0,max:Infinity}]){
  assert.throws(()=>applyWorkspaceChanges([{datasetId:'a'}],[{datasetId:'a',settings:{absoluteViewRange:range}}]),/X-axis range/);
 }
});
test('save captures the displayed Plotly viewport rather than the original range',()=>{
 const v=viewer();
 v.run(`visibleTofRange();absoluteViewRange={min:12,max:16};
 chart={layout:{xaxis:{range:[13.123456,13.234567]}}};
 chartViewContext={datasetId:'a',mode:'absolute',relativeKey:JSON.stringify(relativeTofRange())};
 saveCurrentViewerState();`);
 assert.deepEqual(v.read('loadedFileStates[0].settings.absoluteViewRange'),{min:13.123456,max:13.234567});
 v.run(`activeFileStateIndex=1;applyViewerSettings({timeMode:'absolute',tofLowUs:'12',tofHighUs:'16'});saveCurrentViewerState()`);
 assert.equal(v.read('loadedFileStates[1].settings.absoluteViewRange'),null);
 v.run(`activeFileStateIndex=0;applyViewerSettings(loadedFileStates[0].settings)`);
 assert.deepEqual(v.read('visibleTofRange()'),{min:13.123456,max:13.234567});
});
test('relative Plotly viewport is saved with full precision',()=>{
 const v=viewer();
 v.run(`document.getElementById('timeMode').value='relative';
 chart={layout:{xaxis:{range:[7.123456789,7.234567891]}}};
 chartViewContext={datasetId:'a',mode:'relative',relativeKey:JSON.stringify(relativeTofRange())};saveCurrentViewerState()`);
 assert.equal(v.read('loadedFileStates[0].settings.tofLowUs'),'7.123456789');
 assert.equal(v.read('loadedFileStates[0].settings.tofHighUs'),'7.234567891');
});
test('opening the drift heatmap retains the displayed viewport for subsequent redraws in either mode',()=>{
 for(const mode of ['absolute','relative']){
  const v=viewer();v.elements.timeMode.value=mode;
  const frame={getAttribute:()=>'/drift.html'};
  const popup={querySelector:()=>frame};
  v.elements.driftWindow=popup;
  v.context.URLSearchParams=URLSearchParams;
  v.run(`driftViewerParams=()=>new URLSearchParams({datasetId:'a'});
   syncDriftWindow=()=>{};scheduleWorkspaceSave=()=>{};
   visibleTofRange();chart={layout:{xaxis:{range:[7.123456789,7.234567891]}}};
   chartViewContext={datasetId:'a',mode:document.getElementById('timeMode').value,relativeKey:JSON.stringify(relativeTofRange())};
   showDrift();`);
  // A popup close removes its DOM only. A later workspace or layout redraw
  // must still use the actual viewport, even if relayout state was stale.
  delete v.elements.driftWindow;
  assert.deepEqual(v.read('visibleTofRange()'),{min:7.123456789,max:7.234567891});
  assert.equal(v.elements.plotWidthUs.value,'0.1111');
  const saved=v.read('loadedFileStates[0].settings');
  if(mode==='absolute')assert.deepEqual(saved.absoluteViewRange,{min:7.123456789,max:7.234567891});
  else {
   assert.equal(saved.tofLowUs,'7.123456789');
   assert.equal(saved.tofHighUs,'7.234567891');
  }
  // Retaining the opening range must not freeze later navigation.
  v.context.Plotly={relayout(){}};
  v.run('drawCombinedChart=()=>{};applyVisibleTofRange(10,11)');
  assert.deepEqual(v.read('visibleTofRange()'),{min:10,max:11});
 }
});
test('retaining a popup viewport ignores a chart belonging to a different dataset or view',()=>{
 const v=viewer();
 v.run(`visibleTofRange();chart={layout:{xaxis:{range:[7,8]}}};
  chartViewContext={datasetId:'b',mode:'absolute',relativeKey:JSON.stringify(relativeTofRange())};
  retainDisplayedTofRange()`);
 assert.deepEqual(v.read('visibleTofRange()'),{min:2.5,max:25});
 v.run(`chartViewContext.datasetId='a';chartViewContext.mode='relative';retainDisplayedTofRange()`);
 assert.deepEqual(v.read('visibleTofRange()'),{min:2.5,max:25});
 v.run(`chartViewContext.mode='absolute';chartViewContext.relativeKey='stale';retainDisplayedTofRange()`);
 assert.deepEqual(v.read('visibleTofRange()'),{min:2.5,max:25});
});
test('editing the ToF reference moves the absolute view without changing its width',()=>{
 const v=viewer();
 v.run('drawCombinedChart=()=>{};visibleTofRange();absoluteViewRange={min:12,max:16}');
 v.run('navigateTofReference(27088172,"ns",27086172)');
 const range=v.read('visibleTofRange()');
 assert.ok(Math.abs(range.min-14)<1e-8);
 assert.ok(Math.abs(range.max-18)<1e-8);
 v.run('navigateTofReference(NaN,"ns",27088172)');
 assert.deepEqual(v.read('visibleTofRange()'),range);
 v.run('navigateTofReference(0,"ns",27088172)');
 assert.deepEqual(v.read('visibleTofRange()'),{min:0,max:4});
});
test('editing the reference can navigate between separated TAGs in either axis unit',()=>{
 const v=viewer();
 v.run(`drawCombinedChart=()=>{};plottedTags=new Map([
 [0,{chartData:{datasets:[{ejectUs:100}]}}],[1,{chartData:{datasets:[{ejectUs:300}]}}]]);
 visibleTofRange();absoluteViewRange={min:12,max:16};`);
 const offset=v.run('FULL_TOF_HIGH_US+breakGapUs()');
 v.run('navigateTofReference(314000,"ns",114000)');
 let range=v.read('visibleTofRange()');
 assert.ok(Math.abs(range.min-(offset+12))<1e-8);
 assert.ok(Math.abs(range.max-(offset+16))<1e-8);
 v.run('navigateTofReference(114000,"ns",314000)');
 range=v.read('visibleTofRange()');
 assert.ok(Math.abs(range.min-12)<1e-8);
 assert.ok(Math.abs(range.max-16)<1e-8);
 v.run('absoluteViewRange={min:0,max:80};navigateTofReference(110,"µs",100)');
 assert.deepEqual(v.read('visibleTofRange()'),{min:10,max:90});
});

test('plot width resizes around the viewport center in both modes and survives restoration',()=>{
 for(const mode of ['relative','absolute']){
  const v=viewer();v.elements.timeMode.value=mode;
  v.run('drawCombinedChart=()=>{};scheduleWorkspaceSave=()=>{};applyVisibleTofRange(10,20)');
  const input=v.elements.plotWidthUs;
  input.setCustomValidity=message=>input.validationMessage=message;
  input.reportValidity=()=>{};
  assert.equal(input.value,'10.0000');
  input.value='4';v.run('applyPlotWidth()');
  assert.deepEqual(v.read('visibleTofRange()'),{min:13,max:17});
  v.run('saveCurrentViewerState();applyViewerSettings(loadedFileStates[0].settings)');
  assert.equal(input.value,'4.0000');
  input.value='40';v.run('applyPlotWidth()');
  assert.deepEqual(v.read('visibleTofRange()'),{min:0,max:40});
  assert.equal(input.value,'40.0000');
  for(const invalid of ['', '0', '-1', 'NaN', 'Infinity']){
   input.value=invalid;v.run('applyPlotWidth()');
   assert.ok(input.validationMessage);
   assert.deepEqual(v.read('visibleTofRange()'),{min:0,max:40});
  }
 }
});
test('plot width includes the full compressed axis across separated TAGs',()=>{
 const v=viewer();
 v.run(`plottedTags.set(3,{chartData:{datasets:[{ejectUs:30885.159}]}});syncPlotWidth()`);
 const range=v.read('visibleTofRange()');
 assert.equal(v.elements.plotWidthUs.value,(range.max-range.min).toFixed(4));
 assert.ok(Number(v.elements.plotWidthUs.value)>40);
});

test('a derived spectrum first loads at its parent displayed range in either mode',()=>{
 const {derivedViewerSettings}=require('../derived-viewer');
 for(const mode of ['absolute','relative']){
  const v=viewer();v.elements.timeMode.value=mode;
  v.run(`visibleTofRange();chart={layout:{xaxis:{range:[52.123456789,52.234567891]}}};
   chartViewContext={datasetId:'a',mode:document.getElementById('timeMode').value,relativeKey:JSON.stringify(relativeTofRange())};saveCurrentViewerState()`);
  v.context.inherited=derivedViewerSettings({id:'a',viewerState:{settings:v.read('loadedFileStates[0].settings')}});
  v.run(`loadedFileStates[1].settings=inherited;activeFileStateIndex=1;applyViewerSettings(inherited);
   plottedTags.clear();plottedTags.set(2,{chartData:{datasets:[{ejectUs:27072.172}]}})`);
  assert.deepEqual(v.read('visibleTofRange()'),{min:52.123456789,max:52.234567891});
 }
});
