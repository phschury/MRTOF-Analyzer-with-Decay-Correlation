function displayNumber(value, options) {
    return typeof NumberDisplay!=='undefined'?NumberDisplay.format(value,options):
      options?.minimumFractionDigits!==undefined?Number(value).toFixed(options.minimumFractionDigits):String(Number(value));
}
window.addEventListener('number-display-change',()=>{
    const payload=plottedTags.values().next().value;
    if(payload)drawRunInfo(payload);
    if(chart)drawCombinedChart();
});
const FULL_TOF_LOW_US = 0;
let FULL_TOF_HIGH_US = 40;
let globalMinRangeUs = 0.32;
let globalMaxRangeUs = 3200;

let storedRange = {low: 2.5, high: 25.0};
let safeRegion = {low: 2.5, high: 25.0};

let loadedFileStates = [];
let activeFileStateIndex = -1;
let loadingSpectrumId = null;

let currentSweepRange = null;
let availableSweeps = null;

let currentRoi = null;
let lastRightClickXValue = null;

let chart = null;
let chartViewContext = null;
let plottedTags = new Map();
let lastSettingsKey = null;
let absoluteViewRange = null;
let absoluteViewKey = "";
let absoluteViewDatasetId = null;
function validAxisRange(range) {
    return !!range && Number.isFinite(range.min) && Number.isFinite(range.max) && range.max>range.min;
}

const plotColors = [
  "#003366", // dark blue
  "#ff0000", // bright red
  "#006400", // dark green
  "#800080", // purple
  "#ff8c00", // orange
  "#00a0a0", // teal
  "#8b4513", // brown
  "#000000"  // black
];

document.addEventListener("DOMContentLoaded", async () => {
    await loadViewerPreferences();
    initializeBinWidthEditor();
    document.getElementById("plotWidthUs").addEventListener("input", event => event.target.setCustomValidity(""));
    document.getElementById("plotWidthUs").addEventListener("change", applyPlotWidth);
    document.getElementById("sliceInput").addEventListener("input", event => event.target.setCustomValidity(""));

    document
        .getElementById("updateButton")
        .addEventListener("click", loadAllHistograms);

    initializeFileLoading();
    initializeCombineFiles();

    const canvas = document.getElementById("histogramChart");
    initializeRoiDrag(canvas);
    initializeCursorCopy(canvas);
    canvas.addEventListener("contextmenu", showChartContextMenu);
    document.addEventListener("click", hideChartContextMenu);
    canvas.addEventListener("wheel", handleChartWheel, { passive: false });
    // Container size can change when controls wrap or file information updates.
    // Resize the plot without redrawing it or changing its selected axis range.
    let resizeFrame;
    const chartResizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => {
            if (chart?._fullLayout) Plotly.Plots.resize(chart);
        });
    });
    chartResizeObserver.observe(canvas);
    document.getElementById("yScale").addEventListener("change", drawCombinedChart);
    document.getElementById("timeMode").addEventListener("change", drawCombinedChart);

    document
    .getElementById("channel")
    .addEventListener("change", () => scheduleHistogramRefresh(true, 0));

    document
    .getElementById("edge")
    .addEventListener("change", () => scheduleHistogramRefresh(true, 0));

    document.getElementById("status").textContent =
        "Choose a listmode file and click Load File.";

    document
    .getElementById("sweepUpdateButton")
    .addEventListener("click", loadAllHistogramsForSweepRange);

    document
        .getElementById("sweepFirst")
        ?.addEventListener("change", sanitizeSweepInputs);

    document
        .getElementById("sweepLast")
        ?.addEventListener("change", sanitizeSweepInputs);

    document.getElementById("showDriftButton").addEventListener("click", showDrift);
    document.getElementById("tag").addEventListener("change", () => { syncDriftWindow(); drawCombinedChart(); });
    document.getElementById("driftCorrectButton").addEventListener("click", showDriftFits);
    document.getElementById("debounceButton").addEventListener("click", debounceSpectrum);
    for(const id of ['debounceMinNs','debounceMaxNs'])document.getElementById(id).addEventListener('input',scheduleWorkspaceSave);
    document.getElementById("driftCorrectionTag").addEventListener("change", scheduleWorkspaceSave);
    updateDriftCorrectButton();
    initializeFittingUi();
    if(typeof workspaceSession!=="undefined")await workspaceSession.start();
});

function driftViewerParams() {
    const state = loadedFileStates[activeFileStateIndex];
    if (!state || !chart || !plottedTags.size) {
        return null;
    }
    const params = new URLSearchParams({ datasetId: state.datasetId });
    params.set('thousandsSeparator',typeof NumberDisplay!=='undefined'?NumberDisplay.choice:'comma');
    const availableTags = document.getElementById('tag').options;
    params.set('tags', (availableTags ? [...availableTags].map(option=>option.value) : [...plottedTags.keys()]).join(','));
    for (const key of ["channel", "edge", "tag", "binWidth", "tofLowUs", "tofHighUs", "yScale"]) {
        params.set(key, document.getElementById(key).value);
    }
    const plotted = plottedTags.get(Number(document.getElementById("tag").value));
    if (plotted) {
        for (const key of ["channel", "edge", "binWidth"]) params.set(key, plotted.settings[key]);
    }
    params.set('tagEjectionsUs',JSON.stringify(Object.fromEntries([...plottedTags].map(([tag,payload])=>
        [tag,payload.chartData?.datasets[0]?.ejectUs]))));
    const displayedRange = chart.layout?.xaxis?.range;
    if (displayedRange && !absoluteTimeMode()) {
        params.set("tofLowUs", displayedRange[0]);
        params.set("tofHighUs", displayedRange[1]);
    }
    if (displayedRange && absoluteTimeMode()) {
        const ranges={};
        for(const [tag,payload] of plottedTags) {
            const offset=plotOffset(Number(payload.chartData.datasets[0].ejectUs));
            const low=Math.max(0,displayedRange[0]-offset);
            const high=Math.min(FULL_TOF_HIGH_US,displayedRange[1]-offset);
            ranges[tag]=high>low?{low,high}:null;
        }
        params.set('tagRanges',JSON.stringify(ranges));
    }
    if(!currentSweepRange && availableSweeps!==null) {
        params.set('sweepLow',0);params.set('sweepHigh',availableSweeps);
    }
    if (currentSweepRange) {
        params.set("sweepLow", currentSweepRange.sweepLow);
        params.set("sweepHigh", currentSweepRange.sweepHigh);
    }
    return params;
}

let driftSyncTimer;
let lastDriftSnapshot = "";
function syncDriftWindow(force = false) {
    if(typeof syncDistroWindow==='function')syncDistroWindow(force);
    clearTimeout(driftSyncTimer);
    driftSyncTimer = setTimeout(() => {
        const frame = document.querySelector("#driftWindow iframe");
        const params = driftViewerParams();
        if (!frame || !params) return;
        const snapshot = params.toString();
        if (!force && snapshot === lastDriftSnapshot) return;
        lastDriftSnapshot = snapshot;
        frame.contentWindow.postMessage({ type: "drift-viewer-state", query: snapshot }, window.location.origin);
    }, 150);
}
window.addEventListener("message", event => {
    const frame = document.querySelector("#driftWindow iframe");
    if (event.origin === window.location.origin && frame && event.source === frame.contentWindow && event.data?.type === "drift-ready") {
        syncDriftWindow(true);
    }
});

const acceptingDriftDatasets = new Set();
window.addEventListener("message", async event => {
    const frame=document.querySelector("#driftFitWindow iframe");
    if(event.origin!==window.location.origin || !frame || event.source!==frame.contentWindow || event.data?.type!=="drift-corrected-dataset")return;
    const dataset=event.data.dataset;
    if(!dataset?.id || acceptingDriftDatasets.has(dataset.id))return;
    acceptingDriftDatasets.add(dataset.id);
    const accept=async()=>{
        saveCurrentViewerState();
        const parent=loadedFileStates.find(state=>state.datasetId===dataset.parentId);
        const settings={...(dataset.viewerSettings || parent?.settings || collectViewerSettings())};
        // Keep the parent's latest viewport, including navigation during fitting.
        // The fit interval remains the ROI, independently of the displayed range.
        for(const key of ['tofLowUs','tofHighUs','timeMode','absoluteViewRange']) {
            if(parent?.settings?.[key]!==undefined)settings[key]=parent.settings[key];
        }
        if(settings.absoluteViewRange)settings.absoluteViewRange={...settings.absoluteViewRange};
        for(const key of ["channel","edge","tag","binWidth"])if(dataset.fitSettings?.[key]!==undefined)settings[key]=String(dataset.fitSettings[key]);
        let index=loadedFileStates.findIndex(state=>state.datasetId===dataset.id);
        if(index<0) {
            index=loadedFileStates.length;
            loadedFileStates.push({datasetId:dataset.id,filename:dataset.filename,displayName:dataset.filename,
              settings,fits:[],sweepRange:null,roi:dataset.fitSettings?{lowUs:dataset.fitSettings.tofLowUs,highUs:dataset.fitSettings.tofHighUs}:null,
              kind:dataset.kind,parentId:dataset.parentId,notes:dataset.notes});
        } else {
            // The workspace broadcast can add the spectrum before this message.
            loadedFileStates[index].settings=settings;
        }
        await restoreLoadedFileState(index);
    };
    try {
        if(typeof workspaceSession!=="undefined")await workspaceSession.localTask(accept);
        else await accept();
    } catch(error) {
        document.getElementById('status').textContent='Could not display corrected spectrum: '+error.message;
    } finally {
        acceptingDriftDatasets.delete(dataset.id);
    }
});

window.addEventListener("message", event => {
    if(event.data?.type!=="drift-results-close") return;
    const popup=document.getElementById("driftFitWindow");
    const frame=popup?.querySelector("iframe");
    if(event.origin===window.location.origin && frame && event.source===frame.contentWindow && event.data?.type==="drift-results-close") popup.remove();
});

