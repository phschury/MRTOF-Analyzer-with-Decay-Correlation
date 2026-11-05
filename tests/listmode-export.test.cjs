const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {parseListModeText}=require('../listmode');
const {serializeListmode,listmodeFilename}=require('../listmode-export');
const {makeDebouncedData}=require('../debounce');
const {makeDriftCorrectedData}=require('../drift-correction');
const hex=(tof,sweep,tag=0)=>((BigInt(tag)<<48n)|(BigInt(sweep)<<32n)|(BigInt(tof)<<4n)|9n).toString(16).padStart(16,'0');
const header=['[MPA4A] 315','time_patch=5b','cmline0=05/22/2024 18:00:00 source notes','cmline2=TP:0,100,300','cmline3=P:1000','custom_setting=preserve me'];
function source(){return parseListModeText([...header,'[DATA]',hex(1120000,1),hex(1120200,1),hex(1130000,2),hex(3130000,2,1)].join('\n'));}
function assertHeader(text){for(const line of header)assert.ok(text.split(/\r\n|\n|\r/).includes(line),line);}
function assertEvents(actual,expected){
 assert.equal(actual.length,expected.length);
 for(const key of ['sweep','rawSweep','tag','channel','edge'])assert.deepEqual([...actual[key]],[...expected[key]],key);
 assert.deepEqual([...actual.tof],[...expected.tof].map(Math.round));
}
test('filename moves .lst after the complete processing description',()=>{
 assert.equal(listmodeFilename('sample.lst [debounced; 20–1000 ns]'),'sample [debounced; 20–1000 ns].lst');
 assert.equal(listmodeFilename('sample.LST [drift corrected; 5000 sweeps] [debounced; 20–1000 ns]'),'sample [drift corrected; 5000 sweeps] [debounced; 20–1000 ns].lst');
 assert.equal(listmodeFilename('sample.lst'),'sample.lst');
});
test('debounced export inherits the parent header and contains only retained events',()=>{
 const parent=source();const {lm}=makeDebouncedData(parent,20,1000);
 assert.equal(lm.events.length,3);assert.equal(parent.events.length,4);
 const text=serializeListmode(lm);assertHeader(text);
 assertEvents(parseListModeText(text).events,lm.events);
 assert.equal(parent.headerLines.some(line=>line.startsWith('correlyzer_')),false);
});
test('drift-corrected export writes corrected times and keeps the header through further processing',()=>{
 const parent=source();
 const fit={trancheSize:1,settings:{sweepLow:1,sweepHigh:3},results:[
  {sweepLow:1,sweepHigh:2,success:true,params:{center:{value:112}}},
  {sweepLow:2,sweepHigh:3,success:true,params:{center:{value:113}}}]};
 const {lm}=makeDriftCorrectedData(parent,fit);
 assert.notEqual(lm.events.tof[2],parent.events.tof[2]);
 const text=serializeListmode(lm);assertHeader(text);
 const restored=parseListModeText(text,{ejectionBreakUs:1});
 assertEvents(restored.events,lm.events);
 const next=serializeListmode(makeDebouncedData(restored,20,1000).lm);
 assertHeader(next);assert.equal(next.match(/^correlyzer_processed=/gm).length,1);
});
test('sparse and out-of-order sweep rollovers survive export without relying on removed events',()=>{
 const lm=source();lm.events.sweep=Int32Array.from([65535,65536,131070,131069]);
 const text=serializeListmode(lm);assertEvents(parseListModeText(text).events,lm.events);
});
test('native timestamp layouts retain all non-time bits and reject timestamp overflow',()=>{
 for(const [timePatch,length,bits] of [['1a',12,28],['2a',12,28],['5b',16,28],['f3',16,36]]){
  const raw=((1n<<BigInt(length*4-1))|16n|9n).toString(16).padStart(length,'0');
  const lm={timePatch,headerLines:['time_patch='+timePatch,'[DATA]'],events:{length:1,raw:[raw],tof:[12345.6],rawSweep:[5],sweep:[5]}};
  const text=serializeListmode(lm),encoded=BigInt('0x'+text.trim().split('\n').at(-1));
  const mask=((1n<<BigInt(bits))-1n)<<4n;
  assert.equal(encoded&~mask,BigInt('0x'+raw)&~mask);
  assert.equal((encoded&mask)>>4n,12346n);
  lm.events.tof[0]=2**bits;assert.throws(()=>serializeListmode(lm),/cannot be represented/);
 }
});

