const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const FitParameters=require('../public/js/fit-parameters');
const FitModels=require('../public/js/fit-models');
test('dialog sends absolute uncertainty bounds, converts FWHM, and overwrites result inputs',async()=>{
  const input = (value,fixed) => ({value,dataset:{fixed:String(fixed)},parentElement:{querySelector:()=>null},classList:{toggle(){}},setAttribute(){},setCustomValidity(){},focus(){}});
  const center=input('123(2.1)',true),fwhm=input('0.04(0.01)',true),height=input('100(0)',true),bg=input('2(1)',false);
  const row={querySelector:sel=>sel==='.fitCenterInput'?center:fwhm,querySelectorAll:()=>[height,bg]};
  const elements={fitModelSelect:{value:'gaussianConstant'},fitPeakCountInput:{value:'1'},fitTagSelect:{value:'3'}};
  for(const id of ['fitStatusText','fitRunButton','fitSaveButton','fitCountsText','fitChi2Text','fitAreaText'])elements[id]={};
  let sent;
  const result={ok:true,params:{center:{value:123.1,sigma:0.2},fwhm:{value:0.041,sigma:0.002},sigma:{value:0.017,sigma:0.001},amplitude:{value:100,sigma:0},baseline:{value:2.1,sigma:0.1}},chi2:2,reducedChi2:1,dof:2,iterations:4,counts:5,fitCurve:[]};
  const context=vm.createContext({FitModels,FitParameters,structuredClone,console,
    document:{getElementById:id=>elements[id],querySelector:()=>row},
    extractRoiData:()=>[],drawCombinedChart(){},
    fetch:async(url,options)=>{sent=JSON.parse(options.body);return{ok:true,json:async()=>result}},
  });
  vm.runInContext(fs.readFileSync('public/js/fitting.js','utf8'),context);
  vm.runInContext('currentFitParams=structuredClone(defaultFitState); extractRoiData=()=>[]',context);
  await vm.runInContext('runFitPreview()',context);
  assert.equal(sent.initialFitState.params.center.sigma,2.1);
  assert.equal(sent.initialFitState.params.center.fixed,true);
  assert.ok(Math.abs(sent.initialFitState.params.sigma.sigma-0.01/2.3548200450309493)<1e-12);
  assert.equal(sent.initialFitState.params.amplitude.sigma,0);
  assert.equal(sent.initialFitState.params.amplitude.fixed,true);
  assert.equal(sent.initialFitState.params.baseline.fixed,false);
  assert.equal(center.value,'123.1(0.2)'); assert.equal(height.value,'100(0)');
  assert.equal(fwhm.value,'0.041(0.002)');assert.equal(elements.fitSaveButton.disabled,false);
});

function validationHarness() {
  const makeInput=(value,fixed=false)=>{
    const classes=new Set();
    return {value,dataset:{fixed:String(fixed),cleanValue:value,cleanFixed:String(fixed)},classes,
      classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name)},
      setAttribute(name,value){this[name]=value},setCustomValidity(value){this.validationMessage=value},focus(){this.focused=true}};
  };
  const inputs={center:makeInput('123(2.1)'),fwhm:makeInput('0.04(0.01)'),amplitude:makeInput('100(5)'),baseline:makeInput('2(1)')};
  const row={querySelector:selector=>selector==='.fitCenterInput'?inputs.center:inputs.fwhm,querySelectorAll:()=>[inputs.amplitude,inputs.baseline]};
  const elements={fitModelSelect:{value:'gaussianConstant'},fitPeakCountInput:{value:'1'},fitTagSelect:{value:'3'}};
  for(const id of ['fitStatusText','fitRunButton','fitSaveButton'])elements[id]={};
  const alerts=[];let requests=0;
  const context=vm.createContext({FitModels,FitParameters,structuredClone,window:{alert:message=>alerts.push(message)},
    document:{getElementById:id=>elements[id],querySelector:()=>row},drawCombinedChart(){},
    fetch:()=>{requests++;throw new Error('Unexpected request')},
  });
  vm.runInContext(fs.readFileSync('public/js/fitting.js','utf8'),context);
  vm.runInContext('currentFitParams=structuredClone(defaultFitState)',context);
  return {inputs,elements,alerts,context,requests:()=>requests};
}

