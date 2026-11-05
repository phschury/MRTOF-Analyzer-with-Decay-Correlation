const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parse,format}=require('../public/js/fit-parameters');
test('parentheses contain absolute uncertainty, including decimals and exponents',()=>{
  assert.deepEqual(parse('123(2.1)'),{value:123,uncertainty:2.1});
  assert.deepEqual(parse(' 1.23e2 ( 2.1e-2 ) '),{value:123,uncertainty:0.021});
  assert.deepEqual(parse('123(0)'),{value:123,uncertainty:0});
  assert.deepEqual(parse('123(?)'),{value:123,uncertainty:null});
  assert.deepEqual(parse('123'),{value:123,uncertainty:null});
  for(const input of ['123(-2)','NaN(1)','1(2)junk','1()','1(1e999)']) assert.throws(()=>parse(input));
});
test('fitted values are rounded to the precision of their uncertainties',()=>{
  for(const [value,error] of [[27085.0062628,0.000073131],[123,2.1],[0,0],[12,null]]) {
    const result=parse(format(value,error));
    assert.ok(Math.abs(result.value-value) <= (error || 1e-10) * 0.01);
    if (error) assert.ok(Math.abs(result.uncertainty-error)/error < 0.01);
    else assert.equal(result.uncertainty,error);
  }
});

test('validation rejects invalid numeric entries and nonphysical parameter values',()=>{
  for(const input of ['123(-2.1)','123(abc)','123(2)xyz','Infinity(1)','1,000(2)','', '1(1e999)']) {
    assert.throws(()=>require('../public/js/fit-parameters').validate(input,'center',false));
  }
  const {validate}=require('../public/js/fit-parameters');
  assert.throws(()=>validate('0(1)','fwhm',false));
  assert.throws(()=>validate('-1(1)','baseline',false));
  assert.throws(()=>validate('123(?)','center',true));
  assert.equal(validate('123(0)','center',true).uncertainty,0);
  assert.equal(validate('1.23e2(2.1e-3)','center',true).value,123);
});
