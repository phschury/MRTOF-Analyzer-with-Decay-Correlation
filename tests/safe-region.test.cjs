const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('safe shading clips correctly when the view overlaps, contains, or lies outside the safe region',()=>{
 const context=vm.createContext({window:{addEventListener(){}},document:{addEventListener(){}}});
 vm.runInContext(fs.readFileSync('public/js/histogram-page.js','utf8'),context);
 vm.runInContext('safeRegion={low:5,high:25}',context);
 const shapes=(low,high)=>JSON.parse(vm.runInContext(`JSON.stringify(safeRegionShapes(${low},${high}))`,context));
 const bounds=(low,high)=>shapes(low,high).map(s=>[s.x0,s.x1]);
 assert.deepEqual(bounds(0,40),[[0,0.125],[0.625,1]]);
 assert.deepEqual(bounds(10,20),[[0,0],[1,1]]);
 assert.deepEqual(bounds(-10,0),[[0,1],[1,1]]);
 assert.deepEqual(bounds(30,40),[[0,0],[0,1]]);
 assert.deepEqual(bounds(0,10),[[0,0.5],[1,1]]);
 assert.deepEqual(bounds(20,30),[[0,0],[0.5,1]]);
 for(const shape of shapes(0,40)){
   assert.equal(shape.fillcolor,'rgba(128,128,128,0.5)');
   assert.equal(shape.yref,'paper');assert.equal(shape.y0,0);assert.equal(shape.y1,1);
 }
 assert.deepEqual(shapes(10,10),[]);
});