function showDrift() {
    const params = driftViewerParams();
    if (!params) {
        document.getElementById("status").textContent = "Load a listmode file before showing drift.";
        return;
    }
    // Plotly can already show a new viewport before its relayout handler has
    // updated our range. Keep that viewport for workspace/layout redraws while
    // the heatmap is open, rather than falling back to the input/default range.
    retainDisplayedTofRange();
    let popup = document.getElementById("driftWindow");
    if (!popup) {
        popup = document.createElement("section");
        popup.id = "driftWindow";
        popup.setAttribute("role", "dialog");
        popup.setAttribute("aria-modal", "false");
        popup.setAttribute("aria-label", "Drift heatmap");
        popup.innerHTML = '<header><span>Drift heatmap — drag to move</span><button type="button" aria-label="Close drift heatmap">×</button></header><iframe title="TOF drift heatmap"></iframe>';
        document.body.appendChild(popup);
        popup.querySelector("button").addEventListener("click", () => popup.remove());
        const header = popup.querySelector("header");
        header.addEventListener("pointerdown", event => {
            if (event.target.closest("button")) return;
            const rect = popup.getBoundingClientRect();
            const dx = event.clientX - rect.left, dy = event.clientY - rect.top;
            header.setPointerCapture(event.pointerId);
            header.onpointermove = move => {
                popup.style.left = Math.max(0, Math.min(window.innerWidth - 120, move.clientX - dx)) + "px";
                popup.style.top = Math.max(0, Math.min(window.innerHeight - 40, move.clientY - dy)) + "px";
            };
            header.onpointerup = () => { header.onpointermove = null; };
            header.onlostpointercapture = () => { header.onpointermove = null; };
        });
    }
    const frame = popup.querySelector("iframe");
    if (!frame.getAttribute("src")) {
        lastDriftSnapshot = "";
        frame.src = "/drift.html?" + params;
    } else {
        syncDriftWindow(true);
    }

}

function retainDisplayedTofRange() {
    const bounds = chart?.layout?.xaxis?.range;
    const range = bounds && {min: bounds[0], max: bounds[1]};
    if (!validAxisRange(range) ||
        chartViewContext?.datasetId !== loadedFileStates[activeFileStateIndex]?.datasetId ||
        chartViewContext?.mode !== (document.getElementById('timeMode')?.value ?? 'absolute') ||
        chartViewContext?.relativeKey !== JSON.stringify(relativeTofRange())) return;
    if (absoluteTimeMode()) {
        visibleTofRange();
        absoluteViewRange = {...range};
    } else {
        document.getElementById('tofLowUs').value = String(range.min);
        document.getElementById('tofHighUs').value = String(range.max);
    }
    syncPlotWidth(range);
    saveCurrentViewerState();
    scheduleWorkspaceSave();
}

let debounceBusy=false;
async function debounceSpectrum() {
    if(debounceBusy)return;
    const parent=loadedFileStates[activeFileStateIndex];
    if(!parent)return;
    const status=document.getElementById('debounceStatus');
    const minText=document.getElementById('debounceMinNs').value.trim();
    const maxText=document.getElementById('debounceMaxNs').value.trim();
    const minNs=Number(minText),maxNs=Number(maxText);
    if(!minText || !maxText || !Number.isFinite(minNs) || !Number.isFinite(maxNs) || minNs<0 || maxNs<=minNs) {
        status.textContent='Enter a range with 0 ≤ min < max, in nanoseconds.';
        return;
    }
    debounceBusy=true;
    updateDriftCorrectButton();
    status.textContent='Debouncing the full event set…';
    const task=async()=>{
        saveCurrentViewerState();
        const settings={...parent.settings};
        const sessionId=typeof workspaceSession!=='undefined'?workspaceSession.sessionId():'';
        const response=await fetch('/api/debounce',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({datasetId:parent.datasetId,minNs,maxNs,sessionId,viewerSettings:settings})});
        const result=await response.json();
        if(!response.ok || !result.ok)throw new Error(result.error || 'Debouncing failed.');
        if(sessionId && workspaceSession.sessionId()!==sessionId)return;
        const dataset=result.dataset;
        loadedFileStates.push({datasetId:dataset.id,filename:dataset.filename,displayName:dataset.filename,
            kind:dataset.kind,parentId:dataset.parentId,notes:dataset.notes,settings,fits:[],roi:null,sweepRange:null});
        await restoreLoadedFileState(loadedFileStates.length-1);
        status.textContent=`Created debounced spectrum: ${displayNumber(result.debouncing.removedEvents)} of ${displayNumber(result.debouncing.sourceEvents)} events removed (${displayNumber(minNs)}–${displayNumber(maxNs)} ns).`;
    };
    try {
        if(typeof workspaceSession!=='undefined')await workspaceSession.localTask(task);
        else await task();
    }catch(error){status.textContent=error.message;}
    finally{debounceBusy=false;updateDriftCorrectButton();}
}

function updateDriftCorrectButton() {
    const distroButton=document.getElementById('distroButton');
    if(distroButton)distroButton.disabled=!loadedFileStates[activeFileStateIndex] || !plottedTags.size;
    const debounceButton=document.getElementById('debounceButton');
    if(debounceButton)debounceButton.disabled=debounceBusy || !loadedFileStates[activeFileStateIndex];
    const button=document.getElementById("driftCorrectButton");
    if(button) button.disabled=!(roiIsReadyForFit() && Number.isFinite(currentRoi.lowUs) && Number.isFinite(currentRoi.highUs) &&
      currentRoi.highUs>currentRoi.lowUs && loadedFileStates[activeFileStateIndex] && plottedTags.size);
}

function parseDriftTrancheSize(text) {
    const value=String(text).trim();
    const size=Number(value);
    if(!/^\d+$/.test(value) || !Number.isSafeInteger(size) || size<1) throw new Error("Enter a positive whole number of sweeps.");
    return size;
}

async function showDriftFits() {
    updateDriftCorrectButton();
    if(document.getElementById("driftCorrectButton").disabled)return;
    const params=driftViewerParams();
    if(!params)return;
    saveCurrentViewerState();
    const correctionTag=document.getElementById("driftCorrectionTag")?.value;
    if(correctionTag!==undefined && correctionTag!=="")params.set("tag",correctionTag);
    else if(currentRoi.tag!==undefined)params.set("tag",currentRoi.tag);
    params.set("tofLowUs",currentRoi.lowUs);
    params.set("tofHighUs",currentRoi.highUs);
    const sliceInput=document.getElementById("sliceInput");
    let trancheSize;
    try {
        trancheSize=parseDriftTrancheSize(sliceInput.value);
        sliceInput.setCustomValidity("");
    } catch (error) {
        sliceInput.setCustomValidity(error.message);
        sliceInput.reportValidity();
        sliceInput.focus();
        return;
    }
    params.set("trancheSize",trancheSize);
    params.set("viewerSettings",JSON.stringify(collectViewerSettings()));
    let popup=document.getElementById("driftFitWindow");
    if(!popup){
      popup=document.createElement("section"); popup.id="driftFitWindow";popup.className="drift-results-window";
      popup.setAttribute("role","dialog");popup.setAttribute("aria-modal","false");popup.setAttribute("aria-label","Drift fit results");
      popup.innerHTML='<header><span>Drift fit results — drag to move</span><button type="button" aria-label="Close drift fit results">×</button></header><iframe title="Drift fit results"></iframe>';
      document.body.appendChild(popup);
      popup.querySelector("button").addEventListener("click",()=>popup.querySelector("iframe").contentWindow.postMessage({type:"drift-results-reject"},window.location.origin));
      const header=popup.querySelector("header");
      header.addEventListener("pointerdown",event=>{
        if(event.target.closest("button"))return;
        const rect=popup.getBoundingClientRect(),dx=event.clientX-rect.left,dy=event.clientY-rect.top;
        header.setPointerCapture(event.pointerId);
        header.onpointermove=e=>{popup.style.left=Math.max(0,Math.min(window.innerWidth-120,e.clientX-dx))+"px";popup.style.top=Math.max(0,Math.min(window.innerHeight-40,e.clientY-dy))+"px"};
        header.onpointerup=header.onlostpointercapture=()=>{header.onpointermove=null};
      });
    }
    popup.querySelector("iframe").src="/drift-fits.html?"+params;
}

function initializeFileLoading() {
    const button = document.getElementById("loadFileButton");
    const input = document.getElementById("listmodeFile");
    const status = document.getElementById("status");
    const clearHighlight = () => button.classList.remove("file-drag-over");
    const hasFiles = event => Array.from(event.dataTransfer?.types || []).includes("Files");
    async function load(files) {
        if (!files?.length || button.disabled) return;
        files=Array.from(files);
        button.disabled = true;
        input.disabled = true;
        clearHighlight();
        try {
            if(files.length===1)await loadSelectedFile(files[0]);
            else await loadSelectedFiles(files);
        } catch (error) {
            status.textContent = "Could not load file: " + error.message;
            if(files.length>1)window.alert?.("Could not combine files: " + error.message);
        } finally {
            button.disabled = false;
            input.disabled = false;
            input.value = "";
        }
    }
    button.addEventListener("click", () => input.click());
    input.addEventListener("change", () => load(input.files));
    for (const name of ["dragenter", "dragover"]) {
        button.addEventListener(name, event => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = button.disabled ? "none" : "copy";
            if (!button.disabled) button.classList.add("file-drag-over");
        });
    }
    button.addEventListener("dragleave", clearHighlight);
    button.addEventListener("dragend", clearHighlight);
    button.addEventListener("drop", event => {
        event.preventDefault();
        clearHighlight();
        if (button.disabled) return;
        const files = event.dataTransfer?.files;
        if (!files?.length) return;
        return load(files);
    });
}

async function loadSelectedFiles(files) {
    if(files.length>100)throw new Error('Choose at most 100 files to combine.');
    if(files.some(file=>file.size>2*1024*1024*1024))throw new Error('Each selected file must be smaller than 2 GiB.');
    const task=async()=>{
        const sessionId=typeof workspaceSession!=='undefined'?workspaceSession.sessionId():'';
        const ids=[];
        for(const file of files) {
            await loadSelectedFileData(file);
            if(sessionId && workspaceSession.sessionId()!==sessionId)throw new Error('A new session was started. Select the files again.');
            ids.push(loadedFileStates[activeFileStateIndex].datasetId);
        }
        saveCurrentViewerState();
        const viewerSettings=loadedFileStates.find(state=>state.datasetId===ids[0])?.settings;
        const response=await fetch('/api/combine-files',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({datasetIds:ids,viewerSettings,sessionId})});
        const result=await response.json();
        if(!response.ok || !result.ok)throw new Error(result.error || 'Could not combine files.');
        if(sessionId && workspaceSession.sessionId()!==sessionId)throw new Error('A new session was started. Select the files again.');
        const ds=result.dataset;
        loadedFileStates.push({datasetId:ds.id,filename:ds.filename,displayName:ds.filename,kind:ds.kind,
            parentId:ds.parentId,sourceIds:ds.sourceIds,notes:ds.notes,settings:ds.viewerSettings,fits:[],roi:null,sweepRange:null});
        await restoreLoadedFileState(loadedFileStates.length-1);
    };
    if(typeof workspaceSession!=='undefined')await workspaceSession.localTask(task);
    else await task();
}

function scheduleWorkspaceSave() {
    if(typeof workspaceSession!=="undefined")workspaceSession.schedule();
}

