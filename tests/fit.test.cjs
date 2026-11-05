const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fitGaussianConstant } = require('../fit-engine');
const addon = require('../build/Release/fitaddon.node');
function request(fixed = {}) {
  const points = Array.from({length:101}, (_,i)=>{
    const plotX = 12 + i * 0.01;
    return {plotX,x:27072+plotX,y:5+200*Math.exp(-0.5*((plotX-12.5)/0.08)**2)};
  });
  const initialFitState = {params:{}};
  for (const [key,value] of Object.entries({baseline:4,sigma:0.1,amplitude:180,center:27084.48})) {
    initialFitState.params[key]={value,fixed:fixed[key]||false,sigma:0};
  }
  return {points,initialFitState};
}
test('recovers Gaussian parameters and MPFIT errors with covariance',()=>{
  const r=fitGaussianConstant(request());
  assert.ok(Math.abs(r.params.center.value-27084.5)<1e-6);
  assert.ok(Math.abs(r.params.sigma.value-0.08)<1e-6);
  assert.ok(Math.abs(r.params.amplitude.value-200)<1e-4);
  assert.ok(Math.abs(r.params.baseline.value-5)<1e-4);
  assert.equal(r.uncertaintiesValid,true);
  assert.ok(r.params.center.sigma>0);
  for(let i=0;i<4;i++) {
    const key=r.covarianceOrder[i];
    assert.ok(Math.abs(r.covariance[i][i]-r.params[key].sigma**2)<1e-8);
  }
  assert.equal(r.dof,97);
});
test('fixed center stays fixed and has no fitted uncertainty',()=>{
  const q=request({center:true}); q.initialFitState.params.center.value=27084.5;
  const r=fitGaussianConstant(q);
  assert.equal(r.params.center.value,27084.5); assert.equal(r.params.center.sigma,0);
  assert.equal(r.dof,98);
});
test('retains zero bins and rejects invalid inputs',()=>{
  const q=request(); q.points[0].y=0;
  const r=fitGaussianConstant(q); assert.equal(r.dof,97);
  q.points[0].y=-1; assert.throws(()=>fitGaussianConstant(q),/nonnegative/);
  assert.throws(()=>fitGaussianConstant(request({baseline:true,sigma:true,amplitude:true,center:true})),/free/);
});
test('bridge supports custom JS residuals and propagates callback errors',()=>{
  const options={initialValues:[1,0],fixed:[0,0],minValues:[-100,-100],maxValues:[100,100],dataLength:5};
  const r=addon.fit(options,p=>[0,1,2,3,4].map(x=>2*x+3-(p[0]*x+p[1])));
  assert.ok(Math.abs(r.covariance[0]-0.1)<1e-6);
  assert.ok(Math.abs(r.covariance[1]+0.2)<1e-6);
  assert.ok(Math.abs(r.covariance[3]-0.6)<1e-6);
  assert.ok(Math.abs(r.parameterValues[0]-2)<1e-5); assert.ok(Math.abs(r.parameterValues[1]-3)<1e-5);
  assert.throws(()=>addon.fit(options,()=>{throw new Error('model error')}),/model error/);
  assert.throws(()=>addon.fit(options,()=>[1]),/Residual count/);
});

test('a fixed zero background does not suppress uncertainties of free parameters',()=>{
  const q=request({baseline:true}); q.initialFitState.params.baseline.value=0;
  q.points.forEach(p=>p.y-=5);
  const r=fitGaussianConstant(q); assert.equal(r.uncertaintiesValid,true);
  assert.ok(r.params.center.sigma>0); assert.equal(r.params.baseline.sigma,0);
});

test('uncertainties decrease with increased counts, without chi-square rescaling',()=>{
  const q=request(); const first=fitGaussianConstant(q);
  const more=request(); more.points.forEach(p=>p.y*=4);
  more.initialFitState.params.baseline.value*=4;
  more.initialFitState.params.amplitude.value*=4;
  const second=fitGaussianConstant(more);
  assert.ok(Math.abs(second.params.center.sigma/first.params.center.sigma-0.5)<0.001);
  assert.ok(Math.abs(second.params.sigma.sigma/first.params.sigma.sigma-0.5)<0.001);
});

