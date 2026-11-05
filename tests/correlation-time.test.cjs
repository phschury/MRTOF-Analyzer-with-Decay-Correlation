const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {makeCorrelationTimeHistogram,fitExponentialDecay,fitSchmidtDecay}=require('../correlation-time');
const {makeEnergyCorrelatedData,boxSumReferences}=require('../energy-correlation');
const {parseEnergyListmode,combineEnergyData}=require('../energy-listmode');
test('correlation snapshots the next qualifying Energy event after each retained ToF implantation',()=>{
 const data=parseEnergyListmode('1,0,0,0\n1,11,100,50000000\n1,11,100,100000000\n1,11,500,140000000\n1,12,100,145000000\n1,11,100,200000000');
 const times=[0.4,0.5,0.75,1,1.5,2.2];
 const lm={sweepPeriodUs:1000000,events:{length:times.length,tof:Float64Array.from(times,t=>(t%1)*1e10),sweep:Int32Array.from(times,Math.floor),tag:Int32Array.from(times,()=>0),channel:Int16Array.from(times,()=>1),edge:Int8Array.from(times,()=>0)}};
 const calibrations={'1:11':{gain:1,offset:0},'1:12':{gain:1,offset:0}};
 const result=makeEnergyCorrelatedData(lm,data,{module:1,channel:11,roi:{low:100,high:200},preTime:0.5,postTime:1},calibrations);
 const delays=result.lm.events.energyDelaySeconds;
 assert.ok(Number.isNaN(delays[5]));
 [0.1,0,0.25,0,0.5].forEach((expected,i)=>assert.ok(Math.abs(delays[i]-expected)<1e-12));
 assert.equal(result.lm.energyDelayDirection,'next');
 data.events.ticks.fill(0);assert.ok(Math.abs(delays[4]-0.5)<1e-12);
});
const fixture=()=>({energyDelayDirection:'next',energyDelaySource:'box-sum',ejectBins:[10000,20000],events:{length:7,tof:[11000,12000,22000,11000,11000,11000,13000],sweep:[0,1,1,2,3,4,0],tag:[2,2,3,2,2,2,2],channel:[2,2,2,2,12,2,2],edge:[1,1,1,1,1,0,1],energyDelaySeconds:Float64Array.from([0,0.2,0.3,NaN,0.4,0.5,0.6]),energyDecayKeV:Float64Array.from([100,200,300,NaN,400,500,600]),energyDecayModule:Int32Array.from([1,1,1,-1,1,1,1]),energyDecayChannel:Int32Array.from([11,12,13,-1,14,15,11])}});
const selection={channel:2,edge:1,tag:2,tofLowUs:0.1,tofHighUs:0.3,sweepLow:0,sweepHigh:5,binWidth:0.1};
test('time histogram respects the ToF ROI, TAG, channel, edge and sweep range and reports missing following Energy events',()=>{
 const result=makeCorrelationTimeHistogram(fixture(),selection);
 assert.deepEqual(result.counts,[1,1]);assert.equal(result.totalEvents,2);assert.equal(result.missingSuccessor,1);assert.equal(result.selectedEvents,3);
 assert.equal(makeCorrelationTimeHistogram(fixture(),{...selection,sweepHigh:1}).totalEvents,1);
 const empty=makeCorrelationTimeHistogram(fixture(),{...selection,channel:99});assert.deepEqual(empty.counts,[0]);assert.equal(empty.totalEvents,0);
 assert.deepEqual(makeCorrelationTimeHistogram(fixture(),{...selection,sweepHigh:1,binWidth:undefined}).counts,[1]);
});
test('invalid time histogram requests and missing saved timing fail clearly',()=>{
 for(const bad of [{binWidth:0},{binWidth:NaN},{binWidth:1e-20},{tofHighUs:0},{tag:-1},{sweepHigh:0},{channel:NaN}])assert.throws(()=>makeCorrelationTimeHistogram(fixture(),{...selection,...bad}));
 const lm=fixture();delete lm.events.energyDelaySeconds;assert.throws(()=>makeCorrelationTimeHistogram(lm,selection),/Create a new Energy-correlated spectrum/);
 const old=fixture();delete old.energyDelayDirection;assert.throws(()=>makeCorrelationTimeHistogram(old,selection),/previous timing direction/);
});
test('connected spectra calculate delays from Energy references without applying pre/post windows',()=>{
 const lm=fixture();lm.sweepPeriodUs=1000000;delete lm.events.energyDelaySeconds;
 const times=Float64Array.from([0,0.5,1,3]);
 const result=makeCorrelationTimeHistogram(lm,selection,times);
 assert.equal(result.totalEvents,2);assert.equal(result.missingSuccessor,1);
 assert.equal(result.selectedEvents,3);
});
test('log scale bins positive delays across decades and reports zero-delay events',()=>{
 const lm=fixture();lm.events.energyDelaySeconds=Float64Array.from([0,0.00001,0.3,0.1,0.4,0.5,0.6]);
 const data=makeCorrelationTimeHistogram(lm,{...selection,xScale:'log'});
 assert.equal(data.xScale,'log');assert.equal(data.totalEvents,2);assert.equal(data.zeroDelay,1);assert.equal(data.counts.reduce((a,b)=>a+b),2);
 assert.ok(data.x.every(x=>Number.isFinite(x) && x>0));assert.ok(data.widths.every(width=>Number.isFinite(width) && width>0));
 const empty=makeCorrelationTimeHistogram(lm,{...selection,xScale:'log',sweepHigh:1});assert.equal(empty.totalEvents,0);assert.equal(empty.zeroDelay,1);
});
test('only singleton bins expose the matched Energy event in linear and log modes',()=>{
 const lm=fixture(),linear=makeCorrelationTimeHistogram(lm,selection);
 assert.deepEqual(linear.singleEvents.map(event=>event?.energyKeV),[100,200]);assert.equal(linear.singleEvents[1].detector,'Box Right-Si');
 const combined=makeCorrelationTimeHistogram(lm,{...selection,binWidth:1});assert.equal(combined.counts[0],2);assert.equal(combined.singleEvents[0],null);
 const log=makeCorrelationTimeHistogram(lm,{...selection,xScale:'log'});assert.equal(log.singleEvents.filter(Boolean).length,1);assert.equal(log.singleEvents.find(Boolean).energyKeV,200);
 const old=fixture();delete old.events.energyDecayKeV;assert.ok(makeCorrelationTimeHistogram(old,selection).singleEvents.every(event=>event===null));
});
test('sorting live multi-part Energy events preserves calibrated energy, detector identity and equal-time order',()=>{
 const data=combineEnergyData([parseEnergyListmode('1,0,0,0\n1,11,20,200'),parseEnergyListmode('1,12,30,100\n1,13,40,100')]);
 const calibrations={'1:11':{gain:2,offset:5},'1:12':{gain:3,offset:1},'1:13':{gain:4,offset:2}};
 const refs=boxSumReferences(data,{},calibrations);
 assert.deepEqual([...refs.times],[0.000001,0.000001,0.000002]);assert.equal(refs.getEvent(0).energyKeV,91);assert.equal(refs.getEvent(0).channel,12);assert.equal(refs.getEvent(2).energyKeV,45);
 const lm={sweepPeriodUs:1000000,ejectBins:[0,0],events:{length:2,tof:[5000,17500],sweep:[0,0],tag:[0,0],channel:[1,1],edge:[0,0]}};
 const result=makeCorrelationTimeHistogram(lm,{channel:1,edge:0,tag:0,tofLowUs:0,tofHighUs:3,binWidth:1e-7},refs);
 assert.deepEqual(result.singleEvents.filter(Boolean).map(event=>event.energyKeV),[45,91]);
 const cleaned=boxSumReferences(data,{},calibrations,[{module:1,low:90,high:92,timeLow:null,timeHigh:null}]);
 const after=makeCorrelationTimeHistogram(lm,{channel:1,edge:0,tag:0,tofLowUs:0,tofHighUs:3,binWidth:1e-7},cleaned);
 assert.deepEqual(after.singleEvents.filter(Boolean).map(event=>event.energyKeV),[45,162]);
});
test('ROI action opens a draggable non-modal window with a snapshot of the selected spectrum and ROI',()=>{
 const elements={},handlers={};
 const header={addEventListener(name,handler){handlers[name]=handler}},close={addEventListener(name,handler){handlers.close=handler}},frame={};
 const popup={style:{},setAttribute(name,value){this[name]=value},querySelector:selector=>selector==='header'?header:selector==='button'?close:frame,remove(){delete elements.correlationTimeWindow}};
 const context=vm.createContext({URLSearchParams,window:{addEventListener(){}},document:{addEventListener(){},getElementById:id=>elements[id],createElement:()=>popup,body:{appendChild(node){elements[node.id]=node}}}});
 vm.runInContext(fs.readFileSync('public/js/histogram-page.js','utf8'),context);
 vm.runInContext(fs.readFileSync('public/js/correlation-time-viewer.js','utf8'),context);
 vm.runInContext(`loadedFileStates=[{datasetId:'child',kind:'energy-correlated'}];activeFileStateIndex=0;currentRoi={lowUs:12,highUs:13,tag:3};currentSweepRange={sweepLow:10,sweepHigh:20};plottedTags.set(3,{settings:{channel:2,edge:1}});hideChartContextMenu=()=>{};handleChartContextMenuClick({target:{dataset:{action:'correlation-time'}}});`,context);
 assert.equal(popup['aria-modal'],'false');assert.equal(popup.role,'dialog');assert.equal(typeof handlers.pointerdown,'function');
 const params=new URL(frame.src,'http://localhost').searchParams;
 for(const [key,value]of Object.entries({datasetId:'child',tag:3,tofLowUs:12,tofHighUs:13,channel:2,edge:1,sweepLow:10,sweepHigh:20}))assert.equal(params.get(key),String(value));
 vm.runInContext('currentRoi.highUs=14;showCorrelationTime()',context);assert.equal(new URL(frame.src,'http://localhost').searchParams.get('tofHighUs'),'14');
 vm.runInContext(`loadedFileStates=[{datasetId:'connected',kind:'original',correlationEnergySources:[{id:'energy',filename:'energy.dat'}]}];showCorrelationTime()`,context);
 assert.equal(new URL(frame.src,'http://localhost').searchParams.get('datasetId'),'connected');assert.match(new URL(frame.src,'http://localhost').searchParams.get('energySources'),/energy.dat/);
 assert.equal(vm.runInContext(`loadedFileStates[0].correlationEnergySources=[];correlationTimeParams()`,context),null);
 handlers.close();assert.equal(elements.correlationTimeWindow,undefined);
});
test('popup draws the time histogram and reports omitted ToF events',async()=>{
 const elements={source:{},selection:{},status:{},fitResult:{},schmidtResult:{},timeFitSchmidt:{addEventListener(name,handler){this[name]=handler},setAttribute(name,value){this[name]=value}},timeFitExponential:{checked:false,addEventListener(){}},timeBinWidth:{value:''},timeControls:{addEventListener(){}},timeXScale:{value:'linear',addEventListener(){}},energyRoi:{value:'',children:[],replaceChildren(){this.children=[]},appendChild(child){this.children.push(child)},addEventListener(name,handler){this[name]=handler}}},plots=[];
 let histogramFixture=fixture;const requests=[];const energyRois=[{id:'roi-1',name:'Box sum 6523 keV'}];
 const context=vm.createContext({URLSearchParams,AbortController,window:{location:{search:'?datasetId=child'}},document:{getElementById:id=>elements[id],createElement:()=>({})},
  Plotly:{react:async(...args)=>plots.push(args),purge(){}},fetch:async url=>{const params=new URL(url,'http://localhost').searchParams;requests.push(params);return {ok:true,json:async()=>({ok:true,filename:'correlated',energyRois,energyRoiId:params.get('energyRoiId'),...makeCorrelationTimeHistogram(histogramFixture(),{...selection,binWidth:params.has('binWidth')?Number(params.get('binWidth')):selection.binWidth,xScale:params.get('xScale') || 'linear',fitExponential:params.get('fitExponential')==='true',fitSchmidt:params.get('fitSchmidt')==='true'})})};}});
 vm.runInContext(fs.readFileSync('public/js/correlation-time.js','utf8').replace(/loadCorrelationTime\(\);\s*$/,'globalThis.ready=loadCorrelationTime();'),context);await context.ready;
 assert.equal(elements.energyRoi.value,'');assert.equal(requests[0].has('energyRoiId'),false);
 assert.deepEqual(elements.energyRoi.children.map(option=>option.textContent),['Full Box detector sum','Box sum 6523 keV']);
 assert.equal(elements.fitResult.hidden,true);
 assert.equal(plots.length,1);assert.equal(plots[0][1][0].type,'bar');assert.deepEqual([...plots[0][1][0].y],[1,1]);
 assert.match(elements.status.textContent,/2 ToF events · 1 excluded/);
 assert.deepEqual([...plots[0][1][0].customdata[1]],[200,'Box Right-Si']);assert.match(plots[0][1][0].hovertemplate[1],/Energy:.*keV.*Detector:/);
 elements.timeXScale.value='log';await vm.runInContext('loadCorrelationTime()',context);assert.equal(plots[1][2].xaxis.type,'log');assert.equal(elements.timeBinWidth.disabled,true);assert.match(elements.status.textContent,/1 zero-delay events omitted/);
 elements.timeXScale.value='linear';elements.timeBinWidth.value='1';
 await vm.runInContext('loadCorrelationTime()',context);
 assert.equal(plots[2][1][0].y[0],2);assert.doesNotMatch(plots[2][1][0].hovertemplate[0],/Energy:|Detector:/);assert.deepEqual([...plots[2][1][0].customdata[0]],[null,null]);
 elements.timeFitExponential.checked=true;await vm.runInContext('loadCorrelationTime()',context);
 assert.equal(plots[3][1].length,2);assert.equal(plots[3][1][1].name,'Exponential fit');assert.match(elements.fitResult.textContent,/Half-life:.*standard error/);assert.equal(elements.fitResult.hidden,false);
 elements.timeXScale.value='log';await vm.runInContext('loadCorrelationTime()',context);assert.equal(plots[4][1][1].y.length,100);
 elements.timeFitExponential.checked=false;await vm.runInContext('loadCorrelationTime()',context);assert.equal(plots[5][1].length,1);assert.equal(elements.fitResult.hidden,true);
 elements.timeFitExponential.checked=true;elements.timeXScale.value='linear';elements.timeBinWidth.value='-1';await vm.runInContext('loadCorrelationTime()',context);assert.equal(elements.fitResult.hidden,true);assert.match(elements.status.textContent,/positive bin width/);
 elements.timeBinWidth.value='';elements.timeFitExponential.checked=false;
 await elements.timeFitSchmidt.click();assert.equal(elements.timeXScale.value,'log');assert.equal(elements.timeFitSchmidt['aria-pressed'],'true');assert.equal(elements.schmidtResult.hidden,false);assert.match(elements.schmidtResult.textContent,/At least two positive/);
 histogramFixture=()=>{const lm=fixture();lm.events.energyDelaySeconds=Float64Array.from([0.03,0.2,0.3,0.1,0.4,0.5,0.6]);return lm;};
 await vm.runInContext('loadCorrelationTime()',context);
 assert.equal(plots.at(-1)[1][1].name,'Schmidt fit');assert.equal(plots.at(-1)[2].shapes.length,1);assert.match(elements.schmidtResult.textContent,/Schmidt half-life:.*T½ = τ ln\(2\)/);
 elements.timeFitExponential.checked=true;await vm.runInContext('loadCorrelationTime()',context);assert.equal(plots.at(-1)[1].length,3);
 await elements.timeFitSchmidt.click();assert.equal(elements.timeFitSchmidt['aria-pressed'],'false');assert.equal(elements.schmidtResult.hidden,true);assert.equal(plots.at(-1)[1].length,2);
 await elements.timeFitSchmidt.click();elements.timeXScale.value='linear';await vm.runInContext('loadCorrelationTime()',context);assert.equal(elements.schmidtResult.hidden,true);assert.equal(elements.timeFitSchmidt['aria-pressed'],'false');
 elements.energyRoi.value='roi-1';await elements.energyRoi.change({target:elements.energyRoi});
 assert.equal(requests.at(-1).get('energyRoiId'),'roi-1');assert.equal(elements.energyRoi.value,'roi-1');
 assert.match(plots.at(-1)[2].xaxis.title.text,/Box sum 6523 keV/);assert.match(elements.status.textContent,/following Box sum 6523 keV/);
 elements.energyRoi.value='';await elements.energyRoi.change({target:elements.energyRoi});
 assert.equal(requests.at(-1).has('energyRoiId'),false);assert.equal(elements.energyRoi.value,'');
});

