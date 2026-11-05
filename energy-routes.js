const express=require('express');
const {randomUUID}=require('node:crypto');
const {StringDecoder}=require('node:string_decoder');
const {prepareEnergySeries}=require('./energy-series');
const {defaultNikiCalibrations,parseCalibrationFiles}=require('./energy-calibration');
const {calibrationChannel}=require('./public/js/energy-import');
const {parseEnergyListmode,createEnergyListmodeParser,energyHistogram,energySummary}=require('./energy-listmode');
function mountEnergyRoutes(app,{workspace,tofDatasets=new Map()}){
  const datasets=new Map(),imports=new Map();let activeId=null,calibrations=defaultNikiCalibrations();
  const tofSummary=ds=>({id:ds.id,filename:ds.filename,kind:ds.kind,
    startTime:ds.lm?.startTime && Number.isFinite(new Date(ds.lm.startTime).getTime())?new Date(ds.lm.startTime).toISOString():null,
    sweepPeriodUs:ds.lm?.sweepPeriodUs??null});
  function summarize(ds){
    const target=tofDatasets.get(ds.tofConnection?.tofDatasetId);
    const connection=target && !target.pending?{...ds.tofConnection,tofFilename:target.filename,
      energyZeroTick:ds.data.minTick,energyTimebaseNs:ds.data.timebaseNs,tofSweepZero:0,
      tofStartTime:tofSummary(target).startTime,tofSweepPeriodUs:target.lm?.sweepPeriodUs??null}:null;
    return {...energySummary(ds),tofConnection:connection,boxDeletedRegions:ds.boxDeletedRegions || []};
  }
  const snapshot=()=>({ok:true,sessionId:workspace.snapshot().sessionId,activeId,datasets:[...datasets.values()].map(summarize)});
  const current=req=>{const ds=datasets.get(req.params.id);if(!ds)throw new Error('Energy file is no longer available. Load it again.');return ds;};
  const validSession=(id)=>{if(id && !workspace.isCurrent(id)){const error=new Error('A new session was started. Load the files again.');error.status=409;throw error;}};
  function correlationReferences(ds,options,roiId){
    const {energyReferenceTimes,boxSumReferences}=require('./energy-correlation');
    if(!roiId)return boxSumReferences(ds.data,options,ds.calibrations,ds.boxDeletedRegions);
    const selected=ds.savedRois?.find(entry=>entry.id===roiId);
    if(!selected)throw new Error('The selected Energy ROI is no longer available. Reopen Correlation time to refresh the list.');
    return energyReferenceTimes(ds.data,selected,ds.calibrations,ds.boxDeletedRegions,true);
  }
  function applyCalibrations(incoming){calibrations={...calibrations,...incoming};for(const ds of datasets.values())if(ds.data.format==='niki')ds.calibrations={...ds.calibrations,...incoming};}
  function refreshBoxDelaySnapshots(energy){
    const {boxSumReferences,snapshotEnergyMatches}=require('./energy-correlation');
    for(const dataset of tofDatasets.values())if(dataset.correlation?.energyDatasetId===energy.id){
      // A stale snapshot must never reintroduce deleted noise after export.
      dataset.lm.energyDelaySource=null;
      try{
        const lm=dataset.lm;
        if(!Number.isFinite(lm.sweepPeriodUs) || lm.sweepPeriodUs<=0)continue;
        const references=boxSumReferences(energy.data,energy.boxCorrelationReference || energy.correlationReference || dataset.correlation || {},energy.calibrations,energy.boxDeletedRegions);
        Object.assign(lm.events,snapshotEnergyMatches(lm,references));
        lm.energyDelayDirection='next';lm.energyDelaySource='box-sum';
      }catch{/* Missing calibration leaves the snapshot unavailable; live analysis reports the required calibration. */}
    }
  }
  app.get('/api/energy/files',(req,res)=>res.json(snapshot()));
  app.post('/api/energy/files/:id/correlation-reference',(req,res)=>{
    try{
      validSession(req.body?.sessionId);const ds=current(req),{roi,module,channel,timebaseNs,timeLow,timeHigh}=req.body;
      if(req.body.savedRois!==undefined){
        const entries=req.body.savedRois;
        if(!Array.isArray(entries) || entries.length>1000 || entries.some(entry=>!entry || typeof entry.id!=='string' || typeof entry.name!=='string' || !entry.roi || !Number.isFinite(entry.roi.low) || !Number.isFinite(entry.roi.high) || entry.roi.low>=entry.roi.high) || new Set(entries.map(entry=>entry.id)).size!==entries.length)throw new Error('Invalid saved Energy ROIs.');
        ds.savedRois=entries.map(({id,name,roi,module,channel,timebaseNs,timeLow,timeHigh})=>({id,name,roi,module,channel,timebaseNs,timeLow,timeHigh}));
      }
      ds.correlationReference={roi,module,channel,timebaseNs,timeLow,timeHigh};
      if(channel==='box-sum')ds.boxCorrelationReference={module,timebaseNs,timeLow,timeHigh};
      res.json({ok:true});
    }catch(error){res.status(error.status||400).json({ok:false,error:error.message});}
  });
  app.post('/api/energy/files/:id/box-deleted-regions',(req,res)=>{
    try{
      validSession(req.body?.sessionId);const ds=current(req);
      if(req.body?.restore===true){ds.boxDeletedRegions=[];refreshBoxDelaySnapshots(ds);return res.json({ok:true,dataset:summarize(ds)});}
      const {roi}=req.body || {};
      if(req.body?.channel!=='box-sum' || !roi || !Number.isFinite(roi.low) || !Number.isFinite(roi.high) || roi.high<=roi.low)throw new Error('Select a complete ROI in Box detector sum before deleting a region.');
      const number=(value,fallback)=>value===undefined || value===null || value===''?fallback:Number(value);
      const module=number(req.body.module,null),timeLow=number(req.body.timeLow,null),timeHigh=number(req.body.timeHigh,null),timebaseNs=number(req.body.timebaseNs,ds.data.timebaseNs);
      if(module!==null && (!Number.isInteger(module) || module< -1) || timeLow!==null && (!Number.isFinite(timeLow) || timeLow<0) || timeHigh!==null && (!Number.isFinite(timeHigh) || timeHigh<(timeLow??0)))throw new Error('Invalid module or elapsed-time range.');
      if((timeLow!==null || timeHigh!==null) && (!Number.isFinite(timebaseNs) || timebaseNs<=0))throw new Error('Specify a positive timebase before deleting an elapsed-time region.');
      require('./energy-calibration').boxDetectorCalibrations(ds.data,module,ds.calibrations);
      if((ds.boxDeletedRegions?.length || 0)>=1000)throw new Error('Maximum 1,000 deleted regions. Restore deleted regions before adding more.');
      ds.boxDeletedRegions=[...(ds.boxDeletedRegions || []),{low:roi.low,high:roi.high,module,timeLow,timeHigh,timebaseNs}];
      refreshBoxDelaySnapshots(ds);
      res.json({ok:true,dataset:summarize(ds)});
    }catch(error){res.status(error.status||400).json({ok:false,error:error.message});}
  });
  app.get('/api/energy/files/:id/tof-options',(req,res)=>{
    try{res.json({ok:true,sessionId:workspace.snapshot().sessionId,dataset:summarize(current(req)),tofSpectra:[...tofDatasets.values()].filter(ds=>!ds.pending).map(tofSummary)});}
    catch(error){res.status(400).json({ok:false,error:error.message});}
  });
  app.post('/api/energy/files/:id/tof-connection',(req,res)=>{
    try{
      validSession(req.body?.sessionId);const ds=current(req),id=req.body?.tofDatasetId;
      if(id===null)delete ds.tofConnection;
      else {
        const target=typeof id==='string'?tofDatasets.get(id):null;
        if(!target || target.pending)throw new Error('The selected ToF spectrum is no longer available. Reopen the list and select a loaded spectrum.');
        ds.tofConnection={tofDatasetId:id,alignment:'simultaneous-start',assumedSimultaneousStart:true};
      }
      workspace.publish();
      res.json({ok:true,sessionId:workspace.snapshot().sessionId,dataset:summarize(ds)});
    }catch(error){res.status(error.status||400).json({ok:false,error:error.message});}
  });
  app.post('/api/energy/files/:id/correlate',(req,res)=>{
    try{
      validSession(req.body?.sessionId);const energy=current(req);
      const parent=tofDatasets.get(energy.tofConnection?.tofDatasetId);
      if(!parent || parent.pending)throw new Error('Connect this energy spectrum to an available ToF spectrum before correlating.');
      if(req.body?.tofDatasetId!==parent.id)throw new Error('The ToF connection changed. Reopen the ROI menu and try again.');
      const {lm,correlation}=require('./energy-correlation').makeEnergyCorrelatedData(parent.lm,energy.data,req.body,energy.calibrations,energy.boxDeletedRegions);
      Object.assign(correlation,{energyDatasetId:energy.id,energyFilename:energy.filename,tofDatasetId:parent.id});
      const id=randomUUID(),filename=parent.filename+' [energy correlated; '+req.body.preTime+' s pre, '+req.body.postTime+' s post]';
      const dataset={id,filename,kind:'energy-correlated',parentId:parent.id,createdAt:new Date().toISOString(),bytes:parent.bytes,lm,correlation,
        notes:correlation.totalEvents+' of '+correlation.sourceEvents+' ToF events retained around '+correlation.energyEvents+' ROI events in '+energy.filename+'; simultaneous starts assumed.',
        viewerState:{settings:require('./derived-viewer').derivedViewerSettings(parent),fits:[],roi:null,sweepRange:null}};
      tofDatasets.set(id,dataset);
      workspace.update({sessionId:workspace.snapshot().sessionId,activeDatasetId:id});
      res.json({ok:true,sessionId:workspace.snapshot().sessionId,dataset:{id,filename,kind:dataset.kind,parentId:parent.id},correlation});
    }catch(error){res.status(error.status||400).json({ok:false,error:error.message});}
  });
  app.post('/api/energy/imports',(req,res)=>{
    try{
      validSession(req.body?.sessionId);
      const files=req.body?.files;
      if(!Array.isArray(files) || files.length>1000 || files.some(file=>typeof file.filename!=='string' || !file.filename || calibrationChannel(file.filename)!==null || file.size!==undefined && (!Number.isSafeInteger(file.size) || file.size<=0)))throw new Error('Invalid data-file selection.');
      const incoming=parseCalibrationFiles(req.body.calibrations);
      if(!files.length){applyCalibrations(incoming);return res.json({...snapshot(),importId:null});}
      const id=randomUUID();imports.set(id,{sessionId:workspace.snapshot().sessionId,files,data:new Map(),calibrations:incoming});
      res.json({ok:true,importId:id,sessionId:workspace.snapshot().sessionId});
    }catch(error){res.status(error.status||400).json({ok:false,error:error.message,file:error.filename,line:error.line,record:error.record});}
  });
  const chunkBody=express.raw({type:'application/octet-stream',limit:4*1024**2});
  app.post('/api/energy/imports/:id/files/:index/chunks',(req,res,next)=>chunkBody(req,res,error=>{
    if(error)return res.status(error.status||400).json({ok:false,error:'Could not receive the file chunk: '+error.message});
    next();
  }),(req,res)=>{
    let batch,index,parsing=false;
    try{
      batch=imports.get(req.params.id);if(!batch)throw new Error('Import is no longer available.');validSession(batch.sessionId);
      index=Number(req.params.index);
      const offset=Number(req.headers['x-energy-chunk-offset']),size=Number(req.headers['x-energy-file-size']);
      const file=batch.files[index];
      if(!Number.isInteger(index) || !file || batch.data.has(index))throw new Error('Invalid or already completed import file index.');
      if(!Buffer.isBuffer(req.body) || !req.body.length)throw new Error('Choose a nonempty file chunk.');
      if(!Number.isSafeInteger(offset) || offset<0 || !Number.isSafeInteger(size) || size<=0 || offset+req.body.length>size || file.size!==undefined && file.size!==size)throw new Error('Invalid file size or chunk position.');
      if(!batch.upload){
        if(offset!==0)throw new Error('The first file chunk must start at zero.');
        batch.upload={index,size,offset:0,parser:createEnergyListmodeParser({filename:file.filename}),decoder:new StringDecoder('utf8')};
      }
      const upload=batch.upload;
      if(upload.index!==index || upload.size!==size || upload.offset!==offset)throw new Error('Upload file chunks sequentially, finishing one file before starting the next.');
      parsing=true;upload.parser.write(upload.decoder.write(req.body));upload.offset+=req.body.length;
      const complete=upload.offset===size;
      if(complete){
        upload.parser.write(upload.decoder.end());
        const data=upload.parser.finish({compact:false});data.bytes=size;batch.data.set(index,data);batch.upload=null;
      }
      res.json({ok:true,sessionId:batch.sessionId,receivedBytes:offset+req.body.length,complete});
    }catch(error){
      if(parsing && batch)batch.upload=null;
      res.status(error.status||400).json({ok:false,error:error.message,file:error.filename,line:error.line,record:error.record});
    }
  });
  app.post('/api/energy/imports/:id/finish',(req,res)=>{
    try{
      const batch=imports.get(req.params.id);if(!batch)throw new Error('Import is no longer available.');validSession(batch.sessionId);
      if(batch.data.size!==batch.files.length)throw new Error('The import is incomplete.');
      const incoming=batch.files.map((file,index)=>({filename:file.filename,data:batch.data.get(index),bytes:batch.data.get(index).bytes}));
      const created=prepareEnergySeries(datasets,incoming,{...calibrations,...batch.calibrations});
      applyCalibrations(batch.calibrations);
      for(const ds of created){datasets.set(ds.id,ds);activeId=ds.id;}imports.delete(req.params.id);
      res.json({...snapshot(),createdIds:created.map(ds=>ds.id)});
    }catch(error){res.status(error.status||400).json({ok:false,error:error.message,file:error.filename,line:error.line,record:error.record});}
  });
  app.delete('/api/energy/imports/:id',(req,res)=>{imports.delete(req.params.id);res.json({ok:true});});
  app.post('/api/energy/files',express.raw({type:'application/octet-stream',limit:'2gb'}),(req,res)=>{
    try{
      validSession(req.headers['x-workspace-session']);
      if(!Buffer.isBuffer(req.body) || !req.body.length)throw new Error('Choose a nonempty listmode file.');
      let filename=req.headers['x-filename']||'energy.lst';if(req.headers['x-filename-encoded']==='uri')filename=decodeURIComponent(filename);
      if(calibrationChannel(filename)!==null){applyCalibrations(parseCalibrationFiles([{filename,text:req.body.toString('utf8')}]));return res.json({...snapshot(),calibration:true});}
      const batchId=req.headers['x-energy-import'],batch=batchId?imports.get(batchId):null;
      const index=Number(req.headers['x-energy-file-index']);
      if(batchId){
        if(!batch)throw new Error('Import is no longer available.');validSession(batch.sessionId);
        if(batch.upload)throw new Error('Finish the current chunked file upload before uploading another file.');
        if(!Number.isInteger(index) || !batch.files[index] || batch.files[index].filename!==filename || batch.data.has(index))throw new Error('Invalid import file index.');
      }
      const data=parseEnergyListmode(req.body.toString('utf8'),{filename});data.bytes=req.body.length;
      if(batch){batch.data.set(index,data);return res.json({ok:true,sessionId:batch.sessionId});}
      const [dataset]=prepareEnergySeries(datasets,[{filename,bytes:req.body.length,data}],calibrations);
      datasets.set(dataset.id,dataset);activeId=dataset.id;
      res.json({ok:true,dataset:summarize(dataset),sessionId:workspace.snapshot().sessionId});
    }catch(error){res.status(error.status||400).json({ok:false,error:error.message,file:error.filename,line:error.line,record:error.record});}
  });
  app.get('/api/energy/files/:id/histogram',(req,res)=>{try{const ds=current(req);res.json({ok:true,datasetId:ds.id,...energyHistogram(ds.data,req.query,ds.calibrations,ds.boxDeletedRegions)});}catch(error){res.status(error.status||400).json({ok:false,error:error.message,file:error.filename,line:error.line,record:error.record});}});
  app.post('/api/energy/files/:id/select',(req,res)=>{try{activeId=current(req).id;res.json({ok:true});}catch(error){res.status(error.status||400).json({ok:false,error:error.message,file:error.filename,line:error.line,record:error.record});}});
  app.delete('/api/energy/files/:id',(req,res)=>{try{
    const ds=current(req);
    if(summarize(ds).tofConnection)throw new Error('This energy spectrum is connected for correlation. Disconnect it from the ToF spectrum before removing it.');
    datasets.delete(ds.id);if(activeId===req.params.id)activeId=datasets.keys().next().value??null;res.json(snapshot());
  }catch(error){res.status(error.status||400).json({ok:false,error:error.message,file:error.filename,line:error.line,record:error.record});}});
  return {clear(){datasets.clear();imports.clear();calibrations=defaultNikiCalibrations();activeId=null;},
    tofEnergySources(id){return [...datasets.values()].filter(ds=>ds.tofConnection?.tofDatasetId===id).map(ds=>({id:ds.id,filename:ds.filename}));},
    correlationRois(energyId){return (datasets.get(energyId)?.savedRois || []).map(({id,name})=>({id,name}));},
    derivedEnergySource(dataset){const ds=datasets.get(dataset.correlation?.energyDatasetId);return ds?{id:ds.id,filename:ds.filename}:null;},
    referenceTimesForTof(id,energyId,roiId){
      const ds=datasets.get(energyId);
      if(!ds || ds.tofConnection?.tofDatasetId!==id)throw new Error('The selected Energy histogram is no longer connected to this ToF spectrum.');
      return correlationReferences(ds,ds.boxCorrelationReference || ds.correlationReference || {},roiId);
    },
    referenceTimesForDerived(dataset,roiId){
      const ds=datasets.get(dataset.correlation?.energyDatasetId);if(!ds)return undefined;
      return correlationReferences(ds,ds.boxCorrelationReference || ds.correlationReference || dataset.correlation || {},roiId);
    },
    tofRemovalBlockReason(id){return [...datasets.values()].some(ds=>ds.tofConnection?.tofDatasetId===id)
      ?'This ToF spectrum is connected for correlation. Disconnect all linked energy spectra before removing it.':null;}};
}
module.exports={mountEnergyRoutes};
