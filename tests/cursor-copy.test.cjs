const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function viewer(){
 const handlers={},keys={},windows={},copies=[];
 const elements={timeMode:{value:'absolute'},tag:{value:'1'},status:{textContent:''}};
 const plot={_fullLayout:{xaxis:{_offset:50,_length:1000,p2d:x=>x/10},yaxis:{_offset:20,_length:200}},
  getBoundingClientRect:()=>({left:100,top:100}),addEventListener:(key,fn)=>handlers[key]=fn};
 const context=vm.createContext({plot,window:{addEventListener:(key,fn)=>windows[key]=fn},
  document:{addEventListener:(key,fn)=>keys[key]=fn,getElementById:id=>elements[id]},
  navigator:{clipboard:{writeText:async text=>copies.push(text)}}});
 vm.runInContext(fs.readFileSync('public/js/histogram-page.js','utf8'),context);
 vm.runInContext(`plottedTags=new Map([[0,{chartData:{datasets:[{ejectUs:100}]}}],[1,{chartData:{datasets:[{ejectUs:300}]}}]]);initializeCursorCopy(plot)`,context);
 return {handlers,keys,windows,copies,elements,context,move:(x,y=150)=>handlers.pointermove({clientX:150+x*10,clientY:y}),
  copy:async(options={})=>{const event={key:'c',ctrlKey:true,prevented:false,preventDefault(){this.prevented=true},...options};await keys.keydown(event);return event;}};
}
test('Ctrl+C copies the exact cursor absolute ToF in ns in either TAG panel',async()=>{
 const v=viewer();v.move(12.3456789);assert.equal((await v.copy()).prevented,true);
 assert.equal(v.copies.at(-1),'112345.6789');
 v.move(42.6+12.5);await v.copy();assert.equal(v.copies.at(-1),'312500');
 v.move(41);assert.equal((await v.copy()).prevented,false);assert.equal(v.copies.length,2);
});
test('relative cursor copy uses the selected TAG ejection time and supports Command+C',async()=>{
 const v=viewer();v.elements.timeMode.value='relative';v.move(12.5);
 await v.copy({ctrlKey:false,metaKey:true});assert.equal(v.copies.at(-1),'312500');
 v.elements.tag.value='0';await v.copy();assert.equal(v.copies.at(-1),'112500');
});
test('copy ignores inputs, unrelated keys, margins, pointer leave and window blur',async()=>{
 const v=viewer();await v.copy();assert.equal(v.copies.length,0);
 v.move(10);assert.equal((await v.copy({target:{closest:()=>({})}})).prevented,false);
 await v.copy({key:'x'});await v.copy({ctrlKey:false});await v.copy({altKey:true});
 v.move(10,110);await v.copy();v.move(-1);await v.copy();
 v.move(10);v.handlers.pointerleave();await v.copy();
 v.move(10);v.windows.blur();await v.copy();
 v.move(10);v.windows.scroll();await v.copy();
 assert.equal(v.copies.length,0);
});
test('clipboard failures are reported without losing the chart state',async()=>{
 const v=viewer();v.move(10);
 vm.runInContext(`navigator.clipboard.writeText=async()=>{throw new Error('Permission denied')}`,v.context);
 await v.copy();assert.match(v.elements.status.textContent,/Could not copy cursor ToF: Permission denied/);
});