async function loadSelectedFile(selectedFile) {
    if(typeof workspaceSession!=="undefined")return workspaceSession.localTask(()=>loadSelectedFileData(selectedFile));
    return loadSelectedFileData(selectedFile);
}
async function loadSelectedFileData(selectedFile) {
    const input = document.getElementById("listmodeFile");
    const status = document.getElementById("status");

    if (!(selectedFile instanceof File) && (!input.files || input.files.length === 0)) {
        status.textContent = "Please choose a listmode file first.";
        return;
    }

    const file = selectedFile instanceof File ? selectedFile : input.files[0];

    const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

    if (file.size > MAX_UPLOAD_BYTES) {
    status.textContent =
        "The selected listmode file is too large to load directly: " +
        file.name +
        " (" +
        formatFileSize(file.size) +
        "). Please use a smaller file for now. " +
        "A file-splitting tool will be added later.";

    document.getElementById("loadedFileName").textContent =
        "No listmode file loaded";

    input.value = "";
    return;
    }

    status.textContent = "Uploading " + file.name + "...";

    const buffer = await file.arrayBuffer();

    const response = await fetch("/api/listmode-file", {
        method: "POST",
        headers: {
        "Content-Type": "application/octet-stream",
        "X-Filename": file.name,
        ...(typeof workspaceSession!=="undefined"?{"X-Workspace-Session":workspaceSession.sessionId()}:{}),
        },
        body: buffer,
    });

    const payload = await response.json();

    if (!payload.ok) {
        throw new Error(payload.error || "Could not load file");
    }

    document.getElementById("loadedFileName").textContent =
    payload.filename;

    status.textContent =
        "Loaded " + payload.filename +
        " (" + payload.bytes.toLocaleString("en-US") + " bytes)";

    saveCurrentViewerState();

    activeFileStateIndex = loadedFileStates.length;

    loadedFileStates.push({
        datasetId: payload.datasetId,
        filename: payload.filename,
        displayName: payload.filename,
        kind: payload.datasets?.find(dataset=>dataset.id===payload.datasetId)?.kind || 'original',
        settings: null,
        sweepRange: null,
        roi: null,
    });        
    
    document.getElementById("channel").value = "";
    document.getElementById("edge").value = "";
    document.getElementById("tag").value = "";

    currentSweepRange = null;
    currentRoi = null;

    await loadMetadata();

    plottedTags.clear();
    lastSettingsKey = null;
//    resetVisibleTofRange();
    await loadAllHistograms();

    saveCurrentViewerState();
    renderLoadedFilesList();
}

async function loadMetadata() {
    if(typeof workspaceSession!=="undefined")return workspaceSession.localTask(loadMetadataData);
    return loadMetadataData();
}
async function loadMetadataData() {
    const channel = document.getElementById("channel")?.value ?? "";
    const edge = document.getElementById("edge")?.value ?? "";

    const response = await fetch(
    "/api/metadata?" +
    new URLSearchParams({
        channel,
        edge,
        datasetId: loadedFileStates[activeFileStateIndex]?.datasetId || "",
    }).toString()
    );
    const payload = await response.json();

    if (!payload.ok) {
        throw new Error(payload.error || "Could not load metadata");
    }

    const oldChannel = document.getElementById("channel").value;
    const oldEdge = document.getElementById("edge").value;
    const oldTag = document.getElementById("tag").value;

    populateSelect("channel", payload.observed.channels);
    populateSelect("edge", payload.observed.edges);
    populateSelect("tag", payload.observed.tags);

    chooseSelectValue("channel", oldChannel, 1);
    chooseSelectValue("edge", oldEdge, 1);
    chooseSelectValue("tag", oldTag, 3);
    const correctionSelect=document.getElementById('driftCorrectionTag');
    if(correctionSelect) {
        const previous=correctionSelect.value;
        populateSelect('driftCorrectionTag',payload.observed.tags);
        chooseSelectValue('driftCorrectionTag',previous,Number(document.getElementById('tag').value));
    }
}

function populateSelect(id, values) {
  const select = document.getElementById(id);

  select.innerHTML = "";

  for (const value of values) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = String(value);
    select.appendChild(option);
  }
}

function chooseSelectValue(id, preferredValue, fallbackValue) {
    const select = document.getElementById(id);

    const preferred = String(preferredValue);
    const fallback = String(fallbackValue);

    for (const option of select.options) {
        if (option.value === preferred) {
        select.value = preferred;
        return;
        }
    }

    for (const option of select.options) {
        if (option.value === fallback) {
        select.value = fallback;
        return;
        }
    }

    if (select.options.length > 0) {
        select.selectedIndex = 0;
    }
}

let histogramRefreshTimer;
let histogramRefreshPending = false;
let histogramMetadataPending = false;
let histogramRefreshRunning = false;
function scheduleHistogramRefresh(metadata = false, delay = 180) {
    clearTimeout(histogramRefreshTimer);
    if (!loadedFileStates[activeFileStateIndex]?.datasetId) return;
    histogramRefreshPending = true;
    histogramMetadataPending ||= metadata;
    histogramRefreshTimer = setTimeout(refreshHistogramControls, delay);
}
async function refreshHistogramControls() {
    if (histogramRefreshRunning || !histogramRefreshPending) return;
    const input = document.getElementById('binWidthNs');
    if (!input.checkValidity()) return;
    histogramRefreshPending = false;
    histogramRefreshRunning = true;
    const metadata = histogramMetadataPending;
    histogramMetadataPending = false;
    try {
        const refresh = async () => {
            if (metadata) await loadMetadataData();
            await loadAllHistogramsData();
        };
        if (typeof workspaceSession !== 'undefined') await workspaceSession.localTask(refresh);
        else await refresh();
    } catch (error) {
        document.getElementById('status').textContent = error.message;
    } finally {
        histogramRefreshRunning = false;
        if (histogramRefreshPending) histogramRefreshTimer = setTimeout(refreshHistogramControls, 0);
    }
}

async function loadAllHistograms() {
    if(typeof workspaceSession!=="undefined")return workspaceSession.localTask(loadAllHistogramsData);
    return loadAllHistogramsData();
}
async function loadAllHistogramsData() {
    if (currentSweepRange) {
        await loadAllHistogramsForSweepRange();
        return;
    }

    resetVisibleTofRange();
    plottedTags.clear();
    lastSettingsKey = makeSettingsKey();

    const tagSelect = document.getElementById("tag");
    const tags = [...tagSelect.options]
        .map(option => Number(option.value))
        .filter(tag => Number.isFinite(tag));

    const status = document.getElementById("status");

    if (tags.length === 0) {
        status.textContent = "No TAGs available for the selected channel/edge.";
        drawCombinedChart();
        return;
    }

    status.textContent = "Loading all TAG histograms...";

    for (const tag of tags) {
        await loadHistogramForTag(tag);
    }
    restoreVisibleTofRange();
    drawCombinedChart();
    updateStatus();
}

function makeSettingsKey() {
  return JSON.stringify({
    channel: document.getElementById("channel").value,
    edge: document.getElementById("edge").value,
    binWidth: document.getElementById("binWidth").value,
    tofLowUs: document.getElementById("tofLowUs").value,
    tofHighUs: document.getElementById("tofHighUs").value,
    yScale: document.getElementById("yScale").value,
    timeMode: document.getElementById("timeMode")?.value ?? "absolute",
  });
}

async function loadHistogramForTag(tag) {
    const params = new URLSearchParams();
    const datasetId=loadedFileStates[activeFileStateIndex]?.datasetId;
    if(datasetId)params.set("datasetId",datasetId);

    addParam(params, "channel");
    addParam(params, "edge");
    addParam(params, "binWidth");

    params.set("tag", tag);

    const tofLowUs = FULL_TOF_LOW_US;
    const tofHighUs = FULL_TOF_HIGH_US;
/*
    const tofLowUs = Number(document.getElementById("tofLowUs").value || 12);
    const tofHighUs = Number(document.getElementById("tofHighUs").value || 16);
*/
    params.set("tofLowUs", tofLowUs);
    params.set("tofHighUs", tofHighUs);

    const status = document.getElementById("status");

    status.textContent = "Loading TAG " + tag + "...";

    try {
        const response = await fetch("/api/histogram?" + params.toString());
        const payload = await response.json();

        if (!payload.ok) {
        throw new Error(payload.error || "Unknown server error");
        }

        drawRunInfo(payload);

        plottedTags.set(tag, payload);

    } catch (err) {
        status.textContent = "ERROR:\n" + err.stack;
    }
}

function addParam(params, id) {
  if (id === "binWidth" && !document.getElementById("binWidthNs").checkValidity()) {
    throw new Error("Bin width must be a positive multiple of 0.1 ns.");
  }
  const value = document.getElementById(id).value;

  if (value !== "") {
    params.set(id, value);
  }
}

function drawRunInfo(payload) {
    const runInfo = document.getElementById("runInfo");

    const header = payload.header;
    const tagCounts = payload.tagCounts || {};

    const totalSweeps = header.totalSweeps ?? 0;
    availableSweeps = totalSweeps;

    const sweepFirst = document.getElementById("sweepFirst");
    const sweepLast = document.getElementById("sweepLast");

    if (sweepFirst && sweepLast && !currentSweepRange) {
        sweepFirst.value = 0;
        sweepLast.value = totalSweeps;
    }

    const sweepRateHz = header.sweepRateHz ?? null;

    let durationText = "(unknown)";

    if (sweepRateHz && sweepRateHz > 0) {
        // The parser supplies the rate of recorded sweeps, including MP's
        // two sweeps per master cycle.
        durationText = formatDuration(totalSweeps / sweepRateHz);
    }

    const startText = header.startTime
        ? formatStartTime(header.startTime)
        : "(not parsed)";

    const observedTags = Object
    .keys(tagCounts)
    .map(Number)
    .sort((a, b) => a - b);

    const tag0 = observedTags[0] ?? null;
    const tag1 = observedTags[1] ?? null;

    const eject0 = tag0 !== null ? header.ejectNs?.[Math.abs(tag0) % 2] ?? null : null;
    const eject1 = tag1 !== null ? header.ejectNs?.[Math.abs(tag1) % 2] ?? null : null;

    const count0 = tag0 !== null ? tagCounts[tag0] ?? 0 : 0;
    const count1 = tag1 !== null ? tagCounts[tag1] ?? 0 : 0;

    runInfo.innerHTML = `
    <div><b>Start time:</b> ${escapeHtml(startText)}</div>
    <div><b>Duration:</b> ${formatNumber(totalSweeps)} sweeps (${durationText})</div>
    <div><b>First tag:</b> TAG ${formatTag(tag0)}, ejection time ${formatNumber(eject0)} ns, ${formatNumber(count0)} events</div>
    <div><b>Second tag:</b> TAG ${formatTag(tag1)}, ejection time ${formatNumber(eject1)} ns, ${formatNumber(count1)} events</div>
    `;
}

// Plot coordinates start at ejection in both relative and absolute modes.
// Preserve the requested span when navigation reaches the lower boundary.
function boundTofRange(min, max) {
    if (min < FULL_TOF_LOW_US) {
        max += FULL_TOF_LOW_US - min;
        min = FULL_TOF_LOW_US;
    }
    return {min, max};
}

