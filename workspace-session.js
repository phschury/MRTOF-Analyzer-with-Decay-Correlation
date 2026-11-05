const {randomUUID}=require('node:crypto');
const {applyWorkspaceChanges}=require('./public/js/workspace-state.js');

function createWorkspaceSession({datasets,runs,getActive,setActive,removalBlockReason=()=>null,energySources=()=>[]}) {
  let id=randomUUID(),revision=0;
  const listeners=new Set();
  const snapshot=()=>({sessionId:id,revision,activeDatasetId:getActive(),states:[...datasets.values()].filter(ds=>!ds.pending).map(ds=>({
    datasetId:ds.id,filename:ds.filename,displayName:ds.filename,kind:ds.kind,parentId:ds.parentId,notes:ds.notes,sourceIds:ds.sourceIds,
    settings:null,sweepRange:null,roi:null,fits:[],...ds.viewerState,removalBlockedReason:removalBlockReason(ds.id),correlationEnergySources:energySources(ds.id),
  }))});
  const publish=()=>{revision++;const state=snapshot();for(const listener of listeners)listener(state);return state;};
  return {
    snapshot,publish,
    subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
    update(body){
      if(body.sessionId!==id) return null;
      // Resolve and validate the complete request before modifying any dataset.
      const current=snapshot();
      const next=applyWorkspaceChanges(current.states,body.changes||[]);
      const remove=body.removeDatasetIds??[];
      if(!Array.isArray(remove) || remove.some(value=>typeof value!=='string' || !next.some(ds=>ds.datasetId===value)))throw new Error('Spectrum is no longer available.');
      for(const datasetId of remove){const reason=removalBlockReason(datasetId);if(reason)throw new Error(reason);}
      const removed=new Set(remove);
      let active=body.activeDatasetId===undefined?getActive():body.activeDatasetId;
      if(active!==null && !next.some(ds=>ds.datasetId===active)) throw new Error('Selected spectrum is unavailable.');
      if(removed.has(active)) {
        const index=next.findIndex(state=>state.datasetId===active);
        active=next.slice(index+1).find(state=>!removed.has(state.datasetId))?.datasetId
          ??next.slice(0,index).reverse().find(state=>!removed.has(state.datasetId))?.datasetId??null;
      }
      for(const state of next) datasets.get(state.datasetId).viewerState=state;
      for(const datasetId of removed)datasets.delete(datasetId);
      for(const [runId,run] of runs) {
        if(removed.has(run.datasetId)) {
          const pending=datasets.get(run.correctedDatasetId);
          if(pending?.pending)datasets.delete(pending.id);
          runs.delete(runId);
        }else if(removed.has(run.correctedDatasetId)){run.correctedDatasetId=null;run.rejected=true;}
      }
      setActive(active);
      return publish();
    },
    reset(){id=randomUUID();datasets.clear();runs.clear();setActive(null);return publish();},
    isCurrent(sessionId){return sessionId===id;},
  };
}
module.exports={createWorkspaceSession};
