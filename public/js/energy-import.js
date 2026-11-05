(function(root){
  function calibrationChannel(name){const match=String(name).match(/^BoxSi_ch(1[1-5])_calib(?:\.txt)?$/i);return match?Number(match[1]):null;}
  function energySeriesKey(name){const match=String(name).match(/^(.*?)(\d+)(\.[^.]+)$/);return match?match[1]+'\u0000'+match[3]:null;}
  function planEnergyFiles(files){
    const groups=new Map(),calibrations=[];
    files.forEach((file,index)=>{
      const name=file.name??file.filename;
      if(calibrationChannel(name)!==null){calibrations.push(index);return;}
      const match=String(name).match(/^(.*?)(\d+)(\.[^.]+)$/);
      const key=energySeriesKey(name)??'single\u0000'+index;
      if(!groups.has(key))groups.set(key,[]);
      groups.get(key).push({index,name,number:match?BigInt(match[2]):null});
    });
    return {calibrations,groups:[...groups.values()].map(group=>{
      group.sort((a,b)=>a.number===null || b.number===null?0:a.number<b.number?-1:a.number>b.number?1:0);
      return {indices:group.map(file=>file.index),filename:group.length===1?group[0].name:group[0].name.replace(/(\d+)(\.[^.]+)$/,(_,number,ext)=>number+'–'+String(group.at(-1).name.match(/(\d+)(\.[^.]+)$/)[1])+' [combined]'+ext)};
    })};
  }
  const api={calibrationChannel,energySeriesKey,planEnergyFiles};
  if(typeof module!=='undefined' && module.exports)module.exports=api;else Object.assign(root,api);
})(typeof window!=='undefined'?window:globalThis);