for (const key of ['center', 'sigma', 'amplitude', 'baseline']) {
  test(`fixed ${key} stays at deliberately offset initial value; releasing it recovers truth`,()=>{
    const q=request({[key]:true});
    const held=q.initialFitState.params[key].value;
    const r=fitGaussianConstant(q);
    assert.ok(Math.abs(r.params[key].value-held)<1e-12, `${key} moved while fixed`);
    assert.equal(r.params[key].fixed,true);
    assert.equal(r.params[key].sigma,0);
    assert.equal(r.dof,98);
    q.initialFitState.params[key].fixed=false;
    const free=fitGaussianConstant(q);
    const truth={center:27084.5,sigma:0.08,amplitude:200,baseline:5}[key];
    assert.ok(Math.abs(free.params[key].value-truth)<1e-4);
    assert.equal(free.params[key].fixed,false);
    assert.ok(free.params[key].sigma>0);
  });
}

test('all combinations of one to three fixed parameters remain fixed',()=>{
  const keys=['baseline','sigma','amplitude','center'];
  for(let mask=1;mask<15;mask++) {
    const fixed=Object.fromEntries(keys.map((key,i)=>[key,!!(mask&(1<<i))]));
    const q=request(fixed), r=fitGaussianConstant(q);
    for(const key of keys) if(fixed[key]) {
      assert.ok(Math.abs(r.params[key].value-q.initialFitState.params[key].value)<1e-12,`${mask}: ${key} moved`);
      assert.equal(r.params[key].sigma,0);
    }
    assert.equal(r.dof,101-keys.filter(key=>!fixed[key]).length);
  }
});

test('native lower and upper bounds constrain a solution outside the allowed interval',()=>{
  for(const target of [-5,5]) {
    const r=addon.fit({initialValues:[0.5],fixed:[0],minValues:[0],maxValues:[1],dataLength:5},p=>Array(5).fill(target-p[0]));
    assert.ok(r.status>=1 && r.status<=4);
    assert.equal(r.parameterValues[0],target<0?0:1);
  }
});

test('Gaussian bounds reject invalid starting width, height, background and center',()=>{
  for(const [key,value] of [['sigma',0],['sigma',-0.1],['amplitude',-1],['baseline',-1],['center',27080]]) {
    const q=request(); q.initialFitState.params[key].value=value;
    assert.throws(()=>fitGaussianConstant(q),/Initial parameters/);
  }
});

test('Gaussian background cannot cross zero when unconstrained optimum is negative',()=>{
  const q=request();
  q.points.forEach(p=>{p.y=Math.max(0,p.y-10)});
  const r=fitGaussianConstant(q);
  assert.equal(r.params.baseline.value,0);
  assert.equal(r.uncertaintiesValid,false);
  assert.equal(r.covariance,null);
  assert.match(r.warning,/bound/);
});

test('Fixed with nonzero uncertainty bounds rather than freezes the center',()=>{
  const q=request({center:true});
  const center=q.initialFitState.params.center;
  center.value=27084.48; center.sigma=0.005;
  const r=fitGaussianConstant(q);
  assert.ok(r.params.center.value>center.value);
  assert.ok(r.params.center.value>=center.value-center.sigma-1e-10);
  assert.ok(r.params.center.value<=center.value+center.sigma+1e-10);
  assert.equal(r.params.center.absoluteFixed,false);
  assert.equal(r.params.center.fixed,true);
  assert.equal(r.dof,97);
  assert.equal(r.uncertaintiesValid,false); // optimum hits the requested upper bound
});

test('every bounded parameter may move within its uncertainty range',()=>{
  const truth={center:27084.5,sigma:0.08,amplitude:200,baseline:5};
  const deltas={center:0.05,sigma:0.05,amplitude:50,baseline:3};
  for(const key of Object.keys(truth)) {
    const q=request({[key]:true}); q.initialFitState.params[key].sigma=deltas[key];
    const r=fitGaussianConstant(q);
    assert.ok(Math.abs(r.params[key].value-truth[key])<1e-4,key);
    assert.equal(r.params[key].absoluteFixed,false);
    assert.ok(r.params[key].sigma>0);
  }
});

test('missing, negative or nonfinite uncertainty cannot silently freeze a parameter',()=>{
  for(const sigma of [undefined,null,-1,NaN,Infinity]) {
    const q=request({center:true}); q.initialFitState.params.center.sigma=sigma;
    assert.throws(()=>fitGaussianConstant(q),/uncertainty/);
  }
});