test('valid edits are yellow, invalid edits red, and reverting clears the edit marker',()=>{
  const h=validationHarness();h.context.entry=h.inputs.center;
  h.inputs.center.value='124(2.1)';vm.runInContext('validateFitEntry("center",entry)',h.context);
  assert.ok(h.inputs.center.classes.has('fitEntryEdited'));
  assert.equal(h.inputs.center['aria-invalid'],'false');
  h.inputs.center.value='124(-2.1)';vm.runInContext('validateFitEntry("center",entry)',h.context);
  assert.ok(h.inputs.center.classes.has('fitEntryInvalid'));
  assert.ok(!h.inputs.center.classes.has('fitEntryEdited'));
  assert.equal(h.inputs.center['aria-invalid'],'true');
  h.inputs.center.value='123(2.1)';vm.runInContext('validateFitEntry("center",entry)',h.context);
  assert.equal(h.inputs.center.classes.size,0);
});

test('Run Fit highlights every invalid field, alerts once, and never submits or changes parameters',async()=>{
  const h=validationHarness();
  h.inputs.center.value='123(-2)';h.inputs.fwhm.value='abc';h.inputs.amplitude.value='-1(0)';
  await vm.runInContext('runFitPreview()',h.context);
  assert.equal(h.requests(),0);assert.equal(h.alerts.length,1);
  assert.match(h.alerts[0],/center:/);assert.match(h.alerts[0],/fwhm:/);assert.match(h.alerts[0],/amplitude:/);
  for(const key of ['center','fwhm','amplitude']) assert.ok(h.inputs[key].classes.has('fitEntryInvalid'));
  assert.equal(h.inputs.center.focused,true);assert.equal(h.elements.fitRunButton.disabled,false);
  assert.equal(vm.runInContext('currentFitParams.params.center.value',h.context),0);
});

test('Fixed with missing uncertainty is red and blocked; zero uncertainty is valid',async()=>{
  const h=validationHarness();h.inputs.center.dataset.fixed='true';h.inputs.center.value='123(?)';
  await vm.runInContext('runFitPreview()',h.context);
  assert.equal(h.requests(),0);assert.equal(h.alerts.length,1);
  h.inputs.center.value='123(0)';h.context.entry=h.inputs.center;
  vm.runInContext('validateFitEntry("center",entry)',h.context);
  assert.ok(!h.inputs.center.classes.has('fitEntryInvalid'));
  assert.ok(h.inputs.center.classes.has('fitEntryEdited'));
});

for (const model of ['exponentialGaussianHybrid','dualExpGaussian']) {
  test(`${model} dialog sends active shape inputs and ignores inactive background`,async()=>{
    const h=validationHarness();
    h.elements.fitModelSelect.value=model;
    vm.runInContext('extractRoiData=()=>[]',h.context);
    const right={...h.inputs.baseline,value:'0.12(0.02)',dataset:{fixed:'true'}};
    const oldQuery=h.context.document.querySelector;
    h.context.document.querySelector=()=>({...oldQuery(),querySelectorAll:()=>[h.inputs.amplitude,h.inputs.baseline,right]});
    h.inputs.baseline.value=model==='exponentialGaussianHybrid'?'-0.07(0.02)':'0.08(0.02)';
    h.inputs.baseline.dataset.fixed='true';
    let sent;
    h.context.fetch=async(_url,options)=>{sent=JSON.parse(options.body);throw new Error('captured request');};
    await vm.runInContext('runFitPreview()',h.context);
    assert.equal(sent.model,model);
    assert.equal(sent.initialFitState.params.sigma.value,0.04);
    assert.equal(sent.initialFitState.params.sigma.sigma,0.01);
    assert.equal(sent.initialFitState.params.baseline.value,0);
    if (model==='exponentialGaussianHybrid') {
      assert.equal(sent.initialFitState.params.decay.value,-0.07);
      assert.equal(sent.initialFitState.params.decay.fixed,true);
    } else {
      assert.equal(sent.initialFitState.params.leftSwitching.value,0.08);
      assert.equal(sent.initialFitState.params.rightSwitching.value,0.12);
      assert.equal(sent.initialFitState.params.rightSwitching.fixed,true);
      right.value='0(0)';sent=null;
      await vm.runInContext('runFitPreview()',h.context);
      assert.equal(sent,null);assert.match(h.alerts.at(-1),/rightSwitching/);
    }
  });
}


