const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const vm=require('node:vm');
const {parseCalibration,parseCalibrationFiles}=require('../energy-calibration');
test('Niki imports use Box Si defaults, accept overrides, and restore defaults for a new session',async t=>{
 const express=require('express'),app=express();app.use(express.json());
 const routes=require('../energy-routes').mountEnergyRoutes(app,{workspace:{snapshot:()=>({sessionId:'s'}),isCurrent:id=>id==='s'}});
 const server=app.listen(0,'127.0.0.1');
 await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
 t.after(()=>{server.closeAllConnections();server.close()});const root=`http://127.0.0.1:${server.address().port}`;
 const post=async(path,body)=>{
  const res=await fetch(root+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal(res.status,200);return res.json();
 };
 const upload=async(filename,body)=>{
  const res=await fetch(root+'/api/energy/files',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':filename},body});
  assert.equal(res.status,200);return res.json();
 };
 const expected={
  '1:11':{gain:2.188907,offset:88.799035,filename:'BoxSi_ch11_calib'},
  '1:12':{gain:2.117418,offset:56.663297,filename:'BoxSi_ch12_calib'},
  '1:13':{gain:2.117418,offset:50.311042,filename:'BoxSi_ch13_calib'},
  '1:14':{gain:2.288235,offset:78.858824,filename:'BoxSi_ch14_calib'},
  '1:15':{gain:2.219234,offset:80.503667,filename:'BoxSi_ch15_calib'}
 };
 const text=[11,12,13,14,15].map(ch=>`1,${ch},100,${ch}`).join('\n')+'\n0,11,100,20';
 const first=(await upload('first.dat',text)).dataset;assert.deepEqual(first.calibrations,expected);
 assert.equal(first.calibrations['0:11'],undefined);
 const hist=await(await fetch(root+`/api/energy/files/${first.id}/histogram?module=1&channel=box-sum`)).json();
 assert.equal(hist.ok,true);assert.equal(hist.plottedEvents,5);assert.equal(hist.unit,'keV');
 assert.deepEqual((await upload('legacy.lst','100,11,200')).dataset.calibrations,{});
 await upload('BoxSi_ch12_calib','a:4\nb:3');
 const overridden={...expected,'1:12':{gain:3,offset:4,filename:'BoxSi_ch12_calib'}};
 const current=await(await fetch(root+'/api/energy/files')).json();
 assert.deepEqual(current.datasets.find(ds=>ds.id===first.id).calibrations,overridden);
 assert.deepEqual((await upload('later.dat',text)).dataset.calibrations,overridden);
 routes.clear();
 assert.deepEqual((await upload('reset.dat',text)).dataset.calibrations,expected);
 const batch=await post('/api/energy/imports',{files:[{filename:'batch.dat'}]});
 const res=await fetch(root+'/api/energy/files',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':'batch.dat','X-Energy-Import':batch.importId,'X-Energy-File-Index':'0'},body:text});
 assert.equal(res.status,200);
 const finished=await post('/api/energy/imports/'+batch.importId+'/finish',{});
 assert.deepEqual(finished.datasets.find(ds=>ds.filename==='batch.dat').calibrations,expected);
});
test('calibration files map b to gain and a to offset, with headers and extra coefficients preserved as unrelated data',()=>{
 assert.deepEqual(parseCalibration('Energy calibration file\n#constant\na:88.799035\nb:2.188907\nc:0\nd:1\ne:2542,5653'),{gain:2.188907,offset:88.799035});
 for(const text of ['a:1','a:NaN\nb:2','a:0\nb:0','a:0\nb:-1','a:\nb:2'])assert.throws(()=>parseCalibration(text));
});

test('selected calibration filenames map to module 1 only and duplicate or invalid names fail',()=>{
 const result=parseCalibrationFiles([{filename:'BoxSi_ch11_calib',text:'a:88.799035\nb:2.188907'},{filename:'BoxSi_ch15_calib.txt',text:'a:-2\nb:3'}]);
 assert.equal(result['1:11'].gain,2.188907);assert.equal(result['1:15'].offset,-2);assert.equal(result['0:11'],undefined);
 assert.throws(()=>parseCalibrationFiles([{filename:'BoxSi_ch10_calib',text:'a:1\nb:2'}]),/Invalid/);
 assert.throws(()=>parseCalibrationFiles([{filename:'BoxSi_ch11_calib',text:'a:1\nb:2'},{filename:'BoxSi_ch11_calib.txt',text:'a:2\nb:3'}]),/More than one/);
});
test('detector selection applies its own calibration and resets it for other modules or missing files',async()=>{
 const elements={};
 const element=()=>({value:'',textContent:'',handlers:{},children:[],classList:{toggle(){}},addEventListener(n,fn){this.handlers[n]=fn},replaceChildren(){this.children=[]},appendChild(node){this.children.push(node)}});
 const ds={id:'run',filename:'run.dat',format:'niki',events:2,firstTick:100,lastTick:200,timebaseNs:10,
  channels:[{module:1,channel:11,label:'Bottom'},{module:1,channel:12,label:'Right'},{module:1,channel:14,label:'Top'},{module:0,channel:11,label:'Si array 11'}],
  calibrations:{'1:11':{gain:2.188907,offset:88.799035,filename:'BoxSi_ch11_calib'},'1:12':{gain:3,offset:4,filename:'BoxSi_ch12_calib'}}};
 const context=vm.createContext({AbortController,initializeEnergyRoiDrag:()=>()=>{},URLSearchParams,document:{getElementById:id=>elements[id]??=element(),createElement:element,addEventListener(){}},window:{addEventListener(){}},
  setTimeout(){},clearTimeout(){},ResizeObserver:class{observe(){}},EventSource:class{},Plotly:{react:async()=>{}},
  fetch:async url=>({ok:true,json:async()=>url==='/api/energy/files'?{ok:true,sessionId:'s',activeId:'run',datasets:[ds]}:url.endsWith('/select')?{ok:true}
   :{ok:true,x:[1],counts:[2],range:[0,2],binWidth:1,unit:'keV',timebaseNs:10,plottedEvents:2,selectedEvents:2}})});
 vm.runInContext(await fs.readFile('public/js/energy-page.js','utf8'),context);await vm.runInContext('EnergyViewer.start()',context);
 assert.equal(Number(elements.energyGain.value),2.188907);assert.equal(Number(elements.energyOffset.value),88.799035);assert.equal(elements.energyUnit.value,'keV');
 elements.energyChannel.value='12';elements.energyChannel.handlers.change();assert.equal(Number(elements.energyGain.value),3);assert.equal(Number(elements.energyOffset.value),4);
 assert.equal(elements.energyChannel.children.find(option=>option.value==='box-sum').textContent,'Box detector sum');
 elements.energyChannel.value='box-sum';elements.energyChannel.handlers.change();assert.equal(Number(elements.energyGain.value),1);assert.equal(Number(elements.energyOffset.value),0);assert.equal(elements.energyUnit.value,'keV');
 assert.equal(elements.energyAxis.disabled,true);assert.equal(elements.energyBinUnit.textContent,'[keV]');
 for(const id of ['energyUnit','energyGain','energyOffset','energyLow','energyHigh'])assert.equal(elements[id].disabled,true);
 await vm.runInContext('EnergyViewer.select("run")',context);assert.equal(elements.energyChannel.value,'box-sum');
 elements.energyChannel.value='14';elements.energyChannel.handlers.change();assert.equal(Number(elements.energyGain.value),1);assert.equal(elements.energyUnit.value,'ch');
 assert.equal(elements.energyAxis.disabled,false);assert.equal(elements.energyUnit.disabled,false);assert.equal(elements.energyLow.disabled,false);
 elements.energyModule.value='0';elements.energyModule.handlers.change();assert.equal(Number(elements.energyGain.value),1);assert.equal(elements.energyUnit.value,'ch');
});
