// Energy elapsed zero aligns with ToF sweep zero. Recorded ToFs use 0.1 ns bins.
const {boxDetectorCalibrations,calibratedBoxEnergy}=require('./energy-calibration');
const {isDeletedBoxEvent}=require('./energy-exclusions');
const {detectorName}=require('./energy-listmode');
function referenceEventGetter(data,indices,calibrations){
  const parts=data.parts || [data],starts=[];let offset=0;
  for(const part of parts){starts.push(offset);offset+=part.events.length;}
  return index=>{
    if(index<0 || index>=indices.length)return null;
    const source=indices[index];let low=0,high=starts.length;
    while(low<high){const middle=low+Math.floor((high-low)/2);if(starts[middle]<=source)low=middle+1;else high=middle;}
    const part=parts[low-1],i=source-starts[low-1],e=part.events,module=e.module[i],channel=e.channel[i],calibration=calibrations[module+':'+channel];
    return {energyKeV:calibration?e.pulse[i]*calibration.gain+calibration.offset:null,module,channel,detector:detectorName(module,channel,data.format)};
  };
}
function energyReferenceTimes(data,options={},calibrations={},deletedRegions=[],withDetails=false){
  const {roi}=options;
  if(!roi || !Number.isFinite(roi.low) || !Number.isFinite(roi.high) || roi.low>=roi.high)throw new Error('Select a complete energy ROI before correlating.');
  const number=(key,fallback)=>{
    if(options[key]===undefined || options[key]===null || options[key]==='')return fallback;
    const value=Number(options[key]);if(!Number.isFinite(value))throw new Error('Invalid '+key+'.');return value;
  };
  const module=number('module',null),channel=options.channel==='box-sum'?'box-sum':number('channel',null);
  if(module!==null && (!Number.isInteger(module) || module< -1) || channel!==null && channel!=='box-sum' && (!Number.isInteger(channel) || channel<0))throw new Error('Invalid module or channel.');
  const boxCalibrations=channel==='box-sum'?boxDetectorCalibrations(data,module,calibrations):null;
  const timebaseNs=number('timebaseNs',data.timebaseNs),timeLow=number('timeLow',null),timeHigh=number('timeHigh',null);
  if(!Number.isFinite(timebaseNs) || timebaseNs<=0)throw new Error('Specify a positive energy timestamp timebase before correlating.');
  if(timeLow!==null && timeLow<0 || timeHigh!==null && timeHigh<(timeLow??0))throw new Error('Invalid elapsed-time range.');
  const anchors=new Float64Array(data.events.length),IndexArray=data.events.length>4294967295?Float64Array:Uint32Array;
  const indices=withDetails?new IndexArray(data.events.length):null;let count=0,source=0;
  for(const part of data.parts || [data])for(let i=0;i<part.events.length;i++,source++){
    const e=part.events;
    if(module!==null && e.module[i]!==module || (channel==='box-sum'?e.channel[i]<11 || e.channel[i]>15:channel!==null && e.channel[i]!==channel))continue;
    const energy=boxCalibrations?calibratedBoxEnergy(e,i,boxCalibrations):e.pulse[i];
    if(boxCalibrations && isDeletedBoxEvent(data,e,i,part.tickOffset||0,energy,deletedRegions))continue;
    if(energy<roi.low || energy>=roi.high)continue;
    const seconds=(e.ticks[i]+(part.tickOffset||0)-data.minTick)*timebaseNs/1e9;
    if(timeLow!==null && seconds<timeLow || timeHigh!==null && seconds>=timeHigh)continue;
    if(!Number.isFinite(seconds))throw new Error('An energy event has an invalid timestamp.');
    if(indices)indices[count]=source;anchors[count++]=seconds;
  }
  let times,getEvent;
  if(withDetails){
    const order=IndexArray.from({length:count},(_,i)=>i);order.sort((a,b)=>anchors[a]-anchors[b] || a-b);
    times=new Float64Array(count);
    for(let i=0;i<count;i++){const position=order[i];times[i]=anchors[position];order[i]=indices[position];}
    getEvent=referenceEventGetter(data,order,calibrations);
  }else{times=anchors.subarray(0,count);times.sort();}
  return {times,getEvent,module,channel,timebaseNs,timeLow,timeHigh,roiUnit:boxCalibrations?'keV':'ch'};
}
function boxSumReferenceTimes(data,options={},calibrations={},deletedRegions=[]){
  return energyReferenceTimes(data,{...options,channel:'box-sum',roi:{low:-Number.MAX_VALUE,high:Number.MAX_VALUE}},calibrations,deletedRegions).times;
}
function boxSumReferences(data,options={},calibrations={},deletedRegions=[]){
  return energyReferenceTimes(data,{...options,channel:'box-sum',roi:{low:-Number.MAX_VALUE,high:Number.MAX_VALUE}},calibrations,deletedRegions,true);
}
function nextEnergyIndex(seconds,times,tolerance=Number.EPSILON*Math.max(1,Math.abs(seconds))*4){
  let before=0,after=times.length;
  while(before<after){const middle=before+Math.floor((after-before)/2);if(times[middle]<seconds-tolerance)before=middle+1;else after=middle;}
  return before<times.length?before:-1;
}
function nextEnergyDelay(seconds,times,tolerance){
  const index=nextEnergyIndex(seconds,times,tolerance);return index>=0?Math.max(0,times[index]-seconds):NaN;
}
// Source records need not be chronological. Find the next strictly later ion
// without changing their order; simultaneous records do not precede each other.
function nextIonTimes(lm,indices){
  const events=lm.events,times=Float64Array.from({length:events.length},(_,i)=>events.sweep[i]*lm.sweepPeriodUs/1e6+events.tof[i]/1e10);
  const order=indices?Uint32Array.from(indices):Uint32Array.from({length:events.length},(_,i)=>i);order.sort((a,b)=>times[a]-times[b]);
  const next=new Float64Array(events.length).fill(Infinity);
  let successor=Infinity;
  for(let end=order.length;end>0;){
    let start=end-1;const seconds=times[order[start]];
    while(start>0 && times[order[start-1]]===seconds)start--;
    for(let j=start;j<end;j++)next[order[j]]=successor;
    successor=seconds;end=start;
  }
  return next;
}
function snapshotEnergyMatches(lm,references){
  const length=lm.events.length,result={energyDelaySeconds:new Float64Array(length).fill(NaN),energyDecayKeV:new Float64Array(length).fill(NaN),energyDecayModule:new Int32Array(length).fill(-1),energyDecayChannel:new Int32Array(length).fill(-1)};
  if(!references)return result;
  for(let i=0;i<length;i++){
    const seconds=lm.events.sweep[i]*lm.sweepPeriodUs/1e6+lm.events.tof[i]/1e10,index=nextEnergyIndex(seconds,references.times);
    if(index<0)continue;
    const event=references.getEvent(index);result.energyDelaySeconds[i]=Math.max(0,references.times[index]-seconds);
    result.energyDecayKeV[i]=event.energyKeV;result.energyDecayModule[i]=event.module;result.energyDecayChannel[i]=event.channel;
  }
  return result;
}
function makeEnergyCorrelatedData(lm,data,options={},calibrations={},deletedRegions=[]){
  const {roi,preTime,postTime}=options;
  if(!Number.isFinite(preTime) || !Number.isFinite(postTime) || preTime<0 || postTime<0)throw new Error('Pre-time and Post-time must be nonnegative seconds.');
  if(!Number.isFinite(lm.sweepPeriodUs) || lm.sweepPeriodUs<=0)throw new Error('The connected ToF spectrum needs a positive sweep period before correlating.');
  const {times,module,channel,timebaseNs,timeLow,timeHigh,roiUnit}=energyReferenceTimes(data,options,calibrations,deletedRegions),count=times.length;
  let decayReferences;
  try{decayReferences=boxSumReferences(data,options,calibrations,deletedRegions);}
  catch(error){if(!error.message.includes('requires an energy calibration'))throw error;}
  const source=lm.events,keep=[];
  for(let i=0;i<source.length;i++){
    const seconds=source.sweep[i]*lm.sweepPeriodUs/1e6+source.tof[i]/1e10;
    if(!Number.isFinite(seconds))throw new Error('A ToF event has an invalid timestamp.');
    // An anchor must lie in [ToF time - post, ToF time + pre]. Search once
    // per ToF event, preserving its original order and avoiding duplicates.
    const tolerance=Number.EPSILON*Math.max(1,Math.abs(seconds),preTime,postTime)*4;
    const low=seconds-postTime-tolerance,high=seconds+preTime+tolerance;
    let left=0,right=count;
    while(left<right){const middle=left+Math.floor((right-left)/2);if(times[middle]<low)left=middle+1;else right=middle;}
    if(left<count && times[left]<=high){
      keep.push(i);
    }
  }
  const events={length:keep.length};
  for(const [key,values]of Object.entries(source)){
    if(key==='length')continue;
    events[key]=values && values.length===source.length && (Array.isArray(values) || ArrayBuffer.isView(values))
      ?Array.isArray(values)?keep.map(i=>values[i]):values.constructor.from(keep,i=>values[i]):values;
  }
  // Keep the reference at creation time, independent of later Energy imports,
  // calibration edits, disconnects or source removal.
  Object.assign(events,snapshotEnergyMatches({...lm,events},decayReferences));
  const correlation={roi:{...roi},module,channel,timebaseNs,timeLow,timeHigh,preTime,postTime,
    roiUnit,
    energyEvents:count,sourceEvents:source.length,totalEvents:events.length,alignment:'simultaneous-start',inclusive:true};
  return {lm:{...lm,events,stats:{...lm.stats,acceptedEvents:events.length},
    observedTags:new Set(events.tag),observedChannels:new Set(events.channel),observedEdges:new Set(events.edge),energyDelayDirection:'next',energyDelaySource:decayReferences?'box-sum':null,correlation},correlation};
}
module.exports={nextIonTimes,makeEnergyCorrelatedData,energyReferenceTimes,boxSumReferenceTimes,boxSumReferences,nextEnergyIndex,nextEnergyDelay,snapshotEnergyMatches};