test('width conversion preserves the value and absolute uncertainty across model changes',()=>{
  const h=validationHarness();
  const converted=vm.runInContext('convertFitWidthEntry("0.04(0.01)","fwhm","sigma")',h.context);
  const parsed=FitParameters.parse(converted);
  assert.ok(Math.abs(parsed.value-0.04/2.3548200450309493)<1e-15);
  assert.ok(Math.abs(parsed.uncertainty-0.01/2.3548200450309493)<1e-15);
  h.context.converted=converted;
  const roundtrip=FitParameters.parse(vm.runInContext('convertFitWidthEntry(converted,"sigma","fwhm")',h.context));
  assert.ok(Math.abs(roundtrip.value-0.04)<1e-15);
  assert.ok(Math.abs(roundtrip.uncertainty-0.01)<1e-15);
  assert.equal(vm.runInContext('convertFitWidthEntry("invalid","sigma","fwhm")',h.context),'invalid');
  assert.equal(FitParameters.parse(vm.runInContext('convertFitWidthEntry("1(0)","sigma","fwhm")',h.context)).uncertainty,0);
});

for(const model of ['exponentialGaussianHybrid','dualExpGaussian']) {
  test(`${model} displays fitted sigma directly and saves the traced FWHM`,async()=>{
    const h=validationHarness();h.elements.fitModelSelect.value=model;
    for(const id of ['fitCountsText','fitChi2Text','fitAreaText'])h.elements[id]={};
    for(const input of Object.values(h.inputs))input.parentElement={querySelector:()=>null};
    const right={...h.inputs.baseline,value:'0.12(0.02)',dataset:{fixed:'false'}};
    const row={querySelector:selector=>({'.fitCenterInput':h.inputs.center,'.fitFwhmInput':h.inputs.fwhm,'.fitIonInput':{value:'1Fr221'},'.fitChargeInput':{value:'1'},'.fitLapsInput':{value:'100'}}[selector]),querySelectorAll:()=>[h.inputs.amplitude,h.inputs.baseline,right]};
    h.context.document.querySelector=()=>row;
    h.context.document.querySelectorAll=()=>[row];
    vm.runInContext('extractRoiData=()=>[]',h.context);
    const params={center:{value:123,sigma:0.1},sigma:{value:0.02,sigma:0.001},fwhm:{value:0.08000000123,sigma:0.002},amplitude:{value:100,sigma:1},decay:{value:-0.07,sigma:0.002},leftSwitching:{value:0.08,sigma:0.01},rightSwitching:{value:0.12,sigma:0.01}};
    h.context.fetch=async url=>({ok:true,json:async()=>url==='/api/ions/validate'
      ? {ok:true,results:[{formula:'1Fr221',valid:true}]}
      : {ok:true,params,chi2:2,reducedChi2:1,dof:2,iterations:4,counts:5,fitCurve:[]}});
    await vm.runInContext('runFitPreview()',h.context);
    assert.equal(h.inputs.fwhm.value,'0.02(0.001)');
    assert.equal(h.elements.fitSaveButton.disabled,false);
    const rows=vm.runInContext('collectFitTableRows()',h.context);
    assert.equal(rows[0].fwhm,undefined);
    h.context.loadedFileStates=[{fits:[]}];h.context.activeFileStateIndex=0;
    h.context.crypto={randomUUID:()=>model};h.context.currentRoi={lowUs:1,highUs:2};
    vm.runInContext('validateRequiredFitFields=()=>true;closeFitModal=()=>{}',h.context);
    await vm.runInContext('saveFitResult()',h.context);
    assert.equal(Number(h.context.loadedFileStates[0].fits[0].fwhm),0.08000000123);
    assert.equal(h.context.loadedFileStates[0].fits[0].fitResult.params.fwhm.value,0.08000000123);
    for(const text of ['0(0)','-1(0)'])assert.throws(()=>FitParameters.validate(text,'sigma',false));
  });
}
