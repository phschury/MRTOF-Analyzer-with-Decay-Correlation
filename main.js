// main.js
//
// Express server for MRTOF Analyzer test interface.
//
// Usage:
//   npm install express
//   node main.js
//
// Then open:
//   http://localhost:3000

const express = require("express");
const path = require("path");
const fs = require("fs");
const os = require("os");

const crypto = require("crypto");

const listModeDatasets = new Map();
const driftFitRuns = new Map();
const activeWorkers = new Set();
let currentDatasetId = null;

const { loadListModeFile } = require("./listmode.js");
const {derivedViewerSettings}=require("./derived-viewer.js");
const {canCombineDataset,makeCombinedData}=require("./combine-files.js");
const {
  makeTofHistogramsByTag,
  makeTofHistogramsByTagAndSweep,
  makeChartJsTofDatasets,
} = require("./histogram.js");

let nubaseReady;
// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

const PORT = 3000;
currentListModeFile = "./_221Fr@1669_38.lst";

const DEFAULT_CHANNEL = 1;
const DEFAULT_EDGE = 1;
const DEFAULT_TAG = 3;
const preferenceStore = require("./preferences.js");
let preferences = preferenceStore.load();

// -----------------------------------------------------------------------------
// Express app
// -----------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: "25mb" }));
require("./ufo-workspace").mountUfoWorkspace(app);
app.get('/api/memory-usage',(req,res)=>{
  const memory=process.memoryUsage();
  res.set('Cache-Control','no-store').json({ok:true,sampledAt:new Date().toISOString(),
    rssBytes:memory.rss,heapUsedBytes:memory.heapUsed,heapTotalBytes:memory.heapTotal,
    externalBytes:memory.external,arrayBuffersBytes:memory.arrayBuffers});
});
app.post('/api/ions/validate',async(req,res)=>{
  try {
    const formulas=req.body?.formulas;
    if(!Array.isArray(formulas) || !formulas.length || formulas.length>100 || formulas.some(formula=>typeof formula!=='string')) {
      return res.status(400).json({ok:false,error:'Provide the ion formulas to validate.'});
    }
    const nubase=require('./nubase');
    if(!nubaseReady)nubaseReady=nubase.loadNUBASE(path.join(__dirname,'nubase_4.mas20.txt')).catch(error=>{nubaseReady=null;throw error});
    await nubaseReady;
    res.json({ok:true,results:formulas.map(formula=>({formula,valid:nubase.checkFormula(formula)}))});
  } catch(error){res.status(500).json({ok:false,error:'Could not validate ions against NUBASE: '+error.message});}
});

app.get('/api/preferences',(req,res)=>res.json({ok:true,preferences,defaults:preferenceStore.DEFAULTS}));
app.put('/api/preferences',(req,res)=>{
  let next;
  try { next=preferenceStore.validate(req.body); }
  catch(error){return res.status(400).json({ok:false,error:error.message});}
  try { preferences=preferenceStore.save(next);res.json({ok:true,preferences}); }
  catch(error){res.status(500).json({ok:false,error:'Could not save preferences: '+error.message});}
});
// Native folder chooser returns the absolute path needed by the Node.js server.
app.post('/api/preferences/browse-directory',async(req,res)=>{
  try {
    const requested=req.body?.directory;
    let initial=preferences.listModeDirectory;
    if(typeof requested==='string' && path.isAbsolute(requested)) {
      try {if(fs.statSync(requested).isDirectory())initial=requested;}catch{}
    }
    try {if(!fs.statSync(initial).isDirectory())initial=__dirname;}catch{initial=__dirname;}
    const selection=await require('./folder-picker.js').chooseDirectory(initial);
    res.json({ok:true,...selection});
  }catch(error){res.status(400).json({ok:false,error:error.message,
    ...(process.platform==='linux'?{alert:'Could not open the folder chooser. Please install Zenity or KDialog, or check that your installed chooser can run in this desktop session. You can also enter the directory path manually.\n\nDetails: '+error.message}:{})});}
});
app.get('/api/preference-files',(req,res)=>{
  try {res.json({ok:true,directory:preferences.listModeDirectory,files:fs.readdirSync(preferences.listModeDirectory,{withFileTypes:true}).filter(entry=>entry.isFile() && /\.(lst|lm)$/i.test(entry.name)).map(entry=>entry.name).sort()});}
  catch(error){res.status(400).json({ok:false,error:'Could not read default directory: '+error.message});}
});
app.get('/api/preference-file',(req,res)=>{
  const name=req.query.name;
  if(typeof name!=='string'||path.basename(name)!==name||! /\.(lst|lm)$/i.test(name))return res.status(400).json({ok:false,error:'Invalid listmode filename.'});
  const file=path.join(preferences.listModeDirectory,name);
  try {if(!fs.lstatSync(file).isFile())throw new Error('Not a regular file');res.sendFile(file);}
  catch(error){res.status(400).json({ok:false,error:error.message});}
});


