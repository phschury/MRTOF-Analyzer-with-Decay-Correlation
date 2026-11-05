const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup(){
 const context=vm.createContext({window:{addEventListener(){}},document:{addEventListener(){},getElementById(id){return id==="timeMode"?{value:"absolute"}:null;}}});
 vm.runInContext(fs.readFileSync('public/js/histogram-page.js','utf8'),context);
 vm.runInContext(`
 const payload=(ejectUs,TAGnum)=>({chartData:{datasets:[{ejectUs,TAGnum,data:[{x:12,y:3,tofUs:ejectUs+12}]}]}});
 plottedTags=new Map([[0,payload(100,0)],[1,payload(300,1)]]);
 `,context);
 return context;
}
test('separated ejections preserve time offsets on one axis with absolute ticks and hover values',()=>{
 const c=setup();
 const run=code=>JSON.parse(vm.runInContext(`JSON.stringify(${code})`,c));
 assert.deepEqual(run('ejectionPanels()'),[100,300]);
 assert.equal(run('plotlyTrace(plottedTags.get(0).chartData.datasets[0],"TAG 0","red").xaxis'),'x');
 assert.equal(run('plotlyTrace(plottedTags.get(1).chartData.datasets[0],"TAG 1","red").xaxis'),'x');
 assert.equal(run('plotlyTrace({TAGnum:1,data:[{x:13,y:4}]},"Fit","black",true).xaxis'),'x');
 assert.deepEqual(run('plotlyTrace({TAGnum:1,data:[{x:13,y:4}]},"Fit","black",true).customdata'),[[13,313]]);
 assert.deepEqual(run('absoluteTicks({min:0,max:40},300).ticktext'),['300','310','320','330','340']);
 vm.runInContext('FULL_TOF_HIGH_US=250',c);
 assert.equal(run('ejectionPanels()'),null);
});
test('ROI hit testing chooses either panel and rejects the omitted gap',()=>{
 const c=setup();
 vm.runInContext('const layout={xaxis:{_offset:50,_length:400},xaxis2:{_offset:500,_length:400}}',c);
 assert.equal(vm.runInContext('panelAxisAt(layout,100)===layout.xaxis',c),true);
 assert.equal(vm.runInContext('panelAxisAt(layout,600)===layout.xaxis2',c),true);
 assert.equal(vm.runInContext('panelAxisAt(layout,475)',c),undefined);
});

test('Relative overlays both tags and Absolute restores the broken axis',()=>{
 const c=setup();
 vm.runInContext('const mode={value:"relative"}; document.getElementById=id=>id==="timeMode"?mode:null',c);
 assert.equal(vm.runInContext('ejectionPanels()',c),null);
 assert.equal(vm.runInContext('plotlyTrace(plottedTags.get(1).chartData.datasets[0],"TAG 1","red").xaxis',c),'x');
 vm.runInContext('mode.value="absolute"',c);
 assert.equal(vm.runInContext('plotlyTrace(plottedTags.get(1).chartData.datasets[0],"TAG 1","red").xaxis',c),'x');
});

