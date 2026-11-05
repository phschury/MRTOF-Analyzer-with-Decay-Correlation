const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup(){
 const handlers={},selections=[];let captured=false;
 const plot={_fullLayout:{xaxis:{_offset:50,_length:400,p2d:x=>10+x/100},yaxis:{_offset:20,_length:200}},
  addEventListener:(name,fn)=>handlers[name]=fn,getBoundingClientRect:()=>({left:100,top:100}),appendChild(){},
  setPointerCapture(){captured=true},hasPointerCapture:()=>captured,releasePointerCapture(){captured=false}};
 const context=vm.createContext({window:{},document:{createElement:()=>({style:{},remove(){}})},plot,
  selection:{key:'file|1|11',gain:1,offset:0,unit:'ch'},onSelect:(roi,view)=>selections.push({roi:{...roi},view:{...view}})});
 vm.runInContext(fs.readFileSync('public/js/energy-roi.js','utf8'),context);
 vm.runInContext('cancel=window.initializeEnergyRoiDrag(plot,{getContext:()=>selection,onSelect})',context);
 const event=(clientX,options={})=>({clientX,clientY:150,ctrlKey:true,button:0,pointerId:1,prevented:false,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true},...options});
 return {handlers,selections,event,context};
}
test('energy Ctrl-drag selects ROI in either direction, clamps to the chart, and leaves ordinary drags alone',()=>{
 const v=setup();const ordinary=v.event(250,{ctrlKey:false});v.handlers.pointerdown(ordinary);assert.equal(ordinary.prevented,false);
 v.handlers.pointerdown(v.event(450));const move=v.event(250);v.handlers.pointermove(move);assert.equal(move.stopped,true);v.handlers.pointerup(v.event(250));
 assert.deepEqual(v.selections[0].roi,{low:11,high:13});
 v.handlers.pointerdown(v.event(250));v.handlers.pointerup(v.event(900));assert.deepEqual(v.selections[1].roi,{low:11,high:14});
 v.handlers.pointerdown(v.event(50));v.handlers.pointerup(v.event(450));assert.equal(v.selections.length,2);
});
test('calibrated selections store ADC bounds, and cancelled or stale drags do not select an ROI',()=>{
 const v=setup();v.context.selection={key:'file|1|11',gain:2,offset:3,unit:'keV'};
 v.handlers.pointerdown(v.event(250));v.handlers.pointerup(v.event(450));assert.deepEqual(v.selections[0].roi,{low:4,high:5});
 v.handlers.pointerdown(v.event(250));v.handlers.pointercancel(v.event(450));
 v.handlers.pointerdown(v.event(250));v.handlers.pointerup(v.event(251));
 v.handlers.pointerdown(v.event(250));v.context.selection={key:'other|1|11',gain:2,offset:3,unit:'keV'};v.handlers.pointerup(v.event(450));
 assert.equal(v.selections.length,1);
});
test('energy ROI persists per detector/file, follows calibration and clears without reloading or changing zoom',async()=>{
 const elements={},requests=[],relayouts=[],correlationRequests=[],boxEdits=[];let deletedRegions=[];
 function element(){return {value:'',textContent:'',style:{},handlers:{},children:[],classList:{toggle(){}},
  addEventListener(name,fn){this.handlers[name]=fn},setAttribute(){},replaceChildren(){this.children=[]},appendChild(node){this.children.push(node)},remove(){},
  getBoundingClientRect:()=>({left:100,top:100}),setPointerCapture(){this.captured=true},hasPointerCapture(){return this.captured},releasePointerCapture(){this.captured=false}};}
 const ds=id=>({id,filename:id+'.dat',format:'niki',events:2,timebaseNs:10,firstTick:0,lastTick:100,
  channels:[{module:1,channel:11,label:'Bottom'},{module:1,channel:12,label:'Right'}],calibrations:{},tofConnection:id==='a'?{tofDatasetId:'tof',tofFilename:'tof.lst'}:null});
 const context=vm.createContext({AbortController,URLSearchParams,window:{addEventListener(){}},
  document:{getElementById:id=>elements[id]??=element(),createElement:element,body:{appendChild(node){elements[node.id]=node}},addEventListener(){}},setTimeout(){},clearTimeout(){},ResizeObserver:class{observe(){}},EventSource:class{},
  Plotly:{react:async(plot,data,layout)=>{plot.layout=layout;const bounds=layout.xaxis.range||[0,100];plot._fullLayout={xaxis:{_offset:50,_length:400,p2d:x=>bounds[0]+x/400*(bounds[1]-bounds[0])},yaxis:{_offset:20,_length:200}};},
   relayout:async(plot,changes)=>{relayouts.push(changes);Object.assign(plot.layout,changes);}},
  fetch:async(url,options)=>{
   requests.push(url);let result;
   if(url==='/api/energy/files')result={ok:true,sessionId:'s',activeId:'a',datasets:[ds('a'),ds('b')]};
   else if(url.endsWith('/box-deleted-regions')){const body=JSON.parse(options.body);boxEdits.push(body);deletedRegions=body.restore?[]:[...deletedRegions,body.roi];result={ok:true,dataset:{boxDeletedRegions:deletedRegions}};}
   else if(url.endsWith('/correlate')){correlationRequests.push(JSON.parse(options.body));result={ok:true,dataset:{id:'correlated',filename:'correlated.lst'},correlation:{totalEvents:1,sourceEvents:2}};}
   else if(url.endsWith('/select'))result={ok:true};
   else {const q=new URL(url,'http://localhost').searchParams,kev=q.get('unit')==='keV',gain=kev?Number(q.get('gain')):1,offset=kev?Number(q.get('offset')):0;
    result={ok:true,x:[10,30.2,70.8].map(x=>x*gain+offset),counts:[2,1,3],range:[offset,100*gain+offset],unit:kev?'keV':'ch',binWidth:1,timebaseNs:10,plottedEvents:6,selectedEvents:6};}
   return {ok:true,json:async()=>result};
  }});
 vm.runInContext(fs.readFileSync('public/js/energy-roi.js','utf8'),context);context.initializeEnergyRoiDrag=context.window.initializeEnergyRoiDrag;
 vm.runInContext(fs.readFileSync('public/js/energy-page.js','utf8'),context);const run=code=>vm.runInContext(code,context);await run('EnergyViewer.start()');
 const event=x=>({clientX:x,clientY:150,ctrlKey:true,button:0,pointerId:1,preventDefault(){},stopImmediatePropagation(){}});
 const plot=elements.energyChart;const originalRange=[...plot.layout.xaxis.range];
 const menuAt=x=>plot.handlers.contextmenu({...event(x),ctrlKey:false,pageX:x,pageY:150});
 menuAt(250);const menu=elements.energyRoiMenu;
 assert.deepEqual(menu.children.map(child=>child.textContent),['Save ROI','Fit Gaussian','Clear ROI','Zoom out','Correlate']);
 assert.equal(menu.children.find(child=>child.textContent==='Save ROI').disabled,true);
 assert.equal(menu.children.find(child=>child.textContent==='Correlate').disabled,true);
 plot.handlers.pointerdown(event(250));plot.handlers.pointerup(event(450));assert.equal(elements.energyRoiStatus.textContent,'ROI: 25–75 ch');
 elements.energyCorrelationPreTime.value='0.1';elements.energyCorrelationPostTime.value='0.2';
 menuAt(350);assert.equal(menu.children.find(child=>child.textContent==='Correlate').disabled,false);await menu.children.find(child=>child.textContent==='Correlate').handlers.click();
 assert.deepEqual(correlationRequests,[{sessionId:'s',tofDatasetId:'tof',roi:{low:25,high:75},preTime:0.1,postTime:0.2,module:'1',channel:'11',timebaseNs:10,timeLow:'',timeHigh:''}]);
 assert.match(elements.energyStatus.textContent,/1 of 2 ToF events retained/);
 elements.energyCorrelationPreTime.value='';menuAt(350);await menu.children.find(child=>child.textContent==='Correlate').handlers.click();assert.equal(correlationRequests.length,1);assert.match(elements.energyStatus.textContent,/Enter nonnegative/);
 menuAt(450);plot.handlers.contextmenu(event(250));assert.equal(menu.style.display,'none');
 menuAt(50);assert.equal(menu.style.display,'none');
 plot.handlers.pointerdown(event(250));plot.handlers.pointerup(event(450));
 assert.equal(elements.energyRoiStatus.textContent,'ROI: 25–75 ch');assert.deepEqual([...plot.layout.xaxis.range],originalRange);
 elements.energyUnit.value='keV';elements.energyGain.value='2';elements.energyOffset.value='3';await run('EnergyViewer.draw()');
 assert.equal(elements.energyRoiStatus.textContent,'ROI: 53–153 keV');assert.equal(plot.layout.shapes[0].x0,53);assert.equal(plot.layout.shapes[0].x1,153);
 elements.energyChannel.value='12';elements.energyChannel.handlers.change();await run('EnergyViewer.draw()');assert.equal(elements.energyRoiStatus.textContent,'No ROI selected');
 elements.energyChannel.value='11';elements.energyChannel.handlers.change();await run('EnergyViewer.draw()');assert.equal(elements.energyRoiStatus.textContent,'ROI: 25–75 ch');
 await run('EnergyViewer.select("b")');assert.equal(elements.energyRoiStatus.textContent,'No ROI selected');
 menuAt(250);assert.equal(menu.children.some(child=>child.textContent==='Correlate'),false);
 const staleStart=menu.children.find(child=>child.textContent==='Clear ROI');
 await run('EnergyViewer.select("a")');assert.equal(elements.energyRoiStatus.textContent,'ROI: 25–75 ch');
 assert.equal(menu.style.display,'none');staleStart.handlers.click();assert.equal(elements.energyRoiStatus.textContent,'ROI: 25–75 ch');
 const before=requests.length;elements.energyRoiClear.handlers.click();assert.equal(elements.energyRoiStatus.textContent,'No ROI selected');assert.equal(plot.layout.shapes.length,0);assert.equal(requests.length,before);
 elements.energyChannel.value='box-sum';elements.energyChannel.handlers.change();await run('EnergyViewer.draw()');
 plot.handlers.pointerdown(event(250));plot.handlers.pointerup(event(450));assert.equal(elements.energyRoiStatus.textContent,'ROI: 25–75 keV');
 elements.energyCorrelationPreTime.value='0.1';menuAt(350);await menu.children.find(child=>child.textContent==='Correlate').handlers.click();
 assert.equal(correlationRequests[1].channel,'box-sum');assert.deepEqual(correlationRequests[1].roi,{low:25,high:75});assert.equal(elements.energyAxis.disabled,true);
 menuAt(350);const deleteButton=menu.children.find(button=>button.textContent==='Delete region');assert.equal(deleteButton.disabled,false);await deleteButton.handlers.click();
 assert.deepEqual(boxEdits[0].roi,{low:25,high:75});assert.equal(boxEdits[0].channel,'box-sum');assert.equal(elements.energyRoiStatus.textContent,'No ROI selected');
 menuAt(350);assert.equal(menu.children.find(button=>button.textContent==='Delete region').disabled,true);
 const restore=menu.children.find(button=>button.textContent==='Restore deleted regions');assert.equal(restore.disabled,false);await restore.handlers.click();assert.equal(boxEdits[1].restore,true);
 menuAt(350);assert.equal(menu.children.find(button=>button.textContent==='Restore deleted regions').disabled,true);
 // Save multiple regions, using the counts-weighted centroid rather than the bounds' midpoint.
 const action=label=>menu.children.find(button=>button.textContent===label);
 plot.handlers.pointerdown(event(250));plot.handlers.pointerup(event(450));menuAt(350);action('Save ROI').handlers.click();
 assert.equal(elements.energySavedRois.children[0].textContent,'Box sum 61 keV');
 assert.equal(plot.layout.shapes[0].label.text,'Box sum 61 keV');
 menuAt(350);assert.equal(action('Save ROI'),undefined);assert.ok(action('Remove ROI'));
 assert.equal(menu.children[0].textContent,'Remove ROI');
 plot.handlers.pointerdown(event(470));plot.handlers.pointerup(event(530));menuAt(500);action('Save ROI').handlers.click();
 assert.equal(elements.energySavedRois.children.length,2);assert.equal(plot.layout.shapes.length,2);
 assert.equal(elements.energySavedRois.children[1].textContent,'Box sum 88 keV'); // Empty ROI: midpoint fallback.
 elements.energyRoiClear.handlers.click();assert.equal(plot.layout.shapes.length,2);
 menuAt(350);assert.match(elements.energyRoiStatus.textContent,/Box sum 61 keV/);
 await action('Correlate').handlers.click();assert.deepEqual(correlationRequests.at(-1).roi,{low:25,high:75});
 action('Remove ROI').handlers.click();assert.equal(elements.energySavedRois.children.length,1);assert.equal(plot.layout.shapes.length,1);
 // Saving an overlapping selection must leave the earlier saved ROI intact.
 plot.handlers.pointerdown(event(450));plot.handlers.pointerup(event(510));menuAt(490);action('Save ROI').handlers.click();
 assert.equal(plot.layout.shapes.length,2);
 elements.energySavedRois.children[0].handlers.click();menuAt(490);assert.ok(action('Select Box sum 83 keV'));
 action('Remove ROI').handlers.click();assert.equal(elements.energySavedRois.children.length,1);
 await run('EnergyViewer.select("b")');assert.equal(elements.energySavedRois.children.length,0);
 await run('EnergyViewer.select("a")');assert.equal(elements.energySavedRois.children.length,1);
 elements.energyChannel.value='11';elements.energyChannel.handlers.change();await run('EnergyViewer.draw()');
 assert.equal(elements.energySavedRois.children.length,0);
 elements.energyUnit.value='keV';elements.energyGain.value='2';elements.energyOffset.value='3';await run('EnergyViewer.draw()');
 plot.handlers.pointerdown(event(250));plot.handlers.pointerup(event(450));menuAt(350);action('Save ROI').handlers.click();
 assert.equal(elements.energySavedRois.children[0].textContent,'Channel 11 Bottom 124 keV');
 elements.energyGain.value='3';await run('EnergyViewer.draw()');
 assert.equal(plot.layout.shapes[0].x0,78);assert.equal(plot.layout.shapes[0].x1,228);
 assert.equal(elements.energySavedRois.children[0].textContent,'Channel 11 Bottom 124 keV');
});
