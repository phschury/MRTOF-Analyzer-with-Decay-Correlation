// Shared, server-owned workspace. Raw event data stays on the server.
const workspaceSession = (() => {
  let baseline=null, applying=false, saving=false, queued=null, timer, localTasks=0;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const sameSettings=(a,b)=>{
    const keys=new Set([...Object.keys(a||{}),...Object.keys(b||{})]);
    return [...keys].every(key=>JSON.stringify(a?.[key])===JSON.stringify(b?.[key]));
  };
  const message=text=>{document.getElementById('workspaceStatus').textContent=text;};
  function capture(){
    saveCurrentViewerState();
    for(const state of loadedFileStates)for(const fit of state.fits||[])if(!fit.id)fit.id=crypto.randomUUID();
    return {states:clone(loadedFileStates),activeDatasetId:loadedFileStates[activeFileStateIndex]?.datasetId??null};
  }
  function schedule(){
    if(!baseline || applying)return;
    clearTimeout(timer);
    timer=setTimeout(flush,150);
  }
  async function flush(){
    clearTimeout(timer);
    if(!baseline || applying || saving || localTasks){schedule();return;}
    const local=capture();
    const changes=workspaceChanges(baseline.states,local.states);
    const activeChanged=local.activeDatasetId!==baseline.activeDatasetId;
    if(!changes.length && !activeChanged){if(queued){const next=queued;queued=null;await receive(next);}return;}
    const epoch=baseline.sessionId;
    saving=true;
    message('Saving…');
    try{
      const response=await fetch('/api/session',{method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({sessionId:epoch,changes,...(activeChanged?{activeDatasetId:local.activeDatasetId}:{})})});
      const state=await response.json();
      if(response.status===409){queued=state;baseline={...baseline,states:local.states,activeDatasetId:local.activeDatasetId};}
      else if(!response.ok || !state.ok)throw new Error(state.error||'Workspace save failed.');
      else {
        // Changes made during this request are still differences from this baseline.
        baseline={...state,states:local.states,activeDatasetId:local.activeDatasetId};
        if(!queued || queued.sessionId===state.sessionId && queued.revision<state.revision)queued=state;
      }
      message('Saved on server');
    }catch(error){message('Not saved: '+error.message);timer=setTimeout(flush,2000);}
    finally{saving=false;}
    if(queued){const next=queued;queued=null;await receive(next);}
  }
  async function receive(snapshot){
    if(!snapshot?.sessionId)return;
    if(baseline && snapshot.sessionId===baseline.sessionId && snapshot.revision<baseline.revision)return;
    if(saving || applying || localTasks){queued=snapshot;return;}
    const reset=baseline && snapshot.sessionId!==baseline.sessionId;
    let local=baseline?capture():null;
    let states=snapshot.states;
    let activeId=snapshot.activeDatasetId;
    if(local && !reset){
      // Merge only locally edited fields; fits merge by ID, never by row number.
      const edits=workspaceChanges(baseline.states,local.states).filter(change=>states.some(state=>state.datasetId===change.datasetId));
      states=applyWorkspaceChanges(states,edits);
      if(local.activeDatasetId!==baseline.activeDatasetId && states.some(state=>state.datasetId===local.activeDatasetId))activeId=local.activeDatasetId;
    }
    const previous=loadedFileStates[activeFileStateIndex];
    const next=states.find(state=>state.datasetId===activeId);
    const reload=reset || previous?.datasetId!==next?.datasetId || !sameSettings(previous?.settings,next?.settings) || JSON.stringify(previous?.sweepRange)!==JSON.stringify(next?.sweepRange);
    baseline=clone(snapshot);
    applying=true;
    const surfaces=['.controls','.status-row','.chartBox'].map(selector=>document.querySelector(selector)).filter(Boolean);
    for(const surface of surfaces)surface.inert=true;
    try{
      if(reset || previous?.datasetId!==next?.datasetId){
        cancelFitModal();
        currentFitParams=null;
      }
      if(reset || previous && !states.some(state=>state.datasetId===previous.datasetId)){
        document.querySelectorAll('#driftWindow,#driftFitWindow,#distroWindow,.drift-results-window').forEach(popup=>popup.remove());
      }
      loadedFileStates=states;
      activeFileStateIndex=states.findIndex(state=>state.datasetId===activeId);
      if(!next){
        activeFileStateIndex=-1;plottedTags.clear();currentRoi=null;currentSweepRange=null;activeFitPreview=null;
        lastSettingsKey=null;availableSweeps=null;
        document.getElementById('loadedFileName').textContent='No listmode file loaded';
        document.getElementById('runInfo').textContent='';
        const debounceStatus=document.getElementById('debounceStatus');if(debounceStatus)debounceStatus.textContent='';
        for(const id of ['channel','edge','tag','driftCorrectionTag'])document.getElementById(id).innerHTML='';
        for(const [id,value] of Object.entries({binWidth:320,tofLowUs:12,tofHighUs:16,yScale:'linear',timeMode:'absolute',sliceInput:5000,debounceMinNs:20,debounceMaxNs:1000,sweepFirst:'',sweepLast:''}))setValueIfPresent(id,value);
        drawCombinedChart();
        document.getElementById('status').textContent='Choose a listmode file and click Load File.';
      }else if(reload){
        const index=activeFileStateIndex;
        activeFileStateIndex=-1;
        if(!next.settings)next.settings={channel:'1',edge:'1',tag:'3',binWidth:'320',tofLowUs:'12',tofHighUs:'16',yScale:'linear',timeMode:'absolute',sliceInput:'5000'};
        await restoreLoadedFileState(index);
      }else{
        currentRoi=next.roi?{...next.roi}:null;
        drawCombinedChart();
      }
      renderLoadedFilesList();
      message('Saved on server');
    }catch(error){message('Could not restore workspace: '+error.message);}
    finally{applying=false;for(const surface of surfaces)surface.inert=false;}
    if(queued){const newer=queued;queued=null;await receive(newer);}
    schedule();
  }
  async function localTask(task){
    localTasks++;
    try{return await task();}
    finally{localTasks--;schedule();}
  }
  async function start(){
    message('Restoring workspace…');
    try{
      const response=await fetch('/api/session');
      const state=await response.json();
      if(!response.ok)throw new Error(state.error||'Workspace unavailable.');
      await receive(state);
      const stream=new EventSource('/api/session/events');
      stream.onmessage=event=>{receive(JSON.parse(event.data)).catch(error=>message(error.message));};
      stream.onerror=()=>message('Connection interrupted; reconnecting…');
      document.querySelector('.controls').addEventListener('change',schedule);
      document.querySelector('.controls').addEventListener('input',schedule);
      document.getElementById('sliceInput').addEventListener('change',schedule);
      document.getElementById('sliceInput').addEventListener('input',schedule);
      window.addEventListener('pagehide',()=>{
        if(!baseline || applying)return;
        const local=capture();
        fetch('/api/session',{method:'PATCH',headers:{'Content-Type':'application/json'},keepalive:true,
          body:JSON.stringify({sessionId:baseline.sessionId,changes:workspaceChanges(baseline.states,local.states),...(local.activeDatasetId!==baseline.activeDatasetId?{activeDatasetId:local.activeDatasetId}:{})})}).catch(()=>{});
      });
    }catch(error){message('Could not connect: '+error.message);}
  }
  async function removeSpectrum(datasetId,others=false) {
    if(!baseline)throw new Error('Workspace is not connected.');
    const epoch=baseline.sessionId;
    const state=await localTask(async()=>{
      const local=capture();
      const removeDatasetIds=local.states.filter(state=>others?state.datasetId!==datasetId:state.datasetId===datasetId).map(state=>state.datasetId);
      if(!local.states.some(state=>state.datasetId===datasetId))throw new Error('Spectrum is no longer available.');
      const response=await fetch('/api/session',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        sessionId:epoch,removeDatasetIds,changes:workspaceChanges(baseline.states,local.states),activeDatasetId:local.activeDatasetId})});
      const snapshot=await response.json();
      if(response.status!==409 && (!response.ok || !snapshot.ok))throw new Error(snapshot.error||'Could not remove spectrum.');
      return snapshot;
    });
    await receive(state);
  }
  return {schedule,localTask,start,removeSpectrum,sessionId:()=>baseline?.sessionId||""};
})();
