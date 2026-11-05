const {listmodeFilename}=require('./public/js/listmode-filename');

// Keep the acquisition's native hex layout, changing only its timestamp bits.
// The extra header fields preserve sweep numbering after events are removed,
// and prevent a second acquisition-window filter when reopening processed data.
function serializeListmode(lm){
  const widths={'1a':28,'2a':28,'5b':28,f3:36};
  const bits=widths[lm.timePatch];
  if(!bits)throw new Error('Unsupported listmode format: '+lm.timePatch);
  const mask=((1n<<BigInt(bits))-1n)<<4n;
  const max=2**bits-1;
  const lines=[],sweepRuns=[];
  let previousOffset;
  for(let i=0;i<lm.events.length;i++){
    const tof=Math.round(lm.events.tof[i]);
    if(!Number.isSafeInteger(tof) || tof<=0 || tof>max)throw new Error('An event ToF cannot be represented in the original listmode format.');
    const raw=lm.events.raw[i];
    if(typeof raw!=='string' || !/^[0-9a-f]+$/i.test(raw))throw new Error('An event has no valid acquisition record.');
    const value=(BigInt('0x'+raw)&~mask)|(BigInt(tof)<<4n);
    lines.push(value.toString(16).padStart(raw.length,'0'));
    const offset=lm.events.sweep[i]-lm.events.rawSweep[i];
    if(!Number.isSafeInteger(offset))throw new Error('Invalid event sweep number.');
    if(offset!==previousOffset){sweepRuns.push([i,offset]);previousOffset=offset;}
  }
  const header=lm.headerLines.flatMap(line=>line.split(/\r\n|\n|\r/)).filter(line=>line.trim()!=='[DATA]' && !/^correlyzer_(processed|processing|sweep_runs|energy_delays|energy_delay_direction|energy_delay_source|energy_events)=/i.test(line.trim()));
  const processing=lm.correlation?'energy-correlated':lm.correction || lm.driftCorrection?'drift-corrected':lm.debouncing?'debounced':lm.combination?'combined':lm.header?.correlyzer_processing || 'processed';
  const delays=lm.events.energyDelaySeconds;
  const timing=delays?['correlyzer_energy_delays='+JSON.stringify(Array.from(delays,value=>Number.isFinite(value)?value:null)),...(lm.energyDelayDirection==='next'?['correlyzer_energy_delay_direction=next']:[])]:[];
  if(delays && lm.energyDelaySource==='box-sum')timing.push('correlyzer_energy_delay_source=box-sum');
  if(delays && lm.events.energyDecayKeV)timing.push('correlyzer_energy_events='+JSON.stringify(Array.from(lm.events.energyDecayKeV,(energy,i)=>Number.isFinite(energy)?[energy,lm.events.energyDecayModule[i],lm.events.energyDecayChannel[i]]:null)));
  return [...header,'correlyzer_processed=1','correlyzer_processing='+processing,'correlyzer_sweep_runs='+JSON.stringify(sweepRuns),...timing,'[DATA]',...lines,''].join('\r\n');
}
module.exports={serializeListmode,listmodeFilename};
