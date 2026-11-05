function isDeletedBoxEvent(data,events,index,tickOffset,energy,regions=[]){
  return regions.some(region=>{
    if(region.module!==null && events.module[index]!==region.module || energy<region.low || energy>=region.high)return false;
    if(region.timeLow===null && region.timeHigh===null)return true;
    const seconds=(events.ticks[index]+tickOffset-data.minTick)*region.timebaseNs/1e9;
    return (region.timeLow===null || seconds>=region.timeLow) && (region.timeHigh===null || seconds<region.timeHigh);
  });
}
module.exports={isDeletedBoxEvent};
