const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createWorkspaceSession}=require('../workspace-session');
const {workspaceChanges,applyWorkspaceChanges}=require('../public/js/workspace-state');
function setup(){
 const datasets=new Map([['original',{id:'original',filename:'sample.lst',viewerState:{settings:{binWidth:'320',sliceInput:'5000'},fits:[],roi:null,sweepRange:null}}],['pending',{id:'pending',pending:true}]]);
 const runs=new Map([['run',{}]]);let active='original';
 const session=createWorkspaceSession({datasets,runs,getActive:()=>active,setActive:id=>active=id});
 return {session,datasets,runs};
}
test('server restores settings, ROI, sweep range, saved fits and active file, without raw event data or pending spectra',()=>{
 const {session}=setup();const initial=session.snapshot();
 assert.equal(initial.states.length,1);
 const fit={id:'f1',formula:'1Fr221',chartDataset:{data:[{x:12,y:10}]}};
 session.update({sessionId:initial.sessionId,changes:[{datasetId:'original',settings:{sliceInput:'2000'},roi:{lowUs:12,highUs:13},sweepRange:{sweepLow:1,sweepHigh:500},upsertFits:[fit]}],activeDatasetId:'original'});
 const restored=session.snapshot();
 assert.equal(restored.states[0].settings.binWidth,'320');
 assert.equal(restored.states[0].settings.sliceInput,'2000');
 assert.deepEqual(restored.states[0].fits,[fit]);
 assert.deepEqual(restored.states[0].roi,{lowUs:12,highUs:13});
 assert.deepEqual(restored.states[0].sweepRange,{sweepLow:1,sweepHigh:500});
 assert.equal(restored.activeDatasetId,'original');
});
test('two browsers merge independent settings and saved fits without replacing each other',()=>{
 const {session}=setup();const base=session.snapshot();
 const a=structuredClone(base.states),b=structuredClone(base.states);
 a[0].settings.binWidth='640';a[0].fits.push({id:'a',formula:'1Fr221'});
 b[0].settings.sliceInput='1000';b[0].fits.push({id:'b',formula:'1Rb85'});
 session.update({sessionId:base.sessionId,changes:workspaceChanges(base.states,a)});
 session.update({sessionId:base.sessionId,changes:workspaceChanges(base.states,b)});
 const final=session.snapshot().states[0];
 assert.equal(final.settings.binWidth,'640');assert.equal(final.settings.sliceInput,'1000');
 assert.deepEqual(final.fits.map(fit=>fit.id),['a','b']);
 // A late edit to a different setting cannot resurrect a remotely deleted fit.
 session.update({sessionId:base.sessionId,changes:[{datasetId:'original',deleteFits:['a']}]});
 a[0].settings.yScale='logarithmic';
 const edits=workspaceChanges([{...a[0],settings:{...a[0].settings,yScale:undefined}}],a);
 assert.equal(applyWorkspaceChanges(session.snapshot().states,edits)[0].fits.length,1);
});
test('New Session clears data and pending corrections, broadcasts reset, and rejects stale browsers',()=>{
 const {session,datasets,runs}=setup();const old=session.snapshot();const updates=[];
 const unsubscribe=session.subscribe(state=>updates.push(state));
 const reset=session.reset();
 assert.notEqual(reset.sessionId,old.sessionId);assert.equal(reset.activeDatasetId,null);
 assert.equal(datasets.size,0);assert.equal(runs.size,0);assert.deepEqual(reset.states,[]);
 assert.equal(session.update({sessionId:old.sessionId,changes:[]}),null);
 assert.equal(updates.length,1);unsubscribe();session.publish();assert.equal(updates.length,1);
});
test('invalid multi-file updates are atomic',()=>{
 const {session}=setup();const base=session.snapshot();
 assert.throws(()=>session.update({sessionId:base.sessionId,changes:[{datasetId:'original',settings:{binWidth:'10'}},{datasetId:'missing',roi:null}]}));
 assert.equal(session.snapshot().states[0].settings.binWidth,'320');
});

test('spectrum removal selects the next spectrum, preserves independent children, and cleans pending fits',()=>{
 const {session,datasets,runs}=setup();
 datasets.set('child',{id:'child',filename:'debounced',parentId:'original',viewerState:{fits:[{id:'child-fit'}]}});
 datasets.set('last',{id:'last',filename:'last.lst'});
 runs.set('parent-run',{datasetId:'original',correctedDatasetId:'pending'});
 const epoch=session.snapshot().sessionId;
 const result=session.update({sessionId:epoch,removeDatasetIds:['original']});
 assert.equal(result.activeDatasetId,'child');assert.equal(datasets.has('original'),false);
 assert.equal(datasets.has('pending'),false);assert.equal(runs.has('parent-run'),false);
 assert.deepEqual(result.states[0].fits,[{id:'child-fit'}]);
 assert.equal(result.states[0].parentId,'original');
 const keep=session.update({sessionId:epoch,removeDatasetIds:['last']});
 assert.equal(keep.activeDatasetId,'child');
 const empty=session.update({sessionId:epoch,removeDatasetIds:['child']});
 assert.equal(empty.activeDatasetId,null);assert.deepEqual(empty.states,[]);
});
test('invalid removal is atomic and stale sessions cannot remove spectra',()=>{
 const {session,datasets}=setup();const epoch=session.snapshot().sessionId;
 assert.throws(()=>session.update({sessionId:epoch,removeDatasetIds:['missing'],changes:[{datasetId:'original',settings:{binWidth:'10'}}]}));
 assert.equal(session.snapshot().states[0].settings.binWidth,'320');
 assert.equal(session.update({sessionId:'stale',removeDatasetIds:['original']}),null);
 assert.equal(datasets.has('original'),true);
});
