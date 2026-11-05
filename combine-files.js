function canCombineDataset(dataset) {
  if(!dataset || dataset.pending || !['original','combined'].includes(dataset.kind))return false;
  const lm=dataset.lm;
  return !!lm && !lm.correction && !lm.driftCorrection && !lm.debouncing &&
    (lm.header?.correlyzer_processed!=='1' || lm.header?.correlyzer_processing==='combined');
}
function makeCombinedData(datasets) {
  if(!Array.isArray(datasets) || datasets.length<2 || new Set(datasets.map(ds=>ds.id)).size!==datasets.length)throw new Error('Choose at least two different files.');
  if(datasets.some(ds=>!canCombineDataset(ds)))throw new Error('Drift-corrected or debounced files cannot be combined.');
  if(datasets.some(ds=>!(ds.lm.startTime instanceof Date) || !Number.isFinite(ds.lm.startTime.getTime()) ||
      !Number.isFinite(ds.lm.sweepPeriodUs) || ds.lm.sweepPeriodUs<=0)) {
    throw new Error('Files need valid start times and positive sweep periods to combine on a shared timeline.');
  }
  datasets=[...datasets].sort((a,b)=>a.lm.startTime-b.lm.startTime);
  const first=datasets[0].lm;
  for(const ds of datasets.slice(1)) {
    if(ds.lm.timePatch!==first.timePatch || ds.lm.sweepPeriodUs!==first.sweepPeriodUs) {
      throw new Error('Files must have matching listmode formats and sweep periods.');
    }
  }
  const ejectBins=[0,1].map(index=>{
    const values=datasets.map(ds=>ds.lm.ejectBins?.[index]);
    if(values.some(value=>!Number.isFinite(value)))throw new Error('Files need valid ejection times.');
    if(Math.max(...values)-Math.min(...values)>10000+Number.EPSILON*Math.max(1,...values.map(Math.abs))*8) {
      const error=new Error('Files cannot be combined: ejection times differ by more than 1 µs.');
      error.code='EJECTION_MISMATCH';throw error;
    }
    return values.reduce((sum,value)=>sum+value,0)/values.length;
  });
  const ejectNs=ejectBins.map(bin=>bin/10);
  // Persist the averaged reference in the inherited header as well as memory.
  const parts=String(first.cmline?.[2] || 'TP:0,0,0').replace(/^TP:/,'').split(',');
  parts[1]=String(ejectNs[0]/1000);parts[2]=String(ejectNs[1]/1000);
  const ejectionInfo='TP:'+parts.join(',');
  let replaced=false;
  const headerLines=first.headerLines.map(line=>{
    if(/^\s*cmline2\s*=/.test(line)){replaced=true;return 'cmline2='+ejectionInfo;}
    return line;
  });
  if(!replaced)headerLines.splice(Math.max(0,headerLines.findIndex(line=>line.trim()==='[DATA]')),0,'cmline2='+ejectionInfo);
  const length=datasets.reduce((sum,ds)=>sum+ds.lm.events.length,0);
  const events={length,tof:new Float64Array(length),sweep:new Int32Array(length),rawSweep:new Int32Array(length),
    tag:new Int32Array(length),channel:new Int16Array(length),edge:new Int8Array(length),raw:new Array(length)};
  let pos=0,maxSweep=-1;
  const sourceOffsets=[];
  for(const ds of datasets) {
    const source=ds.lm.events;
    const offset=Math.round((ds.lm.startTime.getTime()-first.startTime.getTime())*1000/first.sweepPeriodUs);
    if(!Number.isSafeInteger(offset) || offset>2147483646)throw new Error('Combined sweep count exceeds the supported range.');
    sourceOffsets.push({datasetId:ds.id,sweepOffset:offset});
    for(let i=0;i<source.length;i++) {
      const sweep=source.sweep[i];
      if(!Number.isSafeInteger(sweep) || sweep<0)throw new Error('A source file has an invalid sweep number.');
      const combinedSweep=sweep+offset;
      if(combinedSweep>2147483646)throw new Error('Combined sweep count exceeds the supported range.');
      events.sweep[pos+i]=combinedSweep;
      events.raw[pos+i]=source.raw[i];
      maxSweep=Math.max(maxSweep,combinedSweep);
    }
    for(const key of ['tof','rawSweep','tag','channel','edge'])events[key].set(source[key],pos);
    pos+=source.length;
  }
  const stats={...first.stats};
  for(const key of Object.keys(stats))if(typeof stats[key]==='number')stats[key]=datasets.reduce((sum,ds)=>sum+(ds.lm.stats[key]||0),0);
  stats.acceptedEvents=length;
  return {...first,ejectBins,ejectNs,cmline:{...first.cmline,2:ejectionInfo},header:{...first.header,cmline2:ejectionInfo},headerLines,events,stats,
    observedChannels:new Set(events.channel),observedTags:new Set(events.tag),observedEdges:new Set(events.edge),
    combination:{sourceIds:datasets.map(ds=>ds.id),totalSweeps:maxSweep+1,sourceOffsets}};
}
module.exports={canCombineDataset,makeCombinedData};
