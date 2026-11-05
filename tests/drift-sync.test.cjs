const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('main viewer sends current file and ranges, deduplicates, and refreshes after changes', async () => {
  const sent = [];
  const values = { channel: '2', edge: '1', tag: '3', binWidth: '320', tofLowUs: '12', tofHighUs: '16', yScale: 'linear' };
  const frame = { contentWindow: { postMessage: message => sent.push(message) } };
  let timer;
  const context = vm.createContext({ URLSearchParams, console,
    setTimeout: fn => { timer = fn; return 1; }, clearTimeout() {},
    window: { location: { origin: 'http://localhost:3000' }, addEventListener() {} },
    document: { addEventListener() {}, getElementById: id => ({ value: values[id] }), querySelector: () => frame },
  });
  vm.runInContext(fs.readFileSync('public/js/histogram-page.js', 'utf8'), context);
  vm.runInContext(`loadedFileStates = [{datasetId:'file-a'}, {datasetId:'file-b'}]; activeFileStateIndex = 0;
    plottedTags.set(3, {settings:{channel:2,edge:1,binWidth:320}});
    chart = {layout:{xaxis:{range:[12.125,15.875]}}}; syncDriftWindow();`, context);
  timer();
  assert.equal(new URLSearchParams(sent[0].query).get('datasetId'), 'file-a');
  assert.equal(new URLSearchParams(sent[0].query).get('tofLowUs'), '12.125');
  vm.runInContext('syncDriftWindow()', context); timer(); assert.equal(sent.length, 1);
  vm.runInContext(`activeFileStateIndex = 1; currentSweepRange = {sweepLow:100,sweepHigh:500}; chart.layout.xaxis.range = [13,14]; syncDriftWindow();`, context); timer();
  const changed = new URLSearchParams(sent[1].query);
  assert.equal(changed.get('datasetId'), 'file-b');
  assert.equal(changed.get('tofLowUs'), '13');
  assert.equal(changed.get('sweepHigh'), '500');
  values.yScale='logarithmic';
  vm.runInContext('syncDriftWindow()',context);timer();
  assert.equal(new URLSearchParams(sent[2].query).get('yScale'),'logarithmic');
});

test('heatmap follows trusted parent state, preserves row width and aborts stale requests', async () => {
  const handlers = {}, requests = [], elements = {};
  for (const id of ['status','source','sweepBinWidth','driftControls']) elements[id] = {value:'10',addEventListener(){}};
  const parent = {postMessage(){}};
  const context = vm.createContext({ URLSearchParams, AbortController,
    window: {location:{origin:'http://localhost:3000',search:''},parent,addEventListener:(name,fn)=>handlers[name]=fn},
    document: {getElementById:id=>elements[id]},
    fetch:(url,options)=> { requests.push({url,signal:options.signal}); return new Promise(()=>{}); },
  });
  vm.runInContext(fs.readFileSync('public/js/drift.js','utf8'),context);
  const send = (query, origin='http://localhost:3000') => handlers.message({origin,source:parent,data:{type:'drift-viewer-state',query}});
  send('datasetId=file-a&tofLowUs=12');
  send('datasetId=file-b&tofLowUs=13');
  assert.equal(requests.length,2);
  assert.equal(requests[0].signal.aborted,true);
  const query = new URL(requests[1].url,'http://localhost:3000').searchParams;
  assert.equal(query.get('datasetId'),'file-b');
  assert.equal(query.get('sweepBinWidth'),'10');
  send('datasetId=untrusted','http://elsewhere');
  assert.equal(requests.length,2);
});

test('editing the drift reference fetches the new interval and retains its width',()=>{
  const requests=[],elements={};
  for(const id of ['status','source','sweepBinWidth','driftControls'])elements[id]={value:'10',addEventListener(){}};
  elements.driftPlot={layout:{xaxis:{range:[12,16]}}};
  const context=vm.createContext({URLSearchParams,AbortController,
    window:{location:{origin:'http://localhost:3000',search:''},parent:{postMessage(){}},addEventListener(){}},
    document:{getElementById:id=>elements[id]},
    fetch:url=>{requests.push(url);return new Promise(()=>{});},
  });
  vm.runInContext(fs.readFileSync('public/js/drift.js','utf8'),context);
  vm.runInContext(`params=new URLSearchParams({tag:'3',tagRanges:JSON.stringify({3:{low:12,high:16},2:{low:2,high:6}})});
    navigateDriftTofReference(116000,'ns',114000);`,context);
  const query=new URL(requests[0],'http://localhost:3000').searchParams;
  assert.equal(query.get('tofLowUs'),'14');
  assert.equal(query.get('tofHighUs'),'18');
  assert.deepEqual(JSON.parse(query.get('tagRanges')),{'3':{low:14,high:18},'2':{low:2,high:6}});
});

