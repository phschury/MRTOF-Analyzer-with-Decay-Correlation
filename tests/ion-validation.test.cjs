const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const nubase=require('../nubase');
nubase.setNUBASEFromText(fs.readFileSync('nubase_4.mas20.txt','utf8'));

test('NUBASE validates known isotopes, molecules, counts and distinct isomer entries',()=>{
 for(const formula of ['Fr221','1Fr221','Rb85','2C12;3H1;1O16','2C12:3H1:1O16',' 2C12 ; H1 ','Tc99m','Tc99'])assert.equal(nubase.checkFormula(formula),true,formula);
 for(const formula of ['', ' ', 'Fr999','Xx221','221Fr','0Fr221','-1Fr221','1.5Fr221','Fr221;999','Fr221;;H1','Fr221;',';Fr221','Fr221;Xx1','Tc99q','9007199254740992Fr221'])assert.equal(nubase.checkFormula(formula),false,formula);
 assert.notEqual(nubase.getNuclide('Tc99'),nubase.getNuclide('Tc99m'));
 assert.equal(nubase.getNuclide('Tc99m').state,'m');
});
function viewer(formula='Fr221'){
 const input={classes:new Set(),classList:{toggle(name,on){on?input.classes.add(name):input.classes.delete(name)}}};
 const tableRow={querySelector:()=>input};
 const elements={fitSaveButton:{disabled:false},fitStatusText:{textContent:''}};
 const rows=[{formula,charge:'1',laps:'100',center:'123'}];
 const context=vm.createContext({rows,crypto:{randomUUID:()=> 'new-fit'},loadedFileStates:[{datasetId:'parent',fits:[]}],activeFileStateIndex:0,currentRoi:{lowUs:122,highUs:124},
  document:{getElementById:id=>elements[id],querySelectorAll:()=>[tableRow]},
  fetch:async(url,options)=>({ok:true,json:async()=>({ok:true,results:JSON.parse(options.body).formulas.map(formula=>({formula,valid:nubase.checkFormula(formula)}))})})});
 vm.runInContext(fs.readFileSync('public/js/fitting.js','utf8'),context);
 vm.runInContext(`validateRequiredFitFields=()=>true;collectFitTableRows=()=>rows.map(row=>({...row}));closeFitModal=()=>{};
 activeFitPreview={fitCenterUs:123,fitFwhmUs:0.04,countsInRoi:20};`,context);
 return {context,elements,rows,input,run:code=>vm.runInContext(code,context)};
}
test('Save Fit blocks nonexistent ions and retains the preview so the ion can be corrected',async()=>{
 const v=viewer('Fr999');await v.run('saveFitResult()');
 assert.equal(v.context.loadedFileStates[0].fits.length,0);assert.equal(v.run('activeFitPreview!==null'),true);
 assert.match(v.elements.fitStatusText.textContent,/Fr999/);assert.equal(v.input.classes.has('fitInputMissing'),true);
 assert.equal(v.elements.fitSaveButton.disabled,false);
 v.rows[0].formula='Fr221';await v.run('saveFitResult()');
 assert.equal(v.context.loadedFileStates[0].fits[0].formula,'Fr221');assert.equal(v.input.classes.has('fitInputMissing'),false);
});
test('Save Fit accepts molecular formulas and isomers from the mass table',async()=>{
 for(const formula of ['2C12;3H1;1O16','Tc99m']){
  const v=viewer(formula);await v.run('saveFitResult()');assert.equal(v.context.loadedFileStates[0].fits[0].formula,formula);
 }
});
test('Save Fit blocks saving if validation fails or the ion changes during the request',async()=>{
 const v=viewer();v.context.fetch=async()=>{throw new Error('Validation unavailable')};
 await v.run('saveFitResult()');assert.equal(v.context.loadedFileStates[0].fits.length,0);
 assert.match(v.elements.fitStatusText.textContent,/Validation unavailable/);
 v.context.fetch=async()=>{v.rows[0].formula='Fr999';return {ok:true,json:async()=>({ok:true,results:[{formula:'Fr221',valid:true}]})}};
 await v.run('saveFitResult()');assert.equal(v.context.loadedFileStates[0].fits.length,0);
 assert.match(v.elements.fitStatusText.textContent,/changed during validation/);
});
test('duplicate saves and changes to the preview cannot save a stale validation result',async()=>{
 const v=viewer();let resolveRequest,requests=0;
 v.context.fetch=()=>{requests++;return new Promise(resolve=>resolveRequest=resolve)};
 const pending=v.run('saveFitResult()');await v.run('saveFitResult()');assert.equal(requests,1);
 v.run('activeFitPreview=null');
 resolveRequest({ok:true,json:async()=>({ok:true,results:[{formula:'Fr221',valid:true}]})});await pending;
 assert.equal(v.context.loadedFileStates[0].fits.length,0);
});
test('validation API checks every formula against the workspace mass table',async t=>{
 const {app}=require('../main');const server=app.listen(0,'127.0.0.1');
 await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
 t.after(()=>{server.closeAllConnections();server.close()});
 const url=`http://127.0.0.1:${server.address().port}/api/ions/validate`;
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({formulas:['Fr221','Fr999','2C12;3H1;1O16','Tc99m','Fr221;999']})});
 assert.equal(response.status,200);const result=await response.json();assert.deepEqual(result.results.map(entry=>entry.valid),[true,false,true,true,false]);
 const invalid=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({formulas:[]})});assert.equal(invalid.status,400);
});