function viewer(picker=true){
 const requests=[],written=[],options=[],menu={style:{},children:[],replaceChildren(){this.children=[]},appendChild(child){this.children.push(child)},getBoundingClientRect:()=>({width:100,height:100}),querySelector:()=>({focus(){}})};
 const context=vm.createContext({listmodeFilename,window:{addEventListener(){},scrollX:0,scrollY:0,innerWidth:1000,innerHeight:1000,
  ...(picker?{showSaveFilePicker:async opts=>{options.push(opts);return {createWritable:async()=>({write:async data=>written.push(data),close:async()=>{}})}}}:{})},
  document:{addEventListener(){},getElementById:()=>menu,createElement:()=>({setAttribute(){},addEventListener(name,fn){this[name]=fn}})},
  fetch:async(url,opts)=>{requests.push({url,opts});return {ok:true,blob:async()=>'exported data',json:async()=>({ok:true})}}});
 vm.runInContext(fs.readFileSync('public/js/histogram-page.js','utf8'),context);
 vm.runInContext(`hideChartContextMenu=()=>{};loadedFileStates=[{datasetId:'derived',kind:'debounced',displayName:'sample.lst [debounced; 20–1000 ns]'}]`,context);
 return {context,requests,written,options,menu,run:code=>vm.runInContext(code,context)};
}
test('spectrum menu offers Save as File for both derived kinds, but not uploaded files',()=>{
 const v=viewer();v.context.event={preventDefault(){},stopPropagation(){},target:{closest:()=>true},pageX:0,pageY:0};
 for(const kind of ['debounced','drift-corrected','uploaded']){
  v.context.kind=kind;v.run(`loadedFileStates[0].kind=kind;showSpectrumContextMenu(event,'derived')`);
  assert.equal(v.menu.children.some(button=>button.textContent==='Save as File'),kind!=='uploaded');
 }
});
test('spectrum menu disables removal of correlation connections and bulk removal containing one',()=>{
 const v=viewer();v.context.event={preventDefault(){},stopPropagation(){},target:{closest:()=>true},pageX:0,pageY:0};
 v.run(`loadedFileStates=[{datasetId:'linked',removalBlockedReason:'Disconnect energy spectra first.'},{datasetId:'free'}];showSpectrumContextMenu(event,'linked')`);
 const button=label=>v.menu.children.find(button=>button.textContent===label);
 assert.equal(button('Remove spectrum').disabled,true);assert.match(button('Remove spectrum').title,/Disconnect/);
 assert.equal(button('Remove all other spectra').disabled,false);
 v.run(`showSpectrumContextMenu(event,'free')`);
 assert.equal(button('Remove spectrum').disabled,false);assert.equal(button('Remove all other spectra').disabled,true);
 v.run(`loadedFileStates[0].removalBlockedReason=null;showSpectrumContextMenu(event,'free')`);
 assert.equal(button('Remove all other spectra').disabled,false);
});
test('save picker uses the descriptive filename and saves the requested spectrum',async()=>{
 const v=viewer();await v.run('saveSpectrumAsFile(loadedFileStates[0])');
 assert.equal(v.options[0].suggestedName,'sample [debounced; 20–1000 ns].lst');
 assert.equal(v.requests[0].url,'/api/listmode-datasets/derived/file');assert.deepEqual(v.written,['exported data']);
});
test('save uses the native dialog fallback and cancellation does not fetch or write data',async()=>{
 const v=viewer(false);await v.run('saveSpectrumAsFile(loadedFileStates[0])');
 assert.equal(v.requests[0].url,'/api/listmode-datasets/derived/save');assert.equal(v.requests[0].opts.method,'POST');
 const cancelled=viewer();cancelled.run(`window.showSaveFilePicker=async()=>{const error=new Error('Cancelled');error.name='AbortError';throw error}`);
 await cancelled.run('saveSpectrumAsFile(loadedFileStates[0])');assert.equal(cancelled.requests.length,0);
});
test('HTTP export returns a reloadable derived file with its inherited header and descriptive name',async t=>{
 const {app}=require('../main');
 const server=app.listen(0,'127.0.0.1');
 await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
 t.after(()=>{server.closeAllConnections();server.close()});
 const root=`http://127.0.0.1:${server.address().port}`;
 const upload=await fetch(root+'/api/listmode-file',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':'sample.lst'},body:[...header,'[DATA]',hex(1120000,1),hex(1120200,1)].join('\n')});
 const parent=await upload.json();assert.equal(parent.ok,true);
 const result=await fetch(root+'/api/debounce',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({datasetId:parent.datasetId,minNs:20,maxNs:1000})});
 const derived=await result.json();assert.equal(derived.ok,true);
 const response=await fetch(root+'/api/listmode-datasets/'+derived.dataset.id+'/file');
 assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/debounced/);
 assert.match(response.headers.get('content-disposition'),/\.lst/);
 const text=await response.text();assertHeader(text);
 const restored=parseListModeText(text);assert.equal(restored.events.length,1);assert.equal(restored.events.tof[0],1120000);
 assert.equal((await fetch(root+'/api/listmode-datasets/'+parent.datasetId+'/file')).status,400);
 assert.equal((await fetch(root+'/api/listmode-datasets/missing/file')).status,400);
});

test('older derived exports with embedded CRLF header lines and LF records reload their events',()=>{
 const {lm}=makeDebouncedData(source(),20,1000);
 // Reproduce the original exporter: one inherited header entry ends in CR,
 // then all header entries and event records are joined with LF.
 const oldHeader=[...lm.headerLines];oldHeader[1]+='\r';
 const text=[...oldHeader.filter(line=>line.trim()!=='[DATA]'),
  'correlyzer_processed=1','correlyzer_sweep_runs=[[0,0]]','[DATA]',...lm.events.raw,''].join('\n');
 assert.ok(text.includes('\r\n'));assert.ok(text.includes('[DATA]\n'));
 const restored=parseListModeText(text);assertEvents(restored.events,lm.events);
 assert.equal(restored.header.custom_setting,'preserve me');
});
test('new exports normalize inherited line endings throughout header and event records',()=>{
 const lm=source();lm.headerLines[1]+='\r';
 const text=serializeListmode(lm);
 assert.equal(text.replaceAll('\r\n','').includes('\n'),false);
 assert.equal(text.replaceAll('\r\n','').includes('\r'),false);
 assertHeader(text);assertEvents(parseListModeText(text).events,lm.events);
});
