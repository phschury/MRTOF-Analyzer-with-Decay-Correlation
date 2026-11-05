const {test}=require('node:test');
const assert=require('node:assert/strict');
const {planEnergyFiles,calibrationChannel}=require('../public/js/energy-import');
const {parseEnergyListmode,combineEnergyData,energyHistogram,COUNTER_MODULUS}=require('../energy-listmode');
test('selection separates calibration files and groups only matching final-number filenames in numeric order',()=>{
 const files=['run_010.dat','run_002.dat','other_001.dat','run_001.dat','BoxSi_ch11_calib','BoxSi_ch15_calib.txt','run_other.dat','run_001.lst','202610291509_list_001.dat','202610301509_list_002.dat'].map(name=>({name}));
 const plan=planEnergyFiles(files);assert.deepEqual(plan.calibrations,[4,5]);
 assert.deepEqual(plan.groups[0].indices,[3,1,0]);assert.match(plan.groups[0].filename,/001–010 \[combined\]\.dat$/);
 assert.equal(plan.groups.length,6);assert.equal(calibrationChannel('BoxSi_ch10_calib'),null);
});
test('combined energy spectra use constituent arrays and unwrap timestamps across numbered files',()=>{
 const a=parseEnergyListmode(`1,11,100,${COUNTER_MODULUS-10},6\n1,0,500,${COUNTER_MODULUS-5},6`);
 const b=parseEnergyListmode('1,11,200,5,6\n1,1,500,10,6');
 const c=parseEnergyListmode('1,12,300,15,6');
 const combined=combineEnergyData([a,b,c]);
 assert.equal(combined.parts[0].events,a.events);assert.equal(combined.events.length,3);assert.equal(combined.inputEvents,5);assert.equal(combined.skippedEvents,2);assert.equal(combined.rollovers,1);
 assert.equal(combined.maxTick-combined.minTick,25);
 const hist=energyHistogram(combined);assert.equal(hist.plottedEvents,3);assert.equal(hist.counts[100],1);assert.equal(hist.counts[200],1);assert.equal(hist.counts[300],1);
 assert.equal(energyHistogram(combined,{timeLow:0.0000001}).plottedEvents,2);
});
test('browser batch import loads calibrations, combines numbered groups, and keeps unrelated files separate',async t=>{
 const {app}=require('../main');const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
 t.after(()=>{server.closeAllConnections();server.close()});const root=`http://127.0.0.1:${server.address().port}`;
 const post=async(url,body)=>{const response=await fetch(root+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 const session=(await(await fetch(root+'/api/energy/files')).json()).sessionId;
 assert.equal((await fetch(root+'/api/energy/choose-files',{method:'POST'})).status,404);
 const started=await post('/api/energy/imports',{sessionId:session,files:[{filename:'run_002.dat'},{filename:'run_001.dat'},{filename:'other.dat'}],calibrations:[{filename:'BoxSi_ch11_calib',text:'a:88.799035\nb:2.188907'}]});
 assert.equal(started.status,200);const id=started.body.importId;
 const texts=['1,11,200,300,6\n1,0,500,400,6','1,11,100,100,6\n1,1,500,200,6','1,12,300,500,6'];
 for(let i=0;i<texts.length;i++){
  const res=await fetch(root+'/api/energy/files',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':['run_002.dat','run_001.dat','other.dat'][i],'X-Energy-Import':id,'X-Energy-File-Index':String(i)},body:texts[i]});assert.equal(res.status,200);
 }
 const before=await(await fetch(root+'/api/energy/files')).json();assert.equal(before.datasets.length,0);
 const finished=await post('/api/energy/imports/'+id+'/finish');assert.equal(finished.status,200);assert.equal(finished.body.datasets.length,2);
 const combined=finished.body.datasets.find(ds=>ds.sourceFiles.length===2);assert.deepEqual(combined.sourceFiles,['run_001.dat','run_002.dat']);assert.equal(combined.events,2);assert.equal(combined.inputEvents,4);assert.equal(combined.skippedEvents,2);assert.equal(combined.calibrations['1:11'].gain,2.188907);
 const hist=await(await fetch(root+'/api/energy/files/'+combined.id+'/histogram')).json();assert.equal(hist.plottedEvents,2);assert.equal(hist.counts[100],1);assert.equal(hist.counts[200],1);
 const calibrationOnly=await post('/api/energy/imports',{sessionId:session,files:[],calibrations:[{filename:'BoxSi_ch12_calib',text:'a:4\nb:3'}]});assert.equal(calibrationOnly.body.importId,null);assert.equal(calibrationOnly.body.datasets[0].calibrations['1:12'].gain,3);
 const cancelled=await post('/api/energy/imports',{sessionId:session,files:[{filename:'cancel.dat'}]});assert.equal((await fetch(root+'/api/energy/imports/'+cancelled.body.importId,{method:'DELETE'})).status,200);
 assert.equal((await post('/api/energy/imports/'+cancelled.body.importId+'/finish')).status,400);
});
test('the browser uploader sends calibrations as text and uploads only data files before selecting the combined result',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');const elements={},uploads=[];let calibrationRequest;
 const element=()=>({value:'',textContent:'',handlers:{},classList:{toggle(){}},children:[],addEventListener(n,fn){this.handlers[n]=fn},replaceChildren(){this.children=[]},appendChild(node){this.children.push(node)},click(){this.clicked=true}});
 const ds={id:'combined',filename:'run_1–2 [combined].dat',format:'niki',events:2,inputEvents:4,skippedEvents:2,timebaseNs:10,firstTick:100,lastTick:300,
  sourceFiles:['run_1.dat','run_2.dat'],channels:[{module:1,channel:11,label:'Bottom-Si'}],calibrations:{'1:11':{gain:2,offset:3,filename:'BoxSi_ch11_calib'}}};
 const context=vm.createContext({initializeEnergyRoiDrag:()=>()=>{},URLSearchParams,planEnergyFiles,document:{getElementById:id=>elements[id]??=element(),createElement:element,addEventListener(){}},window:{addEventListener(){}},setTimeout(){},clearTimeout(){},ResizeObserver:class{observe(){}},EventSource:class{},Plotly:{react:async()=>{}},
  fetch:async(url,options)=>{let result;
   if(url==='/api/energy/files' && !options)result={ok:true,sessionId:'s',datasets:[],activeId:null};
   else if(url==='/api/energy/imports'){calibrationRequest=JSON.parse(options.body);result={ok:true,sessionId:'s',importId:'batch'};}
   else if(url.includes('/chunks')){const index=Number(url.split('/')[6]);uploads.push(calibrationRequest.files[index].filename);result={ok:true,sessionId:'s',receivedBytes:Number(options.headers['X-Energy-Chunk-Offset'])+options.body.length,complete:true};}
   else if(url==='/api/energy/imports/batch/finish')result={ok:true,sessionId:'s',datasets:[ds],activeId:ds.id};
   else if(url.endsWith('/select'))result={ok:true};
   else result={ok:true,x:[100],counts:[2],range:[0,300],unit:'keV',binWidth:1,timebaseNs:10,plottedEvents:2,selectedEvents:2};
   return {ok:true,json:async()=>result};
  }});
 vm.runInContext(fs.readFileSync('public/js/energy-page.js','utf8'),context);await vm.runInContext('EnergyViewer.start()',context);
 elements.energyLoad.handlers.click();assert.equal(elements.energyFile.clicked,true);
 const file=name=>({name,size:10,arrayBuffer(){throw new Error('Whole-file reads are forbidden.');},slice:(start,end)=>({arrayBuffer:async()=>Buffer.alloc(end-start)})});
 context.files=[file('run_2.dat'),{name:'BoxSi_ch11_calib',size:10,text:async()=>'a:3\nb:2'},file('run_1.dat')];
 await vm.runInContext('EnergyViewer.load(files)',context);
 assert.deepEqual(uploads,['run_2.dat','run_1.dat']);assert.equal(calibrationRequest.calibrations[0].filename,'BoxSi_ch11_calib');assert.equal(calibrationRequest.files.length,2);
 assert.equal(elements.energyFilename.textContent,'run_1–2 [combined].dat');assert.equal(Number(elements.energyGain.value),2);assert.equal(Number(elements.energyOffset.value),3);
});