test('unbinned exponential fit recovers a known half-life independently of histogram binning',()=>{
 const lifetime=2.5,n=10000;
 // Midpoint quantiles of a known exponential distribution give a deterministic sample.
 const delays=Array.from({length:n},(_,i)=>-lifetime*Math.log((i+0.5)/n));
 const fitted=fitExponentialDecay(delays);
 assert.equal(fitted.ok,true);assert.ok(Math.abs(fitted.halfLife-lifetime*Math.LN2)<0.001);
 assert.equal(fitted.halfLifeError,fitted.halfLife/Math.sqrt(n));
 const lm={energyDelayDirection:'next',energyDelaySource:'box-sum',ejectBins:[0,0],events:{length:n,tof:new Array(n).fill(1000),sweep:new Array(n).fill(0),tag:new Array(n).fill(0),channel:new Array(n).fill(1),edge:new Array(n).fill(0),energyDelaySeconds:delays}};
 const opts={channel:1,edge:0,tag:0,tofLowUs:0,tofHighUs:1,fitExponential:true};
 for(const mode of [{binWidth:0.1},{binWidth:1},{xScale:'log'}]){
  const result=makeCorrelationTimeHistogram(lm,{...opts,...mode});
  assert.equal(result.fit.halfLife,fitted.halfLife);
  if(mode.xScale==='log'){
   const schmidt=makeCorrelationTimeHistogram(lm,{...opts,...mode,fitSchmidt:true}).schmidtFit;
   assert.equal(schmidt.ok,true);assert.ok(Math.abs(schmidt.halfLife-lifetime*Math.LN2)<0.01);assert.equal(schmidt.peakTime,schmidt.lifetime);assert.ok(schmidt.halfLifeError>0);
  }assert.equal(result.fit.counts.length,result.counts.length);
  assert.ok(result.fit.counts.every(count=>Number.isFinite(count) && count>=0));
  assert.ok(result.fit.counts.reduce((a,b)=>a+b,0)<=n);
  const low=mode.xScale==='log'?Math.sqrt(result.x[0]**2+(result.widths[0]/2)**2)-result.widths[0]/2:0;
  const high=mode.xScale==='log'?low+result.widths[0]:result.binWidth;
  assert.ok(Math.abs(result.fit.counts[0]-n*(Math.exp(-low/fitted.lifetime)-Math.exp(-high/fitted.lifetime)))<1e-8);
 }
});
test('exponential fitting includes zero delays, excludes missing successors, and handles insufficient data',()=>{
 const result=makeCorrelationTimeHistogram(fixture(),{...selection,fitExponential:true});
 assert.equal(result.fit.events,2);assert.ok(Math.abs(result.fit.halfLife-0.1*Math.LN2)<1e-12);
 const log=makeCorrelationTimeHistogram(fixture(),{...selection,fitExponential:true,xScale:'log'});
 assert.equal(log.fit.halfLife,result.fit.halfLife);
 for(const delays of [[],[1],[0,0]])assert.equal(fitExponentialDecay(delays).ok,false);
 for(const overrides of [{channel:99},{sweepHigh:1}]){
  const data=makeCorrelationTimeHistogram(fixture(),{...selection,...overrides,fitExponential:true});
  assert.equal(data.fit.ok,false);assert.ok(data.counts.length>0);
 }
 assert.equal(makeCorrelationTimeHistogram(fixture(),selection).fit,undefined);
});

