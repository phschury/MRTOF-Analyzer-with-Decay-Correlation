const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

function viewer(){
    class Element {
        constructor(){this.children=[];this.dataset={};this.style={};this.listeners={};this.attributes={};this.classes=new Set();this.classList={add:name=>this.classes.add(name)};}
        set innerHTML(value){this.children=[];}
        appendChild(child){this.children.push(child);}
        replaceChildren(){this.children=[];}
        setAttribute(key,value){this.attributes[key]=value;}
        addEventListener(name,fn){this.listeners[name]=fn;}
        getBoundingClientRect(){return {width:200,height:100};}
        querySelector(){return this.children[0];}
        focus(){}
    }
    const elements={loadedFilesTableBody:new Element(),spectrumContextMenu:new Element()};
    const context=vm.createContext({document:{getElementById:id=>elements[id],createElement:()=>new Element(),addEventListener(){}},window:{addEventListener(){},scrollX:0,scrollY:0,innerWidth:1000,innerHeight:800}});
    const run=code=>vm.runInContext(code,context);
    run(fs.readFileSync('public/js/histogram-page.js','utf8'));
    run(`scheduleWorkspaceSave=()=>{};hideChartContextMenu=()=>{};
        loadedFileStates=[{datasetId:'a',displayName:'A.lst'},{datasetId:'b',displayName:'B.lst',fits:[{id:'fit1'},{id:'fit2'}]}];activeFileStateIndex=0;`);
    context.event={preventDefault(){},stopPropagation(){},target:{closest:()=>true},pageX:10,pageY:10};
    return {run,context,elements};
}

test('Display spectrum appears only on other files and replaces double-click loading',async()=>{
    const v=viewer();
    v.run('renderLoadedFilesList();showSpectrumContextMenu(event,"a")');
    assert.ok(!v.elements.spectrumContextMenu.children.some(button=>button.textContent==='Display spectrum'));
    for(const row of v.elements.loadedFilesTableBody.children)assert.equal(row.listeners.dblclick,undefined);
    v.run('showSpectrumContextMenu(event,"b")');
    const display=v.elements.spectrumContextMenu.children.find(button=>button.textContent==='Display spectrum');
    assert.ok(display);
    v.run('restoreLoadedFileState=async index=>{activeFileStateIndex=index}');
    await display.listeners.click();
    assert.equal(v.run('activeFileStateIndex'),1);
});

test('loading indicator survives rerenders, blocks overlapping requests, and clears after completion or error',async()=>{
    for(const fail of [false,true]){
        const v=viewer();
        let finish;
        v.context.pending=new Promise((resolve,reject)=>{finish=()=>fail?reject(new Error('Load failed')):resolve();});
        v.run('calls=0;restoreLoadedFileStateData=async()=>{calls++;await pending}');
        const loading=v.run('restoreLoadedFileState(1)');
        const check=()=>{
            const cell=v.elements.loadedFilesTableBody.children[1].children[0];
            assert.ok(cell.classes.has('spectrumLoading'));
            assert.equal(cell.attributes['aria-busy'],'true');
            assert.equal(cell.children[0].attributes.role,'progressbar');
            assert.equal(cell.rowSpan,2);
        };
        check();
        v.run('renderLoadedFilesList()');check();
        v.run('showSpectrumContextMenu(event,"b")');
        assert.equal(v.elements.spectrumContextMenu.children[0].disabled,true);
        await v.run('restoreLoadedFileState(0)');
        assert.equal(v.run('calls'),1);
        finish();
        if(fail)await assert.rejects(loading,/Load failed/);
        else await loading;
        assert.equal(v.run('loadingSpectrumId'),null);
        assert.ok(!v.elements.loadedFilesTableBody.children[1].children[0].classes.has('spectrumLoading'));
    }
});
