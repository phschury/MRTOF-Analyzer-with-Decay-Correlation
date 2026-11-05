const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {driftResultsCsv}=require('../public/js/drift-export.js');
const data={ok:true,fitRunId:'run1',filename:'sample,"name".lst',channel:2,edge:1,tag:3,trancheSize:5000,successful:1,
 settings:{tofLowUs:12,tofHighUs:13,sweepLow:0,sweepHigh:10000},results:[
 {success:true,sweepLow:0,sweepHigh:5000,sweepCenter:2499.5,counts:10,centerUs:12.3,centerSigmaUs:0.0001,fwhmUs:0.03,fwhmSigmaUs:0.001,reducedChi2:1},
 {success:false,sweepLow:5000,sweepHigh:10000,counts:0,error:'No events, try again'}]};

test('CSV exports every tranche with nanoseconds, separate uncertainties, and escaped text',()=>{
 const csv=driftResultsCsv(data);
 assert.match(csv,/Center uncertainty \[ns\]/);
 assert.match(csv,/"sample,""name"".lst"/);
 assert.match(csv,/,12300,0.1,30,1,1,/);
 assert.match(csv,/"No events, try again"/);
 assert.equal(csv.trim().split('\r\n').length,3);
});

async function viewer(picker=false){
 const elements={},messages=[],requests=[];
 const element=()=>({disabled:false,textContent:'',children:[],handlers:{},addEventListener(n,f){this.handlers[n]=f},appendChild(c){this.children.push(c)}});
 for(const id of ['status','source','results','acceptResults','rejectResults','exportResults'])elements[id]=element();
 let saved='';
 const parent={postMessage:m=>messages.push(m)};
 const context=vm.createContext({AbortController,URLSearchParams,FitParameters:{format:String},driftResultsCsv,
 window:{location:{origin:'http://localhost:3000',search:'?trancheSize=5000'},parent,addEventListener(){},
 ...(picker?{showSaveFilePicker:async()=>({createWritable:async()=>({write:async text=>{saved=text},close:async()=>{}})})}:{})},
 document:{getElementById:id=>elements[id],createElement:element},Plotly:{newPlot:async()=>{}},
 fetch:async(url,options)=>{
 requests.push({url,body:options?.body?JSON.parse(options.body):null});
 const result=url.startsWith('/api/drift-fit?')?data:url==='/api/drift-correct'?{ok:true,dataset:{id:'corrected'},correction:{totalEvents:10,scaledEvents:10,discardedEvents:0,outsideEvents:0}}:{ok:true,dataset:{id:'corrected'}};
 return {ok:true,json:async()=>result};
 }});
 vm.runInContext(fs.readFileSync('public/js/drift-fits.js','utf8').replace(/run\(\);\s*$/,'globalThis.ready=run();'),context);
 await context.ready;
 return {elements,messages,requests,saved:()=>saved};
}

test('corrected data remains pending until Accept, then is added and closed',async()=>{
 const v=await viewer();
 assert.equal(v.messages.length,0);
 await v.elements.acceptResults.handlers.click();
 assert.equal(v.requests.at(-1).body.action,'accept');
 assert.deepEqual(v.messages.map(m=>m.type),['drift-corrected-dataset','drift-results-close']);
});
test('Reject deletes the pending spectrum and closes without adding it',async()=>{
 const v=await viewer();
 await v.elements.rejectResults.handlers.click();
 assert.equal(v.requests.at(-1).body.action,'reject');
 assert.deepEqual(v.messages.map(m=>m.type),['drift-results-close']);
});
test('Export saves CSV with the picker and leaves results open for a decision',async()=>{
 const v=await viewer(true);
 await v.elements.exportResults.handlers.click();
 assert.equal(v.saved(),driftResultsCsv(data));
 assert.equal(v.messages.length,0);
});
test('Export requests native save dialog when browser picker is unavailable',async()=>{
 const v=await viewer();
 await v.elements.exportResults.handlers.click();
 assert.equal(v.requests.at(-1).url,'/api/drift-fit/export');
 assert.equal(v.requests.at(-1).body.fitRunId,'run1');
 assert.equal(v.messages.length,0);
});

test('server accepts pending data or deletes rejected data without deleting accepted spectra',()=>{
 const routes={};const datasets=new Map([['corrected',{id:'corrected',pending:true}]]);
 const runs=new Map([['run1',{correctedDatasetId:'corrected'}]]);
 const context=vm.createContext({workspace:{publish(){}},app:{post:(path,handler)=>routes[path]=handler},listModeDatasets:datasets,driftFitRuns:runs,summarizeDataset:ds=>ds});
 const source=fs.readFileSync('main.js','utf8');
 vm.runInContext(source.slice(source.indexOf('app.post("/api/drift-correct/decision"'),source.indexOf('// Fallback for macOS')),context);
 const handler=routes['/api/drift-correct/decision'];
 const res={json(value){this.body=value},status(){return this}};
 handler({body:{fitRunId:'run1',action:'accept'}},res);
 assert.equal(datasets.get('corrected').pending,false);
 handler({body:{fitRunId:'run1',action:'reject'}},res);
 assert.equal(datasets.has('corrected'),true);
 datasets.get('corrected').pending=true;
 handler({body:{fitRunId:'run1',action:'reject'}},res);
 assert.equal(datasets.has('corrected'),false);
 assert.equal(runs.get('run1').correctedDatasetId,null);
});