test('Schmidt Poisson fit recovers a known log-time peak with finite limits and empty bins',()=>{
 for(const lifetime of [1e-8,2.5,1e7]){
  const n=10000,edges=Array.from({length:61},(_,i)=>lifetime*0.4*15**(i/60));
  const counts=edges.slice(1).map((high,i)=>n*(Math.exp(-edges[i]/lifetime)-Math.exp(-high/lifetime)));
  const fit=fitSchmidtDecay(edges,counts);
  assert.equal(fit.ok,true);assert.ok(Math.abs(fit.lifetime/lifetime-1)<1e-5);
  assert.equal(fit.halfLife,fit.peakTime*Math.LN2);assert.ok(Number.isFinite(fit.halfLifeError) && fit.halfLifeError>0);
  assert.ok(Math.abs(fit.counts.reduce((a,b)=>a+b)-counts.reduce((a,b)=>a+b))<1e-7);
  const sparse=counts.map(Math.round),sparseFit=fitSchmidtDecay(edges,sparse);
  assert.equal(sparseFit.ok,true);assert.ok(Math.abs(sparseFit.lifetime/lifetime-1)<0.01);
 }
 const empty=makeCorrelationTimeHistogram(fixture(),{...selection,fitSchmidt:true,xScale:'log',channel:99});
 assert.equal(empty.schmidtFit.ok,false);assert.equal(empty.counts.length,100);
 const zeros=fixture();zeros.events.energyDelaySeconds.fill(0);
 assert.equal(makeCorrelationTimeHistogram(zeros,{...selection,fitSchmidt:true,xScale:'log'}).schmidtFit.ok,false);
 assert.equal(makeCorrelationTimeHistogram(fixture(),{...selection,fitSchmidt:true,xScale:'log'}).schmidtFit.ok,false);
 assert.match(makeCorrelationTimeHistogram(fixture(),{...selection,fitSchmidt:true}).schmidtFit.error,/logarithmic/);
 assert.equal(makeCorrelationTimeHistogram(fixture(),selection).schmidtFit,undefined);
});

