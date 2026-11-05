const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const display=require('../public/js/number-display');
const preferences=require('../preferences');
test('thousands separators preserve sign, decimals, fixed precision and small numbers',()=>{
 display.set('comma');assert.equal(display.format(1234567.125),'1,234,567.125');
 assert.equal(display.format(-12345.25),'-12,345.25');
 assert.equal(display.format(1234567.1,{minimumFractionDigits:1,maximumFractionDigits:1}),'1,234,567.1');
 display.set('half-space');assert.equal(display.format(1234567.125),'1\u2009234\u2009567.125');
 assert.equal(display.format(12.5),'12.5');assert.equal(display.separators,'.\u2009');
 display.set('comma');assert.equal(display.separators,'.,');
});
test('separator preference defaults to comma, round-trips XML and rejects unknown values',()=>{
 assert.equal(preferences.DEFAULTS.thousandsSeparator,'comma');
 assert.equal(preferences.parse('<preferences></preferences>').thousandsSeparator,'comma');
 const xml=preferences.serialize({...preferences.DEFAULTS,thousandsSeparator:'half-space'});
 assert.equal(preferences.parse(xml).thousandsSeparator,'half-space');
 assert.throws(()=>preferences.validate({thousandsSeparator:'bad'}),/thousands/);
});
test('histogram axis references, offsets and run numbers use the selected grouping',()=>{
 const c=vm.createContext({NumberDisplay:display,window:{addEventListener(){}},document:{addEventListener(){},getElementById:()=>({value:'absolute'})}});
 vm.runInContext(fs.readFileSync('public/js/histogram-page.js','utf8'),c);
 vm.runInContext('plottedTags.set(3,{chartData:{datasets:[{ejectUs:27072.172}]}})',c);
 display.set('comma');
 const comma=JSON.parse(vm.runInContext('JSON.stringify(absoluteAxisTicks({min:0,max:10}))',c));
 assert.match(comma.title.text,/27,077,172\.0/);
 assert.ok(comma.ticktext.some(text=>text.includes(',')));
 assert.equal(vm.runInContext('formatNumber(123456)',c),'123,456');
 display.set('half-space');
 assert.equal(vm.runInContext('formatNumber(123456)',c),'123\u2009456');
 const space=JSON.parse(vm.runInContext('JSON.stringify(absoluteAxisTicks({min:0,max:10}))',c));
 assert.match(space.title.text,/27\u2009077\u2009172\.0/);
 assert.deepEqual(space.tickvals,comma.tickvals);
 display.set('comma');
});
test('heatmap groups the large reference and tick offsets without changing their coordinates',()=>{
 display.set('half-space');
 const c=vm.createContext({NumberDisplay:display,URLSearchParams,
 window:{location:{search:'?thousandsSeparator=half-space',origin:'http://localhost'},parent:{postMessage(){}},addEventListener(){}},
 document:{getElementById:id=>id==='driftTag'?null:{value:'',addEventListener(){}}}});
 vm.runInContext(fs.readFileSync('public/js/drift.js','utf8'),c);
 const axis=JSON.parse(vm.runInContext('JSON.stringify(driftTimeAxis(0,10,27072.172))',c));
 assert.match(axis.title.text,/27\u2009077\u2009172\.0/);
 assert.ok(axis.ticktext.some(text=>text.includes('\u2009')));
 axis.tickvals.forEach((x,i)=>assert.ok(Math.abs((x-5)*1000-Number(axis.ticktext[i].replaceAll('\u2009','')))<1e-5));
 display.set('comma');
});
