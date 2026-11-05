const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function setup(loader=async()=>{},multiLoader=async()=>{}){
 const alerts=[];
 const elements=Object.fromEntries(['loadFileButton','listmodeFile','status'].map(id=>[id,{
  handlers:{},classes:new Set(),disabled:false,value:'',textContent:'',files:[],
  addEventListener(name,handler){this.handlers[name]=handler},
  click(){this.clicked=true},
 }]));
 for(const element of Object.values(elements))element.classList={add:name=>element.classes.add(name),remove:name=>element.classes.delete(name)};
 const context=vm.createContext({window:{addEventListener(){},alert:message=>alerts.push(message)},document:{addEventListener(){},getElementById:id=>elements[id]},loader,multiLoader});
 vm.runInContext(fs.readFileSync('public/js/histogram-page.js','utf8'),context);
 vm.runInContext('loadSelectedFile=loader;loadSelectedFiles=multiLoader;initializeFileLoading()',context);
 const event=(files=[],types=['Files'])=>({dataTransfer:{files,types},preventDefault(){this.prevented=true}});
 return {...elements,event,alerts};
}

test('button highlights file drags, prevents navigation, and sends the dropped file to the shared loader',async()=>{
 const calls=[];
 const {loadFileButton:button,listmodeFile:input,event}=setup(async file=>calls.push(file));
 const drag=event();button.handlers.dragover(drag);
 assert.equal(drag.prevented,true);assert.equal(drag.dataTransfer.dropEffect,'copy');
 assert.equal(button.classes.has('file-drag-over'),true);
 button.handlers.dragleave();assert.equal(button.classes.size,0);
 const textDrag=event([],['text/plain']);button.handlers.dragover(textDrag);
 assert.equal(textDrag.prevented,undefined);assert.equal(button.classes.size,0);
 button.handlers.dragenter(event());
 const file={name:'sample.lst'},drop=event([file]);
 await button.handlers.drop(drop);
 assert.equal(drop.prevented,true);assert.deepEqual(calls,[file]);
 assert.equal(button.classes.size,0);assert.equal(button.disabled,false);
 button.handlers.click();assert.equal(input.clicked,true);
 input.files=[file];await input.handlers.change();
 assert.deepEqual(calls,[file,file]);assert.equal(input.value,'');
});

test('empty drops do not load; busy loads reject another drop and recover after errors',async()=>{
 let rejectLoad;
 const calls=[];
 const {loadFileButton:button,listmodeFile:input,status,event}=setup(file=>{
  calls.push(file);return new Promise((resolve,reject)=>{rejectLoad=reject});
 });
 await button.handlers.drop(event());
 assert.equal(calls.length,0);
 const pending=button.handlers.drop(event([{name:'first.lst'}]));
 assert.equal(button.disabled,true);assert.equal(input.disabled,true);
 await button.handlers.drop(event([{name:'second.lst'}]));
 assert.equal(calls.length,1);
 rejectLoad(new Error('Invalid listmode data'));await pending;
 assert.match(status.textContent,/Could not load file: Invalid listmode data/);
 assert.equal(button.disabled,false);assert.equal(input.disabled,false);
});

test('multiple files selected or dropped invoke combination and report failures with an alert',async()=>{
 const calls=[];let fail=false;
 const v=setup(async()=>assert.fail('Single-file loader should not run'),async files=>{calls.push(files);if(fail)throw new Error('Ejection times differ by more than 1 µs');});
 const files=[{name:'a.lst'},{name:'b.lst'}];
 v.listmodeFile.files=files;await v.listmodeFile.handlers.change();
 assert.deepEqual(Array.from(calls[0]),files);
 fail=true;await v.loadFileButton.handlers.drop(v.event(files));
 assert.equal(calls.length,2);assert.match(v.alerts[0],/Ejection times differ/);
 assert.equal(v.loadFileButton.disabled,false);assert.equal(v.listmodeFile.disabled,false);
});
test('multiple-file loading combines uploaded source IDs and selects the resulting spectrum',async()=>{
 const calls=[],restored=[];
 const context=vm.createContext({window:{addEventListener(){}},document:{addEventListener(){}},
  fetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({ok:true,dataset:{id:'combined',kind:'combined',filename:'combined.lst',viewerSettings:{tofLowUs:'7',tofHighUs:'9'}}})}}});
 vm.runInContext(fs.readFileSync('public/js/histogram-page.js','utf8'),context);
 context.restore=index=>restored.push(index);
 vm.runInContext(`saveCurrentViewerState=()=>{};restoreLoadedFileState=restore;
 loadSelectedFileData=async file=>{loadedFileStates.push({datasetId:file.name,settings:{tofLowUs:'7',tofHighUs:'9'}});activeFileStateIndex=loadedFileStates.length-1}`,context);
 context.files=[{name:'a.lst',size:100},{name:'b.lst',size:100}];
 await vm.runInContext('loadSelectedFiles(files)',context);
 assert.deepEqual(calls[0].body.datasetIds,['a.lst','b.lst']);
 assert.equal(calls[0].body.viewerSettings.tofLowUs,'7');
 assert.equal(vm.runInContext('loadedFileStates[2].kind',context),'combined');assert.deepEqual(restored,[2]);
});
