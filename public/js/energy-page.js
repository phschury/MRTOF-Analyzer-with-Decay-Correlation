'use strict';
const EnergyViewer=(()=>{
  const $=id=>document.getElementById(id);
  const fields=['energyModule','energyChannel','energyBinWidth','energyYScale','energyUnit','energyGain','energyOffset','energyLow','energyHigh','energyTimebaseNs','energyTimeLow','energyTimeHigh'];
  const correlationFields=['energyCorrelationPreTime','energyCorrelationPostTime'];
  let datasets=[],activeId=null,sessionId=null,settings=new Map(),timer,requestSerial=0,controller=null,loading=false,viewRevision=0,chartContext=null,cancelRoiDrag=null;
  let plottedHistogram=null,yScaleAttached=false,energyFit=null;
  function visibleEnergyYRange(histogram,range,logarithmic){
    let maximum=0;
    const include=value=>{if(Number.isFinite(value) && (!logarithmic || value>0))maximum=Math.max(maximum,value);};
    const xs=histogram.x,ys=histogram.counts;
    for(let i=0;i<xs.length;i++){
      const x=xs[i],y=ys[i];if(!Number.isFinite(x) || !Number.isFinite(y))continue;
      if(x>=range[0] && x<=range[1])include(y);
      if(i===0)continue;
      const previousX=xs[i-1],previousY=ys[i-1];
      if(!Number.isFinite(previousX) || !Number.isFinite(previousY) || x<=previousX || x<range[0] || previousX>range[1])continue;
      const middle=(previousX+x)/2;
      if(range[0]<=middle && range[1]>=previousX)include(previousY);
      if(range[1]>=middle && range[0]<=x)include(y);
    }
    return logarithmic?[Math.log10(0.8),maximum>0?Math.log10(Math.max(1,maximum*1.1)):1]:[0,maximum>0?maximum*1.1:1];
  }
  function rescaleEnergyY(event={}){
    const plot=$('energyChart'),histogram=plottedHistogram;if(!histogram)return;
    const current=plot._fullLayout?.xaxis?.range || plot.layout?.xaxis?.range || histogram.range;
    const range=event['xaxis.autorange']===true?histogram.range:event['xaxis.range'] || [event['xaxis.range[0]']??current[0],event['xaxis.range[1]']??current[1]];
    if(!range?.every(Number.isFinite) || range[1]<=range[0])return;
    const next=visibleEnergyYRange(histogram,range,$('energyYScale').value==='log');
    const previous=plot.layout?.yaxis?.range;
    if(previous?.[0]===next[0] && previous?.[1]===next[1] && plot.layout.yaxis.autorange===false)return;
    return Plotly.relayout(plot,{'yaxis.autorange':false,'yaxis.range':next}).catch(error=>status(error.message,true));
  }
  const rois=new Map();
  const savedRois=new Map();
  let nextRoiId=0;
  const referenceSaves=new Map();
  function syncCorrelationReference(){
    const ds=active();if(!ds)return Promise.resolve();
    const context=roiContext(),roi=rois.get(context.key),id=ds.id;
    const body=JSON.stringify({sessionId,roi:completeRoi(roi)?{...roi}:null,module:$('energyModule').value,channel:$('energyChannel').value,
      timebaseNs:$('energyTimebaseNs').value,timeLow:$('energyTimeLow').value,timeHigh:$('energyTimeHigh').value,
      savedRois:[...savedRois].filter(([key])=>key.startsWith(id+'|')).flatMap(([,entries])=>entries)});
    const previous=referenceSaves.get(id);if(previous?.body===body)return previous.promise;
    const promise=(previous?.promise || Promise.resolve()).catch(()=>{}).then(()=>json('/api/energy/files/'+encodeURIComponent(id)+'/correlation-reference',{method:'POST',headers:{'Content-Type':'application/json'},body}));
    referenceSaves.set(id,{body,promise});
    promise.catch(error=>{if(referenceSaves.get(id)?.promise===promise)referenceSaves.delete(id);if(activeId===id)status(error.message,true);});
    return promise;
  }
  let roiMenu=null;
  let correlating=false;
  let editingBox=false;
  const completeRoi=roi=>roi && Number.isFinite(roi.low) && Number.isFinite(roi.high) && roi.high>roi.low;
  function hideRoiMenu(){if(roiMenu)roiMenu.style.display='none';}
  let tofDialogSerial=0,tofConnecting=false,tofEnergyId=null,tofChoice=null;
  const number=value=>typeof NumberDisplay!=='undefined'?NumberDisplay.format(value):Number(value).toLocaleString();
  const span=seconds=>seconds===null?'Timebase not specified':seconds<60?seconds.toFixed(3)+' s':seconds<3600?(seconds/60).toFixed(2)+' min':(seconds/3600).toFixed(2)+' h';
  const active=()=>datasets.find(ds=>ds.id===activeId);
  function status(message,error=false){$('energyStatus').textContent=message;$('energyStatus').classList.toggle('error',error);}
  async function json(url,options){const response=await fetch(url,options);const result=await response.json();if(!response.ok || !result.ok)throw new Error(result.error || 'Request failed.');return result;}
  function capture(){if(active())settings.set(activeId,Object.fromEntries([...fields,...correlationFields].map(id=>[id,$(id).value])));}
  function options(select,values,preferred){
    select.replaceChildren();for(const [value,label]of values){const option=document.createElement('option');option.value=String(value);option.textContent=label;select.appendChild(option);}
    select.value=values.some(([value])=>String(value)===String(preferred))?String(preferred):String(values[0]?.[0]??'');
  }
  function channels(preferred){
    const ds=active();if(!ds)return;
    const module=$('energyModule').value;
    const values=ds.channels.filter(row=>module==='' || String(row.module)===module);
    const grouped=new Map();for(const row of values){if(!grouped.has(row.channel))grouped.set(row.channel,[]);grouped.get(row.channel).push(row.label);}
    options($('energyChannel'),[...[...grouped].map(([channel,labels])=>[channel,channel+' · '+labels.join(' / ')]),['box-sum','Box detector sum'],['','All channels']],preferred);
  }
  function applyDetectorCalibration(){
    const ds=active();
    const calibration=ds?.calibrations?.[$('energyModule').value+':'+$('energyChannel').value];
    $('energyGain').value=calibration?.gain??1;
    $('energyOffset').value=calibration?.offset??0;
    $('energyUnit').value=calibration || $('energyChannel').value==='box-sum'?'keV':'ch';
    $('energyLow').value='';$('energyHigh').value='';
    controls();
  }
  function controls(){
    const boxSum=$('energyChannel').value==='box-sum';
    if(boxSum){$('energyUnit').value='keV';$('energyGain').value='1';$('energyOffset').value='0';$('energyLow').value='';$('energyHigh').value='';}
    $('energyAxis').disabled=boxSum;
    $('energyAxis').title=boxSum?'Box detector sum uses each channel’s own calibration and an automatic energy range.':'';
    $('energyUnit').disabled=$('energyLow').disabled=$('energyHigh').disabled=boxSum;
    const calibrated=$('energyUnit').value==='keV';
    $('energyGain').disabled=$('energyOffset').disabled=boxSum || !calibrated;$('energyBinUnit').textContent=calibrated?'[keV]':'[ch]';
    const timed=Number($('energyTimebaseNs').value)>0;
    $('energyTimeLow').disabled=$('energyTimeHigh').disabled=!timed;
    if(!timed){$('energyTimeLow').value='';$('energyTimeHigh').value='';}
  }
  function info(histogram){
    const ds=active();if(!ds){$('energyInfo').textContent='';return;}
    const format=ds.format==='niki'?'Niki: module, channel, pulse height, timestamp, optional extra':'USB-MCA: timestamp, channel, pulse height';
    const timing=histogram?.timebaseNs ?? (Number($('energyTimebaseNs').value)||null);
    const duration=timing===null?null:(ds.lastTick-ds.firstTick)*timing/1e9;
    $('energyInfo').textContent=format+' · '+number(ds.events)+' events · Recorded span: '+span(duration)+
      (timing===null?' · Enter the USB-MCA timebase to enable elapsed-time filtering.':' · '+timing+' ns/tick')+
      (ds.rollovers?' · '+number(ds.rollovers)+' timestamp rollover(s) unwrapped':'')+
      (ds.sourceFiles?.length>1?' · '+number(ds.sourceFiles.length)+' source files in this series':'')+
      ($('energyChannel').value==='box-sum'?' · Box detector sum: individual channel calibrations [keV]':'')+
      (ds.boxDeletedRegions?.length?' · '+number(ds.boxDeletedRegions.length)+' deleted Box sum region(s)':'')+
      (ds.calibrations?.[$('energyModule').value+':'+$('energyChannel').value]?' · Calibration: '+ds.calibrations[$('energyModule').value+':'+$('energyChannel').value].filename:'')+
      (ds.skippedEvents?' · '+number(ds.skippedEvents)+' events in Niki channels 0/1 not stored':'')+
      (ds.incompleteLines?' · '+number(ds.incompleteLines)+' incomplete Niki line(s) skipped':'')+
      (ds.calibrationWarnings?.length?' · Calibration file errors: '+ds.calibrationWarnings.join('; '):'');
  }
  function roiContext(){
    return {key:activeId+'|'+$('energyModule').value+'|'+$('energyChannel').value+($('energyChannel').value==='box-sum'?'|keV':''),
      unit:$('energyUnit').value,gain:$('energyUnit').value==='keV'?Number($('energyGain').value):1,
      offset:$('energyUnit').value==='keV'?Number($('energyOffset').value):0};
  }
  function plottedRoiContext(){
    return active() && chartContext?.serial===requestSerial && JSON.stringify(chartContext.view)===JSON.stringify(roiContext())?chartContext.view:null;
  }
  function roiShapes(context){
    const selected=rois.get(context.key),saved=savedRois.get(context.key)||[];
    const regions=[...saved];
    if(completeRoi(selected) && !saved.some(entry=>entry.roi===selected))regions.push({roi:selected});
    const shapes=regions.map(({roi,name})=>({type:'rect',xref:'x',yref:'paper',x0:roi.low*context.gain+context.offset,x1:roi.high*context.gain+context.offset,y0:0,y1:1,
      fillcolor:roi===selected?'rgba(255,200,0,0.20)':'rgba(35,130,185,0.12)',
      line:{color:roi===selected?'rgba(180,120,0,0.8)':'rgba(35,130,185,0.8)',width:1},layer:'below',
      ...(name?{label:{text:name,textposition:'top center',font:{size:11}}}:{})}));
    if(energyFit)shapes.push({type:'path',xref:'x',yref:'y',path:energyFit.result.fitCurve.map((p,i)=>(i?'L':'M')+p.x+','+p.y).join(' '),line:{color:'#c43d28',width:2}});
    return shapes;
  }
  function saveRoi(context){
    const roi=rois.get(context.key),saved=savedRois.get(context.key)||[];
    if(!completeRoi(roi) || saved.some(entry=>entry.roi===roi))return;
    const low=roi.low*context.gain+context.offset,high=roi.high*context.gain+context.offset;
    let total=0,weighted=0;
    for(let i=0;i<(plottedHistogram?.x.length||0);i++){
      const x=plottedHistogram.x[i],count=plottedHistogram.counts[i];
      if(x>=low && x<=high && Number.isFinite(count) && count>0){total+=count;weighted+=x*count;}
    }
    const channel=$('energyChannel').value,module=$('energyModule').value;
    const labels=[...new Set(active().channels.filter(row=>(module==='' || String(row.module)===module) && String(row.channel)===channel).map(row=>row.label))];
    const label=channel==='box-sum'?'Box sum':channel===''?'All channels':'Channel '+channel+(labels.length?' '+labels.join(' / '):'');
    const centroid=total>0?weighted/total:(low+high)/2;
    saved.push({id:'roi-'+(++nextRoiId),roi,name:label+' '+Math.round(centroid)+' '+context.unit,
      module,channel,timebaseNs:$('energyTimebaseNs').value,timeLow:$('energyTimeLow').value,timeHigh:$('energyTimeHigh').value});savedRois.set(context.key,saved);renderRoi();
  }
  function renderRoi(updatePlot=true){
    hideRoiMenu();
    if(active())syncCorrelationReference();
    const context=plottedRoiContext(),roi=context && rois.get(context.key);
    if(energyFit && (energyFit.serial!==requestSerial || energyFit.key!==context?.key || energyFit.low!==roi?.low || energyFit.high!==roi?.high))energyFit=null;
    $('energyFitStatus').textContent=energyFit?energyFit.summary:'';
    const format=value=>typeof NumberDisplay!=='undefined'?NumberDisplay.format(value,{maximumFractionDigits:4}):String(Number(value.toFixed(4)));
    $('energyRoiStatus').textContent=completeRoi(roi)?'ROI: '+format(roi.low*context.gain+context.offset)+'–'+format(roi.high*context.gain+context.offset)+' '+context.unit:roi?'ROI '+(Number.isFinite(roi.low)?'start: '+format(roi.low*context.gain+context.offset):'end: '+format(roi.high*context.gain+context.offset))+' '+context.unit+' · Set the other bound to complete the ROI.':'No ROI selected';
    $('energyRoiClear').disabled=!roi;
    const saved=context?(savedRois.get(context.key)||[]):[],selected=saved.find(entry=>entry.roi===roi);
    if(selected)$('energyRoiStatus').textContent=selected.name+' · '+$('energyRoiStatus').textContent;
    const list=$('energySavedRois');list.replaceChildren();
    for(const entry of saved){
      const button=document.createElement('button');button.type='button';button.textContent=entry.name;
      button.setAttribute('aria-pressed',String(entry.roi===roi));button.title='Select this saved ROI; right-click inside it for options.';
      button.addEventListener('click',()=>{if(JSON.stringify(plottedRoiContext())!==JSON.stringify(context))return;rois.set(context.key,entry.roi);renderRoi();});list.appendChild(button);
    }
    if(updatePlot && context && $('energyChart')._fullLayout)Plotly.relayout($('energyChart'),{shapes:roiShapes(context)}).catch(error=>status(error.message,true));
  }
  async function fitEnergyRoi(context){
    const roi=rois.get(context.key),serial=requestSerial;
    if(!completeRoi(roi) || !plottedHistogram)return;
    const low=roi.low,high=roi.high;
    try{
      const request=EnergyGaussianFit.request(plottedHistogram,low*context.gain+context.offset,high*context.gain+context.offset);
      status('Fitting Energy ROI…');
      const result=await json('/api/fit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
      const current=rois.get(context.key);
      if(serial!==requestSerial || plottedRoiContext()?.key!==context.key || current?.low!==low || current?.high!==high)return;
      const format=value=>Number(value).toPrecision(6);
      const parameter=key=>format(result.params[key].value)+(Number.isFinite(result.params[key].sigma)?' ± '+format(result.params[key].sigma):'');
      const summary='Gaussian fit · Centroid: '+parameter('center')+' '+context.unit+' · σ: '+parameter('sigma')+' '+context.unit+' · FWHM: '+parameter('fwhm')+' '+context.unit+' · Reduced χ²: '+(Number.isFinite(result.reducedChi2)?format(result.reducedChi2):'unavailable')+(result.warning?' · '+result.warning:'');
      energyFit={serial,key:context.key,low,high,result,summary};renderRoi();status('Energy Gaussian fit complete.');
    }catch(error){if(serial===requestSerial)status(error.message,true);}
  }
  function renderTofConnection(){
    hideRoiMenu();
    const ds=active(),connection=ds?.tofConnection;
    $('energyConnectTof').disabled=!ds || tofConnecting;
    $('energyTofDisconnect').hidden=!connection;$('energyTofDisconnect').disabled=tofConnecting;
    $('energyTofConnection').textContent=connection?'Connected to '+connection.tofFilename+' · Start times assumed equal.':'No ToF spectrum connected.';
    if(!ds && $('energyTofDialog').open)$('energyTofDialog').close();
  }
  function initializeRoiMenu(){
    const plot=$('energyChart');
    plot.addEventListener('contextmenu',event=>{
      event.preventDefault();hideRoiMenu();if(event.ctrlKey)return;
      const context=plottedRoiContext(),layout=plot._fullLayout;if(!context || !layout)return;
      const rect=plot.getBoundingClientRect(),axis=layout.xaxis;
      const x=event.clientX-rect.left-axis._offset,y=event.clientY-rect.top-layout.yaxis._offset;
      if(x<0 || x>axis._length || y<0 || y>layout.yaxis._length)return;
      const value=(axis.p2d(x)-context.offset)/context.gain;if(!Number.isFinite(value))return;
      const saved=savedRois.get(context.key)||[],current=rois.get(context.key);
      const hits=saved.filter(entry=>value>=entry.roi.low && value<=entry.roi.high);
      const hit=completeRoi(current) && value>=current.low && value<=current.high?hits.find(entry=>entry.roi===current):hits[0];
      if(hit){rois.set(context.key,hit.roi);renderRoi();}
      if(!roiMenu){roiMenu=document.createElement('div');roiMenu.id='energyRoiMenu';roiMenu.className='chart-context-menu spectrum-context-menu';roiMenu.setAttribute('role','menu');document.body.appendChild(roiMenu);}
      roiMenu.replaceChildren();
      const add=(label,action,disabled=false,title='')=>{
        const button=document.createElement('button');button.type='button';button.textContent=label;button.disabled=disabled;button.title=title;button.setAttribute('role','menuitem');
        button.addEventListener('click',()=>{
          hideRoiMenu();if(JSON.stringify(plottedRoiContext())!==JSON.stringify(context))return;
          return action();
        });roiMenu.appendChild(button);
      };
      const selected=saved.find(entry=>entry.roi===rois.get(context.key));
      if(selected)add('Remove ROI',()=>{
        savedRois.set(context.key,saved.filter(entry=>entry!==selected));rois.delete(context.key);renderRoi();
      },false,selected.name);
      if(!selected)add('Save ROI',()=>saveRoi(context),!completeRoi(rois.get(context.key)));
      add('Fit Gaussian',()=>fitEnergyRoi(context),!completeRoi(rois.get(context.key)));
      add('Clear ROI',()=>{rois.delete(context.key);renderRoi();},!rois.has(context.key));
      add('Zoom out',()=>{
        const range=axis.range;if(!range || range.length!==2)return;
        const middle=(range[0]+range[1])/2,width=range[1]-range[0];
        Plotly.relayout(plot,{'xaxis.range':[middle-width,middle+width]}).catch(error=>status(error.message,true));
      });
      if(active()?.tofConnection)add('Correlate',()=>correlate(context),correlating || !completeRoi(rois.get(context.key)),completeRoi(rois.get(context.key))?'Create a ToF spectrum using this Energy ROI.':'Select a complete energy ROI first.');
      if($('energyChannel').value==='box-sum'){
        add('Delete region',()=>editBoxRegions(context),editingBox || !completeRoi(rois.get(context.key)),'Exclude the ROI from Box detector sum and correlation-time analysis.');
        add('Restore deleted regions',()=>editBoxRegions(context,true),editingBox || !active()?.boxDeletedRegions?.length);
      }
      if(hits.length>1)for(const entry of hits)add('Select '+entry.name,()=>{rois.set(context.key,entry.roi);renderRoi();});
      roiMenu.style.left=event.pageX+'px';roiMenu.style.top=event.pageY+'px';roiMenu.style.display='block';
    });
    document.addEventListener('click',hideRoiMenu);
    document.addEventListener('keydown',event=>{if(event.key==='Escape')hideRoiMenu();});
    window.addEventListener('blur',hideRoiMenu);
    window.addEventListener('scroll',hideRoiMenu);
    window.addEventListener('resize',hideRoiMenu);
  }
  async function editBoxRegions(context,restore=false){
    const ds=active(),roi=rois.get(context.key);if(editingBox || !ds || !restore && !completeRoi(roi))return;
    const id=ds.id,epoch=sessionId;
    const body={sessionId:epoch,restore,channel:'box-sum',roi:restore?null:{...roi},module:$('energyModule').value,
      timebaseNs:$('energyTimebaseNs').value,timeLow:$('energyTimeLow').value,timeHigh:$('energyTimeHigh').value};
    editingBox=true;status(restore?'Restoring Box sum regions…':'Deleting Box sum region…');
    try{
      const result=await json('/api/energy/files/'+encodeURIComponent(id)+'/box-deleted-regions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(epoch!==sessionId)return;
      const current=datasets.find(ds=>ds.id===id);if(current)current.boxDeletedRegions=result.dataset.boxDeletedRegions;
      if(!restore)rois.delete(context.key);
      if(activeId===id){renderRoi(false);await draw();status(restore?'Restored deleted Box detector sum regions.':'Deleted '+roi.low+'–'+roi.high+' keV from Box detector sum and correlation-time references.');}
    }catch(error){if(epoch===sessionId && activeId===id)status(error.message,true);}
    finally{editingBox=false;hideRoiMenu();}
  }
  async function correlate(context){
    const ds=active(),roi=rois.get(context.key);
    if(correlating || !ds?.tofConnection || !completeRoi(roi))return;
    const preText=$('energyCorrelationPreTime').value.trim(),postText=$('energyCorrelationPostTime').value.trim();
    const preTime=Number(preText),postTime=Number(postText);
    if(!preText || !postText || !Number.isFinite(preTime) || !Number.isFinite(postTime) || preTime<0 || postTime<0){status('Enter nonnegative Pre-time and Post-time values in seconds.',true);return;}
    const epoch=sessionId,id=ds.id;
    correlating=true;status('Creating correlated ToF histogram…');
    try{
      const result=await json('/api/energy/files/'+encodeURIComponent(id)+'/correlate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        sessionId:epoch,tofDatasetId:ds.tofConnection.tofDatasetId,roi:{...roi},preTime,postTime,
        module:$('energyModule').value,channel:$('energyChannel').value,timebaseNs:$('energyTimebaseNs').value,timeLow:$('energyTimeLow').value,timeHigh:$('energyTimeHigh').value})});
      if(epoch!==sessionId || id!==activeId)return;
      status('Created '+result.dataset.filename+' · '+number(result.correlation.totalEvents)+' of '+number(result.correlation.sourceEvents)+' ToF events retained.');
      const link=document.createElement('a');link.href='/histogram.html';link.target='_blank';link.rel='noopener';link.textContent=' Open ToF Histogram Viewer';$('energyStatus').appendChild(link);
    }catch(error){if(epoch===sessionId && id===activeId)status(error.message,true);}
    finally{correlating=false;hideRoiMenu();}
  }
  function acceptTofConnection(result){
    if(sessionId && result.sessionId!==sessionId)throw new Error('A new session was started. Select the spectra again.');
    const ds=datasets.find(ds=>ds.id===result.dataset.id);if(ds)ds.tofConnection=result.dataset.tofConnection;
    renderTofConnection();fileTable();
  }
  function initializeTofConnection(){
    const dialog=$('energyTofDialog'),confirm=$('energyTofConfirm'),cancel=$('energyTofCancel');
    dialog.addEventListener('close',()=>{tofDialogSerial++;tofEnergyId=null;tofChoice=null;});
    dialog.addEventListener('cancel',event=>{if(tofConnecting)event.preventDefault();});
    cancel.addEventListener('click',()=>dialog.close());
    $('energyConnectTof').addEventListener('click',async()=>{
      const ds=active();if(!ds || dialog.open || tofConnecting)return;
      const serial=++tofDialogSerial;tofEnergyId=ds.id;tofChoice=null;
      $('energyTofSource').textContent=ds.filename;$('energyTofChoices').replaceChildren();confirm.disabled=true;
      $('energyTofStatus').textContent='Loading ToF spectra…';dialog.showModal();
      try{
        const result=await json('/api/energy/files/'+encodeURIComponent(ds.id)+'/tof-options');
        if(serial!==tofDialogSerial || tofEnergyId!==ds.id)return;
        acceptTofConnection(result);
        for(const tof of result.tofSpectra){
          const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');
          input.type='radio';input.name='energyTofChoice';input.value=tof.id;input.checked=result.dataset.tofConnection?.tofDatasetId===tof.id;
          if(input.checked)tofChoice=tof.id;
          text.textContent=tof.filename;label.appendChild(input);label.appendChild(text);$('energyTofChoices').appendChild(label);
          input.addEventListener('change',()=>{tofChoice=tof.id;confirm.disabled=false;});
        }
        confirm.disabled=!tofChoice;
        $('energyTofStatus').textContent=result.tofSpectra.length?'Select the ToF spectrum to connect.':'No ToF spectra are loaded. Load one in the ToF Histogram Viewer first.';
      }catch(error){if(serial===tofDialogSerial)$('energyTofStatus').textContent=error.message;}
    });
    confirm.addEventListener('click',async()=>{
      if(!tofEnergyId || !tofChoice || tofConnecting)return;
      tofConnecting=true;confirm.disabled=cancel.disabled=true;renderTofConnection();
      try{
        const result=await json('/api/energy/files/'+encodeURIComponent(tofEnergyId)+'/tof-connection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,tofDatasetId:tofChoice})});
        acceptTofConnection(result);dialog.close();
      }catch(error){$('energyTofStatus').textContent=error.message;}
      finally{tofConnecting=false;cancel.disabled=false;confirm.disabled=!tofChoice;renderTofConnection();}
    });
    $('energyTofDisconnect').addEventListener('click',async()=>{
      const ds=active();if(!ds || tofConnecting)return;tofConnecting=true;renderTofConnection();
      try{acceptTofConnection(await json('/api/energy/files/'+encodeURIComponent(ds.id)+'/tof-connection',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,tofDatasetId:null})}));}
      catch(error){status(error.message,true);}
      finally{tofConnecting=false;renderTofConnection();}
    });
  }
  function fileTable(){
    const body=$('energyFiles');body.replaceChildren();
    for(const ds of datasets){
      const tr=document.createElement('tr');tr.classList.toggle('activeDatasetRow',ds.id===activeId);
      const name=document.createElement('td'),button=document.createElement('button');button.type='button';button.className='energy-file-select';button.textContent=(ds.id===activeId?'▶ ':'')+ds.filename;button.title=(ds.sourceFiles||[ds.filename]).join('\n');
      button.addEventListener('click',()=>select(ds.id).catch(error=>status(error.message,true)));name.appendChild(button);tr.appendChild(name);
      for(const text of [ds.format==='niki'?'Niki':'USB-MCA',number(ds.events),span(ds.recordedSpanSec)]){const td=document.createElement('td');td.textContent=text;tr.appendChild(td);}
      const td=document.createElement('td'),remove=document.createElement('button');remove.type='button';remove.className='energy-remove';remove.textContent='Remove';remove.disabled=loading || !!ds.tofConnection;
      if(ds.tofConnection)remove.title='Disconnect from the ToF spectrum before removing this energy spectrum.';
      remove.addEventListener('click',async()=>{try{const result=await json('/api/energy/files/'+encodeURIComponent(ds.id),{method:'DELETE'});settings.delete(ds.id);for(const store of [rois,savedRois])for(const key of store.keys())if(key.startsWith(ds.id+'|'))store.delete(key);datasets=result.datasets;if(activeId===ds.id)await select(result.activeId);else fileTable();}catch(error){status(error.message,true);}});
      td.appendChild(remove);tr.appendChild(td);body.appendChild(tr);
    }
  }
  async function select(id){
    cancelRoiDrag?.();chartContext=null;plottedHistogram=null;capture();activeId=id;requestSerial++;controller?.abort();renderRoi(false);
    const ds=active();fileTable();renderTofConnection();
    if(!ds){$('energyFilename').textContent='No energy listmode file loaded';$('energyInfo').textContent='';status('Choose a decay energy listmode file.');await Plotly.react($('energyChart'),[],{xaxis:{title:{text:'Pulse height [ch]'}},yaxis:{title:{text:'Counts'}}},{responsive:true,displaylogo:false});return;}
    $('energyFilename').textContent=ds.filename;
    const saved=settings.get(id);
    const modules=[...new Set(ds.channels.map(row=>row.module))];
    options($('energyModule'),[...modules.map(module=>[module,module===-1?'USB-MCA':String(module)]),['','All modules']],saved?.energyModule);
    channels(saved?.energyChannel);
    const defaults={energyBinWidth:'1',energyYScale:'linear',energyUnit:'ch',energyGain:'1',energyOffset:'0',energyLow:'',energyHigh:'',energyTimebaseNs:ds.timebaseNs??'',energyTimeLow:'',energyTimeHigh:'',energyCorrelationPreTime:'0',energyCorrelationPostTime:'0'};
    for(const [key,value]of Object.entries(defaults))$(key).value=saved?.[key]??value;
    if(!saved || ds.calibrations?.[$('energyModule').value+':'+$('energyChannel').value])applyDetectorCalibration();
    controls();info();
    await json('/api/energy/files/'+encodeURIComponent(id)+'/select',{method:'POST'});
    if(activeId===id)await draw(true);
  }
  function query(){
    return new URLSearchParams({module:$('energyModule').value,channel:$('energyChannel').value,binWidth:$('energyBinWidth').value,
      unit:$('energyUnit').value,gain:$('energyGain').value,offset:$('energyOffset').value,low:$('energyLow').value,high:$('energyHigh').value,
      timebaseNs:$('energyTimebaseNs').value,timeLow:$('energyTimeLow').value,timeHigh:$('energyTimeHigh').value});
  }
  async function draw(reset=false){
    hideRoiMenu();energyFit=null;$('energyFitStatus').textContent='';
    if(!active())return;
    const id=activeId,serial=++requestSerial;controller?.abort();controller=new AbortController();capture();
    status('Updating energy histogram…');
    try{
      const histogram=await json('/api/energy/files/'+encodeURIComponent(id)+'/histogram?'+query(),{signal:controller.signal});
      if(serial!==requestSerial || id!==activeId)return;
      if(reset)viewRevision++;
      const logarithmic=$('energyYScale').value==='log';
      const channel=active().channels.find(row=>String(row.channel)===$('energyChannel').value && String(row.module)===$('energyModule').value);
      const plot=$('energyChart'),view=roiContext();
      await Plotly.react(plot,[{x:histogram.x,y:histogram.counts,type:'scatter',mode:'lines',name:$('energyChannel').value==='box-sum'?'Box detector sum':channel?.label || 'Selected channels',
        line:{color:'#174b79',width:1.3,shape:'hvh'},hovertemplate:'%{x:.4f} '+histogram.unit+'<br>%{y} counts<extra></extra>'}],{
        separators:typeof NumberDisplay!=='undefined'?NumberDisplay.separators:'.,',margin:{l:75,r:25,t:30,b:65},
        uirevision:viewRevision+'|'+id+'|'+$('energyUnit').value+'|'+$('energyLow').value+'|'+$('energyHigh').value,
        xaxis:{title:{text:histogram.unit==='keV'?'Energy [keV]':'Pulse height [ADC channel]'},range:histogram.range,tickformat:',~f',separatethousands:true},
        yaxis:{title:{text:'Counts / '+histogram.binWidth+' '+histogram.unit},type:logarithmic?'log':'linear',autorange:false,range:visibleEnergyYRange(histogram,histogram.range,logarithmic),fixedrange:true},
        dragmode:'zoom',hovermode:'closest',showlegend:false,shapes:roiShapes(view),
      },{responsive:true,displaylogo:false,scrollZoom:false,showLink:false,modeBarButtonsToRemove:['select2d','lasso2d']});
      if(serial!==requestSerial || id!==activeId)return;
      plottedHistogram=histogram;
      if(typeof plot.on==='function'){
        if(!yScaleAttached){
          plot.on('plotly_relayout',event=>{if(Object.keys(event).some(key=>key==='xaxis.range' || key.startsWith('xaxis.range[') || key==='xaxis.autorange'))rescaleEnergyY(event);});
          yScaleAttached=true;
        }
        await rescaleEnergyY();
      }
      chartContext={serial,view};renderRoi(false);await syncCorrelationReference();
      info(histogram);status(number(histogram.plottedEvents)+' events plotted · '+number(histogram.selectedEvents)+' events in selected detector/time window · '+number(histogram.counts.length)+' bins');
    }catch(error){if(error.name!=='AbortError' && serial===requestSerial)status(error.message,true);}
  }
  async function load(files){
    if(loading || !files?.length)return;
    files=Array.from(files);loading=true;$('energyLoad').disabled=$('energyFile').disabled=true;fileTable();let importId=null;
    try{
      const plan=planEnergyFiles(files),calibrationFiles=[];
      for(const index of plan.calibrations){const file=files[index];if(file.size>65536)throw new Error('Calibration files must be smaller than 64 KiB.');calibrationFiles.push({filename:file.name,text:await file.text()});}
      const dataFiles=files.filter((_,index)=>!plan.calibrations.includes(index));
      if(dataFiles.some(file=>!Number.isSafeInteger(file.size) || file.size<=0))throw new Error('Choose nonempty data files with supported sizes.');
      const batch=await json('/api/energy/imports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId,files:dataFiles.map(file=>({filename:file.name,size:file.size})),calibrations:calibrationFiles})});
      importId=batch.importId;
      for(let index=0;index<dataFiles.length;index++){
        const file=dataFiles[index],chunkSize=4*1024**2;
        for(let offset=0;offset<file.size;offset+=chunkSize){
          const end=Math.min(file.size,offset+chunkSize);
          status('Loading '+file.name+' ('+(index+1)+'/'+dataFiles.length+') · '+Math.floor(offset/file.size*100)+'%');
          try{
            const result=await json('/api/energy/imports/'+encodeURIComponent(importId)+'/files/'+index+'/chunks',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Energy-Chunk-Offset':String(offset),'X-Energy-File-Size':String(file.size)},body:await file.slice(offset,end).arrayBuffer()});
            if(result.receivedBytes!==end || result.complete!==(end===file.size))throw new Error('The server did not confirm the complete file chunk.');
          }catch(error){throw new Error(file.name+' ('+(index+1)+'/'+dataFiles.length+', '+Math.floor(offset/file.size*100)+'%): '+error.message);}
        }
      }
      const result=importId?await json('/api/energy/imports/'+encodeURIComponent(importId)+'/finish',{method:'POST'}):batch;
      importId=null;
      if(sessionId && sessionId!==result.sessionId)throw new Error('The session changed. Reload the viewer.');
      capture();sessionId=result.sessionId;datasets=result.datasets;
      await select(result.activeId);
      if(!dataFiles.length){applyDetectorCalibration();await draw();status('Calibration files loaded.');}
    }catch(error){status(error.message,true);}
    finally{if(importId)await fetch('/api/energy/imports/'+encodeURIComponent(importId),{method:'DELETE'}).catch(()=>{});loading=false;$('energyLoad').disabled=$('energyFile').disabled=false;$('energyFile').value='';fileTable();}
  }
  async function start(){
    initializeTofConnection();
    cancelRoiDrag=initializeEnergyRoiDrag($('energyChart'),{getContext:plottedRoiContext,onSelect:(roi,context)=>{rois.set(context.key,roi);renderRoi();}});
    initializeRoiMenu();
    $('energyRoiClear').addEventListener('click',()=>{const context=plottedRoiContext();if(context){rois.delete(context.key);renderRoi();}});
    $('energyLoad').addEventListener('click',()=>$('energyFile').click());$('energyFile').addEventListener('change',()=>load($('energyFile').files));
    const button=$('energyLoad');
    for(const name of ['dragenter','dragover'])button.addEventListener(name,event=>{if([...event.dataTransfer.types].includes('Files')){event.preventDefault();if(!loading)button.classList.add('file-drag-over');}});
    for(const name of ['dragleave','dragend'])button.addEventListener(name,()=>button.classList.remove('file-drag-over'));
    button.addEventListener('drop',event=>{event.preventDefault();button.classList.remove('file-drag-over');load(event.dataTransfer.files);});
    $('energyModule').addEventListener('change',()=>{channels();applyDetectorCalibration();schedule();});
    fields.filter(id=>id!=='energyModule').forEach(id=>$(id).addEventListener('change',()=>{if(id==='energyChannel')applyDetectorCalibration();if(id==='energyUnit'){$('energyLow').value='';$('energyHigh').value='';}controls();schedule();}));
    correlationFields.forEach(id=>$(id).addEventListener('change',capture));
    $('energyUpdate').addEventListener('click',()=>draw(true));
    let frame;const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if($('energyChart')._fullLayout)Plotly.Plots.resize($('energyChart'));});});observer.observe($('energyChart'));
    try{const result=await json('/api/energy/files');datasets=result.datasets;sessionId=result.sessionId;await select(result.activeId);}
    catch(error){status(error.message,true);}
    const stream=new EventSource('/api/session/events');
    stream.onmessage=event=>{
      const state=JSON.parse(event.data);
      if(sessionId && state.sessionId!==sessionId){sessionId=state.sessionId;datasets=[];settings.clear();rois.clear();savedRois.clear();select(null);return;}
      if(Array.isArray(state.states)){
        const available=new Set(state.states.map(ds=>ds.datasetId));
        for(const ds of datasets)if(ds.tofConnection && !available.has(ds.tofConnection.tofDatasetId))ds.tofConnection=null;
        renderTofConnection();fileTable();
      }
    };
    window.addEventListener('number-display-change',()=>{fileTable();draw();});
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(()=>draw(),150);}
  return {start,load,select,draw};
})();
document.addEventListener('DOMContentLoaded',()=>EnergyViewer.start());