function relativeTofRange() {
    return boundTofRange(
        Number(document.getElementById("tofLowUs").value),
        Number(document.getElementById("tofHighUs").value),
    );
}

// Width is derived from the viewport, including the compressed absolute axis.
function syncPlotWidth(range = visibleTofRange()) {
    const input = document.getElementById("plotWidthUs");
    if (input && validAxisRange(range)) input.value = (range.max - range.min).toFixed(4);
}

function applyPlotWidth() {
    const input = document.getElementById("plotWidthUs");
    const width = Number(input.value);
    if (!Number.isFinite(width) || width <= 0) {
        input.setCustomValidity("Enter a plot width greater than zero.");
        input.reportValidity();
        return;
    }
    input.setCustomValidity("");
    const range = visibleTofRange();
    const center = range.min + (range.max - range.min) / 2;
    applyVisibleTofRange(center - width / 2, center + width / 2);
    scheduleWorkspaceSave();
}

// One compressed numeric axis lets Plotly zoom and pan across either TAG.
function breakGapUs() { return FULL_TOF_HIGH_US * 0.065; }
function absoluteTimeMode() { return document.getElementById('timeMode')?.value === 'absolute'; }
function visibleTofRange() {
    const relative = relativeTofRange();
    if (!absoluteTimeMode() || !plottedTags.size) return relative;
    const state=loadedFileStates[activeFileStateIndex];
    const datasetId=state?.datasetId ?? null;
    // TAGs arrive separately: their temporary ejection-time list must not reset zoom.
    const key = JSON.stringify([datasetId,relative]);
    if (key !== absoluteViewKey) {
        const changedDataset=datasetId!==absoluteViewDatasetId;
        absoluteViewKey=key;
        absoluteViewRange=changedDataset && validAxisRange(state?.settings?.absoluteViewRange)
            ? {...state.settings.absoluteViewRange}:null;
        absoluteViewDatasetId=datasetId;
    }
    const range = absoluteViewRange || {min:relative.min,max:relative.max+(ejectionPanels()?FULL_TOF_HIGH_US+breakGapUs():0)};
    return boundTofRange(range.min, range.max);
}
function ejectionTimes() {
    return [...new Set([...plottedTags.values()].flatMap(p =>
        p.chartData.datasets.map(ds => Number(ds.ejectUs))).filter(Number.isFinite))].sort((a,b)=>a-b);
}
function plotOffset(eject) {
    const panels=ejectionPanels();
    return !absoluteTimeMode()?0:panels && eject===panels[1]
        ? FULL_TOF_HIGH_US+breakGapUs() : eject-(ejectionTimes()[0]||0);
}
function selectedRoiTag() {
    const value=document.getElementById('tag')?.value;
    return value!==undefined && value!=='' && Number.isFinite(Number(value)) ? Number(value) : undefined;
}
function roiPlotOffset() {
    const tag=currentRoi?.tag ?? selectedRoiTag();
    const eject=Number(plottedTags.get(tag)?.chartData.datasets[0]?.ejectUs);
    return Number.isFinite(eject)?plotOffset(eject):0;
}
function relativeAtPlotX(x) {
    if (!absoluteTimeMode()) return x;
    const times=ejectionTimes(), panels=ejectionPanels();
    if (!times.length) return x;
    if (panels && x>FULL_TOF_HIGH_US && x<FULL_TOF_HIGH_US+breakGapUs()) return NaN;
    const eject=panels && x>=FULL_TOF_HIGH_US+breakGapUs()?panels[1]:times[0];
    const tag=[...plottedTags].find(([,p])=>Number(p.chartData.datasets[0]?.ejectUs)===eject)?.[0];
    const selector=document.getElementById('tag');
    if (selector && tag!==undefined) selector.value=String(tag);
    return x-plotOffset(eject);
}
function plotToAbsoluteTof(x) {
    const panels=ejectionPanels();
    return panels && x>FULL_TOF_HIGH_US
        ? panels[1]+Math.max(0,x-FULL_TOF_HIGH_US-breakGapUs())
        : (ejectionTimes()[0]||0)+x;
}
function navigateTofReference(value, unit, previous) {
    if (!Number.isFinite(value) || value < 0 || !absoluteTimeMode()) return;
    const scale = unit === 'ns' ? 1000 : 1;
    const target = value / scale;
    const panels = ejectionPanels();
    // Convert the requested absolute time back into the compressed plot axis.
    // Times inside the omitted acquisition gap land on its nearest edge.
    let position = target - (ejectionTimes()[0] || 0);
    if (panels && target > panels[0] + FULL_TOF_HIGH_US) {
        position = target >= panels[1] ? FULL_TOF_HIGH_US + breakGapUs() + target - panels[1]
            : target - (panels[0] + FULL_TOF_HIGH_US) < panels[1] - target
                ? FULL_TOF_HIGH_US : FULL_TOF_HIGH_US + breakGapUs();
    }
    const range = visibleTofRange();
    const anchor = unit === 'µs' ? range.min : (range.min + range.max) / 2;
    // Preserve the displayed offsets, including rounding of the reference label.
    const shift = position - anchor + (plotToAbsoluteTof(anchor) - previous / scale);
    applyVisibleTofRange(range.min + shift, range.max + shift);
}
function absoluteAxisTicks(range) {
    const panels=ejectionPanels(), first=ejectionTimes()[0]||0;
    const hasBreak=!!(panels && range.min<FULL_TOF_HIGH_US+breakGapUs() && range.max>FULL_TOF_HIGH_US);
    const center=plotToAbsoluteTof(hasBreak?range.min:(range.min+range.max)/2);
    const reference=Math.round(center*10000)/10000;
    const scale=hasBreak?1:1000;
    const intervals=panels ? [[range.min,Math.min(range.max,FULL_TOF_HIGH_US),first],
        [Math.max(range.min,FULL_TOF_HIGH_US+breakGapUs()),range.max,panels[1]-FULL_TOF_HIGH_US-breakGapUs()]]
        : [[range.min,range.max,first]];
    const tickvals=[],ticktext=[];
    const raw=(range.max-range.min)*scale/8;
    const magnitude=10**Math.floor(Math.log10(raw));
    const step=[1,2,5,10].find(n=>n*magnitude>=raw)*magnitude;
    for(const [low,high,offset] of intervals) {
        if(high<=low)continue;
        const start=(low+offset-reference)*scale, end=(high+offset-reference)*scale;
        for(let value=Math.ceil(start/step)*step;value<=end+step*1e-8;value+=step){
            tickvals.push(reference+value/scale-offset);
            ticktext.push(displayNumber(Number(value.toFixed(6))));
        }
    }
    return {tickmode:'array',tickvals,ticktext,
        title:{text:`ToF - ${displayNumber(hasBreak?reference:reference*scale,{minimumFractionDigits:hasBreak?4:1,maximumFractionDigits:hasBreak?4:1})} [${hasBreak?'µs':'ns'}]`}};
}

function plotlyTrace(ds, name, color, isFit = false) {
    const tag = ds.TAGnum ?? Number(ds.label?.match(/^TAG (\d+)/)?.[1]);
    const eject = Number(ds.ejectUs ?? plottedTags.get(tag)?.chartData.datasets[0]?.ejectUs) || 0;
    return {
        xaxis: 'x',
        type: "scatter", mode: "lines", name,
        x: ds.data.map(p => p.x + plotOffset(eject)),
        y: ds.data.map(p => p.y),
        customdata: ds.data.map(p => [p.x, Number.isFinite(p.tofUs) ? p.tofUs : p.x + eject]),
        line: { color, width: isFit ? 2 : 1, shape: isFit ? "linear" : "hvh" },
        hovertemplate: "%{fullData.name}<br>Rel. ToF: %{customdata[0]:.6f} µs<br>Abs. ToF: %{customdata[1]:.6f} µs<br>Counts: %{y}<extra></extra>",
    };
}

function fitIonLabel(fit) {
    const formula = String(fit.formula ?? "").trim();
    if (!formula) return fit.chartDataset?.label || "Saved fit";
    const superscript = value => String(value).replace(/[0-9+\-]/g,
        char => ({ "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻" }[char]));
    const subscript = value => String(value).replace(/\d/g, char => "₀₁₂₃₄₅₆₇₈₉"[Number(char)]);
    const atoms = formula.split(";").map(part => part.trim().match(/^(\d+)?([A-Z][a-z]?)(\d+)$/));
    // Format only complete, valid formulas; preserve unrecognized notation.
    const ion = atoms.every(atom => atom && Number(atom[1] ?? 1) > 0 && Number(atom[3]) > 0)
        ? atoms.map(atom => `${superscript(atom[3])}${atom[2]}${Number(atom[1] ?? 1) === 1 ? "" : subscript(atom[1])}`).join("")
        : formula;
    const charge = Number(String(fit.charge ?? "").replace(/\+$/, ""));
    const suffix = Number.isInteger(charge) && charge !== 0
        ? superscript(`${Math.abs(charge) === 1 ? "" : Math.abs(charge)}${charge > 0 ? "+" : "-"}`)
        : "";
    return escapeHtml(ion + suffix);
}

// Paper coordinates keep the shading full-height on both linear and log axes.
function safeRegionShapes(low, high) {
    const fraction=value=>Math.max(0,Math.min(1,(value-low)/(high-low)));
    if(!Number.isFinite(low)||!Number.isFinite(high)||high<=low)return [];
    return [[0,fraction(safeRegion.low)],[fraction(safeRegion.high),1]].map(([x0,x1])=>({
        type:'rect',xref:'paper',yref:'paper',x0,x1,y0:0,y1:1,
        fillcolor:'rgba(128,128,128,0.5)',line:{width:0},layer:'above',
    }));
}

// The acquisition gap is omitted while retaining each TAG’s time offset.
function ejectionPanels() {
    if (!absoluteTimeMode()) return null;
    const times = ejectionTimes();
    return times.length === 2 && times[1] > times[0] + FULL_TOF_HIGH_US ? times : null;
}

function panelAxisAt(layout, pixelX) {
    return [layout.xaxis, layout.xaxis2].find(axis => axis &&
        pixelX >= axis._offset && pixelX <= axis._offset + axis._length);
}

function absoluteTicks(range, eject) {
    const step = (range.max-range.min)/4;
    const values = Array.from({length:5}, (_,i)=>range.min+i*step);
    return {tickmode:'array',tickvals:values,ticktext:values.map(v=>displayNumber(Number((v+eject).toFixed(6))))};
}