let energyStore;
const workspace=require("./workspace-session.js").createWorkspaceSession({datasets:listModeDatasets,runs:driftFitRuns,
  getActive:()=>currentDatasetId,setActive:id=>{currentDatasetId=id},removalBlockReason:id=>energyStore?.tofRemovalBlockReason(id)??null,energySources:id=>energyStore?.tofEnergySources(id)??[]});
energyStore=require('./energy-routes').mountEnergyRoutes(app,{workspace,tofDatasets:listModeDatasets});
app.get("/api/session",(req,res)=>res.json({ok:true,...workspace.snapshot()}));
app.patch("/api/session",(req,res)=>{
  try {
    const referenced=[...(req.body?.changes||[]).map(change=>change.datasetId),...(req.body?.removeDatasetIds||[])];
    if(referenced.some(id=>!listModeDatasets.has(id)))return res.status(409).json({ok:false,error:'A spectrum was removed. Refreshing the workspace.',...workspace.snapshot()});
    const state=workspace.update(req.body||{});
    if(!state)return res.status(409).json({ok:false,error:"A new session was started.",...workspace.snapshot()});
    res.json({ok:true,...state});
  } catch(error){res.status(400).json({ok:false,error:error.message});}
});
app.post("/api/session/new",(req,res)=>{
  for(const worker of activeWorkers)worker.terminate();
  activeWorkers.clear();
  energyStore.clear();
  res.json({ok:true,...workspace.reset()});
});
app.get("/api/session/events",(req,res)=>{
  res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
  res.flushHeaders();
  const send=state=>res.write('data: '+JSON.stringify(state)+'\n\n');
  send(workspace.snapshot());
  const unsubscribe=workspace.subscribe(send);
  const heartbeat=setInterval(()=>res.write(': keepalive\n\n'),20000);
  req.on('close',()=>{unsubscribe();clearInterval(heartbeat)});
});

// Use the browser-ready UFO Finder, including its data files and search worker.
app.use("/ufo-finder", express.static(path.join(__dirname, "calcme2/ufo_finder_web_static")));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  "/vendor/chartjs",
  express.static(path.join(__dirname, "node_modules/chart.js/dist"))
);

app.use(
  "/vendor/hammerjs",
  express.static(path.join(__dirname, "node_modules/hammerjs"))
);

app.use(
  "/vendor/chartjs-plugin-zoom",
  express.static(path.join(__dirname, "node_modules/chartjs-plugin-zoom/dist"))
);

// Serve Plotly locally for the ToF histogram and measured drift viewers.
app.get("/vendor/plotly/plotly.min.js", (req, res) => {
  res.sendFile(path.join(__dirname, "node_modules/plotly.js-dist-min/plotly.min.js"));
});

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
app.use("/api/listmode-file", express.raw({
  type: "application/octet-stream",
  limit: MAX_UPLOAD_BYTES,
}));

// -----------------------------------------------------------------------------
// API: histogram data
// -----------------------------------------------------------------------------


app.use((err, req, res, next) => {
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({
      ok: false,
      error:
        "This listmode file is too large to load directly. " +
        "Please use a smaller file for now. A file-splitting tool will be added later.",
    });
  }

  next(err);
});

app.post("/api/listmode-file", (req, res) => {
  try {
    if(req.headers["x-workspace-session"] && !workspace.isCurrent(req.headers["x-workspace-session"]))return res.status(409).json({ok:false,error:"A new session was started. Please load the file again."});
    if (!req.body || req.body.length === 0) {
      throw new Error("No file data received.");
    }

    const originalFilename =
      req.headers["x-filename"] || "listmode.lst";

    const tempFilename = path.join(
      os.tmpdir(),
      "mrtof-upload-" + crypto.randomUUID() + ".lst"
    );

    fs.writeFileSync(tempFilename, req.body);

    const lm = loadListModeFile(tempFilename, { ejectionBreakUs: preferences.ejectionBreakUs });

    try {
      fs.unlinkSync(tempFilename);
    } catch (_) {
      // Not fatal.
    }

    const datasetId = makeDatasetId();

    listModeDatasets.set(datasetId, {
      id: datasetId,
      filename: originalFilename,
      kind: lm.header.correlyzer_processed==='1'
        ? ['combined','debounced','drift-corrected','energy-correlated'].includes(lm.header.correlyzer_processing)?lm.header.correlyzer_processing:'processed'
        : "original",
      parentId: null,
      createdAt: new Date().toISOString(),
      bytes: req.body.length,
      lm,
      notes: "",
    });

    currentDatasetId = datasetId;
    workspace.publish();

    res.json({
      ok: true,
      datasetId,
      filename: originalFilename,
      bytes: req.body.length,
      datasets: summarizeDatasets(),
    });

  } catch (err) {
    res.status(500).json({
      ok: false,
      error: String(err && err.stack ? err.stack : err),
    });
  }
});

