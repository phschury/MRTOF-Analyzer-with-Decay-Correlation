const { fitGaussianConstant } = require('./fit-engine');

// Bound work and count storage (32 million Uint32 bins use 128 MB).
const MAX_FIT_BINS = 100000;
const MAX_TRANCHES = 20000;
const MAX_TOTAL_BINS = 32000000;

function fitSweepTranches({ events, ejectBin, sweepLow, sweepHigh, tofLowUs, tofHighUs, binWidth, trancheSize = 5000 }) {
  if (![sweepLow,sweepHigh,binWidth].every(Number.isSafeInteger) || sweepLow<0 || sweepHigh<=sweepLow || binWidth<=0 ||
      ![ejectBin,tofLowUs,tofHighUs].every(Number.isFinite) || tofHighUs<=tofLowUs) throw new Error('Invalid ROI, bin width, or sweep range.');
  if (!Number.isSafeInteger(trancheSize) || trancheSize < 1) throw new Error('Tranche size must be a positive whole number of sweeps.');
  const tLow=ejectBin+Math.round(tofLowUs*10000),tHigh=ejectBin+Math.round(tofHighUs*10000);
  const bins=Math.ceil((tHigh-tLow)/binWidth), tranches=Math.ceil((sweepHigh-sweepLow)/trancheSize);
  if (bins<6) throw new Error('The fitting ROI needs at least 6 TOF bins. Widen the ROI or reduce Bin Width.');
  if (!Number.isSafeInteger(bins) || bins>MAX_FIT_BINS) throw new Error(`Too many fit bins per tranche (${bins.toLocaleString()}; limit ${MAX_FIT_BINS.toLocaleString()}). Narrow the TOF ROI or increase Bin Width.`);
  if (tranches>MAX_TRANCHES) throw new Error(`Too many sweep tranches (${tranches.toLocaleString()}; limit ${MAX_TRANCHES.toLocaleString()}). Increase Slice (sweeps per tranche) or narrow the sweep range.`);
  if (bins*tranches>MAX_TOTAL_BINS) throw new Error(`Too many total fit bins (${(bins*tranches).toLocaleString()}; limit ${MAX_TOTAL_BINS.toLocaleString()}). Increase Slice or Bin Width, or narrow the TOF ROI or sweep range.`);
  const histograms=Array.from({length:tranches},()=>new Uint32Array(bins));
  for(let i=0;i<events.length;i++) {
    const sw=events.sweep[i],t=events.tof[i];
    if(sw<sweepLow || sw>=sweepHigh || t<tLow || t>=tHigh) continue;
    histograms[Math.floor((sw-sweepLow)/trancheSize)][Math.floor((t-tLow)/binWidth)]++;
  }
  const results=[];
  for(let index=0;index<tranches;index++) {
    const first=sweepLow+index*trancheSize,last=Math.min(first+trancheSize,sweepHigh);
    const counts=histograms[index];
    const count=counts.reduce((a,b)=>a+b,0);
    const row={sweepLow:first,sweepHigh:last,sweepCenter:(first+last-1)/2,counts:count};
    if(!count) {
      results.push({...row,success:false,empty:true,error:'No events in this tranche and TOF ROI; skipped.'});
      continue;
    }
    try {
      const points=Array.from(counts,(y,i)=>({x:(tLow+(i+0.5)*binWidth)/10000,plotX:(tLow+(i+0.5)*binWidth-ejectBin)/10000,y}));
      let peak=0,min=Infinity;
      for(let i=0;i<bins;i++){ if(counts[i]>counts[peak])peak=i; min=Math.min(min,counts[i]); }
      const half=min+(counts[peak]-min)/2;
      let left=peak,right=peak;
      while(left>0 && counts[left]>half)left--;
      while(right<bins-1 && counts[right]>half)right++;
      const width=Math.max((right-left)*binWidth/10000/2.3548200450309493,binWidth/10000);
      const result=fitGaussianConstant({points,initialFitState:{params:{
        baseline:{value:min},amplitude:{value:Math.max(counts[peak]-min,1)},
        center:{value:points[peak].x},sigma:{value:width},
      }}});
      results.push({...row,success:true,centerUs:result.params.center.value-ejectBin/10000,
        centerSigmaUs:result.params.center.sigma,fwhmUs:result.params.fwhm.value,fwhmSigmaUs:result.params.fwhm.sigma,
        reducedChi2:result.reducedChi2,warning:result.warning,params:result.params});
    } catch(error) { results.push({...row,success:false,error:error.message}); }
  }
  return {trancheSize,results,settings:{sweepLow,sweepHigh,tofLowUs,tofHighUs,binWidth},
    model:'Gaussian + constant',emptyTranches:results.filter(row=>row.empty).length,successful:results.filter(row=>row.success).length};
}
module.exports={fitSweepTranches};