// Plotly autorange considers off-screen points, so derive Y limits from the
// visible portions of the plotted curves, including partial histogram steps.
function visibleYRange(traces, range, logarithmic) {
    let maximum=-Infinity;
    const include=value=>{
        if(!Number.isFinite(value) || (logarithmic && value<=0))return;
        maximum=Math.max(maximum,value);
    };
    for(const trace of traces) {
        if(trace.visible===false || trace.visible==='legendonly')continue;
        const xs=trace.x||[],ys=trace.y||[];
        for(let i=0;i<xs.length;i++){
            const x=xs[i],y=ys[i];
            if(!Number.isFinite(x)||!Number.isFinite(y))continue;
            if(x>=range.min && x<=range.max)include(y);
            if(i===0)continue;
            const previousX=xs[i-1],previousY=ys[i-1];
            if(!Number.isFinite(previousX)||!Number.isFinite(previousY)||x<=previousX||x<range.min||previousX>range.max)continue;
            if(trace.line?.shape==='hvh'){
                const middle=(previousX+x)/2;
                if(range.min<=middle && range.max>=previousX)include(previousY);
                if(range.max>=middle && range.min<=x)include(y);
            }else{
                for(const at of [Math.max(previousX,range.min),Math.min(x,range.max)]) {
                    include(previousY+(y-previousY)*(at-previousX)/(x-previousX));
                }
            }
        }
    }
    if(!Number.isFinite(maximum)||maximum<=0)return logarithmic?[Math.log10(0.8),1]:[0,1];
    return logarithmic?[Math.log10(0.8),Math.log10(Math.max(1,maximum*1.1))]:[0,maximum*1.1];
}

function rescaleVisibleY() {
    if(!chart?.data || !chart.layout?.xaxis?.range)return;
    const [min,max]=chart.layout.xaxis.range;
    const logarithmic=document.getElementById('yScale').value==='logarithmic';
    return Plotly.relayout(chart,{'yaxis.autorange':false,'yaxis.range':visibleYRange(chart.data,{min,max},logarithmic)});
}

function drawCombinedChart() {
    scheduleWorkspaceSave();
    updateDriftCorrectButton();
    const plot = document.getElementById("histogramChart");
    const traces = [];
    let colorIndex = 0;
    for (const [tag, payload] of plottedTags) {
        for (const ds of payload.chartData.datasets) {
            traces.push(plotlyTrace(ds, "TAG " + tag, plotColors[colorIndex++ % plotColors.length]));
        }
    }
    for (const state of [loadedFileStates[activeFileStateIndex]]) {
        for (const fit of state?.fits || []) {
            if (fit.chartDataset) {
                const ds = fit.chartDataset;
                traces.push(plotlyTrace(ds, fitIonLabel(fit), ds.borderColor || "#000000", true));
            }
        }
    }
    if (activeFitPreview) traces.push(plotlyTrace(activeFitPreview, activeFitPreview.label, "#000000", true));
    const range = visibleTofRange();
    syncPlotWidth(range);
    const panels = ejectionPanels();
    const absolute = absoluteTimeMode();
    const breakVisible = panels && range.min < FULL_TOF_HIGH_US+breakGapUs() && range.max > FULL_TOF_HIGH_US;
    const logarithmic = document.getElementById("yScale").value === "logarithmic";
    const plottedHistogram = plottedTags.values().next().value;
    // Use the plotted data's bin width, even if the input has unsubmitted edits.
    const rawBinWidth = Number(plottedHistogram?.histogram?.binWidth
        ?? plottedHistogram?.settings?.binWidth
        ?? document.getElementById("binWidth").value);
    const countsLabel = `Counts / ${rawBinWidth / 10} ns`; // Each raw bin is 100 ps.
    const shapes = [];
    const offsets=absolute ? ejectionTimes().map(plotOffset) : [0];
    for(const offset of offsets) {
        // Shade each TAG's unsafe intervals in the shared plot coordinate system.
        for(const [low,high] of [[0,safeRegion.low],[safeRegion.high,FULL_TOF_HIGH_US]]) {
            shapes.push({type:'rect',xref:'x',yref:'paper',x0:offset+low,x1:offset+high,y0:0,y1:1,
                fillcolor:'rgba(128,128,128,0.5)',line:{width:0},layer:'above'});
        }
    }
    if(roiIsReadyForFit()) {
        const offset=roiPlotOffset();
        shapes.push({type:'rect',xref:'x',yref:'paper',
            x0:offset+currentRoi.lowUs,x1:offset+currentRoi.highUs,y0:0,y1:1,
            fillcolor:'rgba(255,200,0,0.20)',line:{color:'rgba(180,120,0,0.8)',width:1},layer:'below'});
    }
    if(breakVisible)shapes.push({type:'rect',xref:'x',yref:'paper',
        x0:FULL_TOF_HIGH_US,x1:FULL_TOF_HIGH_US+breakGapUs(),y0:0,y1:1,
        fillcolor:'rgba(220,38,38,0.18)',line:{width:0},layer:'below'});
    // Keep legend-hidden traces hidden while recomputing the viewport.
    for(const trace of traces){
        const previous=plot.data?.find(item=>item.name===trace.name);
        if(previous?.visible!==undefined)trace.visible=previous.visible;
    }
    const yRange=visibleYRange(traces,range,logarithmic);
    const firstRender = !chart;
    chart = plot;
    chartViewContext={datasetId:loadedFileStates[activeFileStateIndex]?.datasetId,
        mode:document.getElementById('timeMode')?.value ?? 'absolute',
        relativeKey:JSON.stringify(relativeTofRange())};
    Plotly.react(plot, absolute ? traces.filter(trace => trace.x.length &&
        trace.x[0] <= range.max && trace.x[trace.x.length-1] >= range.min) : traces, {
        separators: typeof NumberDisplay!=='undefined'?NumberDisplay.separators:'.,',
        margin: { l: 75, r: 25, t: 40, b: 65 },
        xaxis: {tickformat:',~f',separatethousands:true,exponentformat:'none',title:{text:absolute?'Absolute ToF [µs]':'ToF after TAG ejection [µs]'},
            domain:[0,1],autorange:false,minallowed:FULL_TOF_LOW_US,range:[range.min,range.max],...(absolute?absoluteAxisTicks(range):{})},
        annotations:breakVisible?[{xref:'x',yref:'paper',x:FULL_TOF_HIGH_US+breakGapUs()/2,y:0.5,
            showarrow:false,text:'Time break',textangle:-90,xanchor:'center',yanchor:'middle',
            font:{size:11,color:'#b91c1c'}}]:[],
        yaxis: { title: { text: countsLabel }, type: logarithmic ? "log" : "linear", autorange:false,range:yRange, fixedrange: true },
        dragmode: "zoom", hovermode: "closest", shapes,
        showlegend: true,
        legend: { orientation: "h", y: 1.12 },
    }, { responsive: true, displaylogo: false, scrollZoom: false, showLink: false,
         modeBarButtonsToRemove: ["sendChartToCloud", "select2d", "lasso2d", "autoScale2d", "resetScale2d"]
    }).then(() => {
        if (typeof TofAxisEditor !== 'undefined') TofAxisEditor.attach(plot, navigateTofReference);
        if (firstRender) {
            plot.on("plotly_legendclick",()=>{setTimeout(()=>{rescaleVisibleY();if(typeof syncDistroWindow==='function')syncDistroWindow();},0)});
            plot.on("plotly_legenddoubleclick",()=>{setTimeout(()=>{rescaleVisibleY();if(typeof syncDistroWindow==='function')syncDistroWindow();},0)});
            plot.on("plotly_relayout", event => {
                const axisName = event["xaxis2.range"] || event["xaxis2.range[0]"] !== undefined ? "xaxis2" : "xaxis";
                const bounds = event[axisName+".range"];
                const low = bounds ? bounds[0] : event[axisName+".range[0]"];
                const high = bounds ? bounds[1] : event[axisName+".range[1]"];
                if (Number.isFinite(low) && Number.isFinite(high)) {
                    const range = boundTofRange(low, high);
                    if(absoluteTimeMode()) {
                        absoluteViewRange=range;
                        drawCombinedChart();
                        return;
                    }
                    document.getElementById("tofLowUs").value = String(range.min);
                    document.getElementById("tofHighUs").value = String(range.max);
                    drawCombinedChart();
                    syncDriftWindow();
                    scheduleWorkspaceSave();
                }
            });
            plot.on("plotly_doubleclick", () => {
                applyVisibleTofRange(FULL_TOF_LOW_US, FULL_TOF_HIGH_US+(ejectionPanels()?FULL_TOF_HIGH_US+breakGapUs():0));
                return false;
            });
        }
        syncDriftWindow();
    }).catch(error => { document.getElementById("status").textContent = error.message; });
    updateStatus();
}

function updateStatus() {
    const status = document.getElementById("status");

    if (plottedTags.size === 0) {
        status.textContent = "No TAGs plotted.";
        return;
    }

    const lines = [...plottedTags.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([tag, payload]) => {
        const h = payload.histogram;

        return (
            "TAG " + tag +
            ": Accepted events: " + h.acceptedEvents +
            " | Bins: " + h.nBins
        );
        });

        if (currentSweepRange) {
            lines.push(
                "Sweeps: " +
                currentSweepRange.sweepLow +
                " → " +
                currentSweepRange.sweepHigh
            );
        }

        if (
            currentRoi &&
            currentRoi.lowUs !== undefined &&
            currentRoi.highUs !== undefined
        ) {
            lines.push(
                "ROI: " +
                currentRoi.lowUs.toFixed(3) +
                " µs  →  " +
                currentRoi.highUs.toFixed(3) +
                " µs"
            );
        }

        status.textContent = lines.join("\n");
}

function formatStartTime(isoString) {
  const d = new Date(isoString);

  return d.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function formatTag(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "(not found)";
  }

  return String(value);
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) {
    return "(unknown)";
  }

  if (seconds < 60) {
    return seconds.toFixed(1) + " s";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return (
      minutes +
      " min " +
      remainingSeconds.toFixed(1) +
      " s"
    );
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  return (
    hours +
    " h " +
    remainingMinutes +
    " min"
  );
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "(not found)";
  }

  return displayNumber(value,{maximumFractionDigits:3});
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) {
    return "(unknown size)";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }

  return value.toFixed(unit === 0 ? 0 : 2) + " " + units[unit];
}

