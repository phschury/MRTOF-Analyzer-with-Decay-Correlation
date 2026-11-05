const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Worker } = require('node:worker_threads');
const { evaluate, fullWidthHalfMaximum } = require('../public/js/fit-models');
const { fitPeak } = require('../fit-engine');

// Independent transcription of the legacy C model equations for synthetic data.
function legacy(model, x, p) {
  const d = x - p.center, variance = p.sigma ** 2;
  if (model === 'exponentialGaussianHybrid') {
    const denominator = 2 * variance - p.decay * d;
    return denominator > 0 ? p.amplitude * Math.exp(-d * d / denominator) : 0;
  }
  if (x > p.center + p.rightSwitching) return p.amplitude * Math.exp(0.5 * p.rightSwitching * (2 * p.center - 2 * x + p.rightSwitching) / variance);
  if (x < p.center - p.leftSwitching) return p.amplitude * Math.exp(0.5 * p.leftSwitching * (2 * x - 2 * p.center + p.leftSwitching) / variance);
  return p.amplitude * Math.exp(-0.5 * d * d / variance);
}
function request(model, decay = -0.07, scale = 1) {
  const truth = {sigma:0.08 * scale, amplitude:200, center:27084.5, decay:decay * scale, leftSwitching:0.07 * scale, rightSwitching:0.13 * scale};
  const points = Array.from({ length:301 }, (_, i) => {
    const x = truth.center + (i / 300 - 0.5) * 2 * scale;
    return { x, plotX:x - 27072, y:legacy(model, x, truth) };
  });
  const initial = {sigma:0.09 * scale, amplitude:180, center:truth.center - 0.01 * scale};
  if (model === 'exponentialGaussianHybrid') initial.decay = 0;
  else Object.assign(initial, {leftSwitching:0.08 * scale, rightSwitching:0.10 * scale});
  return {truth, model, points, initialFitState:{params:Object.fromEntries(Object.entries(initial).map(([key,value])=>[key,{value,sigma:null,fixed:false}]))}};
}

test('EGH matches legacy equation, cutoff, and tail direction', () => {
  const p={center:0,sigma:1,amplitude:10,decay:1};
  assert.equal(evaluate('exponentialGaussianHybrid',0,p),10);
  assert.equal(evaluate('exponentialGaussianHybrid',1,p),10 / Math.E);
  assert.equal(evaluate('exponentialGaussianHybrid',2,p),0);
  assert.equal(evaluate('exponentialGaussianHybrid',3,p),0);
  assert.ok(evaluate('exponentialGaussianHybrid',-1,p)>evaluate('exponentialGaussianHybrid',1,p));
  p.decay=0;
  for (const x of [-10,-1,0,1,10]) assert.equal(evaluate('exponentialGaussianHybrid',x,p),evaluate('gaussianConstant',x,{...p,baseline:0}));
});
test('DEG has continuous value and slope at both switchovers', () => {
  const p={center:0,sigma:1,amplitude:10,leftSwitching:0.8,rightSwitching:1.4};
  for (const x of [-p.leftSwitching,p.rightSwitching]) {
    const y=evaluate('dualExpGaussian',x,p), h=1e-6;
    assert.ok(Math.abs(y-10*Math.exp(-x*x/2))<1e-12);
    const left=(y-evaluate('dualExpGaussian',x-h,p))/h;
    const right=(evaluate('dualExpGaussian',x+h,p)-y)/h;
    assert.ok(Math.abs(left-right)<1e-5);
    assert.ok(Math.abs(left+x*y)<1e-5);
  }
  assert.ok(evaluate('dualExpGaussian',-4,p)>evaluate('dualExpGaussian',4,p));
});
for (const model of ['exponentialGaussianHybrid','dualExpGaussian']) {
  for (const scale of [0.01,1,100]) test(`${model} recovers legacy synthetic parameters at time scale ${scale}`, () => {
    const q=request(model,-0.07,scale), r=fitPeak(q);
    for (const key of r.covarianceOrder) assert.ok(Math.abs(r.params[key].value-q.truth[key]) < (key === 'amplitude' ? 1e-3 : 1e-5 * scale),key);
    assert.equal(r.model,model); assert.equal(r.uncertaintiesValid,true);
    assert.equal(r.dof,q.points.length-r.covarianceOrder.length);
    assert.ok(!r.covarianceOrder.includes('baseline'));
    for (let i=0;i<r.covarianceOrder.length;i++) {
      const key=r.covarianceOrder[i];
      assert.ok(Math.abs(r.covariance[i][i]-r.params[key].sigma**2) < 1e-8);
    }
    assert.ok(Math.abs(r.params.fwhm.value-expectedWidth(model,q.truth))<1e-5*scale);
    assert.ok(r.params.fwhm.sigma>0);
    assert.ok(r.fitCurve.every(p=>Number.isFinite(p.y)&&p.y>=0));
  });
  test(`${model} honors exact holds and uncertainty bounds for shape parameters`, () => {
    const q=request(model),key=model==='dualExpGaussian'?'leftSwitching':'decay';
    q.initialFitState.params[key]={value:q.truth[key],sigma:0,fixed:true};
    const held=fitPeak(q);
    assert.equal(held.params[key].value,q.truth[key]);
    assert.equal(held.params[key].sigma,0);
    q.initialFitState.params[key]={value:q.truth[key]*0.95,sigma:Math.abs(q.truth[key])*0.2,fixed:true};
    const bounded=fitPeak(q);
    assert.ok(Math.abs(bounded.params[key].value-q.truth[key])<1e-5);
    assert.equal(bounded.params[key].absoluteFixed,false);
    assert.ok(bounded.params[key].sigma>0);
    q.initialFitState.params[key].sigma=null;
    assert.throws(()=>fitPeak(q),/uncertainty/);
  });
}
test('EGH recovers positive decay as well as negative decay', () => {
  const q=request('exponentialGaussianHybrid',0.07),r=fitPeak(q);
  assert.ok(Math.abs(r.params.decay.value-0.07)<1e-6);
});
test('DEG rejects zero/negative switch distances and unknown models', () => {
  for (const key of ['leftSwitching','rightSwitching']) for (const value of [0,-1]) {
    const q=request('dualExpGaussian');q.initialFitState.params[key].value=value;
    assert.throws(()=>fitPeak(q),/Initial parameters/);
  }
  assert.throws(()=>fitPeak({model:'gaussianLinear'}),/Unknown/);
  assert.throws(()=>fitPeak({model:'toString'}),/Unknown/);
});
test('worker dispatches both asymmetric models', async () => {
  for (const model of ['exponentialGaussianHybrid','dualExpGaussian']) {
    const q=request(model);
    const result=await new Promise((resolve,reject)=>{
      const worker=new Worker(require.resolve('../fit-worker'),{workerData:q});
      worker.once('message',resolve);worker.once('error',reject);
    });
    assert.equal(result.ok,true);assert.equal(result.model,model);
    assert.ok(Math.abs(result.params.center.value-q.truth.center)<1e-6);
  }
});


