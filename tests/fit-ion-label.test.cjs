const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('saved fit legends use isotope names and superscript charges', () => {
  const context = vm.createContext({document: {addEventListener() {}}, window: {addEventListener() {}}});
  vm.runInContext(fs.readFileSync('public/js/histogram-page.js', 'utf8'), context);
  const label = (formula, charge) => {
    context.fit = {formula, charge};
    return vm.runInContext('fitIonLabel(fit)', context);
  };
  assert.equal(label('1Fr221', 1), '²²¹Fr⁺');
  assert.equal(label('1Fr221', 2), '²²¹Fr²⁺');
  assert.equal(label('1Rb85', '3+'), '⁸⁵Rb³⁺');
  assert.equal(label('Fr221', 1), '²²¹Fr⁺');
  assert.equal(label('1Fr221', ''), '²²¹Fr');
  assert.equal(label('2C12', 1), '¹²C₂⁺');
  assert.equal(label('2C12;3H1;1O16', 1), '¹²C₂¹H₃¹⁶O⁺');
  assert.equal(label('2C12;3H1;1O16', 2), '¹²C₂¹H₃¹⁶O²⁺');
  assert.equal(label('12C12;22H1;11O16', 12), '¹²C₁₂¹H₂₂¹⁶O₁₁¹²⁺');
  assert.equal(label(' 2C12 ; 3H1 ; 1O16 ', ''), '¹²C₂¹H₃¹⁶O');
  assert.equal(label('2C12;unknown', 1), '2C12;unknown⁺');
  assert.equal(label('', 1), 'Saved fit');
});


test('bottom results use actual hybrid FWHM for older saved fits and Gaussian sigma convention',()=>{
  const FitModels=require('../public/js/fit-models');
  const context=vm.createContext({FitModels,document:{addEventListener(){}},window:{addEventListener(){}}});
  vm.runInContext(fs.readFileSync('public/js/histogram-page.js','utf8'),context);
  for(const model of Object.keys(FitModels.models)) {
    const p={sigma:0.02,decay:-0.08,leftSwitching:0.01,rightSwitching:0.015};
    context.fit={fwhm:'0.0470964',fitResult:{model,params:Object.fromEntries(Object.entries(p).map(([key,value])=>[key,{value}]))}};
    const width=vm.runInContext('fitResultFwhmUs(fit)',context);
    assert.equal(width,FitModels.fullWidthHalfMaximum(model,p));
    if(model!=='gaussianConstant')assert.ok(width>0.0470964);
  }
  context.fit={fwhm:'0.123'};
  assert.equal(vm.runInContext('fitResultFwhmUs(fit)',context),'0.123');
  context.fit={fwhm:'0.234',fitResult:{model:'dualExpGaussian',params:{sigma:{value:0.02}}}};
  assert.equal(vm.runInContext('fitResultFwhmUs(fit)',context),'0.234');
});
