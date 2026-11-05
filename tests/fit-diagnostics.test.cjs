const {test}=require('node:test');
const assert=require('node:assert/strict');
const {assessCovariance}=require('../fit-diagnostics');
const {fitPeak}=require('../fit-engine');
const {format,parse,validate}=require('../public/js/fit-parameters');

test('covariance checks distinguish finite positive errors from independent parameters',()=>{
  assert.equal(assessCovariance([[1,0],[0,1]],[0,0]).valid,true);
  assert.equal(assessCovariance([[1,1],[1,1]],[0,0]).valid,false);
  const almost=1-1e-12;
  const r=assessCovariance([[1,almost],[almost,1]],[0,0]);
  assert.equal(r.valid,false);assert.ok(r.condition>1e10);
  assert.equal(assessCovariance([[1,0],[0,0]],[0,1]).valid,true);
  assert.equal(assessCovariance([[1,0],[0,0]],[0,0]).valid,false);
});
test('covariance assessment is independent of parameter units and scales',()=>{
  for(const rho of [0.5,1-1e-12]) {
    const a=assessCovariance([[1,rho],[rho,1]],[0,0]);
    const b=assessCovariance([[1e-12,rho*1e3],[rho*1e3,1e18]],[0,0]);
    assert.equal(a.valid,b.valid);
  }
});
test('the 269-count, 45-bin DEG regression preserves its curve but reports unresolved parameters',()=>{
  // TAG 2 of the bundled _221Fr@1669_38.lst, at 32 ns/bin and the reported ROI.
  const r=fitPeak(require('./fixtures/deg-unresolved-core.json'));
  assert.ok(Math.abs(r.chi2-35.531815782233785)<1e-5);
  assert.equal(r.counts,269);assert.equal(r.dof,40);
  assert.equal(r.gaussianCoreBins,0);
  assert.equal(r.uncertaintiesValid,false);assert.equal(r.covariance,null);
  assert.match(r.warning,/not independently determined/);
  assert.match(r.warning,/No bin centers sample the Gaussian core/);
  for(const key of r.covarianceOrder) {
    assert.equal(r.params[key].sigma,null);
    const text=format(r.params[key].value,r.params[key].sigma);
    const parsed=validate(text,key,false);
    assert.ok(Math.abs(parsed.value-r.params[key].value)<1e-9);
    assert.equal(parsed.uncertainty,null);
  }
  assert.equal(r.params.fwhm.sigma,null);
  assert.ok(r.fitCurve.some(p=>p.y>100));
});
test('large uncertainties cannot erase positive parameters in editable fit results',()=>{
  for(const [value,error]of [[0.011802,300000],[0.0061458,320000],[157.618,1.4e9],[30893.0403,46000]]) {
    const displayed=parse(format(value,error));
    assert.equal(displayed.value,value);
    assert.ok(Math.abs(displayed.uncertainty-error)/error<0.01);
  }
});
