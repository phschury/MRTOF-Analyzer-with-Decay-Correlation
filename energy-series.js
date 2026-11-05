const {randomUUID}=require('node:crypto');
const {planEnergyFiles,energySeriesKey}=require('./public/js/energy-import');
const {combineEnergyData}=require('./energy-listmode');
function prepareEnergySeries(datasets,incoming,calibrations){
  const plan=planEnergyFiles(incoming);
  return plan.groups.map(group=>{
    const selected=group.indices.map(index=>incoming[index]);
    const seriesKey=energySeriesKey(selected[0].filename);
    const existing=seriesKey===null?null:[...datasets.values()].find(ds=>ds.seriesKey===seriesKey);
    const files=[...(existing?.sourceParts || []),...selected];
    const names=new Set();
    for(const file of files){if(names.has(file.filename))throw new Error(file.filename+' is already part of this spectrum. It was not added again.');names.add(file.filename);}
    const sorted=planEnergyFiles(files).groups[0];
    const ordered=sorted.indices.map(index=>files[index]);
    let data;
    try{data=combineEnergyData(ordered.map(file=>file.data));}
    catch(error){throw new Error('Cannot add '+selected.map(file=>file.filename).join(', ')+': '+error.message);}
    return {...existing,id:existing?.id || randomUUID(),seriesKey,filename:sorted.filename,
      sourceFiles:ordered.map(file=>file.filename),sourceParts:ordered,
      bytes:ordered.reduce((sum,file)=>sum+file.bytes,0),data,
      calibrations:data.format==='niki'?{...existing?.calibrations,...calibrations}:{}};
  });
}
module.exports={prepareEnergySeries};
