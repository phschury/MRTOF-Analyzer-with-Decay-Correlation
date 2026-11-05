const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {parseListModeText}=require('../listmode');
function displayDuration(period,totalSweeps){
 const lm=parseListModeText('time_patch=1a\ncmline3='+period+'\n[DATA]\n');
 const elements={runInfo:{innerHTML:''}};
 const context=vm.createContext({window:{addEventListener(){}},document:{addEventListener(){},getElementById:id=>elements[id]},
  payload:{header:{totalSweeps,sweepRateHz:lm.sweepRateHz},tagCounts:{}}});
 vm.runInContext(fs.readFileSync('public/js/histogram-page.js','utf8'),context);
 vm.runInContext('drawRunInfo(payload)',context);
 return elements.runInfo.innerHTML;
}
test('run duration uses recorded sweep rate without an additional master-cycle factor',()=>{
 assert.match(displayDuration('MP:50000.000',40),/40 sweeps \(1\.0 s\)/);
 assert.match(displayDuration('P:80000',40),/40 sweeps \(3\.2 s\)/);
 assert.match(displayDuration('MP:50000.000',3290550),/3290550 sweeps \(22 h 51 min\)/);
});
test('missing sweep-period metadata displays an unknown duration',()=>{
 assert.match(displayDuration('',40),/40 sweeps \(\(unknown\)\)/);
});