test('absolute navigation can show only one TAG and removes the break outside the viewport',async()=>{
 const c=setup();
 const handlers={};
 const elements={tofLowUs:{value:'0'},tofHighUs:{value:'40'},timeMode:{value:'absolute'},
   histogramChart:{clientWidth:800,on(name,handler){handlers[name]=handler}},yScale:{value:'linear'},binWidth:{value:'320'},tag:{value:'0'}};
 let layout,traces;
 c.document.getElementById=id=>elements[id];
 c.Plotly={react:async(plot,t,l)=>{traces=t;layout=l}};
 vm.runInContext(`scheduleWorkspaceSave=()=>{};updateDriftCorrectButton=()=>{};
 roiIsReadyForFit=()=>false;updateStatus=()=>{};syncDriftWindow=()=>{};
 activeFitPreview=null;drawCombinedChart();`,c);
 await Promise.resolve();
 assert.equal(layout.annotations.length,1);
 assert.equal(layout.xaxis.title.text,'ToF - 100.0000 [µs]');
 assert.ok(layout.xaxis.ticktext.some(t=>Number(t)>=200));
 assert.equal(layout.xaxis2,undefined);
 assert.deepEqual(Array.from(traces[1].x),[54.6]);
 vm.runInContext('currentRoi={lowUs:11,highUs:13,tag:1};roiIsReadyForFit=()=>true;drawCombinedChart()',c);
 await Promise.resolve();
 const roiShapes=()=>layout.shapes.filter(s=>s.fillcolor==='rgba(255,200,0,0.20)');
 assert.equal(roiShapes().length,1);
 assert.equal(roiShapes()[0].x0,53.6);
 assert.equal(roiShapes()[0].x1,55.6);
 elements.tag.value='0';
 vm.runInContext('drawCombinedChart()',c);
 assert.equal(roiShapes()[0].x0,53.6);
 vm.runInContext('roiIsReadyForFit=()=>false',c);

 vm.runInContext('applyVisibleTofRange(50,60)',c);
 await Promise.resolve();
 assert.equal(layout.annotations.length,0);
 assert.equal(traces.length,1);
 assert.equal(traces[0].name,'TAG 1');
 assert.equal(layout.showlegend,true);
 assert.equal(layout.shapes.some(s=>s.fillcolor==='rgba(220,38,38,0.18)'),false);
 assert.deepEqual(Array.from(layout.xaxis.range),[50,60]);
 assert.equal(layout.xaxis.title.text,'ToF - 312400.0 [ns]');
 assert.ok(layout.xaxis.ticktext.includes('0'));
 assert.ok(layout.xaxis.ticktext.every(t=>Math.abs(Number(t))<=5000));
 vm.runInContext('applyVisibleTofRange(10,20)',c);
 await Promise.resolve();
 assert.equal(layout.annotations.length,0);
 assert.equal(layout.xaxis.title.text,'ToF - 115000.0 [ns]');
 assert.ok(layout.xaxis.ticktext.includes('0'));
 assert.ok(layout.xaxis.ticktext.every(t=>Math.abs(Number(t))<=5000));
 assert.equal(traces.length,1);
 assert.equal(traces[0].name,'TAG 0');
 assert.equal(layout.showlegend,true);
 assert.equal(elements.tofLowUs.value,'0');
 assert.equal(elements.tofHighUs.value,'40');
 assert.equal(layout.xaxis.minallowed,0);
 handlers.plotly_relayout({'xaxis.range':[-5,15]});
 assert.deepEqual(Array.from(layout.xaxis.range),[0,20]);
 elements.timeMode.value='relative';
 handlers.plotly_relayout({'xaxis.range[0]':-10,'xaxis.range[1]':30});
 assert.deepEqual(Array.from(layout.xaxis.range),[0,40]);
 assert.equal(elements.tofLowUs.value,'0');
 assert.equal(elements.tofHighUs.value,'40');
});

test('nanosecond axis reference rounds to 100 ps and tick offsets use the rounded origin',()=>{
 const c=setup();
 const axis=JSON.parse(vm.runInContext('JSON.stringify(absoluteAxisTicks({min:10.000064,max:20.000064}))',c));
 assert.equal(axis.title.text,'ToF - 115000.1 [ns]');
 axis.tickvals.forEach((x,i)=>assert.ok(Math.abs((100+x)*1000-115000.1-Number(axis.ticktext[i]))<1e-7));
});

test('microsecond axis reference rounds to 100 ps and tick offsets use the rounded origin',()=>{
 const c=setup();
 const axis=JSON.parse(vm.runInContext('JSON.stringify(absoluteAxisTicks({min:0.000064,max:82.6}))',c));
 assert.equal(axis.title.text,'ToF - 100.0001 [µs]');
 axis.tickvals.forEach((x,i)=>{
   const absolute=x>40?300+Math.max(0,x-42.6):100+x;
   assert.ok(Math.abs(absolute-100.0001-Number(axis.ticktext[i]))<1e-7);
 });
});
