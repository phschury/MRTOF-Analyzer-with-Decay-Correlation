const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const p=require('../preferences');
test('XML preferences survive save and reload, including escaped directory names',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'preferences-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const file=path.join(directory,'preferences.xml');
 assert.deepEqual(p.load(file),p.DEFAULTS);
 const values={...p.DEFAULTS,binWidthNs:6.4,minZoomUs:0.128,maxZoomUs:320,ejectionBreakUs:55,tofLowUs:3,tofHighUs:19,yScale:'logarithmic',safeLowUs:2,safeHighUs:30,listModeDirectory:path.join(directory,'a & b <c>')};
 p.save(values,file);assert.deepEqual(p.load(file),values);
 assert.match(fs.readFileSync(file,'utf8'),/a &amp; b &lt;c&gt;/);
});
test('partial XML overrides defaults; malformed and invalid preferences are rejected',()=>{
 assert.deepEqual(p.parse('<preferences><binWidthNs>1.6</binWidthNs></preferences>'),{...p.DEFAULTS,binWidthNs:1.6});
 for(const values of [{minZoomUs:0},{minZoomUs:-1},{maxZoomUs:Infinity},{minZoomUs:100,maxZoomUs:100},{minZoomUs:100,maxZoomUs:50},{ejectionBreakUs:0},{ejectionBreakUs:-1},{ejectionBreakUs:Infinity},{binWidthNs:0},{binWidthNs:0.15},{tofLowUs:20},{safeLowUs:30},{yScale:'bad'},{listModeDirectory:'relative'}])assert.throws(()=>p.validate({...p.DEFAULTS,...values}));
 for(const xml of ['<preferences>oops</preferences>','<preferences><binWidthNs></binWidthNs></preferences>','<!DOCTYPE preferences><preferences></preferences>'])assert.throws(()=>p.parse(xml));
});

test('legacy bin zoom limits migrate to microseconds using the saved bin width',()=>{
 const values=p.parse('<preferences><binWidthNs>6.4</binWidthNs><minZoomBins>20</minZoomBins><maxZoomBins>50000</maxZoomBins></preferences>');
 assert.equal(values.minZoomUs,0.128);assert.equal(values.maxZoomUs,320);
 assert.equal(p.parse(p.serialize({...p.DEFAULTS,minZoomUs:0.015,maxZoomUs:12.5})).minZoomUs,0.015);
});