function escapeHtml(s) {
return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function initializeCursorCopy(plot) {
    let cursor = null;
    const clear = () => { cursor = null; };
    plot.addEventListener("pointermove", event => {
        cursor = {x: event.clientX, y: event.clientY};
    }, true);
    plot.addEventListener("pointerleave", clear);
    window.addEventListener("blur", clear);
    window.addEventListener("scroll", clear, true);
    document.addEventListener("keydown", async event => {
        if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== "c" || !cursor) return;
        if (event.target?.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')) return;
        const layout = plot._fullLayout;
        if (!layout || !plottedTags.size) return;
        const rect = plot.getBoundingClientRect();
        const axis = panelAxisAt(layout, cursor.x - rect.left);
        const y = cursor.y - rect.top - layout.yaxis._offset;
        if (!axis || y < 0 || y > layout.yaxis._length) return;
        const x = axis.p2d(cursor.x - rect.left - axis._offset);
        const panels = ejectionPanels();
        if (!Number.isFinite(x) || panels && x > FULL_TOF_HIGH_US && x < FULL_TOF_HIGH_US + breakGapUs()) return;
        // Relative traces overlap; use the selected TAG's ejection reference.
        const eject = Number(plottedTags.get(selectedRoiTag())?.chartData.datasets[0]?.ejectUs);
        const absoluteUs = absoluteTimeMode() ? plotToAbsoluteTof(x)
            : x + (Number.isFinite(eject) ? eject : ejectionTimes()[0]);
        if (!Number.isFinite(absoluteUs)) return;
        event.preventDefault();
        try {
            await navigator.clipboard.writeText(String(Number((absoluteUs * 1000).toFixed(4))));
        } catch (error) {
            document.getElementById("status").textContent = "Could not copy cursor ToF: " + error.message;
        }
    });
}

function initializeRoiDrag(plot) {
    let drag = null;
    const stop = event => {
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    const pixelAt = event => Math.max(0, Math.min(drag.axis._length,
        event.clientX - drag.left));
    const finish = (event, commit) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        stop(event);
        const end = pixelAt(event);
        const previous = drag;
        drag = null;
        previous.preview.remove();
        if (plot.hasPointerCapture(previous.pointerId)) plot.releasePointerCapture(previous.pointerId);
        if (commit && Math.abs(end - previous.start) >= 3) {
            const plotBounds = [previous.axis.p2d(previous.start),previous.axis.p2d(end)].sort((a,b)=>a-b);
            // A fit ROI must belong to one TAG, never span the omitted interval.
            if(ejectionPanels() && plotBounds[0] < FULL_TOF_HIGH_US+breakGapUs() && plotBounds[1] > FULL_TOF_HIGH_US) return;
            const bounds = plotBounds.map(relativeAtPlotX).sort((a, b) => a - b);
            if (bounds.every(Number.isFinite)) {
                currentRoi = { lowUs: bounds[0], highUs: bounds[1], tag: selectedRoiTag() };
                const state = loadedFileStates[activeFileStateIndex];
                if (state) state.roi = { ...currentRoi };
                drawCombinedChart();
            }
        }
    };
    plot.addEventListener("pointerdown", event => {
        if (drag || !event.ctrlKey || event.button !== 0 || !chart?._fullLayout) return;
        const { yaxis } = chart._fullLayout;
        const rect = plot.getBoundingClientRect();
        const xaxis = panelAxisAt(chart._fullLayout, event.clientX-rect.left);
        if (!xaxis) return;
        const x = event.clientX - rect.left - xaxis._offset;
        const y = event.clientY - rect.top - yaxis._offset;
        if (x < 0 || x > xaxis._length || y < 0 || y > yaxis._length) return;
        stop(event);
        hideChartContextMenu();
        const preview = document.createElement("div");
        preview.className = "roi-drag-preview";
        Object.assign(preview.style, { left: `${xaxis._offset + x}px`, top: `${yaxis._offset}px`, height: `${yaxis._length}px`, width: "0px" });
        plot.appendChild(preview);
        drag = { pointerId: event.pointerId, axis: xaxis, left: rect.left + xaxis._offset, start: x, preview };
        plot.setPointerCapture(event.pointerId);
    }, true);
    // Prevent Plotly's mouse handlers from also starting a zoom/pan.
    plot.addEventListener("mousedown", event => { if (drag) stop(event); }, true);
    plot.addEventListener("pointermove", event => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        stop(event);
        const end = pixelAt(event);
        drag.preview.style.left = `${drag.axis._offset + Math.min(drag.start, end)}px`;
        drag.preview.style.width = `${Math.abs(end - drag.start)}px`;
    }, true);
    plot.addEventListener("pointerup", event => finish(event, true), true);
    plot.addEventListener("pointercancel", event => finish(event, false), true);
    plot.addEventListener("lostpointercapture", event => finish(event, false), true);
}

function showChartContextMenu(event) {
    event.preventDefault();
    // macOS treats Control-click as a context-menu gesture.
    if (event.ctrlKey) return;

    if (!chart) {
        return;
    }

    const rect = chart.getBoundingClientRect();
    const layout = chart._fullLayout;
    if (!layout) return;
    const axis = panelAxisAt(layout, event.clientX-rect.left);
    if (!axis) return;
    const pixelX = event.clientX - rect.left - axis._offset;
    const pixelY = event.clientY - rect.top - layout.margin.t;
    if (pixelX < 0 || pixelX > axis._length || pixelY < 0 || pixelY > layout.yaxis._length) return;
    // Plotly's axis conversion uses pixels relative to the plotting area.
    lastRightClickXValue = relativeAtPlotX(axis.p2d(pixelX));
    if (!Number.isFinite(lastRightClickXValue)) return;

    let menu = document.getElementById("chartContextMenu");

    if (!menu) {
        menu = document.createElement("div");

        menu.id = "chartContextMenu";
        menu.className = "chart-context-menu";

        menu.addEventListener(
            "click",
            handleChartContextMenuClick
        );

        document.body.appendChild(menu);
    }

    menu.innerHTML = `
        <div data-action="roi-clear">Clear ROI</div>
        <div data-action="zoom-out">Zoom out</div>
        ${
            roiIsReadyForFit()
                ? '<div data-action="fit-roi">Fit ROI</div>'
                : ''
        }
        ${
            (loadedFileStates[activeFileStateIndex]?.kind === 'energy-correlated' || loadedFileStates[activeFileStateIndex]?.correlationEnergySources?.length)
                ? '<div data-action="correlation-time" role="menuitem"'+(roiIsReadyForFit() && currentRoi.highUs>currentRoi.lowUs?'':' aria-disabled="true" title="Select a complete ToF ROI first."')+'>Correlation time</div>'
                : ''
        }
    `;


    // ---------------------------------------------------------------------
    // Position and display menu
    // ---------------------------------------------------------------------

    menu.style.left = event.pageX + "px";
    menu.style.top = event.pageY + "px";
    menu.style.display = "block";
}

function hideChartContextMenu() {
    const spectrumMenu=document.getElementById('spectrumContextMenu');
    if(spectrumMenu)spectrumMenu.style.display='none';
    const menu = document.getElementById("chartContextMenu");

    if (menu) {
        menu.style.display = "none";
    }

    const fitMenu = document.getElementById("fitResultContextMenu");

    if (fitMenu) {
        fitMenu.style.display = "none";
    }
}

function handleChartContextMenuClick(event) {
    const action = event.target.dataset.action;

    if (!action || event.target.getAttribute?.('aria-disabled') === 'true') {
        return;
    }

    if(action==='correlation-time'){
        showCorrelationTime();hideChartContextMenu();return;
    }

    if (action === "zoom-out") {
        zoomOutByHalfRange();
    }

    if (action === "roi-clear") {
        currentRoi = null;
    }

    if (action === "fit-roi") {
        openFitModal();
    }

    hideChartContextMenu();
    drawCombinedChart();
}

async function loadAllHistogramsForSweepRange() {
    if(typeof workspaceSession!=="undefined")return workspaceSession.localTask(loadAllHistogramsForSweepRangeData);
    return loadAllHistogramsForSweepRangeData();
}
async function loadAllHistogramsForSweepRangeData() {
    const status = document.getElementById("status");

    const sweepLowText = document.getElementById("sweepFirst").value;
    const sweepHighText = document.getElementById("sweepLast").value;

    if (sweepLowText === "" || sweepHighText === "") {
        currentSweepRange = null;
        await loadAllHistograms();
        return;
    }
    
    resetVisibleTofRange();

    const sweepLow = Number(document.getElementById("sweepFirst").value);
    const sweepHigh = Number(document.getElementById("sweepLast").value);

    if (!Number.isInteger(sweepLow) || !Number.isInteger(sweepHigh)) {
        status.textContent = "ERROR: Sweep First and Last must be integer values.";
        return;
    }

    if (sweepLow < 0) {
        status.textContent = "ERROR: First sweep must be >= 0.";
        return;
    }

    if (sweepHigh <= sweepLow) {
        status.textContent = "ERROR: Last sweep must be greater than First sweep.";
        return;
    }

    if (availableSweeps !== null && sweepHigh > availableSweeps) {
        status.textContent =
        "ERROR: Last sweep exceeds available sweeps. " +
        "Maximum allowed is " + availableSweeps + ".";
        return;
    }

    currentSweepRange = {
        sweepLow,
        sweepHigh,
    };

    plottedTags.clear();
    lastSettingsKey = makeSettingsKey();

    const tagSelect = document.getElementById("tag");
    const tags = [...tagSelect.options].map(option => Number(option.value));

    if (tags.length === 0) {
        status.textContent = "No TAGs available for the selected channel/edge.";
        drawCombinedChart();
        return;
    }

    status.textContent =
        "Loading sweep range " + sweepLow + " to " + sweepHigh + "...";

    for (const tag of tags) {
        await loadHistogramForTagAndSweepRange(tag, sweepLow, sweepHigh);
    }

    restoreVisibleTofRange();
    drawCombinedChart();
    updateStatus();
}

async function loadHistogramForTagAndSweepRange(tag, sweepLow, sweepHigh) {
    const params = new URLSearchParams();
    const datasetId=loadedFileStates[activeFileStateIndex]?.datasetId;
    if(datasetId)params.set("datasetId",datasetId);

    addParam(params, "channel");
    addParam(params, "edge");
    addParam(params, "binWidth");

    params.set("tag", tag);
    params.set("sweepLow", sweepLow);
    params.set("sweepHigh", sweepHigh);

    const tofLowUs = FULL_TOF_LOW_US;
    const tofHighUs = FULL_TOF_HIGH_US;
/*
    const tofLowUs = Number(document.getElementById("tofLowUs").value || 12);
    const tofHighUs = Number(document.getElementById("tofHighUs").value || 16);
*/
    params.set("tofLowUs", tofLowUs);
    params.set("tofHighUs", tofHighUs);

    const response = await fetch("/api/histogram-sweeps?" + params.toString());
    const payload = await response.json();

    if (!payload.ok) {
        throw new Error(payload.error || "Unknown server error");
    }

    drawRunInfo(payload);

    plottedTags.set(tag, payload);
}

