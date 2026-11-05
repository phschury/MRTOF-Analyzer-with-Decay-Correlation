(function(root){
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function workspaceChanges(before,after){
    const changes=[];
    for(const state of after){
      const previous=before.find(item=>item.datasetId===state.datasetId)||{};
      const change={datasetId:state.datasetId};
      const settings={};
      for(const [key,value] of Object.entries(state.settings||{})) if(!equal(previous.settings?.[key],value))settings[key]=value;
      if(Object.keys(settings).length)change.settings=settings;
      for(const key of ['roi','sweepRange'])if(!equal(previous[key]??null,state[key]??null))change[key]=state[key]??null;
      const oldFits=previous.fits||[],fits=state.fits||[];
      change.upsertFits=fits.filter(fit=>!equal(oldFits.find(old=>old.id===fit.id),fit));
      change.deleteFits=oldFits.filter(old=>!fits.some(fit=>fit.id===old.id)).map(fit=>fit.id);
      if(!change.upsertFits.length)delete change.upsertFits;
      if(!change.deleteFits.length)delete change.deleteFits;
      if(Object.keys(change).length>1)changes.push(change);
    }
    return changes;
  }
  function applyWorkspaceChanges(states,changes){
    const next=JSON.parse(JSON.stringify(states));
    if(!Array.isArray(changes))throw new Error('Invalid workspace changes.');
    for(const change of changes){
      const state=next.find(item=>item.datasetId===change.datasetId);
      if(!state)throw new Error('Spectrum is no longer available. Reload the workspace.');
      if(change.settings!==undefined){
        if(!change.settings || typeof change.settings!=='object' || Array.isArray(change.settings))throw new Error('Invalid viewer settings.');
        const allowed=['channel','edge','tag','binWidth','tofLowUs','tofHighUs','yScale','timeMode','sliceInput','driftCorrectionTag','absoluteViewRange','debounceMinNs','debounceMaxNs'];
        const range=change.settings.absoluteViewRange;
        if(range!==undefined && range!==null && (!Number.isFinite(range.min)||!Number.isFinite(range.max)||range.max<=range.min))throw new Error('Invalid saved X-axis range.');
        state.settings={...state.settings};
        for(const key of allowed)if(Object.hasOwn(change.settings,key))state.settings[key]=change.settings[key];
      }
      for(const key of ['roi','sweepRange'])if(Object.hasOwn(change,key))state[key]=change[key];
      if(change.deleteFits){if(!Array.isArray(change.deleteFits))throw new Error('Invalid fit deletion.');state.fits=(state.fits||[]).filter(fit=>!change.deleteFits.includes(fit.id));}
      if(change.upsertFits){
        if(!Array.isArray(change.upsertFits))throw new Error('Invalid saved fits.');
        state.fits=state.fits||[];
        for(const fit of change.upsertFits){
          if(!fit || typeof fit.id!=='string' || !fit.id)throw new Error('Saved fit needs an ID.');
          const index=state.fits.findIndex(old=>old.id===fit.id);
          if(index<0)state.fits.push(fit);else state.fits[index]=fit;
        }
      }
    }
    return next;
  }
  const api={workspaceChanges,applyWorkspaceChanges};
  if(typeof module!=='undefined')module.exports=api;else Object.assign(root,api);
})(globalThis);
