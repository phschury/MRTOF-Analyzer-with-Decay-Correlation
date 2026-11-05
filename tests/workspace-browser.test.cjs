const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');
const {createWorkspaceSession}=require('../workspace-session');
const stateTools=require('../public/js/workspace-state');

function server(){
 const datasets=new Map([['a',{id:'a',filename:'sample.lst',viewerState:{settings:{binWidth:'40',tofLowUs:'12',tofHighUs:'13',sliceInput:'2000'},fits:[{id:'fit1',formula:'1Fr221'}],roi:{lowUs:12.1,highUs:12.2},sweepRange:null}}]]);
 let active='a';return createWorkspaceSession({datasets,runs:new Map(),getActive:()=>active,setActive:id=>active=id});
}
async function browser(session){
 const timers=new Map(),elements={};let nextTimer=0,stream,patches=0;
 const element=()=>({value:'',textContent:'',innerHTML:'',inert:false,addEventListener(){}});
 const context=vm.createContext({...stateTools,crypto:{randomUUID},
  setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer},clearTimeout:id=>timers.delete(id),
  document:{getElementById:id=>elements[id]??=element(),querySelector:selector=>elements[selector]??=element(),querySelectorAll:()=>[]},
  window:{addEventListener(){}},EventSource:class {constructor(){stream=this}},
  fetch:async(path,options)=>{
   let snapshot;
   if(options?.method==='PATCH'){patches++;snapshot=session.update(JSON.parse(options.body));}
   else snapshot=session.snapshot();
   return {ok:!!snapshot,status:snapshot?200:409,json:async()=>({ok:!!snapshot,...(snapshot||session.snapshot())})};
  },
 });
 vm.runInContext(`let loadedFileStates=[],activeFileStateIndex=-1,currentRoi=null,currentSweepRange=null,activeFitPreview=null,currentFitParams=null,lastSettingsKey=null,availableSweeps=null;let plottedTags=new Map();
 function saveCurrentViewerState(){}
 function cancelFitModal(){activeFitPreview=null}
 function setValueIfPresent(){}
 function drawCombinedChart(){}
 function renderLoadedFilesList(){}
 async function restoreLoadedFileState(index){activeFileStateIndex=index;currentRoi=loadedFileStates[index].roi;}
 `,context);
 vm.runInContext(fs.readFileSync('public/js/workspace-session.js','utf8'),context);
 await vm.runInContext('workspaceSession.start()',context);
 const settle=async()=>{
  for(let i=0;i<15;i++){
   await new Promise(resolve=>setImmediate(resolve));
   if(!timers.size)return;
   const pending=[...timers.values()];timers.clear();for(const fn of pending)await fn();
  }
  throw new Error('Workspace did not settle');
 };
 await settle();
 return {context,settle,patches:()=>patches,read:code=>vm.runInContext(code,context),edit:code=>vm.runInContext(code+';workspaceSession.schedule()',context),
 push:async state=>{stream.onmessage({data:JSON.stringify(state)});await settle();}};
}

test('page restoration does not create an autosave loop and saved fits survive a fresh browser',async()=>{
 const session=server();const a=await browser(session);
 assert.equal(a.read('loadedFileStates[0].fits[0].formula'),'1Fr221');
 assert.equal(a.read('currentRoi.lowUs'),12.1);
 assert.equal(a.patches(),0);
 a.edit('loadedFileStates[0].settings.sliceInput="1000"');await a.settle();
 assert.equal(a.patches(),1);
 const reloaded=await browser(session);
 assert.equal(reloaded.read('loadedFileStates[0].settings.sliceInput'),'1000');
 assert.equal(reloaded.read('loadedFileStates[0].fits.length'),1);
});
test('pushed remote fits merge with an unsaved local setting, and reset discards old work',async()=>{
 const session=server();const a=await browser(session);const b=await browser(session);
 a.edit('loadedFileStates[0].settings.binWidth="80"');await a.settle();
 b.edit('loadedFileStates[0].settings.sliceInput="3000"');
 await b.push(session.snapshot());
 assert.equal(b.read('loadedFileStates[0].settings.binWidth'),'80');
 assert.equal(b.read('loadedFileStates[0].settings.sliceInput'),'3000');
 assert.equal(session.snapshot().states[0].settings.sliceInput,'3000');
 const remote=session.update({sessionId:session.snapshot().sessionId,changes:[{datasetId:'a',upsertFits:[{id:'fit2',formula:'1Rb85'}]}]});
 await a.push(remote);
 assert.equal(a.read('loadedFileStates[0].fits.length'),2);
 a.edit('loadedFileStates[0].settings.binWidth="160"');
 await a.push(session.reset());
 assert.equal(a.read('loadedFileStates.length'),0);
 assert.equal(a.read('activeFileStateIndex'),-1);
 assert.equal(session.snapshot().states.length,0);
});

test('removal persists, merges unsaved edits, synchronizes another browser, and clears the final spectrum',async()=>{
 const datasets=new Map(['a','b','c'].map(id=>[id,{id,filename:id+'.lst',viewerState:{settings:{binWidth:'40'},fits:[{id:'fit-'+id}]}}]));
 let active='b';const session=createWorkspaceSession({datasets,runs:new Map(),getActive:()=>active,setActive:id=>active=id});
 const a=await browser(session),b=await browser(session);
 a.edit('loadedFileStates[0].settings.binWidth="80"');
 await a.read('workspaceSession.removeSpectrum("b")');await a.settle();
 assert.equal(a.read('loadedFileStates[activeFileStateIndex].datasetId'),'c');
 assert.equal(datasets.get('a').viewerState.settings.binWidth,'80');
 assert.equal(datasets.has('b'),false);
 await b.push(session.snapshot());
 assert.equal(b.read('loadedFileStates.length'),2);
 assert.equal(b.read('loadedFileStates[activeFileStateIndex].datasetId'),'c');
 await a.read('workspaceSession.removeSpectrum("a",true)');await a.settle();
 assert.deepEqual(session.snapshot().states.map(state=>state.datasetId),['a']);
 assert.equal(a.read('loadedFileStates[activeFileStateIndex].datasetId'),'a');
 await a.read('workspaceSession.removeSpectrum("a")');await a.settle();
 assert.equal(a.read('activeFileStateIndex'),-1);assert.equal(a.read('loadedFileStates.length'),0);
 assert.equal(session.snapshot().activeDatasetId,null);
});
