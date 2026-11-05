const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('bin width presets and custom nanoseconds convert to raw bins and restore correctly', () => {
  const element = () => ({ value: '', hidden: true, handlers: {}, children: [],
    addEventListener(name, fn) { this.handlers[name] = fn; },
    setAttribute() {}, appendChild(child) { this.children.push(child); }, focus() {},
    checkValidity() { return true; } });
  const elements = Object.fromEntries(['binWidth', 'binWidthNs', 'binWidthToggle', 'binWidthOptions'].map(id => [id, element()]));
  const context = vm.createContext({ setTimeout, clearTimeout, window: { addEventListener() {} }, document: {
    addEventListener() {}, getElementById: id => elements[id], createElement: element,
  }});
  vm.runInContext(fs.readFileSync('public/js/histogram-page.js', 'utf8'), context);
  vm.runInContext('initializeBinWidthEditor()', context);
  const presets = elements.binWidthOptions.children;
  assert.deepEqual(presets.map(button => button.textContent), Array.from({length: 11}, (_, n) => `${2 ** n} ns`));
  for (let n = 0; n <= 10; n++) {
    presets[n].handlers.click();
    assert.equal(Number(elements.binWidthNs.value), 2 ** n);
    assert.equal(Number(elements.binWidth.value), (2 ** n) * 10);
  }
  elements.binWidthNs.value = '3.7';
  elements.binWidthNs.handlers.input();
  assert.equal(elements.binWidth.value, '37');
  vm.runInContext('setValueIfPresent("binWidth", 320)', context);
  assert.equal(Number(elements.binWidthNs.value), 32);
});

test('automatic refresh reloads metadata for channel/edge and coalesces bin edits',async()=>{
 let timer, clears=0, valid=true;
 const calls=[];
 const context=vm.createContext({window:{addEventListener(){}},
  setTimeout:fn=>{timer=fn;return 1},clearTimeout:()=>{clears++},
  document:{addEventListener(){},getElementById:()=>({checkValidity:()=>valid})},
  metadata:async()=>calls.push('metadata'),histograms:async()=>calls.push('histograms')});
 vm.runInContext(fs.readFileSync('public/js/histogram-page.js','utf8'),context);
 vm.runInContext('loadedFileStates=[{datasetId:"file"}];activeFileStateIndex=0;loadMetadataData=metadata;loadAllHistogramsData=histograms',context);
 vm.runInContext('scheduleHistogramRefresh(true,0);scheduleHistogramRefresh();scheduleHistogramRefresh()',context);
 await timer();
 assert.deepEqual(calls,['metadata','histograms']);
 assert.equal(clears,3);
 calls.length=0;
 valid=false;
 vm.runInContext('scheduleHistogramRefresh()',context);
 await timer();
 assert.deepEqual(calls,[]);
 valid=true;
 vm.runInContext('scheduleHistogramRefresh(false,0)',context);
 await timer();
 assert.deepEqual(calls,['histograms']);
});

test('correction TAG uses the existing saved TAG field and loading preserves range controls',()=>{
 const values={channel:'2',edge:'1',tag:'3',driftCorrectionTag:'2',binWidth:'80',
  tofLowUs:'60.000',tofHighUs:'700.000',yScale:'linear',timeMode:'absolute',sliceInput:'5000'};
 const elements=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,{value}]));
 const context=vm.createContext({window:{addEventListener(){}},document:{addEventListener(){},getElementById:id=>elements[id]}});
 vm.runInContext(fs.readFileSync('public/js/histogram-page.js','utf8'),context);
 const settings=JSON.parse(vm.runInContext('JSON.stringify(collectViewerSettings())',context));
 assert.equal(settings.tag,'2');
 assert.equal(Object.hasOwn(settings,'driftCorrectionTag'),false);
 vm.runInContext('resetVisibleTofRange()',context);
 assert.equal(elements.tofLowUs.value,'60.000');
 assert.equal(elements.tofHighUs.value,'700.000');
});
