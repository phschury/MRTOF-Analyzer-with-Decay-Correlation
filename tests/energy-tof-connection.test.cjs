const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('energy connections list loaded ToF spectra, retain simultaneous-start metadata on append, and reject missing or pending targets',async t=>{
 const express=require('express'),app=express();app.use(express.json());let epoch='session';
 const tofDatasets=new Map([
  ['tof-a',{id:'tof-a',filename:'original.lst',kind:'original',lm:{startTime:new Date('2026-11-03T01:00:00Z'),sweepPeriodUs:25000}}],
  ['tof-b',{id:'tof-b',filename:'corrected.lst',kind:'drift-corrected',lm:{startTime:new Date('2026-11-03T02:00:00Z'),sweepPeriodUs:40000}}],
  ['pending',{id:'pending',filename:'pending.lst',pending:true,lm:{}}],
 ]);
 require('../energy-routes').mountEnergyRoutes(app,{workspace:{snapshot:()=>({sessionId:epoch}),isCurrent:id=>id===epoch,publish(){}},tofDatasets});
 const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
 t.after(()=>{server.closeAllConnections();server.close()});const root=`http://127.0.0.1:${server.address().port}`;
 const post=async(url,body)=>{const response=await fetch(root+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 async function upload(filename,text){const res=await fetch(root+'/api/energy/files',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':filename},body:text});assert.equal(res.status,200);return (await res.json()).dataset;}
 const energy=await upload('run_001.dat','1,0,100,40000,6\n1,11,200,50000,6');const id=energy.id;
 const options=await(await fetch(root+'/api/energy/files/'+id+'/tof-options')).json();assert.deepEqual(options.tofSpectra.map(ds=>ds.id),['tof-a','tof-b']);assert.equal(options.dataset.tofConnection,null);
 const connected=await post('/api/energy/files/'+id+'/tof-connection',{sessionId:epoch,tofDatasetId:'tof-a'});assert.equal(connected.status,200);
 const link=connected.body.dataset.tofConnection;assert.equal(link.tofDatasetId,'tof-a');assert.equal(link.alignment,'simultaneous-start');assert.equal(link.assumedSimultaneousStart,true);
 assert.equal(link.energyZeroTick,40000);assert.equal(link.energyTimebaseNs,10);assert.equal(link.tofSweepZero,0);assert.equal(link.tofSweepPeriodUs,25000);assert.equal(link.tofStartTime,'2026-11-03T01:00:00.000Z');
 const appended=await upload('run_000.dat','1,11,200,10000,6');assert.equal(appended.id,id);assert.equal(appended.tofConnection.tofDatasetId,'tof-a');assert.equal(appended.tofConnection.energyZeroTick,10000);
 const list=await(await fetch(root+'/api/energy/files')).json();assert.equal(list.datasets[0].tofConnection.tofDatasetId,'tof-a');
 const other=await upload('different.dat','1,11,100,100,6');assert.equal(other.tofConnection,null);
 for(const target of ['pending','missing'])assert.equal((await post('/api/energy/files/'+id+'/tof-connection',{sessionId:epoch,tofDatasetId:target})).status,400);
 assert.equal((await post('/api/energy/files/'+id+'/tof-connection',{sessionId:'old',tofDatasetId:'tof-b'})).status,409);
 const changed=await post('/api/energy/files/'+id+'/tof-connection',{sessionId:epoch,tofDatasetId:'tof-b'});assert.equal(changed.body.dataset.tofConnection.tofFilename,'corrected.lst');
 tofDatasets.delete('tof-b');const stale=await(await fetch(root+'/api/energy/files')).json();assert.equal(stale.datasets.find(ds=>ds.id===id).tofConnection,null);
 const disconnected=await post('/api/energy/files/'+id+'/tof-connection',{sessionId:epoch,tofDatasetId:null});assert.equal(disconnected.body.dataset.tofConnection,null);
 assert.equal(tofDatasets.size,2);assert.equal(tofDatasets.get('tof-a').filename,'original.lst');
});

function viewer(){
 const elements={},calls=[];let stream,empty=false;
 function element(){return {value:'',textContent:'',style:{},handlers:{},children:[],classList:{toggle(){}},addEventListener(n,fn){this.handlers[n]=fn},
  replaceChildren(){this.children=[]},appendChild(child){this.children.push(child)},showModal(){this.open=true},close(){this.open=false;this.handlers.close?.()}};}
 const ds=id=>({id,filename:id+'.dat',format:'niki',events:1,timebaseNs:10,firstTick:100,lastTick:200,channels:[{module:1,channel:11,label:'Bottom-Si'}],tofConnection:null});
 const datasets=[ds('energy-a'),ds('energy-b')];
 const context=vm.createContext({AbortController,URLSearchParams,initializeEnergyRoiDrag:()=>()=>{},
  document:{getElementById:id=>elements[id]??=element(),createElement:element,addEventListener(){}},window:{addEventListener(){}},
  setTimeout(){},clearTimeout(){},ResizeObserver:class{observe(){}},EventSource:class{constructor(){stream=this}},Plotly:{react:async()=>{}},
  fetch:async(url,options)=>{
   calls.push({url,options});let result;
   if(url==='/api/energy/files')result={ok:true,sessionId:'session',activeId:'energy-a',datasets};
   else if(url.endsWith('/tof-options')){const id=url.split('/')[4];result={ok:true,sessionId:'session',dataset:datasets.find(ds=>ds.id===id),tofSpectra:empty?[]:[{id:'tof-a',filename:'ToF a.lst'},{id:'tof-b',filename:'ToF b.lst'}]};}
   else if(url.endsWith('/tof-connection')){
    const id=url.split('/')[4],body=JSON.parse(options.body),energy=datasets.find(ds=>ds.id===id);
    energy.tofConnection=body.tofDatasetId===null?null:{tofDatasetId:body.tofDatasetId,tofFilename:body.tofDatasetId==='tof-a'?'ToF a.lst':'ToF b.lst',assumedSimultaneousStart:true};
    result={ok:true,sessionId:'session',dataset:energy};
   }
   else if(url.endsWith('/select'))result={ok:true};
   else result={ok:true,x:[100],counts:[1],range:[0,200],unit:'ch',binWidth:1,timebaseNs:10,plottedEvents:1,selectedEvents:1};
   return {ok:true,json:async()=>JSON.parse(JSON.stringify(result))};
  }});
 vm.runInContext(fs.readFileSync('public/js/energy-page.js','utf8'),context);
 return {context,elements,calls,run:code=>vm.runInContext(code,context),stream:()=>stream,setEmpty:()=>{empty=true}};
}
test('Connect to ToF opens a chooser, saves the selected spectrum per energy file, and supports disconnect',async()=>{
 const v=viewer();await v.run('EnergyViewer.start()');assert.equal(v.elements.energyConnectTof.disabled,false);
 const removeButton=()=>v.elements.energyFiles.children[0].children.at(-1).children[0];
 assert.equal(removeButton().disabled,false);
 await v.elements.energyConnectTof.handlers.click();assert.equal(v.elements.energyTofDialog.open,true);assert.equal(v.elements.energyTofChoices.children.length,2);assert.equal(v.elements.energyTofConfirm.disabled,true);
 const second=v.elements.energyTofChoices.children[1].children[0];second.handlers.change();assert.equal(v.elements.energyTofConfirm.disabled,false);
 await v.elements.energyTofConfirm.handlers.click();assert.match(v.elements.energyTofConnection.textContent,/ToF b.lst.*Start times assumed equal/);assert.equal(v.elements.energyTofDialog.open,false);
 assert.equal(removeButton().disabled,true);assert.match(removeButton().title,/Disconnect/);
 const request=v.calls.find(call=>call.url.endsWith('/tof-connection'));assert.equal(JSON.parse(request.options.body).tofDatasetId,'tof-b');
 await v.run('EnergyViewer.select("energy-b")');assert.equal(v.elements.energyTofConnection.textContent,'No ToF spectrum connected.');
 await v.run('EnergyViewer.select("energy-a")');assert.match(v.elements.energyTofConnection.textContent,/ToF b.lst/);
 await v.elements.energyTofDisconnect.handlers.click();assert.equal(v.elements.energyTofConnection.textContent,'No ToF spectrum connected.');assert.equal(v.elements.energyTofDisconnect.hidden,true);
 assert.equal(removeButton().disabled,false);
});
test('the ToF chooser handles no loaded spectra and removed connections',async()=>{
 const v=viewer();await v.run('EnergyViewer.start()');await v.elements.energyConnectTof.handlers.click();
 v.elements.energyTofChoices.children[0].children[0].handlers.change();await v.elements.energyTofConfirm.handlers.click();
 v.stream().onmessage({data:JSON.stringify({sessionId:'session',states:[]})});assert.equal(v.elements.energyTofConnection.textContent,'No ToF spectrum connected.');
 v.setEmpty();await v.elements.energyConnectTof.handlers.click();assert.equal(v.elements.energyTofChoices.children.length,0);assert.equal(v.elements.energyTofConfirm.disabled,true);assert.match(v.elements.energyTofStatus.textContent,/No ToF spectra are loaded/);
 v.elements.energyTofCancel.handlers.click();assert.equal(v.elements.energyTofDialog.open,false);
});
