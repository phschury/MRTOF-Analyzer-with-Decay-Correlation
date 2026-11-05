function initializeCombineFiles() {
    const button=document.getElementById('combineFilesButton');
    if(!button)return;
    const dialog=document.getElementById('combineFilesDialog');
    const choices=document.getElementById('combineFilesChoices');
    const status=document.getElementById('combineFilesStatus');
    const submit=document.getElementById('combineFilesSubmit');
    const cancel=document.getElementById('combineFilesCancel');
    let datasets=[],busy=false;
    const selected=()=>[...choices.querySelectorAll('input:checked')].map(input=>input.value);
    const refresh=()=>{submit.disabled=busy || selected().length<2;};
    choices.addEventListener('change',refresh);
    cancel.addEventListener('click',()=>dialog.close());
    dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
    button.addEventListener('click',async()=>{
        if(dialog.open)return;
        choices.replaceChildren();submit.disabled=true;status.textContent='Loading files…';dialog.showModal();
        try {
            const response=await fetch('/api/listmode-datasets');
            const result=await response.json();
            if(!response.ok || !result.ok)throw new Error(result.error || 'Could not list files.');
            datasets=result.datasets;
            for(const dataset of datasets) {
                const label=document.createElement('label');
                const input=document.createElement('input');
                input.type='checkbox';input.value=dataset.id;input.disabled=!dataset.canCombine;
                const name=document.createElement('span');name.textContent=dataset.filename;
                label.append(input,name);
                if(!dataset.canCombine){label.className='combine-file-excluded';label.title='Processed files cannot be combined.';}
                choices.appendChild(label);
            }
            status.textContent=datasets.filter(ds=>ds.canCombine).length<2?'Load at least two unprocessed files to combine.':'';
        } catch(error){status.textContent=error.message;}
    });
    submit.addEventListener('click',async()=>{
        if(busy)return;
        const ids=selected();
        if(ids.length<2)return;
        busy=true;refresh();cancel.disabled=true;status.textContent='Combining files…';
        try {
            const task=async()=>{
                saveCurrentViewerState();
                const first=loadedFileStates.find(state=>state.datasetId===ids[0]);
                const viewerSettings=first?.settings || datasets.find(ds=>ds.id===ids[0])?.viewerSettings;
                const sessionId=typeof workspaceSession!=='undefined'?workspaceSession.sessionId():'';
                const response=await fetch('/api/combine-files',{method:'POST',headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({datasetIds:ids,viewerSettings,sessionId})});
                const result=await response.json();
                if(!response.ok || !result.ok){const error=new Error(result.error || 'Could not combine files.');error.code=result.code;throw error;}
                if(sessionId && workspaceSession.sessionId()!==sessionId)throw new Error('A new session was started. Select the files again.');
                const ds=result.dataset;
                let index=loadedFileStates.findIndex(state=>state.datasetId===ds.id);
                if(index<0) {
                    index=loadedFileStates.length;
                    loadedFileStates.push({datasetId:ds.id,filename:ds.filename,displayName:ds.filename,kind:ds.kind,
                        parentId:ds.parentId,sourceIds:ds.sourceIds,notes:ds.notes,settings:ds.viewerSettings,fits:[],roi:null,sweepRange:null});
                }
                await restoreLoadedFileState(index);
            };
            if(typeof workspaceSession!=='undefined')await workspaceSession.localTask(task);
            else await task();
            dialog.close();
        } catch(error){status.textContent=error.message;if(error.code==='EJECTION_MISMATCH')window.alert?.(error.message);}
        finally{busy=false;cancel.disabled=false;refresh();}
    });
}
