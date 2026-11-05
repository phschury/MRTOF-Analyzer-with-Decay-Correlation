const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createEnergyListmodeParser,parseEnergyListmode,combineEnergyData,energyHistogram,COUNTER_MODULUS}=require('../energy-listmode');
const {boxSumReferenceTimes}=require('../energy-correlation');
const {planEnergyFiles}=require('../public/js/energy-import');
test('incremental parsing handles every text split, CRLF, BOM, incomplete records and rollover boundaries',()=>{
 const text='\uFEFF# 測定\r\n\r\n1,11,100,'+(COUNTER_MODULUS-10)+',6\r\n1,11\r\n1,0,200,'+(COUNTER_MODULUS-5)+'\n1,12,200,5,\r1,11,300,10';
 const expected=parseEnergyListmode(text,{filename:'run.dat'});
 assert.deepEqual([...expected.events.pulse],[100,200,300]);assert.equal(expected.incompleteLines,1);assert.equal(expected.rollovers,1);
 for(let split=0;split<=text.length;split++){
  const parser=createEnergyListmodeParser({filename:'run.dat'});parser.write(text.slice(0,split));parser.write(text.slice(split));assert.deepEqual(parser.finish(),expected);
 }
 const broken=createEnergyListmodeParser({filename:'broken.dat'});broken.write('# comment\r');broken.write('\n1,11,100,200\n1,11,b');
 assert.throws(()=>{broken.write('ad,300\n')},error=>error.filename==='broken.dat' && error.line===3 && error.record==='1,11,bad,300');
 const huge=createEnergyListmodeParser({filename:'huge.dat'});assert.throws(()=>huge.write('1'.repeat(65537)),/64 KiB/);
});
test('streamed events retain their original typed chunks and combine without nested parts or event copies',()=>{
 const parser=createEnergyListmodeParser();
 for(let i=0;i<65540;i++)parser.write('1,11,100,'+(COUNTER_MODULUS-65540+i)+'\n');
 const a=parser.finish({compact:false});assert.equal(a.parts.length,2);assert.equal(a.events.length,65540);assert.equal(a.events.ticks,undefined);
 assert.equal(a.parts[0].events.length,65536);assert.equal(a.parts[1].events.length,4);
 const next=createEnergyListmodeParser();next.write('1,12,200,5\n');const b=next.finish({compact:false});
 const combined=combineEnergyData([a,b]);assert.equal(combined.parts.length,3);assert.equal(combined.parts[0].events,a.parts[0].events);assert.equal(combined.parts[2].events,b.parts[0].events);
 assert.equal(combined.parts[2].tickOffset,COUNTER_MODULUS);assert.equal(combined.events.length,65541);
 const hist=energyHistogram(combined);assert.equal(hist.counts[100],65540);assert.equal(hist.counts[200],1);
 const times=boxSumReferenceTimes(combined,{}, {'1:11':{gain:1,offset:0},'1:12':{gain:1,offset:0}});assert.equal(times.length,65541);assert.equal(times[0],0);assert.equal(times.at(-1),65545/1e8);
 assert.throws(()=>parser.write('data'),/already finished/);
});
test('browser reads a logical 12.5 GiB batch sequentially with at most one 4 MiB slice in flight',async()=>{
 const elements={},requests=[],chunk=Buffer.alloc(4*1024**2);let manifest,inFlight=false,completed=0,slices=0,failAt=-1;
 const element=()=>({value:'',textContent:'',children:[],handlers:{},classList:{toggle(){}},addEventListener(name,fn){this.handlers[name]=fn},replaceChildren(){this.children=[]},appendChild(node){this.children.push(node)}});
 const ds={id:'combined',filename:'run_001–025.dat',format:'niki',events:25,timebaseNs:10,firstTick:0,lastTick:25,channels:[{module:1,channel:11,label:'Bottom'}],sourceFiles:[],calibrations:{}};
 const context=vm.createContext({AbortController,URLSearchParams,planEnergyFiles,initializeEnergyRoiDrag:()=>()=>{},document:{getElementById:id=>elements[id]??=element(),createElement:element,addEventListener(){}},window:{addEventListener(){}},setTimeout(){},clearTimeout(){},ResizeObserver:class{observe(){}},EventSource:class{},Plotly:{react:async()=>{}},
  fetch:async(url,options)=>{
   requests.push(url);let result={ok:true};
   if(url==='/api/energy/files')result={ok:true,sessionId:'s',datasets:[],activeId:null};
   else if(url==='/api/energy/imports'){manifest=JSON.parse(options.body);result={ok:true,sessionId:'s',importId:'batch'};}
   else if(url.endsWith('/chunks')){
    assert.equal(inFlight,false);inFlight=true;
    const index=Number(url.split('/')[6]),offset=Number(options.headers['X-Energy-Chunk-Offset']),size=Number(options.headers['X-Energy-File-Size']);
    assert.equal(index,completed);assert.ok(options.body.byteLength<=4*1024**2);await Promise.resolve();
    if(offset===failAt){inFlight=false;throw new Error('Failed to fetch');}
    const receivedBytes=offset+options.body.byteLength,complete=receivedBytes===size;if(complete)completed++;inFlight=false;
    result={ok:true,sessionId:'s',receivedBytes,complete};
   }else if(url.endsWith('/finish')){assert.equal(completed,manifest.files.length);result={ok:true,sessionId:'s',datasets:[ds],activeId:ds.id};}
   else if(url.includes('/histogram?'))result={ok:true,x:[100],counts:[25],range:[0,200],binWidth:1,unit:'ch',selectedEvents:25,plottedEvents:25};
   return {ok:true,json:async()=>result};
  }});
 vm.runInContext(fs.readFileSync('public/js/energy-import.js','utf8'),context);vm.runInContext(fs.readFileSync('public/js/energy-page.js','utf8'),context);await vm.runInContext('EnergyViewer.start()',context);
 context.files=Array.from({length:25},(_,i)=>({name:'run_'+String(i+1).padStart(3,'0')+'.dat',size:512*1024**2,
  arrayBuffer(){throw new Error('A whole-file read must never occur.');},slice(start,end){assert.equal(inFlight,false);assert.equal(i,completed);slices++;assert.ok(end-start<=chunk.length);return {arrayBuffer:async()=>chunk.subarray(0,end-start)};}}));
 await vm.runInContext('EnergyViewer.load(files)',context);
 assert.equal(slices,25*128);assert.equal(manifest.files.length,25);assert.equal(completed,25);assert.equal(elements.energyFilename.textContent,ds.filename);
 assert.ok(!requests.some(url=>url==='/api/energy/imports/batch' ));
 completed=0;failAt=chunk.length;context.files=[context.files[0]];
 await vm.runInContext('EnergyViewer.load(files)',context);
 assert.match(elements.energyStatus.textContent,/run_001.dat.*Failed to fetch/);assert.equal(elements.energyLoad.disabled,false);
 assert.ok(requests.includes('/api/energy/imports/batch'));assert.equal(elements.energyFilename.textContent,ds.filename);
});
test('HTTP chunks import 25 consecutive files, enforce sequential positions, and preserve diagnostics and atomic cancellation',async t=>{
 const {app}=require('../main'),server=app.listen(0,'127.0.0.1');
 await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
 t.after(()=>{server.closeAllConnections();server.close()});const root=`http://127.0.0.1:${server.address().port}`;
 const request=async(path,body,method=body===undefined?'GET':'POST')=>{const response=await fetch(root+path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};};
 const sessionId=(await request('/api/session')).body.sessionId;
 const files=Array.from({length:25},(_,index)=>({filename:'測定_'+String(index+1).padStart(3,'0')+'.dat',text:'\uFEFF# 測定\r\n'+(index===0?'1,11\r\n1,0,50,'+(COUNTER_MODULUS-20)+'\r\n':'')+'1,11,'+(100+index)+','+(index===0?COUNTER_MODULUS-10:index*10)+'\r\n'})).map(file=>({...file,buffer:Buffer.from(file.text)}));
 const begin=await request('/api/energy/imports',{sessionId,files:files.map(file=>({filename:file.filename,size:file.buffer.length}))});assert.equal(begin.status,200);const id=begin.body.importId;
 const chunk=async(batch,index,offset,size,bytes)=>{const response=await fetch(root+'/api/energy/imports/'+batch+'/files/'+index+'/chunks',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Energy-Chunk-Offset':String(offset),'X-Energy-File-Size':String(size)},body:bytes});return {status:response.status,body:await response.json()};};
 assert.equal((await chunk(id,0,1,files[0].buffer.length,files[0].buffer.subarray(0,1))).status,400);
 for(let index=0;index<files.length;index++){
  const {buffer}=files[index];
  for(let offset=0;offset<buffer.length;offset+=7){
   const end=Math.min(buffer.length,offset+7),result=await chunk(id,index,offset,buffer.length,buffer.subarray(offset,end));assert.equal(result.status,200);assert.equal(result.body.receivedBytes,end);assert.equal(result.body.complete,end===buffer.length);
   if(index===0 && offset===0){
    assert.equal((await request('/api/memory-usage')).status,200);
    assert.equal((await request('/api/energy/imports/'+id+'/finish',{})).status,400);
    assert.equal((await chunk(id,1,0,files[1].buffer.length,files[1].buffer.subarray(0,1))).status,400);
    assert.equal((await chunk(id,0,0,buffer.length,buffer.subarray(0,7))).status,400);
   }
  }
 }
 assert.equal((await request('/api/energy/files')).body.datasets.length,0);
 const finished=await request('/api/energy/imports/'+id+'/finish',{});assert.equal(finished.status,200);const data=finished.body.datasets[0];
 assert.equal(data.events,25);assert.equal(data.rollovers,1);assert.equal(data.incompleteLines,1);assert.equal(data.sourceFiles.length,25);assert.equal(data.lastTick-data.firstTick,260);
 const hist=(await request('/api/energy/files/'+data.id+'/histogram')).body;assert.equal(hist.plottedEvents,25);assert.deepEqual(hist.counts.slice(100,125),Array(25).fill(1));
 const invalidText=Buffer.from('1,11,100,0\r\n1,11,bad,200\r\n');
 const bad=(await request('/api/energy/imports',{sessionId,files:[{filename:'broken.dat',size:invalidText.length}]})).body.importId;
 assert.equal((await chunk(bad,0,0,invalidText.length,invalidText.subarray(0,15))).status,200);
 const failure=await chunk(bad,0,15,invalidText.length,invalidText.subarray(15));assert.equal(failure.status,400);assert.equal(failure.body.file,'broken.dat');assert.equal(failure.body.line,2);assert.match(failure.body.record,/bad/);
 assert.equal((await request('/api/energy/files')).body.datasets[0].events,25);
 assert.equal((await request('/api/energy/imports/'+bad,undefined,'DELETE')).status,200);
 const oversize=(await request('/api/energy/imports',{sessionId,files:[{filename:'oversize.dat'}]})).body.importId;
 assert.equal((await chunk(oversize,0,0,4*1024**2+1,Buffer.alloc(4*1024**2+1))).status,413);
 await request('/api/energy/imports/'+oversize,undefined,'DELETE');
 const stale=(await request('/api/energy/imports',{sessionId,files:[{filename:'stale.dat'}]})).body.importId;
 await chunk(stale,0,0,20,Buffer.from('1,11,'));await request('/api/session/new',{});
 assert.equal((await chunk(stale,0,5,20,Buffer.from('100,0'))).status,400);assert.equal((await request('/api/energy/files')).body.datasets.length,0);
});