test('an intervening ion disqualifies the first match in live and saved correlations',()=>{
 const {snapshotEnergyMatches}=require('../energy-correlation');
 // Deliberately out of order; the ion at 1.5 is outside the displayed ROI.
 const lm={sweepPeriodUs:1000000,ejectBins:[0,0],events:{length:4,
  sweep:[2,0,1,1],tof:[10000,10000,10000,5000000000],
  channel:[1,1,1,1],edge:[0,0,0,0],tag:[0,0,0,0]}};
 const refs={times:Float64Array.from([1.25,2.000001]),getEvent:()=>({energyKeV:100,module:1,channel:11})};
 const before=structuredClone(lm);
 const options={channel:1,edge:0,tag:0,tofLowUs:0,tofHighUs:2};
 const live=makeCorrelationTimeHistogram(lm,options,refs);
 assert.equal(live.totalEvents,2);assert.equal(live.missingSuccessor,1);
 const saved=snapshotEnergyMatches(lm,refs);
 assert.ok(Number.isFinite(saved.energyDelaySeconds[1])); // Preserve references until the ToF ROI is known.
 assert.equal(saved.energyDelaySeconds[0],0); // Equal-time energy remains valid.
 assert.deepEqual(lm,before);
 Object.assign(lm.events,saved);lm.energyDelayDirection='next';lm.energyDelaySource='box-sum';
 const histogram=makeCorrelationTimeHistogram(lm,options);
 assert.equal(histogram.totalEvents,live.totalEvents);
 assert.equal(histogram.missingSuccessor,live.missingSuccessor);
});