/* Below here are utility functions for managing viewer settings */
function collectViewerSettings() {
    const settings = {
        channel: document.getElementById("channel").value,
        edge: document.getElementById("edge").value,
        tag: document.getElementById("driftCorrectionTag")?.value || document.getElementById("tag").value,
        binWidth: document.getElementById("binWidth").value,
        tofLowUs: document.getElementById("tofLowUs").value,
        tofHighUs: document.getElementById("tofHighUs").value,
        yScale: document.getElementById("yScale").value,
        timeMode: document.getElementById("timeMode")?.value ?? "absolute",
        absoluteViewRange: absoluteViewDatasetId===loadedFileStates[activeFileStateIndex]?.datasetId
            ? absoluteViewKey===JSON.stringify([absoluteViewDatasetId,relativeTofRange()]) && validAxisRange(absoluteViewRange)?{...absoluteViewRange}:null
            : loadedFileStates[activeFileStateIndex]?.settings?.absoluteViewRange ?? null,
        sliceInput: document.getElementById("sliceInput")?.value ?? "5000",
        debounceMinNs: document.getElementById('debounceMinNs')?.value ?? '20',
        debounceMaxNs: document.getElementById('debounceMaxNs')?.value ?? '1000',
    };
    // Plotly's modebar and drag gestures can change the viewport independently
    // of the input fields. Save that viewport, only for the spectrum it belongs to.
    const bounds=chart?.layout?.xaxis?.range;
    const displayed=bounds && {min:bounds[0],max:bounds[1]};
    if(chartViewContext?.datasetId===loadedFileStates[activeFileStateIndex]?.datasetId &&
        chartViewContext?.mode===settings.timeMode &&
        chartViewContext?.relativeKey===JSON.stringify(relativeTofRange()) && validAxisRange(displayed)) {
        if(settings.timeMode==='absolute')settings.absoluteViewRange={...displayed};
        else {
            settings.tofLowUs=String(displayed.min);
            settings.tofHighUs=String(displayed.max);
        }
    }
    return settings;
}

function applyViewerSettings(settings) {
    chartViewContext=null;
    if (!settings) {
        return;
    }

    setValueIfPresent("channel", settings.channel);
    setValueIfPresent("edge", settings.edge);
    setValueIfPresent("tag", settings.tag);
    setValueIfPresent("binWidth", settings.binWidth);
    setValueIfPresent("tofLowUs", settings.tofLowUs);
    setValueIfPresent("tofHighUs", settings.tofHighUs);
    setValueIfPresent("yScale", settings.yScale);
    setValueIfPresent("timeMode", settings.timeMode ?? "absolute");
    setValueIfPresent("sliceInput", settings.sliceInput);
    setValueIfPresent('debounceMinNs', settings.debounceMinNs ?? '20');
    setValueIfPresent('debounceMaxNs', settings.debounceMaxNs ?? '1000');
    setValueIfPresent("driftCorrectionTag", settings.driftCorrectionTag ?? settings.tag);
    absoluteViewDatasetId=loadedFileStates[activeFileStateIndex]?.datasetId ?? null;
    absoluteViewKey=JSON.stringify([absoluteViewDatasetId,relativeTofRange()]);
    absoluteViewRange=validAxisRange(settings.absoluteViewRange)?{...settings.absoluteViewRange}:null;
    syncPlotWidth();
}

function setValueIfPresent(id, value) {
    const el = document.getElementById(id);

    if (!el || value === undefined || value === null) {
        return;
    }

    el.value = value;
    if (id === "binWidth") document.getElementById("binWidthNs").value = Number(value) / 10;
}

function saveCurrentViewerState() {
    if (activeFileStateIndex < 0) {
        return;
    }

    const state = loadedFileStates[activeFileStateIndex];

    state.settings = collectViewerSettings();
    state.sweepRange = currentSweepRange ? { ...currentSweepRange } : null;
    state.roi = currentRoi ? { ...currentRoi } : null;
}

function renderLoadedFilesList() {
    scheduleWorkspaceSave();
    const tbody = document.getElementById("loadedFilesTableBody");

    if (!tbody) {
        return;
    }

    tbody.innerHTML = "";

    loadedFileStates.forEach((state, index) => {
        const fits = state.fits && state.fits.length > 0
            ? state.fits
            : [null];

        fits.forEach((fit, fitIndex) => {
            const tr = document.createElement("tr");

            tr.dataset.datasetIndex = index;
            tr.dataset.fitIndex = fitIndex;

            if (index === activeFileStateIndex) {
                tr.classList.add("activeDatasetRow");
            }

            if (fitIndex === 0) {
                const fileTd = document.createElement("td");

                fileTd.rowSpan = fits.length;
                fileTd.title = state.notes || state.displayName;
                fileTd.className = "datasetFileCell";
                fileTd.textContent =
                    (index === activeFileStateIndex ? "▶ " : "") +
                    state.displayName;
                if (state.datasetId === loadingSpectrumId) {
                    fileTd.classList.add('spectrumLoading');
                    fileTd.setAttribute('aria-busy', 'true');
                    const progress = document.createElement('span');
                    progress.className = 'spectrumLoadingProgress';
                    progress.setAttribute('role', 'progressbar');
                    progress.setAttribute('aria-label', 'Loading spectrum: ' + state.displayName);
                    fileTd.appendChild(progress);
                    const label = document.createElement('span');
                    label.className = 'spectrumLoadingLabel';
                    label.setAttribute('role', 'status');
                    label.textContent = ' — Loading…';
                    fileTd.appendChild(label);
                }

                tr.appendChild(fileTd);
            }

            tr.appendChild(makeTableCell(fit?.formula ?? "—"));
            tr.appendChild(makeTableCell(fit?.charge ?? "—"));
            tr.appendChild(makeTableCell(fit?.laps ?? "—"));
            tr.appendChild(makeTableCell(fit?.mass ?? "—"));
            tr.appendChild(makeTableCell(fitTimeNanoseconds(fit?.tof)));
            tr.appendChild(makeTableCell(fitTimeNanoseconds(fit?.dtof)));
            tr.appendChild(makeTableCell(fitTimeNanoseconds(fitResultFwhmUs(fit), 2)));
            tr.appendChild(makeTableCell(fit?.counts ?? "—"));

            tr.addEventListener('contextmenu',event=>showSpectrumContextMenu(event,state.datasetId,fit?.id));

            tbody.appendChild(tr);
        });
    });
}

async function saveSpectrumAsFile(state) {
    const url='/api/listmode-datasets/'+encodeURIComponent(state.datasetId);
    try {
        if(typeof window.showSaveFilePicker==='function') {
            const handle=await window.showSaveFilePicker({suggestedName:listmodeFilename(state.displayName || state.filename),
                types:[{description:'Listmode file',accept:{'text/plain':['.lst']}}]});
            const response=await fetch(url+'/file');
            if(!response.ok){const result=await response.json();throw new Error(result.error || 'Could not export spectrum.');}
            const data=await response.blob();
            const writable=await handle.createWritable();
            try {await writable.write(data);await writable.close();}
            catch(error){await writable.abort();throw error;}
        } else {
            const response=await fetch(url+'/save',{method:'POST'});
            const result=await response.json();
            if(!response.ok || !result.ok)throw new Error(result.error || 'Could not save spectrum.');
        }
    } catch(error){if(error.name!=='AbortError')throw error;}
}

function showSpectrumContextMenu(event,datasetId,fitId) {
    event.preventDefault();event.stopPropagation();hideChartContextMenu();
    let menu=document.getElementById('spectrumContextMenu');
    if(!menu){menu=document.createElement('div');menu.id='spectrumContextMenu';menu.className='chart-context-menu spectrum-context-menu';menu.setAttribute('role','menu');document.body.appendChild(menu);}
    menu.replaceChildren();
    const add=(label,action,disabled=false,title='')=>{
        const button=document.createElement('button');button.type='button';button.textContent=label;button.setAttribute('role','menuitem');button.disabled=disabled;
        button.title=title;
        button.addEventListener('click',async()=>{
            menu.style.display='none';
            try{await action();}catch(error){document.getElementById('workspaceStatus').textContent=error.message;}
        });menu.appendChild(button);
    };
    if(fitId && !event.target.closest('.datasetFileCell'))add('Delete fit',()=>{
        const state=loadedFileStates.find(state=>state.datasetId===datasetId);
        if(state)state.fits=state.fits.filter(fit=>fit.id!==fitId);
        renderLoadedFilesList();drawCombinedChart();
    });
    const state=loadedFileStates.find(state=>state.datasetId===datasetId);
    if(state && datasetId!==loadedFileStates[activeFileStateIndex]?.datasetId) {
        add('Display spectrum',()=>restoreLoadedFileState(loadedFileStates.indexOf(state)),loadingSpectrumId!==null);
    }
    if(state && ['debounced','drift-corrected','combined','energy-correlated'].includes(state.kind))add('Save as File',()=>saveSpectrumAsFile(state));
    add('Remove spectrum',()=>workspaceSession.removeSpectrum(datasetId),!!state?.removalBlockedReason,state?.removalBlockedReason || '');
    const blockedOther=loadedFileStates.find(state=>state.datasetId!==datasetId && state.removalBlockedReason);
    add('Remove all other spectra',()=>workspaceSession.removeSpectrum(datasetId,true),loadedFileStates.length<2 || !!blockedOther,blockedOther?.removalBlockedReason || '');
    menu.style.display='block';
    const rect=menu.getBoundingClientRect();
    menu.style.left=Math.max(0,Math.min(event.pageX,window.scrollX+window.innerWidth-rect.width-8))+'px';
    menu.style.top=Math.max(0,Math.min(event.pageY,window.scrollY+window.innerHeight-rect.height-8))+'px';
    menu.querySelector('button')?.focus();
}

document.addEventListener('keydown',event=>{if(event.key==='Escape')hideChartContextMenu();});
window.addEventListener('blur',hideChartContextMenu);
window.addEventListener('scroll',hideChartContextMenu);

function fitResultFwhmUs(fit) {
    const result = fit?.fitResult;
    // Older saved hybrid results contain core FWHM. Recompute from their
    // fitted parameters so the results table uses the full peak width too.
    if (typeof FitModels !== "undefined" && result && Object.hasOwn(FitModels.models, result.model)) {
        const p = Object.fromEntries(Object.entries(result.params || {}).map(([key, parameter]) => [key, parameter?.value]));
        const required = result.model === "gaussianConstant" ? ["sigma"] : result.model === "exponentialGaussianHybrid" ? ["sigma", "decay"] : ["sigma", "leftSwitching", "rightSwitching"];
        if (required.every(key => Number.isFinite(p[key])) && p.sigma > 0 &&
            (result.model !== "dualExpGaussian" || (p.leftSwitching > 0 && p.rightSwitching > 0))) {
            return FitModels.fullWidthHalfMaximum(result.model, p);
        }
    }
    return fit?.fwhm;
}

