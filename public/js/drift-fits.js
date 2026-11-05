if(typeof NumberDisplay!=='undefined') {
  NumberDisplay.set(new URLSearchParams(window.location.search).get('thousandsSeparator')||NumberDisplay.choice,false);
  window.addEventListener('number-display-change',()=>{
    if(document.getElementById('resultsPlot')?.data)Plotly.relayout('resultsPlot',{separators:NumberDisplay.separators});
  });
}
const controller=new AbortController();
let fitResults=null, correctedDataset=null, settled=false, busy=false;
const statusMessage = text => { document.getElementById('status').textContent=text; };
function closeResults() {
  window.parent.postMessage({type:'drift-results-close'},window.location.origin);
}
async function decide(action) {
  if(busy || settled) return;
  busy=true;
  document.getElementById('acceptResults').disabled=true;
  document.getElementById('rejectResults').disabled=true;
  try {
    if(fitResults) {
      const reply=await fetch('/api/drift-correct/decision',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({fitRunId:fitResults.fitRunId,action})});
      const result=await reply.json();
      if(!reply.ok || !result.ok) throw new Error(result.error||'Could not update corrected spectrum.');
      if(action==='accept') window.parent.postMessage({type:'drift-corrected-dataset',dataset:result.dataset},window.location.origin);
    }
    settled=true;
    controller.abort();
    closeResults();
  } catch(error) { statusMessage(error.message); }
  finally {
    busy=false;
    document.getElementById('acceptResults').disabled=!correctedDataset || settled;
    document.getElementById('rejectResults').disabled=settled;
  }
}
document.getElementById('acceptResults').addEventListener('click',()=>decide('accept'));
document.getElementById('rejectResults').addEventListener('click',()=>decide('reject'));
window.addEventListener('message',event=>{
  if(event.origin===window.location.origin && event.source===window.parent && event.data?.type==='drift-results-reject') decide('reject');
});
window.addEventListener('pagehide',()=>{
  controller.abort();
  if(fitResults && !settled) fetch('/api/drift-correct/decision',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({fitRunId:fitResults.fitRunId,action:'reject'}),keepalive:true});
});
document.getElementById('exportResults').addEventListener('click',async()=>{
  if(!fitResults) return;
  const button=document.getElementById('exportResults');
  button.disabled=true;
  try {
    if(typeof window.showSaveFilePicker==='function') {
      const handle=await window.showSaveFilePicker({suggestedName:'drift-results.csv',types:[{description:'CSV file',accept:{'text/csv':['.csv']}}]});
      const writable=await handle.createWritable();
      await writable.write(driftResultsCsv(fitResults));
      await writable.close();
      statusMessage('Results exported. Choose Accept or Reject to finish.');
    } else {
      const reply=await fetch('/api/drift-fit/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fitRunId:fitResults.fitRunId})});
      const result=await reply.json();
      if(!reply.ok || !result.ok) throw new Error(result.error||'Export failed.');
      if(!result.cancelled) statusMessage('Results exported. Choose Accept or Reject to finish.');
    }
  } catch(error) { if(error.name!=='AbortError') statusMessage(error.message); }
  finally { button.disabled=false; }
});
async function run(){
 try{
  const requestedSize=Number(new URLSearchParams(window.location.search).get('trancheSize')||5000);
  document.getElementById('status').textContent=`Fitting successive ${requestedSize.toLocaleString()}-sweep tranches…`;
  const response=await fetch('/api/drift-fit?'+window.location.search.slice(1),{signal:controller.signal});
  const data=await response.json();
  if(!response.ok||!data.ok)throw new Error(data.error||'Drift fits failed.');
  fitResults=data;
  document.getElementById('exportResults').disabled=false;
  let corrected=null,correctionError=null;
  try{
    const reply=await fetch('/api/drift-correct',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({fitRunId:data.fitRunId}),signal:controller.signal});
    corrected=await reply.json();
    if(!reply.ok || !corrected.ok)throw new Error(corrected.error||'Could not create corrected spectrum.');
    correctedDataset=corrected.dataset;
    document.getElementById('acceptResults').disabled=false;
  }catch(error){if(error.name==='AbortError')throw error;correctionError=error.message;corrected=null}
  const s=data.settings;
  document.getElementById('source').textContent=`${data.filename} · Channel ${data.channel} · Edge ${data.edge} · TAG ${data.tag} · ROI ${s.tofLowUs.toFixed(6)}–${s.tofHighUs.toFixed(6)} µs · sweeps ${s.sweepLow}–${s.sweepHigh} · ${data.trancheSize.toLocaleString()} sweeps/tranche`;
  const format=(v,e)=>FitParameters.format(v,e);
  const traces=[false,true].map(warn=>{
    const rows=data.results.filter(r=>r.success&&!!r.warning===warn);
    return {type:'scatter',mode:'markers',name:warn?'Fit with warning':'Fit',
      x:rows.map(r=>r.sweepCenter),y:rows.map(r=>r.centerUs),
      error_y:{type:'data',array:rows.map(r=>r.centerSigmaUs??0),visible:true},
      marker:{color:warn?'#c87900':'#126eaa',symbol:rows.map(r=>r.centerSigmaUs===null?'circle-open':'circle'),size:8},
      customdata:rows.map(r=>[r.sweepLow,r.sweepHigh,format(r.centerUs,r.centerSigmaUs),r.counts]),
      hovertemplate:'Sweeps [%{customdata[0]}, %{customdata[1]})<br>Center: %{customdata[2]} µs<br>Events: %{customdata[3]}<extra>%{fullData.name}</extra>'};
  });
  await Plotly.newPlot('resultsPlot',traces,{showlegend:true,margin:{l:95,r:20,t:35,b:60},separators:typeof NumberDisplay!=='undefined'?NumberDisplay.separators:'.,',xaxis:{tickformat:',~f',separatethousands:true,title:{text:'Sweep number (tranche midpoint)'}},yaxis:{title:{text:'Fitted TOF after ejection [µs]'},tickformat:'.6f'},legend:{orientation:'h',y:1.15}},
    {responsive:true,displaylogo:false,showLink:false,modeBarButtonsToRemove:['sendChartToCloud']});
  for(const row of data.results){
    const tr=document.createElement('tr');tr.className=row.empty?'empty':row.success?(row.warning?'warning':''):'failed';
    const cells=[row.sweepLow,row.sweepHigh,row.counts,row.success?format(row.centerUs,row.centerSigmaUs):'—',row.success?format(row.fwhmUs,row.fwhmSigmaUs):'—',row.reducedChi2?.toPrecision(5)??'—',row.success?(row.warning||'Converged'):row.error];
    for(const value of cells){const td=document.createElement('td');td.textContent=value;tr.appendChild(td)}
    document.getElementById('results').appendChild(tr);
  }
  document.getElementById('status').textContent=`${data.successful} of ${data.results.length} tranche fits converged; ${data.results.filter(row=>row.success&&row.warning).length} have quality warnings (orange). Error bars are 1σ; open circles have no reported uncertainty. ${data.results.filter(row=>row.empty).length} empty ROI tranches were skipped. Failed tranches remain listed below.` +
    (corrected?` Corrected spectrum ready for review; press Accept to add it: ${corrected.correction.totalEvents.toLocaleString()} events retained, ${corrected.correction.scaledEvents.toLocaleString()} scaled. ${corrected.correction.discardedEvents.toLocaleString()} events discarded from failed tranches across all TAGs. ${corrected.correction.outsideEvents.toLocaleString()} events outside the fitted sweep range remain unchanged.`:` Corrected spectrum not created: ${correctionError}`);
 }catch(error){if(error.name!=='AbortError')document.getElementById('status').textContent=error.message}
}
run();
