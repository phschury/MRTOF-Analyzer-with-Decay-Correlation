const {nextEnergyIndex,nextIonTimes}=require('./energy-correlation');
const {detectorName}=require('./energy-listmode');
function fitExponentialDecay(delays){
  if(delays.length<2)return {ok:false,error:'At least two correlation times are required for an exponential fit.'};
  // Unbinned maximum likelihood for p(t) = exp(-t/tau)/tau, t >= 0.
  // Updating the mean avoids overflowing a sum of large delays.
  let lifetime=0;
  for(let i=0;i<delays.length;i++)lifetime+=(delays[i]-lifetime)/(i+1);
  const halfLife=lifetime*Math.LN2;
  if(!(halfLife>0) || !Number.isFinite(halfLife))return {ok:false,error:'A positive mean correlation time is required for an exponential fit.'};
  return {ok:true,model:'single-exponential',method:'unbinned-maximum-likelihood',events:delays.length,lifetime,halfLife,halfLifeError:halfLife/Math.sqrt(delays.length)};
}
function fitSchmidtDecay(edges,counts){
  // Schmidt, Eur. Phys. J. A 8, 141–145 (2000), §2.3:
  // dN/d(ln t) = N0 (t/tau) exp(-t/tau), with mode t = tau.
  // Use integrated Poisson bin probabilities, including empty bins. Profile
  // N0 over the displayed interval so finite histogram limits do not bias tau.
  const events=counts.reduce((sum,count)=>sum+count,0);
  if(events<2)return {ok:false,error:'At least two positive correlation times are required for a Schmidt fit.'};
  const logProbability=(low,high,logLifetime)=>{
    const lifetime=Math.exp(logLifetime);
    return -low/lifetime+Math.log(-Math.expm1(-(high-low)/lifetime));
  };
  const objective=logLifetime=>{
    const logTotal=logProbability(edges[0],edges.at(-1),logLifetime);
    let value=0;
    for(let i=0;i<counts.length;i++)if(counts[i])value-=counts[i]*(logProbability(edges[i],edges[i+1],logLifetime)-logTotal);
    return value;
  };
  const lower=Math.log(edges[0])-20,upper=Math.log(edges.at(-1))+20;
  let a=lower,b=upper;
  const ratio=(Math.sqrt(5)-1)/2;
  let c=b-ratio*(b-a),d=a+ratio*(b-a),fc=objective(c),fd=objective(d);
  for(let i=0;i<160 && b-a>1e-9;i++){
    if(fc<fd){b=d;d=c;fd=fc;c=b-ratio*(b-a);fc=objective(c);}
    else{a=c;c=d;fc=fd;d=a+ratio*(b-a);fd=objective(d);}
  }
  const logLifetime=(a+b)/2,lifetime=Math.exp(logLifetime),step=0.001;
  const curvature=(objective(logLifetime+step)-2*objective(logLifetime)+objective(logLifetime-step))/(step*step);
  if(!Number.isFinite(curvature) || curvature<=1e-6 || logLifetime-lower<0.01 || upper-logLifetime<0.01)
    return {ok:false,error:'These logarithmic-time bins do not constrain a finite lifetime.'};
  const halfLife=lifetime*Math.LN2,logTotal=logProbability(edges[0],edges.at(-1),logLifetime);
  return {ok:true,model:'schmidt-log-time',method:'binned-poisson-maximum-likelihood',events,lifetime,peakTime:lifetime,halfLife,halfLifeError:halfLife/Math.sqrt(curvature),
    counts:counts.map((_,i)=>events*Math.exp(logProbability(edges[i],edges[i+1],logLifetime)-logTotal))};
}
function makeCorrelationTimeHistogram(lm,{channel,edge,tag,tofLowUs,tofHighUs,sweepLow=0,sweepHigh=Infinity,binWidth,xScale='linear',fitExponential=false,fitSchmidt=false}={},referenceTimes){
  const events=lm.events,delays=events.energyDelaySeconds;
  const references=referenceTimes?.times?referenceTimes:null,times=references?references.times:referenceTimes;
  const eventDetails=index=>{
    if(references)return references.getEvent(index);
    if(referenceTimes!==undefined || !Number.isFinite(events.energyDecayKeV?.[index]))return null;
    const module=events.energyDecayModule?.[index],channel=events.energyDecayChannel?.[index];
    if(!Number.isInteger(module) || !Number.isInteger(channel) || channel<0)return null;
    return {energyKeV:events.energyDecayKeV[index],module,channel,detector:detectorName(module,channel,module===-1?'usb-mca':'niki')};
  };
  if(referenceTimes===undefined && (!delays || delays.length!==events.length))throw new Error('Energy reference times are unavailable. Create a new Energy-correlated spectrum to view correlation time.');
  if(referenceTimes===undefined && lm.energyDelayDirection!=='next')throw new Error('Saved correlation times use the previous timing direction. Recreate the Energy correlation or connect this spectrum to an Energy histogram to calculate forward decay times.');
  if(referenceTimes===undefined && lm.energyDelaySource!=='box-sum')throw new Error('Saved correlation times do not use the calibrated Box detector sum. Connect to the Energy histogram with Box channel calibrations loaded, or recreate the correlation.');
  if(referenceTimes!==undefined && (!Number.isFinite(lm.sweepPeriodUs) || lm.sweepPeriodUs<=0))throw new Error('A positive ToF sweep period is required for correlation time.');
  if(!['linear','log'].includes(xScale))throw new Error('Invalid time scale.');
  if(![channel,edge,tag].every(value=>Number.isSafeInteger(value) && value>=0) || !Number.isFinite(tofLowUs) || !Number.isFinite(tofHighUs) || tofHighUs<=tofLowUs ||
    !Number.isSafeInteger(sweepLow) || sweepLow<0 || !(sweepHigh===Infinity || Number.isSafeInteger(sweepHigh)) || sweepHigh<=sweepLow)throw new Error('Invalid ToF ROI, channel, edge, TAG or sweep range.');
  if(binWidth!==undefined && (!Number.isFinite(binWidth) || binWidth<=0))throw new Error('Use a positive correlation-time bin width in seconds.');
  const eject=lm.ejectBins?.[Math.abs(tag)%2];
  if(!Number.isFinite(eject))throw new Error('No ejection time for this TAG.');
  const low=eject+tofLowUs*10000,high=eject+tofHighUs*10000;
  // Resolve competing implantations only after selecting the displayed ToF
  // population. Other channels, edges, TAGs and masses are not competing ions.
  const candidates=[];
  for(let i=0;i<events.length;i++){
    if(events.channel[i]===channel && events.edge[i]===edge && events.tag[i]===tag && events.sweep[i]>=sweepLow && events.sweep[i]<sweepHigh && events.tof[i]>=low && events.tof[i]<high)candidates.push(i);
  }
  const successors=Number.isFinite(lm.sweepPeriodUs) && lm.sweepPeriodUs>0?nextIonTimes(lm,candidates):null;
  const selected=[],matches=[];let missingSuccessor=0,zeroDelay=0,max=0,minPositive=Infinity;
  for(const i of candidates){
    const seconds=referenceTimes===undefined?null:events.sweep[i]*lm.sweepPeriodUs/1e6+events.tof[i]/1e10;
    const matched=referenceTimes===undefined?i:nextEnergyIndex(seconds,times);
    const delay=referenceTimes===undefined?delays[i]:matched>=0?Math.max(0,times[matched]-seconds):NaN;
    const ionSeconds=successors?events.sweep[i]*lm.sweepPeriodUs/1e6+events.tof[i]/1e10:NaN;
    const tolerance=Number.EPSILON*Math.max(1,Math.abs(ionSeconds),Math.abs(delay))*4;
    if(!Number.isFinite(delay) || delay<0 || successors && successors[i]-ionSeconds<delay-tolerance){missingSuccessor++;continue;}
    if(delay===0)zeroDelay++;else minPositive=Math.min(minPositive,delay);
    selected.push(delay);matches.push(matched);max=Math.max(max,delay);
  }
  const singleEvents=(counts,binMatches)=>counts.map((count,i)=>count===1?eventDetails(binMatches[i]):null);
  const fit=fitExponential?fitExponentialDecay(selected):undefined;
  const fitResult=edges=>{
    if(!fit)return {};
    if(!fit.ok)return {fit};
    // Integrate over each bin, including unequal log-time bins and empty bins.
    return {fit:{...fit,counts:edges.slice(1).map((high,i)=>fit.events*Math.exp(-edges[i]/fit.lifetime)*(-Math.expm1(-(high-edges[i])/fit.lifetime)))}};
  };
  if(xScale==='log'){
    // Equal-width bins in log10(seconds); zero has no logarithm.
    const low=Number.isFinite(minPositive)?Math.floor(Math.log10(minPositive)): -3;
    const high=Number.isFinite(minPositive)?Math.max(low+0.1,Math.ceil(Math.log10(max))): -2;
    const bins=100,step=(high-low)/bins,edges=Array.from({length:bins+1},(_,i)=>10**(low+i*step));
    const counts=new Array(bins).fill(0),binMatches=new Array(bins).fill(-1);
    for(let i=0;i<selected.length;i++)if(selected[i]>0){const bin=Math.min(bins-1,Math.max(0,Math.floor((Math.log10(selected[i])-low)/step)));counts[bin]++;binMatches[bin]=matches[i];}
    return {...fitResult(edges),...(fitSchmidt?{schmidtFit:fitSchmidtDecay(edges,counts)}:{}),x:counts.map((_,i)=>Math.sqrt(edges[i]*edges[i+1])),counts,singleEvents:singleEvents(counts,binMatches),widths:counts.map((_,i)=>edges[i+1]-edges[i]),binWidth:null,xScale,zeroDelay,
      totalEvents:selected.length-zeroDelay,missingSuccessor,selectedEvents:selected.length+missingSuccessor,settings:{channel,edge,tag,tofLowUs,tofHighUs,sweepLow,sweepHigh:sweepHigh===Infinity?null:sweepHigh}};
  }
  const width=binWidth??(max>0?max/100:0.001),bins=Math.max(1,Math.ceil(max/width));
  if(!Number.isFinite(bins) || bins>100000)throw new Error('Too many correlation-time bins. Increase the bin width (maximum 100,000 bins).');
  const counts=new Array(bins).fill(0),binMatches=new Array(bins).fill(-1);
  for(let i=0;i<selected.length;i++){const bin=Math.min(bins-1,Math.floor(selected[i]/width));counts[bin]++;binMatches[bin]=matches[i];}
  return {...fitResult(Array.from({length:bins+1},(_,i)=>i*width)),...(fitSchmidt?{schmidtFit:{ok:false,error:'Use logarithmic time bins for a Schmidt fit.'}}:{}),x:counts.map((_,i)=>(i+0.5)*width),counts,singleEvents:singleEvents(counts,binMatches),binWidth:width,xScale,zeroDelay,totalEvents:selected.length,missingSuccessor,
    selectedEvents:selected.length+missingSuccessor,settings:{channel,edge,tag,tofLowUs,tofHighUs,sweepLow,sweepHigh:sweepHigh===Infinity?null:sweepHigh}};
}
module.exports={makeCorrelationTimeHistogram,fitExponentialDecay,fitSchmidtDecay};