test('Drift Correct is enabled only for a loaded file with a complete nonempty ROI',()=>{
  const button={disabled:false};
  const context=vm.createContext({URLSearchParams,setTimeout,clearTimeout,
    window:{addEventListener(){}},document:{addEventListener(){},getElementById:()=>button},
  });
  vm.runInContext(fs.readFileSync('public/js/histogram-page.js','utf8'),context);
  vm.runInContext('updateDriftCorrectButton()',context);assert.equal(button.disabled,true);
  vm.runInContext('loadedFileStates=[{datasetId:"a"}]; activeFileStateIndex=0; plottedTags.set(3,{}); currentRoi={lowUs:12}; updateDriftCorrectButton()',context);
  assert.equal(button.disabled,true);
  vm.runInContext('currentRoi.highUs=13; updateDriftCorrectButton()',context);assert.equal(button.disabled,false);
  vm.runInContext('currentRoi=null; updateDriftCorrectButton()',context);assert.equal(button.disabled,true);
});

test('drift correction uses Slice directly and rejects invalid sweep counts', async()=>{
  const frame={src:''};
  const input={value:'2000',setCustomValidity(message){this.error=message},reportValidity(){},focus(){}};
  const context=vm.createContext({URLSearchParams,window:{addEventListener(){}},
    document:{addEventListener(){},getElementById:id=>id==='sliceInput'?input:id==='driftCorrectionTag'?{value:'7'}:id==='driftFitWindow'?{querySelector:()=>frame}:{disabled:false}}});
  vm.runInContext(fs.readFileSync('public/js/histogram-page.js','utf8'),context);
  vm.runInContext('updateDriftCorrectButton=()=>{}; driftViewerParams=()=>new URLSearchParams(); saveCurrentViewerState=()=>{}; currentRoi={lowUs:12,highUs:13,tag:3};',context);
  await vm.runInContext('showDriftFits()',context);
  assert.equal(new URLSearchParams(frame.src.split('?')[1]).get('trancheSize'),'2000');
  assert.equal(new URLSearchParams(frame.src.split('?')[1]).get('tag'),'7');
  for(const value of ['', 'abc', '-5', '1.5', '0', 'Infinity', '1e3', '9007199254740992']){
    input.value=value; frame.src='';
    await vm.runInContext('showDriftFits()',context);
    assert.equal(frame.src,'');
    assert.match(input.error,/positive whole/);
  }
});

test('corrected dataset acceptance selects the new spectrum once without replacing the original',async()=>{
  const listeners=[];const frame={contentWindow:{}};
  const context=vm.createContext({URLSearchParams,setTimeout,clearTimeout,
    window:{location:{origin:'http://localhost:3000'},addEventListener:(name,fn)=>{if(name==='message')listeners.push(fn)}},
    document:{addEventListener(){},querySelector:()=>frame,getElementById:()=>({value:'1'})},
  });
  vm.runInContext(fs.readFileSync('public/js/histogram-page.js','utf8'),context);
  vm.runInContext('loadedFileStates=[{datasetId:"original",settings:{channel:"2",tag:"3"}}]; activeFileStateIndex=0; saveCurrentViewerState=()=>{}; let selections=0; restoreLoadedFileState=async index=>{selections++;activeFileStateIndex=index};',context);
  const dataset={id:'corrected',filename:'test [drift corrected]',parentId:'original',kind:'drift-corrected',fitSettings:{channel:2,edge:1,tag:3,binWidth:80,tofLowUs:12,tofHighUs:13}};
  const event={origin:'http://localhost:3000',source:frame.contentWindow,data:{type:'drift-corrected-dataset',dataset}};
  await Promise.all(listeners.map(fn=>fn({...event,origin:'http://untrusted'})));
  assert.equal(vm.runInContext('loadedFileStates.length',context),1);
  await Promise.all([...listeners.map(fn=>fn(event)),...listeners.map(fn=>fn(event))]);
  assert.equal(vm.runInContext('loadedFileStates.length',context),2);
  assert.equal(vm.runInContext('loadedFileStates[0].datasetId',context),'original');
  assert.equal(vm.runInContext('loadedFileStates[1].datasetId',context),'corrected');
  assert.equal(vm.runInContext('activeFileStateIndex',context),1);
  assert.equal(vm.runInContext('selections',context),1);
  assert.equal(vm.runInContext('loadedFileStates[1].sweepRange',context),null);
  assert.equal(vm.runInContext('loadedFileStates[1].fits.length',context),0);
});