// Closed-form reference crossings, independent of the numerical trace.
function expectedWidth(model,p) {
  if(model==='exponentialGaussianHybrid') return Math.sqrt((Math.LN2*p.decay)**2+8*Math.LN2*p.sigma**2);
  const coreHalf=p.sigma*Math.sqrt(2*Math.LN2);
  const half=s=>s>=coreHalf?coreHalf:p.sigma**2*Math.LN2/s+s/2;
  return half(p.leftSwitching)+half(p.rightSwitching);
}

test('traced widths match analytical half-height crossings across both hybrid shapes',()=>{
  for(const scale of [1e-6,1,1e6]) {
    for(const decay of [-10,-0.1,0,0.1,10]) {
      const p={sigma:scale,decay:decay*scale,center:1e12,amplitude:1e-200};
      assert.ok(Math.abs(fullWidthHalfMaximum('exponentialGaussianHybrid',p)/expectedWidth('exponentialGaussianHybrid',p)-1)<1e-12);
    }
    for(const [left,right] of [[2,3],[0.5,3],[3,0.5],[0.1,0.5]]) {
      const p={sigma:scale,leftSwitching:left*scale,rightSwitching:right*scale,center:1e12,amplitude:1e-200};
      assert.ok(Math.abs(fullWidthHalfMaximum('dualExpGaussian',p)/expectedWidth('dualExpGaussian',p)-1)<1e-12);
    }
  }
  assert.equal(fullWidthHalfMaximum('gaussianConstant',{sigma:2,baseline:10000,amplitude:1}),2*2.3548200450309493);
});
test('FWHM is independent of the ROI and includes tails outside it',()=>{
  const q=request('dualExpGaussian');
  q.points=q.points.filter(p=>Math.abs(p.x-q.truth.center)<0.03);
  for(const [key,param] of Object.entries(q.initialFitState.params)) {
    param.value=q.truth[key];param.sigma=0;param.fixed=key!=='amplitude';
  }
  const r=fitPeak(q);
  assert.ok(r.params.fwhm.value>q.points.at(-1).x-q.points[0].x);
  assert.ok(Math.abs(r.params.fwhm.value-expectedWidth(q.model,q.truth))<1e-12);
  assert.equal(r.params.fwhm.sigma,0);
});
test('hybrid FWHM uncertainties include shape covariance',()=>{
  for(const model of ['exponentialGaussianHybrid','dualExpGaussian']) {
    const r=fitPeak(request(model));
    const p=Object.fromEntries(r.covarianceOrder.map(key=>[key,r.params[key].value]));
    const gradient=r.covarianceOrder.map(key=>{
      if(['center','amplitude'].includes(key))return 0;
      const step=1e-6;
      return (expectedWidth(model,{...p,[key]:p[key]+step})-expectedWidth(model,{...p,[key]:p[key]-step}))/(2*step);
    });
    const variance=gradient.reduce((sum,g,i)=>sum+gradient.reduce((v,h,j)=>v+g*r.covariance[i][j]*h,0),0);
    assert.ok(Math.abs(r.params.fwhm.sigma/Math.sqrt(variance)-1)<1e-6);
  }
});