test('nearest selected ion survives unrelated records and narrowing the ToF population',()=>{
 const {snapshotEnergyMatches}=require('../energy-correlation');
 const lm={sweepPeriodUs:1000000,ejectBins:[0,0],events:{length:7,
  sweep:[0,1,1,1,1,1,1],tof:[10000,10000,20000,30000,40000,50000,60000],
  channel:[1,1,2,1,1,1,1],edge:[0,0,0,1,0,0,0],tag:[0,0,0,0,1,0,0]}};
 const refs={times:Float64Array.from([2]),getEvent:()=>({energyKeV:100,module:1,channel:11})};
 const options={channel:1,edge:0,tag:0,tofLowUs:0,tofHighUs:2};
 for(const saved of [false,true]){
  if(saved){Object.assign(lm.events,snapshotEnergyMatches(lm,refs));lm.energyDelayDirection='next';lm.energyDelaySource='box-sum';}
  const result=makeCorrelationTimeHistogram(lm,options,saved?undefined:refs);
  assert.equal(result.totalEvents,1);assert.equal(result.missingSuccessor,1);
  assert.equal(result.selectedEvents,2);
  const wide=makeCorrelationTimeHistogram(lm,{...options,tofHighUs:7},saved?undefined:refs);
  assert.equal(wide.totalEvents,1);assert.equal(wide.missingSuccessor,3);
  assert.ok(wide.x[wide.counts.findIndex(Boolean)]<result.x[result.counts.findIndex(Boolean)]);
 }
});
