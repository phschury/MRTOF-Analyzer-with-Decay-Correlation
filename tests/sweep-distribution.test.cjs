const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {makeSweepDistribution}=require('../sweep-distribution');
const lm={ejectBins:[10000,20000],events:{length:8,
  tof:[11000,12000,22000,13000,11000,11000,11000,11000],
  sweep:[0,0,0,1,2,3,4,5],tag:[2,2,3,2,2,2,2,2],
  channel:[2,2,2,2,12,2,2,2],edge:[1,1,1,1,1,0,1,1]}};
const options={channel:2,edge:1,sweepLow:0,sweepHigh:5,tagRanges:{2:{low:0.1,high:0.3},3:{low:0.1,high:0.3}}};
test('counts all visible TAGs together per sweep, includes empty sweeps, excludes upper TOF and sweep boundaries',()=>{
  const data=makeSweepDistribution(lm,options);
  assert.deepEqual(data.ionsPerSweep,[0,1,3]);assert.deepEqual(data.sweeps,[3,1,1]);
  assert.equal(data.totalIons,4);assert.equal(data.totalSweeps,5);
  assert.equal(data.nonemptySweeps,2);assert.equal(data.meanIonsPerSweep,2);
});
test('narrowing the range, excluding a TAG, and changing sweep selection alter the distribution',()=>{
  const data=makeSweepDistribution(lm,{...options,sweepLow:1,tagRanges:{2:{low:0.1,high:0.2},3:null}});
  assert.deepEqual(data.ionsPerSweep,[0,1]);assert.deepEqual(data.sweeps,[3,1]);
  assert.equal(data.nonemptySweeps,1);assert.equal(data.meanIonsPerSweep,1);
  const empty=makeSweepDistribution(lm,{...options,tagRanges:{}});
  assert.deepEqual(empty.sweeps,[5]);assert.equal(empty.totalIons,0);
  assert.equal(empty.nonemptySweeps,0);assert.equal(empty.meanIonsPerSweep,null);
});
test('invalid settings are rejected',()=>{
  for(const invalid of [{sweepHigh:0},{sweepLow:-1},{channel:NaN},{tagRanges:{2:{low:1,high:0}}},{tagRanges:[]}]) {
    assert.throws(()=>makeSweepDistribution(lm,{...options,...invalid}),/Invalid/);
  }
});
test('viewer maps absolute panel ranges for every plotted TAG and excludes legend-hidden TAGs',()=>{
  const values={channel:'2',edge:'1',tag:'3',binWidth:'80',tofLowUs:'12',tofHighUs:'16',timeMode:'absolute',yScale:'linear'};
  const context=vm.createContext({URLSearchParams,setTimeout,clearTimeout,window:{addEventListener(){}},
    document:{addEventListener(){},getElementById:id=>({value:values[id]})}});
  vm.runInContext(fs.readFileSync('public/js/histogram-page.js','utf8'),context);
  vm.runInContext(fs.readFileSync('public/js/distro-viewer.js','utf8'),context);
  vm.runInContext(`loadedFileStates=[{datasetId:'a'}];activeFileStateIndex=0;availableSweeps=100;
    plottedTags=new Map([[3,{settings:{channel:2,edge:1,binWidth:80},chartData:{datasets:[{ejectUs:100}]}}],
    [2,{settings:{channel:2,edge:1,binWidth:80},chartData:{datasets:[{ejectUs:300}]}}]]);
    chart={data:[{name:'TAG 3'},{name:'TAG 2'}],layout:{xaxis:{range:[7,9]}}};`,context);
  const get=()=>new URLSearchParams(vm.runInContext('distroViewerParams().toString()',context));
  assert.deepEqual(JSON.parse(get().get('tagRanges')),{'3':{low:7,high:9},'2':null});
  assert.equal(get().get('sweepHigh'),'100');
  values.timeMode='relative';
  assert.deepEqual(JSON.parse(get().get('tagRanges')),{'3':{low:7,high:9},'2':{low:7,high:9}});
  vm.runInContext("chart.data[0].visible='legendonly';currentSweepRange={sweepLow:10,sweepHigh:20};",context);
  assert.deepEqual(JSON.parse(get().get('tagRanges')),{'2':{low:7,high:9}});
  assert.equal(get().get('sweepLow'),'10');assert.equal(get().get('sweepHigh'),'20');
});
test('popup renders frequency bars with integer multiplicities and zero sweeps',async()=>{
  const elements={source:{},status:{}},plots=[],handlers={};
  const parent={};
  const context=vm.createContext({URLSearchParams,AbortController,window:{location:{search:'?datasetId=a',origin:'http://localhost'},parent,
    addEventListener:(type,handler)=>handlers[type]=handler},document:{getElementById:id=>elements[id]},
    Plotly:{react:async(...args)=>plots.push(args),purge(){}},fetch:async()=>({ok:true,json:async()=>({ok:true,filename:'sample',...makeSweepDistribution(lm,options)})})});
  context.window.parent=context.window;
  vm.runInContext(fs.readFileSync('public/js/distro.js','utf8').replace('else loadDistro();','else globalThis.ready=loadDistro();'),context);
  await context.ready;
  assert.equal(plots.length,1);
  assert.deepEqual(plots[0][1][0].x,[0,1,3]);assert.deepEqual(plots[0][1][0].y,[3,1,1]);
  assert.equal(plots[0][1][0].type,'bar');
  assert.match(elements.status.textContent,/4 ions · 5 sweeps/);
  assert.match(elements.status.textContent,/zero-ion sweeps/);
  assert.match(elements.status.textContent,/Mean 2 ions\/sweep \(2 nonempty sweeps\)/);
});

test('HTTP distribution uses the requested dataset and event ranges',async t=>{
  const {app}=require('../main');
  const server=app.listen(0,'127.0.0.1');
  await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
  t.after(()=>{server.closeAllConnections();server.close()});
  const root=`http://127.0.0.1:${server.address().port}`;
  const hex=(tof,sweep)=>(BigInt(sweep)<<32n|BigInt(tof)<<4n|8n).toString(16).padStart(12,'0');
  const body='time_patch=1a\n[DATA]\n'+[[100,0],[200,0],[1000,2]].map(([tof,sweep])=>hex(tof,sweep)).join('\n');
  const upload=await fetch(root+'/api/listmode-file',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body});
  const parent=await upload.json();
  const query=new URLSearchParams({datasetId:parent.datasetId,channel:0,edge:1,sweepLow:0,sweepHigh:3,tagRanges:JSON.stringify({0:{low:0,high:0.05}})});
  const response=await fetch(root+'/api/sweep-distribution?'+query),result=await response.json();
  assert.equal(response.status,200);assert.equal(result.datasetId,parent.datasetId);
  assert.deepEqual(result.ionsPerSweep,[0,2]);assert.deepEqual(result.sweeps,[2,1]);
  assert.equal(result.nonemptySweeps,1);assert.equal(result.meanIonsPerSweep,2);
  query.set('sweepHigh','999');assert.equal((await fetch(root+'/api/sweep-distribution?'+query)).status,400);
});
