const {applyWorkspaceChanges}=require('./public/js/workspace-state');

function derivedViewerSettings(parent, viewerSettings, fitSettings={}) {
  const base={datasetId:parent.id,settings:parent.viewerState?.settings || {}};
  const settings=applyWorkspaceChanges([base],[{datasetId:parent.id,settings:viewerSettings ?? {}}])[0].settings;
  // Fit intervals are ROIs, independent of the parent's displayed viewport.
  for(const key of ['channel','edge','tag','binWidth']) {
    if(fitSettings[key]!==undefined)settings[key]=String(fitSettings[key]);
  }
  return settings;
}
module.exports={derivedViewerSettings};