test('drift TAG selector refreshes immediately and remains independent of parent TAG changes',()=>{
  const handlers={},requests=[],elements={};
  const tag={value:'',listeners:{},addEventListener(name,fn){this.listeners[name]=fn},
    replaceChildren(...options){this.options=options;this.value=options[0]?.value||''}};
  for(const id of ['status','source','sweepBinWidth','driftControls'])elements[id]={value:'',addEventListener(){}};
  elements.driftTag=tag;
  const parent={postMessage(){}};
  const context=vm.createContext({URLSearchParams,AbortController,
    window:{location:{origin:'http://localhost:3000',search:'?tags=2,3&tag=2'},parent,
      addEventListener:(name,fn)=>handlers[name]=fn},
    document:{getElementById:id=>elements[id],createElement:()=>({})},
    fetch:(url)=>{requests.push(new URL(url,'http://localhost:3000').searchParams);return new Promise(()=>{})}});
  vm.runInContext(fs.readFileSync('public/js/drift.js','utf8'),context);
  assert.deepEqual(Array.from(tag.options,o=>o.value),['2','3']);
  tag.value='3';tag.listeners.change();
  assert.equal(requests.at(-1).get('tag'),'3');
  handlers.message({origin:'http://localhost:3000',source:parent,
    data:{type:'drift-viewer-state',query:'tags=2,3&tag=2&binWidth=80&sweepLow=0&sweepHigh=125870&tagRanges='+encodeURIComponent(JSON.stringify({2:null,3:{low:0,high:40}}))}});
  assert.equal(tag.value,'3');
  assert.equal(requests.at(-1).get('tag'),'3');
  assert.equal(requests.at(-1).get('binWidth'),'80');
  assert.equal(requests.at(-1).get('tofLowUs'),'0');
  assert.equal(requests.at(-1).get('tofHighUs'),'40');
  assert.equal(requests.at(-1).get('sweepBinWidth'),'315');
  handlers.message({origin:'http://localhost:3000',source:parent,
    data:{type:'drift-viewer-state',query:'tags=4,5&tag=4'}});
  assert.equal(tag.value,'4');
  assert.equal(requests.at(-1).get('tag'),'4');
});

test('absolute histogram sends per-TAG visible relative ranges rather than stale input ranges',()=>{
 const values={channel:'2',edge:'1',tag:'3',binWidth:'80',tofLowUs:'60',tofHighUs:'700',yScale:'linear',timeMode:'absolute'};
 const context=vm.createContext({URLSearchParams,window:{addEventListener(){}},
  document:{addEventListener(){},getElementById:id=>({value:values[id]})}});
 vm.runInContext(fs.readFileSync('public/js/histogram-page.js','utf8'),context);
 vm.runInContext(`loadedFileStates=[{datasetId:'a'}];activeFileStateIndex=0;availableSweeps=125870;
 plottedTags=new Map([[3,{settings:{channel:2,edge:1,binWidth:80},chartData:{datasets:[{ejectUs:100}]}}],
 [2,{settings:{channel:2,edge:1,binWidth:80},chartData:{datasets:[{ejectUs:300}]}}]]);
 chart={layout:{xaxis:{range:[7,9]}}};`,context);
 const query=new URLSearchParams(vm.runInContext('driftViewerParams().toString()',context));
 assert.deepEqual(JSON.parse(query.get('tagRanges')),{'3':{low:7,high:9},'2':null});
 assert.equal(query.get('sweepHigh'),'125870');
});
