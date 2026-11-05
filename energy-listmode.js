const {boxDetectorCalibrations,calibratedBoxEnergy}=require('./energy-calibration');
const {isDeletedBoxEvent}=require('./energy-exclusions');
const COUNTER_MODULUS=2**40;
const DETECTORS={
  '1:0':'GAGG center','1:1':'GAGG side','1:3':'MCS trigger','1:4':'Si elastic monitor',
  '1:11':'Box Bottom-Si','1:12':'Box Right-Si','1:13':'Box Left-Si','1:14':'Box Top-Si','1:15':'Box Center-Si',
};
function detectorName(module,channel,format){
  if(format==='usb-mca')return 'USB-MCA channel '+channel;
  if(module===0 && channel<=15)return 'Si array '+channel;
  return DETECTORS[module+':'+channel] || 'Module '+module+', channel '+channel;
}
function createEnergyListmodeParser({filename}={}){
  const keys={module:Int32Array,channel:Uint16Array,pulse:Uint32Array,ticks:Float64Array,additional:Float64Array};
  const chunks=[];const chunkSize=65536;let retained=0,inputEvents=0,skippedEvents=0,incompleteLines=0,index=0;
  const incompleteExamples=[];
  const nikiFilename=typeof filename==='string' && /\.dat$/i.test(filename);
  let format=null,highest=-1,rollovers=0,minTick=Infinity,maxTick=-Infinity,minPulse=Infinity,maxPulse=-Infinity;
  const channels=new Map();
  let pending='',first=true,skipLF=false,finished=false;
  function record(source){
    const line=source.trim();index++;if(!line || line.startsWith('#'))return;
    const fail=message=>{const error=new Error((filename?filename+': ':'')+message+' Record: '+line.slice(0,160));error.filename=filename;error.line=index;error.record=line.slice(0,160);throw error;};
    const fields=line.split(',').map(value=>value.trim());
    // Niki needs four fields; the fifth field is optional. A .dat filename
    // identifies Niki even when the first physical record is truncated.
    if((nikiFilename || format==='niki') && (fields.length<4 || fields.slice(0,4).some(value=>value===''))){
      incompleteLines++;
      if(incompleteExamples.length<5)incompleteExamples.push({filename,line:index,record:line.slice(0,160)});
      return;
    }
    if(fields.length===5 && fields[4]==='')fields.pop();
    if(![3,4,5].includes(fields.length) || fields.some(value=>!/^\d+$/.test(value)))fail('Invalid energy record on line '+index+'. Expected 3 USB-MCA columns or 4–5 Niki columns.');
    const values=fields.map(Number);
    if(values.some(value=>!Number.isSafeInteger(value)))fail('An integer on line '+index+' exceeds the supported range.');
    const recordFormat=fields.length===3?'usb-mca':'niki';
    if(format && format!==recordFormat)fail('Mixed USB-MCA and Niki records in one file at line '+index+'. Expected '+(format==='niki'?'4–5 Niki columns':'3 USB-MCA columns')+'; found '+fields.length+' columns.');
    format=recordFormat;
    const [module,channel,pulse,rawTick]=format==='niki'?values:[-1,values[1],values[2],values[0]];
    if(module>65535 || channel>65535 || pulse>4294967295 || (format==='niki' && rawTick>=COUNTER_MODULUS))fail('An energy record is out of range on line '+index+'.');
    let tick=rawTick;
    if(format==='niki'){
      const epoch=highest<0?0:Math.floor(highest/COUNTER_MODULUS);
      tick=epoch*COUNTER_MODULUS+rawTick;
      if(highest>=0 && tick<highest-COUNTER_MODULUS/2){tick+=COUNTER_MODULUS;rollovers++;}
      else if(epoch>0 && tick>highest+COUNTER_MODULUS/2)tick-=COUNTER_MODULUS;
    }
    if(!Number.isSafeInteger(tick))fail('Unwrapped timestamp exceeds the supported range on line '+index+'.');
    highest=Math.max(highest,tick);minTick=Math.min(minTick,tick);maxTick=Math.max(maxTick,tick);
    inputEvents++;
    // Keep timing/rollover accounting, but allocate no event storage for the
    // Niki channels currently excluded from analysis.
    if(format==='niki' && (channel===0 || channel===1)){skippedEvents++;return;}
    minPulse=Math.min(minPulse,pulse);maxPulse=Math.max(maxPulse,pulse);
    const key=module+':'+channel;
    if(!channels.has(key))channels.set(key,{module,channel,label:detectorName(module,channel,format),events:0});
    channels.get(key).events++;
    const chunkIndex=Math.floor(retained/chunkSize),position=retained%chunkSize;
    if(!chunks[chunkIndex])chunks.push(Object.fromEntries(Object.entries(keys).map(([key,Type])=>[key,new Type(chunkSize)])));
    const chunk=chunks[chunkIndex];
    chunk.module[position]=module;chunk.channel[position]=channel;chunk.pulse[position]=pulse;chunk.ticks[position]=tick;chunk.additional[position]=values[4]??NaN;
    retained++;
  }
  function checkLineLength(length){
    if(length<=65536)return;
    const error=new Error((filename?filename+': ':'')+'Energy record on line '+(index+1)+' exceeds 64 KiB.');
    error.filename=filename;error.line=index+1;error.record=pending.slice(0,160);throw error;
  }
  function write(value){
    if(finished)throw new Error('The energy parser is already finished.');
    let text=String(value);if(!text)return;
    if(first){text=text.replace(/^\uFEFF/,'');first=false;}
    if(skipLF && text.startsWith('\n'))text=text.slice(1);skipLF=false;
    let start=0;
    for(let i=0;i<text.length;i++){
      if(text[i]!=='\r' && text[i]!=='\n')continue;
      checkLineLength(pending.length+i-start);record(pending+text.slice(start,i));pending='';
      if(text[i]==='\r'){
        if(text[i+1]==='\n')i++;
        else if(i===text.length-1)skipLF=true;
      }
      start=i+1;
    }
    checkLineLength(pending.length+text.length-start);pending+=text.slice(start);
  }
  function finish({compact=true}={}){
    if(finished)throw new Error('The energy parser is already finished.');
    finished=true;if(pending){record(pending);pending='';}
    if(!inputEvents)throw new Error((filename?filename+': ':'')+'The file contains no complete energy events.'+(incompleteLines?' '+incompleteLines+' incomplete Niki line(s) skipped.':''));
    const events={length:retained};
    const parts=[];
    if(compact)for(const [key,Type]of Object.entries(keys)){
      events[key]=new Type(retained);
      chunks.forEach((chunk,i)=>events[key].set(chunk[key].subarray(0,Math.min(chunkSize,retained-i*chunkSize)),i*chunkSize));
    }
    else chunks.forEach((chunk,i)=>{
      const length=Math.min(chunkSize,retained-i*chunkSize),part={events:{length},tickOffset:0};
      for(const key of Object.keys(keys))part.events[key]=chunk[key].subarray(0,length);
      parts.push(part);
    });
    if(!retained){minPulse=0;maxPulse=0;}
    return {format,events,...(compact?{}:{parts}),inputEvents,skippedEvents,incompleteLines,incompleteExamples,channels:[...channels.values()].sort((a,b)=>a.module-b.module || a.channel-b.channel),
      minTick,maxTick,minPulse,maxPulse,rollovers,timebaseNs:format==='niki'?10:null};
  }
  return {write,finish};
}
function parseEnergyListmode(text,options={}){
  const parser=createEnergyListmodeParser(options);parser.write(text);return parser.finish();
}
function energySummary(dataset){
  const {data}=dataset;
  return {id:dataset.id,filename:dataset.filename,bytes:dataset.bytes,calibrations:dataset.calibrations||{},calibrationWarnings:dataset.calibrationWarnings||[],sourceFiles:dataset.sourceFiles||[dataset.filename],format:data.format,events:data.events.length,inputEvents:data.inputEvents??data.events.length,skippedEvents:data.skippedEvents??0,incompleteLines:data.incompleteLines??0,incompleteExamples:data.incompleteExamples||[],
    channels:data.channels,minPulse:data.minPulse,maxPulse:data.maxPulse,timebaseNs:data.timebaseNs,
    firstTick:data.minTick,lastTick:data.maxTick,rollovers:data.rollovers,
    recordedSpanSec:data.timebaseNs===null?null:(data.maxTick-data.minTick)*data.timebaseNs/1e9};
}
function energyHistogram(data,options={},calibrations={},deletedRegions=[]){
  const number=(key,fallback)=>{
    if(options[key]===undefined || options[key]==='')return fallback;
    const value=Number(options[key]);if(!Number.isFinite(value))throw new Error('Invalid '+key+'.');return value;
  };
  const module=number('module',null),channel=options.channel==='box-sum'?'box-sum':number('channel',null);
  if((module!==null && (!Number.isInteger(module) || module< -1)) || (channel!==null && channel!=='box-sum' && (!Number.isInteger(channel) || channel<0)))throw new Error('Invalid module or channel.');
  const boxSum=channel==='box-sum',boxCalibrations=boxSum?boxDetectorCalibrations(data,module,calibrations):null;
  const calibrated=boxSum || options.unit==='keV',gain=calibrated && !boxSum?number('gain',1):1,offset=calibrated && !boxSum?number('offset',0):0;
  if(gain<=0)throw new Error('Calibration gain must be positive.');
  const binWidth=number('binWidth',1);
  let low=boxSum?0:number('low',offset),high=boxSum?binWidth:number('high',(data.maxPulse+1)*gain+offset);
  if(boxSum)for(const part of data.parts || [data])for(let i=0;i<part.events.length;i++){
    const e=part.events;if(!boxCalibrations.has(e.module[i]+':'+e.channel[i]))continue;
    const value=calibratedBoxEnergy(e,i,boxCalibrations);
    if(isDeletedBoxEvent(data,e,i,part.tickOffset||0,value,deletedRegions))continue;
    low=Math.min(low,value);high=Math.max(high,value+binWidth);
  }
  if(binWidth<=0 || high<=low)throw new Error('Use a positive bin width and a maximum greater than the minimum.');
  const bins=Math.ceil((high-low)/binWidth);
  if(bins>100000)throw new Error('Too many histogram bins. Increase Bin Width or narrow the range (maximum 100,000 bins).');
  const timebaseNs=number('timebaseNs',data.timebaseNs),timeLow=number('timeLow',null),timeHigh=number('timeHigh',null);
  if(timebaseNs!==null && timebaseNs<=0)throw new Error('Timebase must be positive.');
  if((timeLow!==null || timeHigh!==null) && timebaseNs===null)throw new Error('Specify the timestamp timebase before filtering elapsed time.');
  if((timeLow!==null && timeLow<0) || (timeHigh!==null && timeHigh<0) || (timeHigh!==null && timeHigh< (timeLow??0)))throw new Error('Invalid elapsed-time range.');
  const counts=new Array(bins).fill(0);let selectedEvents=0,plottedEvents=0;
  for(const part of data.parts || [data])for(let i=0;i<part.events.length;i++){
    const e=part.events;
    if(module!==null && e.module[i]!==module || (channel==='box-sum'?e.channel[i]<11 || e.channel[i]>15:channel!==null && e.channel[i]!==channel))continue;
    const seconds=timebaseNs===null?null:(e.ticks[i]+(part.tickOffset||0)-data.minTick)*timebaseNs/1e9;
    if(timeLow!==null && seconds<timeLow || timeHigh!==null && seconds>=timeHigh)continue;
    const value=boxSum?calibratedBoxEnergy(e,i,boxCalibrations):e.pulse[i]*gain+offset;
    if(boxSum && isDeletedBoxEvent(data,e,i,part.tickOffset||0,value,deletedRegions))continue;
    selectedEvents++;
    if(value<low || value>=high)continue;
    counts[Math.min(bins-1,Math.floor((value-low)/binWidth))]++;plottedEvents++;
  }
  return {x:counts.map((_,i)=>(low+i*binWidth+Math.min(low+(i+1)*binWidth,high))/2),counts,selectedEvents,plottedEvents,totalEvents:data.events.length,
    unit:calibrated?'keV':'ch',binWidth,range:[low,high],timebaseNs,
    recordedSpanSec:timebaseNs===null?null:(data.maxTick-data.minTick)*timebaseNs/1e9};
}
function combineEnergyData(parts){
  if(!parts.length)throw new Error('No data files selected.');
  if(parts.some(part=>part.format!==parts[0].format))throw new Error('A numbered sequence cannot mix Niki and USB-MCA formats.');
  if(parts.length===1)return parts[0];
  let maxTick=-Infinity,minTick=Infinity,rollovers=0;
  const shifted=[],channels=new Map();
  for(const part of parts){
    let tickOffset=0;
    if(part.format==='niki' && maxTick!==-Infinity){
      tickOffset=Math.max(0,Math.round((maxTick-part.minTick)/COUNTER_MODULUS))*COUNTER_MODULUS;
      if(part.minTick+tickOffset<maxTick-COUNTER_MODULUS/2)tickOffset+=COUNTER_MODULUS;
    }
    if(!Number.isSafeInteger(part.maxTick+tickOffset))throw new Error('Combined timestamps exceed the supported range.');
    if(part.format==='niki' && maxTick!==-Infinity)rollovers+=Math.max(0,Math.floor((part.minTick+tickOffset)/COUNTER_MODULUS)-Math.floor(maxTick/COUNTER_MODULUS));
    for(const piece of part.parts || [part])shifted.push({...piece,tickOffset:(piece.tickOffset||0)+tickOffset});
    minTick=Math.min(minTick,part.minTick+tickOffset);maxTick=Math.max(maxTick,part.maxTick+tickOffset);rollovers+=part.rollovers;
    for(const row of part.channels){const key=row.module+':'+row.channel;if(!channels.has(key))channels.set(key,{...row,events:0});channels.get(key).events+=row.events;}
  }
  return {format:parts[0].format,parts:shifted,events:{length:parts.reduce((sum,part)=>sum+part.events.length,0)},
    incompleteLines:parts.reduce((sum,part)=>sum+(part.incompleteLines||0),0),incompleteExamples:parts.flatMap(part=>part.incompleteExamples||[]).slice(0,5),
    inputEvents:parts.reduce((sum,part)=>sum+part.inputEvents,0),skippedEvents:parts.reduce((sum,part)=>sum+part.skippedEvents,0),
    timebaseNs:parts[0].timebaseNs,minTick,maxTick,rollovers,minPulse:Math.min(...parts.map(part=>part.minPulse)),maxPulse:Math.max(...parts.map(part=>part.maxPulse)),
    channels:[...channels.values()].sort((a,b)=>a.module-b.module || a.channel-b.channel)};
}
module.exports={combineEnergyData,parseEnergyListmode,createEnergyListmodeParser,energyHistogram,energySummary,detectorName,COUNTER_MODULUS};
