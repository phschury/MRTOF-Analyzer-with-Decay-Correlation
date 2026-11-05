const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {derivedViewerSettings}=require('../derived-viewer');

test('derived viewer settings copy the full parent range independently of the fit ROI',()=>{
 for(const timeMode of ['absolute','relative']){
  const parent={id:'parent',viewerState:{settings:{timeMode,tofLowUs:'7.123456789',tofHighUs:'9.987654321',
   absoluteViewRange:{min:52.123456789,max:54.987654321},binWidth:'80'}}};
  const settings=derivedViewerSettings(parent,undefined,{channel:2,tag:3,tofLowUs:8,tofHighUs:8.1});
  assert.equal(settings.timeMode,timeMode);
  assert.equal(settings.tofLowUs,parent.viewerState.settings.tofLowUs);
  assert.equal(settings.tofHighUs,parent.viewerState.settings.tofHighUs);
  assert.deepEqual(settings.absoluteViewRange,parent.viewerState.settings.absoluteViewRange);
  settings.absoluteViewRange.min=55;
  assert.equal(parent.viewerState.settings.absoluteViewRange.min,52.123456789);
 }
});
test('a fresh viewport snapshot takes precedence over the last autosaved parent view',()=>{
 const parent={id:'parent',viewerState:{settings:{timeMode:'absolute',tofLowUs:'12',tofHighUs:'16',absoluteViewRange:{min:12,max:16},binWidth:'80'}}};
 const settings=derivedViewerSettings(parent,{timeMode:'relative',tofLowUs:'8.123456789',tofHighUs:'8.234567891',absoluteViewRange:null});
 assert.equal(settings.timeMode,'relative');assert.equal(settings.tofLowUs,'8.123456789');assert.equal(settings.tofHighUs,'8.234567891');
 assert.equal(settings.absoluteViewRange,null);assert.equal(settings.binWidth,'80');
 assert.throws(()=>derivedViewerSettings(parent,{absoluteViewRange:{min:2,max:1}}),/X-axis range/);
});
test('drift correction initializes and publishes the inherited view, keeping the fit interval as ROI',()=>{
 const routes={},parent={id:'parent',filename:'sample.lst',lm:{},viewerState:{settings:{timeMode:'absolute',tofLowUs:'12',tofHighUs:'16'}}};
 const inherited={timeMode:'absolute',tofLowUs:'12',tofHighUs:'16',absoluteViewRange:{min:52.123456,max:52.234567}};
 const datasets=new Map([['parent',parent]]);
 const runs=new Map([['fit',{datasetId:'parent',viewerSettings:inherited,channel:1,edge:1,tag:3,
  result:{settings:{tofLowUs:7.1,tofHighUs:7.2,binWidth:80},trancheSize:5000}}]]);
 const context=vm.createContext({derivedViewerSettings,require:()=>({makeDriftCorrectedData:()=>({lm:{},correction:{totalEvents:10,sourceEvents:10,scaledEvents:5,discardedEvents:0}})}),
  app:{post:(path,handler)=>routes[path]=handler},listModeDatasets:datasets,driftFitRuns:runs,makeDatasetId:()=> 'child',summarizeDataset:ds=>ds,workspace:{publish(){}}});
 const source=fs.readFileSync('main.js','utf8');
 vm.runInContext(source.slice(source.indexOf('app.post("/api/drift-correct",'),source.indexOf('// Fallback for macOS')),context);
 const res={json(body){this.body=body;return this},status(code){this.code=code;return this}};
 routes['/api/drift-correct']({body:{fitRunId:'fit'}},res);
 assert.equal(res.body.ok,true);
 const child=datasets.get('child');assert.deepEqual(child.viewerState.settings.absoluteViewRange,inherited.absoluteViewRange);
 assert.equal(child.viewerState.settings.tofLowUs,'12');assert.equal(child.viewerState.settings.tofHighUs,'16');
 assert.equal(child.viewerState.roi.lowUs,7.1);assert.equal(child.viewerState.roi.highUs,7.2);
 routes['/api/drift-correct/decision']({body:{fitRunId:'fit',action:'accept'}},res);
 assert.equal(child.pending,false);assert.deepEqual(child.viewerState.settings.absoluteViewRange,inherited.absoluteViewRange);
});
