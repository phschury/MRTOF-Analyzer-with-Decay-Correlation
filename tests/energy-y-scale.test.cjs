const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
async function viewer(){
 const elements={},requests=[],handlers={},registrations=[];let counts=[10000,5,10,20000];
 const element=()=>({value:'',style:{},textContent:'',children:[],handlers:{},classList:{toggle(){}},addEventListener(name,fn){this.handlers[name]=fn},replaceChildren(){this.children=[]},appendChild(child){this.children.push(child)}});
 const plot=elements.energyChart=element();plot.on=(name,fn)=>{registrations.push(name);handlers[name]=fn;};
 const Plotly={react:async(p,data,layout)=>{
   const range=p.layout?.uirevision===layout.uirevision?p._fullLayout.xaxis.range:layout.xaxis.range || [0,3];
   p.data=data;p.layout=layout;p._fullLayout={xaxis:{range:[...range]},yaxis:{range:[...layout.yaxis.range]}};
  },relayout:async(p,changes)=>{
   for(const [key,value]of Object.entries(changes)){
    if(key==='xaxis.range'){p.layout.xaxis.range=[...value];p._fullLayout.xaxis.range=[...value];}
    else if(key==='xaxis.range[0]' || key==='xaxis.range[1]'){const index=key.endsWith('[0]')?0:1;p._fullLayout.xaxis.range[index]=value;}
    else if(key==='xaxis.autorange' && value)p._fullLayout.xaxis.range=[0,3];
    else if(key==='yaxis.range'){p.layout.yaxis.range=[...value];p._fullLayout.yaxis.range=[...value];}
    else if(key==='yaxis.autorange')p.layout.yaxis.autorange=value;
   }
   handlers.plotly_relayout?.(changes);
  }};
 const ds={id:'a',filename:'energy.dat',format:'niki',events:4,timebaseNs:10,firstTick:0,lastTick:100,channels:[{module:1,channel:11,label:'Bottom'}],calibrations:{}};
 const context=vm.createContext({AbortController,URLSearchParams,initializeEnergyRoiDrag:()=>()=>{},window:{addEventListener(){}},document:{getElementById:id=>elements[id]??=element(),createElement:element,addEventListener(){}},
  setTimeout(){},clearTimeout(){},ResizeObserver:class{observe(){}},EventSource:class{},Plotly,fetch:async url=>{
   requests.push(url);let result={ok:true};
   if(url==='/api/energy/files')result={ok:true,sessionId:'s',activeId:'a',datasets:[ds]};
   else if(url.includes('/histogram?'))result={ok:true,x:[0,1,2,3],counts:[...counts],range:[0,3],binWidth:1,unit:elements.energyUnit.value==='keV'?'keV':'ch',timebaseNs:10,selectedEvents:4,plottedEvents:4};
   return {ok:true,json:async()=>result};
  }});
 vm.runInContext(fs.readFileSync('public/js/energy-page.js','utf8'),context);const run=code=>vm.runInContext(code,context);await run('EnergyViewer.start()');
 return {elements,plot,requests,registrations,run,setCounts:values=>{counts=values},pan:changes=>Plotly.relayout(plot,changes)};
}
test('Energy pan, zoom and reset fit visible step counts without reloading events or attaching duplicate handlers',async()=>{
 const v=await viewer();assert.deepEqual(Array.from(v.plot.layout.yaxis.range),[0,22000]);assert.equal(v.plot.layout.yaxis.fixedrange,true);
 const before=v.requests.length;
 await v.pan({'xaxis.range[0]':1,'xaxis.range[1]':2});assert.deepEqual(Array.from(v.plot.layout.yaxis.range),[0,11]);
 await v.pan({'xaxis.range':[0.1,0.4]});assert.deepEqual(Array.from(v.plot.layout.yaxis.range),[0,11000]);
 await v.pan({'xaxis.range':[0.6,0.8]});assert.deepEqual(Array.from(v.plot.layout.yaxis.range),[0,5.5]);
 await v.pan({'xaxis.range':[10,11]});assert.deepEqual(Array.from(v.plot.layout.yaxis.range),[0,1]);
 await v.pan({'xaxis.autorange':true});assert.deepEqual(Array.from(v.plot.layout.yaxis.range),[0,22000]);assert.equal(v.requests.length,before);
 await v.pan({'xaxis.range':[1,2]});await v.run('EnergyViewer.draw()');assert.deepEqual(Array.from(v.plot.layout.yaxis.range),[0,11]);
 assert.deepEqual(v.registrations,['plotly_relayout']);
});
test('Energy log scale, calibrated Box sum and refreshed noise cuts rescale to the visible data',async()=>{
 const v=await viewer();v.elements.energyChannel.value='box-sum';v.elements.energyChannel.handlers.change();await v.run('EnergyViewer.draw()');
 assert.equal(v.elements.energyUnit.value,'keV');await v.pan({'xaxis.range':[1,2]});assert.deepEqual(Array.from(v.plot.layout.yaxis.range),[0,11]);
 v.elements.energyYScale.value='log';await v.run('EnergyViewer.draw()');assert.deepEqual(Array.from(v.plot.layout.yaxis.range),[Math.log10(0.8),Math.log10(11)]);
 await v.pan({'xaxis.range':[10,11]});assert.deepEqual(Array.from(v.plot.layout.yaxis.range),[Math.log10(0.8),1]);
 await v.pan({'xaxis.range':[1,2]});v.setCounts([0,0,0,0]);await v.run('EnergyViewer.draw()');assert.deepEqual(Array.from(v.plot.layout.yaxis.range),[Math.log10(0.8),1]);
 v.elements.energyYScale.value='linear';await v.run('EnergyViewer.draw()');assert.deepEqual(Array.from(v.plot.layout.yaxis.range),[0,1]);
});