app.get("/api/metadata", (req, res) => {
  try {
    const dataset = getDatasetByRequest(req);

    const channel = parseOptionalInteger(req.query.channel, undefined);
    const edge = parseOptionalInteger(req.query.edge, undefined);

    const lmAll = dataset.lm;

    const filterOptions = {};

    if (channel !== undefined) {
      filterOptions.channel = channel;
    }

    if (edge !== undefined) {
      filterOptions.edge = edge;
    }

    const lmAccepted = filterListModeData(lmAll, filterOptions);
    const acceptedTags = countAcceptedEventsByTag(lmAccepted);

    res.json({
      ok: true,
      datasetId: dataset.id,
      filename: dataset.filename,

      settings: {
        channel,
        edge,
      },

      observed: {
        channels: [...lmAll.observedChannels].sort((a, b) => a - b),
        edges: [...lmAll.observedEdges].sort((a, b) => a - b),
        tags: [...acceptedTags.keys()].sort((a, b) => a - b),
      },

      header: {
        startTime: lmAll.startTime ? lmAll.startTime.toISOString() : null,
        ejectNs: lmAll.ejectNs,
        ejectBins: lmAll.ejectBins,
        timePatch: lmAll.timePatch,
      },
    });

  } catch (err) {
    res.status(500).json({
      ok: false,
      error: String(err && err.stack ? err.stack : err),
    });
  }
});


app.get("/api/histogram", (req, res) => {
  try {
    const dataset = getDatasetByRequest(req);

    const channel = parseOptionalInteger(req.query.channel, DEFAULT_CHANNEL);
    const edge = parseOptionalInteger(req.query.edge, DEFAULT_EDGE);
    const tag = parseOptionalInteger(req.query.tag, DEFAULT_TAG);
    const binWidth = parseOptionalInteger(req.query.binWidth, Math.round(preferences.binWidthNs * 10));

    const lm = filterListModeData(dataset.lm, {
      channel,
      edge,
    });

    const ejectBin = lm.ejectBins[Math.abs(tag) % 2];

    const tofLowUs =
      req.query.tofLowUs !== undefined && req.query.tofLowUs !== ""
        ? Number(req.query.tofLowUs)
        : preferences.tofLowUs;

    const tofHighUs =
      req.query.tofHighUs !== undefined && req.query.tofHighUs !== ""
        ? Number(req.query.tofHighUs)
        : preferences.tofHighUs;

    const tLow = ejectBin + Math.round(tofLowUs * 10000);
    const tHigh = ejectBin + Math.round(tofHighUs * 10000);

    const result = makeTofHistogramsByTag(lm, {
      binWidth,
      TAGnum: tag,
      tLow,
      tHigh,
    });

    const chartData = makeChartJsTofDatasets(result, {
      xUnits: "us",
      relativeToEject: true,
    });

    const tagCounts = countAcceptedEventsByTag(lm);
    const totalSweeps = getTotalSweeps(lm);

    res.json({
      ok: true,

      datasetId: dataset.id,
      filename: dataset.filename,

      settings: {
        channel,
        edge,
        tag,
        binWidth,
        tLow,
        tHigh,
        relativeToEject: true,
        xUnits: "us",
      },

      header: {
        timePatch: lm.timePatch,
        cmline0: lm.cmline[0] ?? null,
        cmline2: lm.cmline[2] ?? null,
        cmline3: lm.cmline[3] ?? null,
        startTime: lm.startTime ? lm.startTime.toISOString() : null,
        ejectNs: lm.ejectNs,
        ejectBins: lm.ejectBins,
        masterPeriodUs: lm.masterPeriodUs,
        sweepPeriodUs: lm.sweepPeriodUs,
        sweepRateHz: lm.sweepRateHz,
        totalSweeps,
      },

      parserStats: lm.stats,
      tagCounts: Object.fromEntries(tagCounts),
      histogram: summarizeHistogram(result.histograms[0]),
      chartData,
    });

  } catch (err) {
    res.status(500).json({
      ok: false,
      error: String(err && err.stack ? err.stack : err),
    });
  }
});