function showFitResultContextMenu(event) {
    event.preventDefault();

    const row = event.currentTarget;

    const datasetIndex = Number(row.dataset.datasetIndex);
    const fitIndex = Number(row.dataset.fitIndex);

    let menu = document.getElementById("fitResultContextMenu");

    if (!menu) {
        menu = document.createElement("div");
        menu.id = "fitResultContextMenu";
        menu.className = "chart-context-menu";
        document.body.appendChild(menu);
    }

    menu.innerHTML = `
        <div data-action="delete-fit">Delete fit</div>
    `;

    menu.onclick = () => {
        loadedFileStates[datasetIndex].fits.splice(fitIndex, 1);

        renderLoadedFilesList();
        drawCombinedChart();

        menu.style.display = "none";
    };

    menu.style.left = event.pageX + "px";
    menu.style.top = event.pageY + "px";
    menu.style.display = "block";
}

function fitTimeNanoseconds(valueUs, decimalPlaces) {
    if (valueUs === undefined || valueUs === null || valueUs === "") return "—";
    const ns = Number(valueUs) * 1000;
    // Suppress floating-point conversion artifacts while retaining fit precision.
    return Number.isFinite(ns) ? decimalPlaces === undefined
        ? String(Number(ns.toPrecision(12))) : ns.toFixed(decimalPlaces) : "—";
}

function makeTableCell(value) {
    const td = document.createElement("td");
    td.textContent = String(value);
    return td;
}

async function restoreLoadedFileState(index) {
    if(loadingSpectrumId!==null || !loadedFileStates[index])return;
    const load=async()=>{
        loadingSpectrumId=loadedFileStates[index].datasetId;
        renderLoadedFilesList();
        try {
            await restoreLoadedFileStateData(index);
        } finally {
            loadingSpectrumId=null;
            renderLoadedFilesList();
        }
    };
    if(typeof workspaceSession!=="undefined")return workspaceSession.localTask(load);
    return load();
}
async function restoreLoadedFileStateData(index) {
    if (index < 0 || index >= loadedFileStates.length) {
        return;
    }

    saveCurrentViewerState();

    const state = loadedFileStates[index];

    const response = await fetch("/api/listmode-datasets/select", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            datasetId: state.datasetId,
        }),
    });

    const payload = await response.json();

    if (!payload.ok) {
        throw new Error(payload.error || "Could not select dataset");
    }

    activeFileStateIndex = index;
    activeFitPreview = null;

    document.getElementById("loadedFileName").textContent = state.displayName;

    await loadMetadata();
    applyViewerSettings(state.settings);
    await loadMetadata();
    setValueIfPresent("tag", state.settings?.tag);

    currentSweepRange = state.sweepRange ? { ...state.sweepRange } : null;
    currentRoi = state.roi ? { ...state.roi } : null;

    if (currentSweepRange) {
        document.getElementById("sweepFirst").value = currentSweepRange.sweepLow;
        document.getElementById("sweepLast").value = currentSweepRange.sweepHigh;
        await loadAllHistogramsForSweepRange();
    } else {
        document.getElementById("sweepFirst").value = "";
        document.getElementById("sweepLast").value = "";
        await loadAllHistograms();
    }

    renderLoadedFilesList();
}

function roiIsReadyForFit() {
    return (
        currentRoi &&
        currentRoi.lowUs !== undefined &&
        currentRoi.highUs !== undefined
    );
}

function initializeBinWidthEditor() {
    const input = document.getElementById("binWidthNs");
    const rawInput = document.getElementById("binWidth");
    const toggle = document.getElementById("binWidthToggle");
    const options = document.getElementById("binWidthOptions");
    const close = () => {
        options.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
    };
    input.required = true;
    input.addEventListener("input", () => {
        rawInput.value = String(Math.round(Number(input.value) * 10));
        scheduleHistogramRefresh();
    });
    input.addEventListener("change", () => scheduleHistogramRefresh(false, 0));
    for (let n = 0; n <= 10; n++) {
        const value = 2 ** n;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `${value} ns`;
        button.addEventListener("click", () => {
            input.value = value;
            rawInput.value = value * 10;
            scheduleHistogramRefresh(false, 0);
            close();
            input.focus();
        });
        options.appendChild(button);
    }
    toggle.addEventListener("click", () => {
        options.hidden = !options.hidden;
        toggle.setAttribute("aria-expanded", String(!options.hidden));
    });
    document.addEventListener("click", event => {
        if (!event.target.closest(".bin-width-control")) close();
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !options.hidden) {
            close();
            toggle.focus();
        }
    });
}

function sanitizeSweepInputs() {
    const firstInput =
        document.getElementById("sweepFirst");

    const lastInput =
        document.getElementById("sweepLast");

    let first = Number(firstInput.value);
    let last = Number(lastInput.value);

    if (!Number.isFinite(first)) {
        first = 0;
    }

    if (!Number.isFinite(last)) {
        last = availableSweeps;
    }

    first = Math.max(0, first);
    last = Math.min(availableSweeps, last);

    if (first >= last) {
        if (document.activeElement === firstInput) {
            last = Math.min(first + 1, availableSweeps);
        } else {
            first = Math.max(0, last - 1);
        }
    }

    firstInput.value = first;
    lastInput.value = last;
}

function zoomOutByHalfRange() {
    if (!chart) {
        return;
    }

    const xScale = visibleTofRange();

    const low = xScale.min;
    const high = xScale.max;
    const range = high - low;

    if (!Number.isFinite(low) || !Number.isFinite(high) || range <= 0) {
        return;
    }

    const newLow = low - range / 2;
    const newHigh = high + range / 2;



    applyVisibleTofRange(newLow, newHigh);
}

function zoomInToHalfRange() {
    if (!chart) {
        return;
    }

    const xScale = visibleTofRange();

    const low = xScale.min;
    const high = xScale.max;
    const range = high - low;

    if (!Number.isFinite(low) || !Number.isFinite(high) || range <= 0) {
        return;
    }

    const newLow = low + range / 4;
    const newHigh = high - range / 4;



    applyVisibleTofRange(newLow, newHigh);
}

function applyVisibleTofRange(low, high) {
    if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return;
    const range = boundTofRange(low, high);
    low = range.min;
    high = range.max;
    syncPlotWidth(range);
    if(absoluteTimeMode() && plottedTags.size) {
        visibleTofRange();
        absoluteViewRange={min:low,max:high};
        drawCombinedChart();
        return;
    }
    document.getElementById("tofLowUs").value = String(low);
    document.getElementById("tofHighUs").value = String(high);

    if (!chart) {
        return;
    }

    Plotly.relayout(chart, { "xaxis.range": [low, high] });
}

function resetVisibleTofRange() {
    storedRange = {low: Number(document.getElementById("tofLowUs")?.value ?? FULL_TOF_LOW_US), high: Number(document.getElementById("tofHighUs")?.value ?? FULL_TOF_HIGH_US)};
}

function restoreVisibleTofRange() {
    if (!storedRange) {
        return;
    }

    document.getElementById("tofLowUs").value = String(storedRange.low);
    document.getElementById("tofHighUs").value = String(storedRange.high);
    syncPlotWidth();
}

function handleChartWheel(event) {
    if (!event.shiftKey || !chart || (!event.deltaX && !event.deltaY)) return;
    event.preventDefault();

    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        panVisibleTofRange(event.deltaX);
        return;
    }

    if (event.deltaY < 0) {
        zoomOutByTenthRange();
    } else {
        zoomInByTenthRange();
    }
}

function panVisibleTofRange(deltaX) {
    if (!chart) {
        return;
    }

    const xScale = visibleTofRange();

    const low = xScale.min;
    const high = xScale.max;
    const range = high - low;

    if (!Number.isFinite(low) || !Number.isFinite(high) || range <= 0) {
        return;
    }

    const panFraction = deltaX / (chart._fullLayout?.xaxis._length || chart.clientWidth);
    const shift = range * panFraction;

    applyVisibleTofRange(low + shift, high + shift);
}

let zoomLimitHintTimer;
function showZoomLimitHint(message) {
    const hint=document.getElementById('zoomLimitHint');
    if(!hint)return;
    clearTimeout(zoomLimitHintTimer);
    hint.textContent=message;
    zoomLimitHintTimer=setTimeout(()=>{hint.textContent='';},4000);
}

function zoomOutByTenthRange() {
    if (!chart) {
        return;
    }

    const xScale = visibleTofRange();

    const low = xScale.min;
    const high = xScale.max;
    const range = high - low;

    if (!Number.isFinite(low) || !Number.isFinite(high) || range <= 0) {
        return;
    }

    const newLow = low - range / 10;
    const newHigh = high + range / 10;

    const maxRangeUs = globalMaxRangeUs;

    if (newHigh - newLow > maxRangeUs) { 
        showZoomLimitHint("Maximum zoom range reached (" + maxRangeUs.toFixed(3) + " µs).");
        return;
    }



    applyVisibleTofRange(newLow, newHigh);
}

function zoomInByTenthRange() {
    if (!chart) {
        return;
    }

    const xScale = visibleTofRange();

    const low = xScale.min;
    const high = xScale.max;
    const range = high - low;

    if (!Number.isFinite(low) || !Number.isFinite(high) || range <= 0) {
        return;
    }

    const newLow = low + range / 10;
    const newHigh = high - range / 10;

    const minRangeUs = globalMinRangeUs;

    if (newHigh - newLow < minRangeUs) { 
        showZoomLimitHint("Minimum zoom range reached (" + minRangeUs.toFixed(3) + " µs).");
        return;
    }



    applyVisibleTofRange(newLow, newHigh);
}

async function loadViewerPreferences() {
    try {
        const response=await fetch('/api/preferences');
        const data=await response.json();
        if(!response.ok)throw new Error(data.error || 'Could not load preferences.');
        const p=data.preferences;
        if(typeof NumberDisplay!=='undefined')NumberDisplay.set(p.thousandsSeparator);
        FULL_TOF_HIGH_US=p.ejectionBreakUs ?? 40;
        globalMinRangeUs=p.minZoomUs ?? 0.32;
        globalMaxRangeUs=p.maxZoomUs ?? 3200;
        for(const key of ['tofLowUs','tofHighUs','yScale'])document.getElementById(key).value=p[key];
        document.getElementById('binWidth').value=Math.round(p.binWidthNs*10);
        document.getElementById('binWidthNs').value=p.binWidthNs;
        safeRegion={low:p.safeLowUs,high:p.safeHighUs};
        storedRange={...safeRegion};
    } catch(error) { document.getElementById('workspaceStatus').textContent='Using built-in preferences: '+error.message; }
    syncPlotWidth();
    document.getElementById('safeRegionButton').addEventListener('click',async()=>{
        try {
            const response=await fetch('/api/preferences');const data=await response.json();
            if(!response.ok)throw new Error(data.error);
            safeRegion={low:data.preferences.safeLowUs,high:data.preferences.safeHighUs};
            applyVisibleTofRange(safeRegion.low,safeRegion.high+(ejectionPanels()?FULL_TOF_HIGH_US+breakGapUs():0));
        } catch(error){document.getElementById('status').textContent=error.message;}
    });
}
