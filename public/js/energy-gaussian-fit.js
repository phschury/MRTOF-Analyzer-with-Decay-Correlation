(function(root){
  'use strict';
  function request(histogram,low,high){
    const points=[];
    for(let i=0;i<histogram.x.length;i++){
      const x=histogram.x[i],y=histogram.counts[i];
      if(x>=low && x<=high)points.push({x,plotX:x,y});
    }
    if(points.length<6 || points.length>100000)throw new Error('Select an Energy ROI containing 6–100,000 bins.');
    let total=0,maximum=0,baseline=Infinity;
    for(const p of points){
      if(!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.y<0)throw new Error('Energy ROI contains invalid counts.');
      total+=p.y;maximum=Math.max(maximum,p.y);baseline=Math.min(baseline,p.y);
    }
    if(!(total>0))throw new Error('Energy ROI contains no events.');
    const signal=points.reduce((sum,p)=>sum+p.y-baseline,0);
    if(!(signal>0))throw new Error('Energy ROI has no resolved peak.');
    const center=points.reduce((sum,p)=>sum+p.x*(p.y-baseline),0)/signal;
    const variance=points.reduce((sum,p)=>sum+(p.x-center)**2*(p.y-baseline),0)/signal;
    const sigma=Math.max(Math.sqrt(variance),(points.at(-1).x-points[0].x)/points.length);
    const params={};
    for(const [key,value]of Object.entries({baseline,amplitude:maximum-baseline,center,sigma}))params[key]={value,fixed:false,sigma:0};
    return {model:'gaussianConstant',points,initialFitState:{params}};
  }
  const api={request};
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.EnergyGaussianFit=api;
})(typeof window==='object'?window:globalThis);