app.get("/api/histogram-sweeps", (req, res) => {
  try {
    const dataset = getDatasetByRequest(req);

    const channel = parseOptionalInteger(req.query.channel, DEFAULT_CHANNEL);
    const edge = parseOptionalInteger(req.query.edge, DEFAULT_EDGE);
    const tag = parseOptionalInteger(req.query.tag, DEFAULT_TAG);
    const binWidth = parseOptionalInteger(req.query.binWidth, Math.round(preferences.binWidthNs * 10));

    const sweepLow = parseOptionalInteger(req.query.sweepLow, 0);
    const sweepHigh = parseOptionalInteger(req.query.sweepHigh, undefined);

    const lm = filterListModeData(dataset.lm, {
      channel,
      edge,
    });

    const ejectBin = lm.ejectBins[Math.abs(tag) % 2];

    const tofLowUs =
      req.query.tofLowUs !== undefined && req.query.tofLowUs !== ""
        ? Number(req.query.tofLowUs)
        : preferences.tofLowUs;

    const tofHighUs =
      req.query.tofHighUs !== undefined && req.query.tofHighUs !== ""
        ? Number(req.query.tofHighUs)
        : preferences.tofHighUs;

    const tLow = ejectBin + Math.round(tofLowUs * 10000);
    const tHigh = ejectBin + Math.round(tofHighUs * 10000);

    const result = makeTofHistogramsByTagAndSweep(lm, {
      binWidth,
      TAGnum: tag,
      tLow,
      tHigh,
      sweepLow,
      sweepHigh,
    });

    const chartData = makeChartJsTofDatasets(result, {
      xUnits: "us",
      relativeToEject: true,
    });

    const tagCounts = countAcceptedEventsByTag(lm);
    const totalSweeps = getTotalSweeps(lm);

    res.json({
      ok: true,

      datasetId: dataset.id,
      filename: dataset.filename,

      settings: {
        channel,
        edge,
        tag,
        binWidth,
        tLow,
        tHigh,
        sweepLow,
        sweepHigh,
        relativeToEject: true,
        xUnits: "us",
      },

      header: {
        timePatch: lm.timePatch,
        cmline0: lm.cmline[0] ?? null,
        cmline2: lm.cmline[2] ?? null,
        cmline3: lm.cmline[3] ?? null,
        startTime: lm.startTime ? lm.startTime.toISOString() : null,
        ejectNs: lm.ejectNs,
        ejectBins: lm.ejectBins,
        masterPeriodUs: lm.masterPeriodUs,
        sweepPeriodUs: lm.sweepPeriodUs,
        sweepRateHz: lm.sweepRateHz,
        totalSweeps,
      },

      parserStats: lm.stats,
      tagCounts: Object.fromEntries(tagCounts),
      histogram: summarizeHistogram(result.histograms[0]),
      chartData,
    });

  } catch (err) {
    res.status(500).json({
      ok: false,
      error: String(err && err.stack ? err.stack : err),
    });
  }
});

