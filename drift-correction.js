// Scale full recorded TOFs for every TAG; discard all events in failed tranches.
const MAX_FAILED_SWEEPS=2**15;
function makeDriftCorrectedData(lm, fit) {
  const rows=fit.results;
  if(!rows?.length)throw new Error('Cannot create a corrected spectrum: no tranche fits are available.');
  const referenceIndex=rows.findIndex(row=>row.success && Number.isFinite(row.params?.center?.value) && row.params.center.value>0);
  const reference=referenceIndex>=0?rows[referenceIndex].params.center.value:null;
  const occupied=new Set();
  for(let i=0;i<lm.events.length;i++) {
    const sweep=lm.events.sweep[i];
    if(sweep>=fit.settings.sweepLow && sweep<fit.settings.sweepHigh)occupied.add(Math.floor((sweep-fit.settings.sweepLow)/fit.trancheSize));
  }
  let boundary=fit.settings.sweepLow,consecutiveFailedSweeps=0,maxConsecutiveFailedSweeps=0;
  const factors=rows.map((row,index)=>{
    if(row.sweepLow!==boundary || !Number.isSafeInteger(row.sweepHigh) || row.sweepHigh<=row.sweepLow) throw new Error('Invalid tranche boundaries.');
    boundary=row.sweepHigh;
    const center=row.params?.center?.value;
    const usable=row.success && Number.isFinite(center) && center>0;
    // Only a tranche with no events across the full spectrum is a true gap.
    // An empty fit ROI with events on other TAGs still lacks a usable fit.
    const empty=!usable && (row.empty===true || row.counts===0) && !occupied.has(index);
    consecutiveFailedSweeps=usable || empty?0:consecutiveFailedSweeps+(row.sweepHigh-row.sweepLow);
    maxConsecutiveFailedSweeps=Math.max(maxConsecutiveFailedSweeps,consecutiveFailedSweeps);
    if(consecutiveFailedSweeps>MAX_FAILED_SWEEPS) {
      throw new Error(`Drift correction failed: consecutive failed tranches span ${consecutiveFailedSweeps} sweeps, exceeding ${MAX_FAILED_SWEEPS}. No corrected spectrum was created.`);
    }
    return {sweepLow:row.sweepLow,sweepHigh:row.sweepHigh,factor:index===referenceIndex?1:usable?reference/center:null,
      corrected:index!==referenceIndex && usable,empty,failed:!usable && !empty};
  });
  if(boundary!==fit.settings.sweepHigh)throw new Error('Tranches do not cover the fitted sweep range.');
  if(referenceIndex<0)throw new Error('Cannot create a corrected spectrum: no successful tranche provides a reference TOF.');
  const keep=[],scaledTof=new Float64Array(lm.events.length);
  let scaledEvents=0,referenceEvents=0,discardedEvents=0,outsideEvents=0;
  for(let i=0;i<lm.events.length;i++){
    const sweep=lm.events.sweep[i];
    let tof=lm.events.tof[i];
    if(sweep<fit.settings.sweepLow || sweep>=fit.settings.sweepHigh){outsideEvents++}
    else{
      const index=Math.floor((sweep-fit.settings.sweepLow)/fit.trancheSize);
      const tranche=factors[index];
      if(!tranche || sweep<tranche.sweepLow || sweep>=tranche.sweepHigh)throw new Error('Event does not match a fitted tranche.');
      // Tranche membership alone controls correction/discard: no TAG, channel,
      // edge, TOF ROI or plot-range filter is applied here.
      if(tranche.failed){discardedEvents++;continue}
      if(index===referenceIndex){referenceEvents++}
      else{
        tof*=tranche.factor;
        if(!Number.isFinite(tof) || tof<0)throw new Error('Correction produced an invalid event TOF.');
        scaledEvents++;
      }
    }
    scaledTof[keep.length]=tof;keep.push(i);
  }
  const events={length:keep.length};
  for(const [key,values]of Object.entries(lm.events)){
    if(key==='length' || key==='tof')continue;
    if(values && values.length===lm.events.length && (Array.isArray(values)||ArrayBuffer.isView(values))){
      events[key]=discardedEvents===0?values:Array.isArray(values)?keep.map(i=>values[i]):values.constructor.from(keep,i=>values[i]);
    }else events[key]=values;
  }
  events.tof=scaledTof.slice(0,keep.length);
  const correction={method:'first absolute fitted TOF / current absolute fitted TOF',appliesTo:'all TAG numbers, channels, and edges',referenceTofUs:reference,
    referenceTranche:referenceIndex,referenceSweepLow:rows[referenceIndex].sweepLow,
    trancheSize:fit.trancheSize,sweepLow:fit.settings.sweepLow,sweepHigh:fit.settings.sweepHigh,factors,
    sourceEvents:lm.events.length,totalEvents:events.length,scaledEvents,referenceEvents,discardedEvents,outsideEvents,
    emptyTranches:factors.filter(row=>row.empty).length,failedTranches:factors.filter(row=>row.failed).length,maxConsecutiveFailedSweeps,failureLimitSweeps:MAX_FAILED_SWEEPS,
    warningTranches:rows.filter(row=>row.success&&row.warning).length};
  return {lm:{...lm,events,stats:{...lm.stats,acceptedEvents:events.length},
    observedTags:new Set(events.tag),observedChannels:new Set(events.channel),observedEdges:new Set(events.edge),
    driftCorrection:correction},correction};
}
module.exports={makeDriftCorrectedData,MAX_FAILED_SWEEPS};