// Snapshot of the selected dataset and viewer ranges for the drift popup.
app.get("/api/drift", (req, res) => {
  try {
    const dataset = getDatasetByRequest(req);
    const totalSweeps = getTotalSweeps(dataset.lm);
    const number = (key, fallback) => req.query[key] === undefined ? fallback : Number(req.query[key]);
    const sweepLow = number("sweepLow", 0);
    const sweepHigh = number("sweepHigh", totalSweeps);
    if (sweepHigh > totalSweeps) throw new Error("Sweep range exceeds the dataset.");
    const result = require("./drift.js").makeDriftHeatmap(dataset.lm, {
      channel: number("channel", DEFAULT_CHANNEL), edge: number("edge", DEFAULT_EDGE),
      tag: number("tag", DEFAULT_TAG), binWidth: number("binWidth", Math.round(preferences.binWidthNs * 10)),
      tofLowUs: number("tofLowUs", 12), tofHighUs: number("tofHighUs", 16),
      sweepLow, sweepHigh, sweepBinWidth: number("sweepBinWidth", undefined),
    });
    res.json({ ok: true, datasetId: dataset.id, filename: dataset.filename, ...result });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

app.get('/api/correlation-time',(req,res)=>{
  try{
    const dataset=getDatasetByRequest(req);
    const energySources=energyStore.tofEnergySources(dataset.id);
    const derivedSource=dataset.kind==='energy-correlated'?energyStore.derivedEnergySource(dataset):null;
    if(derivedSource && !energySources.some(source=>source.id===derivedSource.id))energySources.push(derivedSource);
    const energyRoiId=req.query.energyRoiId || null;
    let referenceTimes,energyDatasetId=null;
    if(energySources.length || req.query.energyDatasetId){
      energyDatasetId=req.query.energyDatasetId || energySources[0].id;
      referenceTimes=derivedSource?.id===energyDatasetId?energyStore.referenceTimesForDerived(dataset,energyRoiId):energyStore.referenceTimesForTof(dataset.id,energyDatasetId,energyRoiId);
    }else if(dataset.kind==='energy-correlated'){
      if(energyRoiId)throw new Error('Saved Energy ROIs require the original Energy histogram to be loaded.');
      referenceTimes=energyStore.referenceTimesForDerived(dataset);
    }
    else throw new Error('Connect this ToF spectrum to an Energy histogram first.');
    const number=(key,fallback)=>req.query[key]===undefined || req.query[key]===''?fallback:Number(req.query[key]);
    const result=require('./correlation-time').makeCorrelationTimeHistogram(dataset.lm,{
      channel:number('channel',DEFAULT_CHANNEL),edge:number('edge',DEFAULT_EDGE),tag:number('tag',DEFAULT_TAG),
      tofLowUs:number('tofLowUs'),tofHighUs:number('tofHighUs'),sweepLow:number('sweepLow',0),sweepHigh:number('sweepHigh',Infinity),binWidth:number('binWidth'),xScale:req.query.xScale || 'linear',fitExponential:req.query.fitExponential==='true',fitSchmidt:req.query.fitSchmidt==='true'},referenceTimes);
    res.json({ok:true,datasetId:dataset.id,filename:dataset.filename,energySources,energyDatasetId,energyRois:energyStore.correlationRois(energyDatasetId),energyRoiId,...result});
  }catch(error){res.status(400).json({ok:false,error:error.message});}
});
app.get('/api/sweep-distribution', (req,res)=>{
  try {
    const dataset=getDatasetByRequest(req);
    const totalSweeps=getTotalSweeps(dataset.lm);
    const sweepLow=Number(req.query.sweepLow ?? 0),sweepHigh=Number(req.query.sweepHigh ?? totalSweeps);
    if(sweepHigh>totalSweeps)throw new Error('Sweep range exceeds the dataset.');
    const result=require('./sweep-distribution.js').makeSweepDistribution(dataset.lm,{
      channel:Number(req.query.channel),edge:Number(req.query.edge),sweepLow,sweepHigh,
      tagRanges:JSON.parse(req.query.tagRanges || '{}')});
    res.json({ok:true,datasetId:dataset.id,filename:dataset.filename,...result});
  }catch(error){res.status(400).json({ok:false,error:error.message});}
});

app.get("/api/drift-fit", (req, res) => {
  try {
    const dataset = getDatasetByRequest(req);
    const sessionId=workspace.snapshot().sessionId;
    const viewerSettings=derivedViewerSettings(dataset,req.query.viewerSettings ? JSON.parse(req.query.viewerSettings) : undefined);
    const integer = (key, fallback) => parseOptionalInteger(req.query[key], fallback);
    const channel=integer("channel",DEFAULT_CHANNEL), edge=integer("edge",DEFAULT_EDGE), tag=integer("tag",DEFAULT_TAG);
    const total=getTotalSweeps(dataset.lm);
    const sweepLow=integer("sweepLow",0),sweepHigh=integer("sweepHigh",total);
    if(sweepLow<0 || sweepHigh>total || sweepHigh<=sweepLow) throw new Error("Invalid sweep range.");
    const selected=[]; const events=dataset.lm.events;
    for(let i=0;i<events.length;i++) if(events.channel[i]===channel && events.edge[i]===edge && events.tag[i]===tag && events.sweep[i]>=sweepLow && events.sweep[i]<sweepHigh) selected.push(i);
    const tof=Float64Array.from(selected,i=>events.tof[i]);
    const sweep=Int32Array.from(selected,i=>events.sweep[i]);
    const {Worker}=require("node:worker_threads");
    const worker=new Worker(path.join(__dirname,"drift-fit-worker.js"),{workerData:{
      events:{length:selected.length,tof,sweep},ejectBin:dataset.lm.ejectBins[Math.abs(tag)%2],
      sweepLow,sweepHigh,tofLowUs:Number(req.query.tofLowUs),tofHighUs:Number(req.query.tofHighUs),
      binWidth:integer("binWidth",Math.round(preferences.binWidthNs * 10)),trancheSize:integer("trancheSize",5000),
    },transferList:[tof.buffer,sweep.buffer]});
    activeWorkers.add(worker);
    worker.once("exit",()=>activeWorkers.delete(worker));
    let finished=false;
    const finish=(status,result)=>{
      if(finished)return; finished=true;clearTimeout(timer);
      if(!res.destroyed)res.status(status).json({...result,filename:dataset.filename,datasetId:dataset.id,channel,edge,tag});
      worker.terminate();
    };
    const timer=setTimeout(()=>finish(408,{ok:false,error:"Tranche fits exceeded the 60-second time limit. Select fewer sweeps."}),60000);
    worker.once("message",result=>{
      if(finished)return;
      if(!workspace.isCurrent(sessionId))return finish(409,{ok:false,error:"A new session was started."});
      if(!listModeDatasets.has(dataset.id))return finish(409,{ok:false,error:'Source spectrum was removed.'});
      if(result.ok){
        const fitRunId=makeDatasetId();
        driftFitRuns.set(fitRunId,{datasetId:dataset.id,result,channel,edge,tag,viewerSettings,correctedDatasetId:null});
        // Retain a bounded set of recent fit runs for correction provenance.
        if(driftFitRuns.size>30){
          const oldest=driftFitRuns.keys().next().value;
          const pending=listModeDatasets.get(driftFitRuns.get(oldest).correctedDatasetId);
          if(pending?.pending)listModeDatasets.delete(pending.id);
          driftFitRuns.delete(oldest);
        }
        result.fitRunId=fitRunId;
      }
      finish(result.ok?200:400,result);
    });
    worker.once("error",error=>finish(500,{ok:false,error:error.message}));
    worker.once("exit",code=>{if(!finished)finish(500,{ok:false,error:`Drift fit worker exited (${code}).`})});
    res.once("close",()=>{if(!finished){finished=true;clearTimeout(timer);worker.terminate()}});
  }catch(error){res.status(400).json({ok:false,error:error.message})}
});

app.post('/api/combine-files',(req,res)=>{
  try {
    if(req.body?.sessionId && !workspace.isCurrent(req.body.sessionId))return res.status(409).json({ok:false,error:'A new session was started. Select the files again.'});
    const ids=req.body?.datasetIds;
    if(!Array.isArray(ids) || ids.length<2 || ids.length>100 || ids.some(id=>typeof id!=='string') || new Set(ids).size!==ids.length)throw new Error('Choose at least two different files (up to 100).');
    const sources=ids.map(id=>listModeDatasets.get(id));
    if(sources.some(ds=>!ds || ds.pending))throw new Error('A selected file is no longer available.');
    const lm=makeCombinedData(sources);
    sources.sort((a,b)=>a.lm.startTime-b.lm.startTime);
    const settings=derivedViewerSettings(sources[0],req.body.viewerSettings);
    const id=makeDatasetId();
    const filename=sources.map(ds=>ds.filename.replace(/\.(lst|lm)$/i,'')).join(' + ')+' [combined].lst';
    const dataset={id,filename,kind:'combined',sourceIds:sources.map(ds=>ds.id),parentId:sources[0].id,createdAt:new Date().toISOString(),
      bytes:sources.reduce((sum,ds)=>sum+ds.bytes,0),lm,notes:'Combined on the acquisition timeline: '+sources.map(ds=>ds.filename).join('; '),
      viewerState:{settings,fits:[],roi:null,sweepRange:null}};
    listModeDatasets.set(id,dataset);
    workspace.publish();
    res.json({ok:true,dataset:summarizeDataset(dataset)});
  } catch(error){res.status(400).json({ok:false,error:error.message,code:error.code});}
});

app.post("/api/debounce", (req,res)=>{
  try {
    if(req.body?.sessionId && !workspace.isCurrent(req.body.sessionId))return res.status(409).json({ok:false,error:"A new session was started. Please select a spectrum again."});
    const parent=listModeDatasets.get(req.body?.datasetId);
    if(!parent || parent.pending)throw new Error("Source spectrum is unavailable.");
    const settings=derivedViewerSettings(parent,req.body.viewerSettings);
    const {lm,debouncing}=require('./debounce.js').makeDebouncedData(parent.lm,req.body.minNs,req.body.maxNs);
    const id=makeDatasetId();
    const filename=parent.filename+` [debounced; ${debouncing.minNs}–${debouncing.maxNs} ns]`;
    const dataset={id,filename,kind:'debounced',parentId:parent.id,createdAt:new Date().toISOString(),bytes:parent.bytes,lm,debouncing,
      notes:`${debouncing.removedEvents} of ${debouncing.sourceEvents} events removed; ${debouncing.minNs}–${debouncing.maxNs} ns after any source event in the same sweep.`,
      viewerState:{settings,fits:[],roi:null,sweepRange:null}};
    listModeDatasets.set(id,dataset);
    workspace.publish();
    res.json({ok:true,dataset:summarizeDataset(dataset),debouncing});
  }catch(error){res.status(400).json({ok:false,error:error.message})}
});

app.post("/api/drift-correct", (req,res)=>{
  try{
    const run=driftFitRuns.get(req.body?.fitRunId);
    if(!run)throw new Error("Drift fit results are unavailable. Run Drift Correct again.");
    if(run.rejected)throw new Error("These drift correction results were rejected. Run Drift Correct again.");
    if(run.correctedDatasetId){
      const existing=listModeDatasets.get(run.correctedDatasetId);
      return res.json({ok:true,dataset:summarizeDataset(existing),correction:existing.correction});
    }
    const parent=listModeDatasets.get(run.datasetId);
    if(!parent)throw new Error("Source dataset is unavailable.");
    const {lm,correction}=require("./drift-correction.js").makeDriftCorrectedData(parent.lm,run.result);
    const id=makeDatasetId();
    const filename=parent.filename+" [drift corrected; "+run.result.trancheSize+" sweeps]";
    const dataset={id,filename,kind:"drift-corrected",parentId:parent.id,createdAt:new Date().toISOString(),
      pending:true,bytes:parent.bytes,lm,correction,notes:`${correction.totalEvents} of ${correction.sourceEvents} events retained across all TAGs; ${correction.scaledEvents} scaled; ${correction.discardedEvents} discarded from failed tranches.`,
      fitSettings:{...run.result.settings,channel:run.channel,edge:run.edge,tag:run.tag},fitResults:run.result,
      viewerState:{settings:derivedViewerSettings(parent,run.viewerSettings,{channel:run.channel,edge:run.edge,tag:run.tag,binWidth:run.result.settings.binWidth}),
        fits:[],sweepRange:null,roi:{lowUs:run.result.settings.tofLowUs,highUs:run.result.settings.tofHighUs}}};
    listModeDatasets.set(id,dataset);run.correctedDatasetId=id;
    res.json({ok:true,dataset:summarizeDataset(dataset),correction});
  }catch(error){res.status(400).json({ok:false,error:error.message})}
});

app.post("/api/drift-correct/decision", (req,res)=>{
  try {
    const run=driftFitRuns.get(req.body?.fitRunId);
    if(!run) throw new Error("Drift fit results are unavailable.");
    const dataset=listModeDatasets.get(run.correctedDatasetId);
    if(req.body.action === "accept") {
      if(!dataset) throw new Error("Corrected spectrum is unavailable.");
      dataset.pending=false;
      if(!dataset.viewerState)dataset.viewerState={settings:{...dataset.fitSettings},fits:[],sweepRange:null,roi:{lowUs:dataset.fitSettings.tofLowUs,highUs:dataset.fitSettings.tofHighUs}};
      workspace.publish();
      return res.json({ok:true,dataset:summarizeDataset(dataset)});
    }
    if(req.body.action !== "reject") throw new Error("Unknown results action.");
    // Never remove a spectrum that has already been accepted.
    if(!dataset || dataset.pending) run.rejected=true;
    if(dataset?.pending) { listModeDatasets.delete(dataset.id); run.correctedDatasetId=null; }
    res.json({ok:true});
  } catch(error) { res.status(400).json({ok:false,error:error.message}); }
});

// Fallback for macOS browsers that do not support the browser save-file picker.
app.post("/api/drift-fit/export", async (req,res)=>{
  try {
    const run=driftFitRuns.get(req.body?.fitRunId);
    if(!run) throw new Error("Drift fit results are unavailable.");
    if(process.platform !== "darwin") throw new Error("This browser does not support choosing a save location. Please open the viewer in Chrome or Edge to export.");
    const parent=listModeDatasets.get(run.datasetId);
    const {execFile}=require("node:child_process");
    const {promisify}=require("node:util");
    const script='on run argv\nset outputFile to choose file name with prompt "Export drift correction results" default name (item 1 of argv)\nreturn POSIX path of outputFile\nend run';
    let destination;
    try {
      const {stdout}=await promisify(execFile)("/usr/bin/osascript",["-e",script,"drift-results.csv"]);
      destination=stdout.trimEnd();
    } catch(error) {
      if(String(error.stderr).includes("(-128)")) return res.json({ok:true,cancelled:true});
      throw error;
    }
    const csv=require("./public/js/drift-export.js").driftResultsCsv({...run.result,filename:parent?.filename,channel:run.channel,edge:run.edge,tag:run.tag});
    await fs.promises.writeFile(destination,csv,"utf8");
    res.json({ok:true});
  } catch(error) { res.status(400).json({ok:false,error:error.message}); }
});

app.get("/api/listmode-datasets", (req, res) => {
  res.json({
    ok: true,
    currentDatasetId,
    datasets: summarizeDatasets(),
  });
});

function exportableDataset(id) {
  const dataset=listModeDatasets.get(id);
  if(!dataset || dataset.pending || !['debounced','drift-corrected','combined','energy-correlated'].includes(dataset.kind))throw new Error('Processed spectrum is unavailable.');
  return dataset;
}
app.get('/api/listmode-datasets/:id/file',(req,res)=>{
  try {
    const dataset=exportableDataset(req.params.id);
    const {serializeListmode,listmodeFilename}=require('./listmode-export');
    const text=serializeListmode(dataset.lm);
    res.attachment(listmodeFilename(dataset.filename)).type('text/plain').send(text);
  } catch(error){res.status(400).json({ok:false,error:error.message});}
});
// Native save dialog for browsers without the save-file picker.
app.post('/api/listmode-datasets/:id/save',async(req,res)=>{
  try {
    const dataset=exportableDataset(req.params.id);
    if(process.platform!=='darwin')throw new Error('Please use Chrome or Edge to choose a save location.');
    const {serializeListmode,listmodeFilename}=require('./listmode-export');
    const text=serializeListmode(dataset.lm);
    const {execFile}=require('node:child_process');
    const {promisify}=require('node:util');
    const script='on run argv\nset outputFile to choose file name with prompt "Save processed spectrum" default name (item 1 of argv)\nreturn POSIX path of outputFile\nend run';
    let destination;
    try {
      const {stdout}=await promisify(execFile)('/usr/bin/osascript',['-e',script,listmodeFilename(dataset.filename)]);
      destination=stdout.trimEnd();
    } catch(error){
      if(String(error.stderr).includes('(-128)'))return res.json({ok:true,cancelled:true});
      throw error;
    }
    await fs.promises.writeFile(destination,text,'utf8');
    res.json({ok:true});
  } catch(error){res.status(400).json({ok:false,error:error.message});}
});

app.post("/api/listmode-datasets/select", express.json(), (req, res) => {
  try {
    const datasetId = req.body?.datasetId;

    if (!datasetId || !listModeDatasets.has(datasetId) || listModeDatasets.get(datasetId).pending) {
      throw new Error("Dataset not found: " + datasetId);
    }

    currentDatasetId = datasetId;

    res.json({
      ok: true,
      currentDatasetId,
      datasets: summarizeDatasets(),
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: String(err && err.stack ? err.stack : err),
    });
  }
});

// -----------------------------------------------------------------------------
// API: Fit interface
// -----------------------------------------------------------------------------
// Fit in a worker so the histogram and drift viewer stay responsive.
app.post("/api/fit", (req, res) => {
  const { Worker } = require("node:worker_threads");
  const worker = new Worker(path.join(__dirname, "fit-worker.js"), { workerData: req.body });
  activeWorkers.add(worker);
  worker.once("exit",()=>activeWorkers.delete(worker));
  let finished = false;
  const finish = (status, result) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (!res.destroyed) res.status(status).json(result);
    worker.terminate();
  };
  const timer = setTimeout(() => finish(408, { ok: false, error: "Fit exceeded the 15-second time limit." }), 15000);
  worker.once("message", result => finish(result.ok ? 200 : 400, result));
  worker.once("error", error => finish(500, { ok: false, error: error.message }));
  worker.once("exit", code => {
    if (!finished) finish(500, { ok: false, error: `Fit worker exited unexpectedly (${code}).` });
  });
  res.once("close", () => {
    if (!finished) { finished = true; clearTimeout(timer); worker.terminate(); }
  });
});

// -----------------------------------------------------------------------------
// Start server
// -----------------------------------------------------------------------------

if(require.main===module)app.listen(PORT, () => {
  console.log("");
  console.log("MRTOF Analyzer test server");
  console.log("--------------------------");
  console.log(`Open: http://localhost:${PORT}`);
  console.log("");
});

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------

function parseOptionalInteger(value, defaultValue) {
    if (value === undefined || value === null || value === "") {
      return defaultValue;
    }

    const n = Number(value);

    if (!Number.isInteger(n)) {
      throw new Error(`Expected integer, got ${value}`);
    }

    return n;
}

function countAcceptedEventsByTag(lm) {
    const counts = new Map();

    for (let i = 0; i < lm.events.length; i++) {
      const tag = lm.events.tag[i];
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }

    return new Map([...counts.entries()].sort((a, b) => a[0] - b[0]));
}

function getTotalSweeps(lm) {
    let maxSweep = -1;

    for (let i = 0; i < lm.events.length; i++) {
      if (lm.events.sweep[i] > maxSweep) {
        maxSweep = lm.events.sweep[i];
      }
    }

    return maxSweep + 1;
}

function summarizeHistogram(h) {
    if (!h) {
      return null;
    }

    return {
      TAGnum: h.TAGnum,
      ejectBin: h.ejectBin,
      ejectNs: h.ejectNs,
      startTime: h.startTime,
      sweepRange: h.sweepRange,
      binWidth: h.binWidth,
      tLow: h.tLow,
      tHigh: h.tHigh,
      nBins: h.nBins,
      inputEventsForTag: h.inputEventsForTag,
      acceptedEvents: h.acceptedEvents,
    };
}

/* These are helper functions for managing listmode data */ 
function makeDatasetId() {
  return crypto.randomUUID();
}

function getCurrentDataset() {
    if (!currentDatasetId || !listModeDatasets.has(currentDatasetId)) {
      throw new Error("No listmode dataset loaded yet.");
    }

    return listModeDatasets.get(currentDatasetId);
}

function getDatasetByRequest(req) {
    const datasetId = req.query.datasetId || currentDatasetId;

    if (!datasetId || !listModeDatasets.has(datasetId) || listModeDatasets.get(datasetId).pending) {
      throw new Error("Requested listmode dataset was not found.");
    }

    return listModeDatasets.get(datasetId);
}

function filterListModeData(lm, options = {}) {
    const channel = options.channel;
    const edge = options.edge;

    if (channel === undefined && edge === undefined) {
      return lm;
    }

    const n = lm.events.length;
    const keep = [];

    for (let i = 0; i < n; i++) {
      if (channel !== undefined && lm.events.channel[i] !== channel) {
        continue;
      }

      if (edge !== undefined && lm.events.edge[i] !== edge) {
        continue;
      }

      keep.push(i);
    }

    const events = {
      length: keep.length,
    };

    for (const key of Object.keys(lm.events)) {
      const src = lm.events[key];

      if (!src || typeof src.length !== "number" || src.length !== n) {
        events[key] = src;
        continue;
      }

      if (ArrayBuffer.isView(src)) {
        const dst = new src.constructor(keep.length);

        for (let j = 0; j < keep.length; j++) {
          dst[j] = src[keep[j]];
        }

        events[key] = dst;
      } else if (Array.isArray(src)) {
        events[key] = keep.map(i => src[i]);
      } else {
        events[key] = src;
      }
    }

    return {
      ...lm,
      events,
      observedChannels: new Set(events.channel ?? []),
      observedEdges: new Set(events.edge ?? []),
      observedTags: new Set(events.tag ?? []),
    };
}

function summarizeDataset(ds) {
    return {id:ds.id,filename:ds.filename,kind:ds.kind,parentId:ds.parentId,createdAt:ds.createdAt,
      bytes:ds.bytes,notes:ds.notes,canCombine:canCombineDataset(ds),sourceIds:ds.sourceIds,viewerSettings:ds.viewerState?.settings??null,isCurrent:ds.id===currentDatasetId,fitSettings:ds.fitSettings??null};
}
function summarizeDatasets() {
    return [...listModeDatasets.values()].filter(dataset=>!dataset.pending).map(summarizeDataset);
}

module.exports={app,workspace};
