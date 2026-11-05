let params = new URLSearchParams(window.location.search);
function driftNumber(value,options){return typeof NumberDisplay!=='undefined'?NumberDisplay.format(value,options):options?.minimumFractionDigits!==undefined?Number(value).toFixed(options.minimumFractionDigits):String(Number(value));}
if(typeof NumberDisplay!=='undefined')NumberDisplay.set(params.get('thousandsSeparator')||NumberDisplay.choice,false);
window.addEventListener('number-display-change',()=>{
  if(typeof NumberDisplay!=='undefined')params.set('thousandsSeparator',NumberDisplay.choice);
  loadDrift();
});
let requestNumber = 0;
let activeRequest;
let driftEjectionUs=0;
let driftAxisListenerAttached=false;
function driftTimeAxis(low,high,ejectUs) {
  const reference=Math.round((ejectUs+(low+high)/2)*10000)/10000;
  const tickvals=[],ticktext=[];
  const raw=(high-low)*1000/8;
  if(!(raw>0)) return {};
  const magnitude=10**Math.floor(Math.log10(raw));
  const step=[1,2,5,10].find(n=>n*magnitude>=raw)*magnitude;
  const start=(low+ejectUs-reference)*1000,end=(high+ejectUs-reference)*1000;
  for(let value=Math.ceil(start/step)*step;value<=end+step*1e-8;value+=step) {
    tickvals.push(reference+value/1000-ejectUs);
    ticktext.push(driftNumber(Number(value.toFixed(6))));
  }
  return {title:{text:`ToF - ${driftNumber(reference*1000,{minimumFractionDigits:1,maximumFractionDigits:1})} [ns]`},tickmode:'array',tickvals,ticktext};
}
function attachDriftAxisListener() {
  const plot=document.getElementById('driftPlot');
  if(driftAxisListenerAttached || !plot?.on) return;
  plot.on('plotly_relayout',event=>{
    const bounds=event['xaxis.range'];
    const low=bounds?bounds[0]:event['xaxis.range[0]'];
    const high=bounds?bounds[1]:event['xaxis.range[1]'];
    if(!Number.isFinite(low)||!Number.isFinite(high)||high<=low)return;
    const axis=driftTimeAxis(low,high,driftEjectionUs);
    Plotly.relayout(plot,{'xaxis.title':axis.title,'xaxis.tickmode':axis.tickmode,
      'xaxis.tickvals':axis.tickvals,'xaxis.ticktext':axis.ticktext});
  });
  driftAxisListenerAttached=true;
}
function navigateDriftTofReference(value, unit, previous) {
  const plot=document.getElementById('driftPlot');
  const range=plot.layout?.xaxis?.range;
  if(!range || !Number.isFinite(value) || value<0)return;
  const shift=(value-previous)/1000;
  let low=range[0]+shift,high=range[1]+shift;
  if(low<0){high-=low;low=0;}
  params.set('tofLowUs',low);
  params.set('tofHighUs',high);
  if(params.has('tagRanges')) {
    const ranges=JSON.parse(params.get('tagRanges'));
    ranges[document.getElementById('driftTag')?.value || params.get('tag')]={low,high};
    params.set('tagRanges',JSON.stringify(ranges));
  }
  // The heatmap only contains the requested interval; fetch the newly viewed cells.
  return loadDrift();
}
function syncDriftTagOptions() {
  const select=document.getElementById('driftTag');
  if (!select) return;
  const values=(params.get('tags') || params.get('tag') || '').split(',')
    .filter(value=>value.trim()!=='' && Number.isInteger(Number(value)));
  const tags=[...new Set(values.map(value=>String(Number(value))))];
  const previous=select.value;
  select.replaceChildren(...tags.map(tag=>{
    const option=document.createElement('option');
    option.value=tag;option.textContent=tag;return option;
  }));
  select.value=tags.includes(previous)?previous:tags.includes(params.get('tag'))?params.get('tag'):(tags[0] || '');
}
async function loadDrift(event) {
  event?.preventDefault();
  const request = ++requestNumber;
  activeRequest?.abort();
  activeRequest = new AbortController();
  const status = document.getElementById('status');
  const tag=document.getElementById('driftTag')?.value;
  if (tag) params.set('tag',tag);
  const width = document.getElementById('sweepBinWidth').value;
  if (width) params.set('sweepBinWidth', width);
  else params.delete('sweepBinWidth');
  status.textContent = 'Loading drift data…';
  try {
    if(params.has('tagRanges')) {
      const range=JSON.parse(params.get('tagRanges'))[params.get('tag')];
      if(!range) throw new Error('This TAG is outside the visible histogram range. Pan to it or choose another TAG.');
      params.set('tofLowUs',range.low);params.set('tofHighUs',range.high);
    }
    if(!width && params.has('sweepHigh')) {
      const columns=Math.ceil((Number(params.get('tofHighUs'))-Number(params.get('tofLowUs')))*10000/Number(params.get('binWidth')));
      const targetRows=Math.max(1,Math.min(1000,Math.floor(2000000/columns)));
      params.set('sweepBinWidth',Math.max(1,Math.ceil((Number(params.get('sweepHigh'))-Number(params.get('sweepLow')||0))/targetRows)));
    }
    const response = await fetch('/api/drift?' + params, { signal: activeRequest.signal });
    const grid = await response.json();
    if (request !== requestNumber) return;
    if (!response.ok || !grid.ok) throw new Error(grid.error || 'Could not load drift data.');
    if(width) document.getElementById('sweepBinWidth').value = grid.sweepBinWidth;
    else document.getElementById('sweepBinWidth').placeholder = `Auto (${grid.sweepBinWidth})`;
    const s = grid.settings;
    const ejections=JSON.parse(params.get('tagEjectionsUs')||'{}');
    driftEjectionUs=Number(s.ejectUs ?? ejections[s.tag] ?? 0);
    document.getElementById('source').textContent = `${grid.filename} · Channel ${s.channel} · Edge ${s.edge} · TAG ${s.tag} · TOF ${Number(s.tofLowUs).toFixed(4)}–${Number(s.tofHighUs).toFixed(4)} µs`;
    const logarithmic = params.get('yScale') === 'logarithmic';
    let maxCount = 0;
    for (const row of grid.z) for (const value of row) maxCount = Math.max(maxCount, value);
    const maxLog = maxCount > 0 ? Math.log10(maxCount) : 0;
    const ticks = Array.from({ length: Math.floor(maxLog) + 1 }, (_, i) => i);
    const z = logarithmic ? grid.z.map(row => row.map(value => value > 0 ? Math.log10(value) : null)) : grid.z;
    const colorbar = logarithmic ? {
      title: { text: 'Events / cell (log)' }, tickmode: 'array',
      tickvals: ticks, ticktext: ticks.map(value => driftNumber(10 ** value)),
    } : { title: { text: 'Events / cell' } };
    await Plotly.react('driftPlot', [{
      type: 'heatmap', x: grid.x, y: grid.y, z, customdata: grid.z,
      ...(logarithmic ? { zmax: Math.max(1, maxLog) } : {}),
      colorscale: 'Viridis', zmin: 0, zsmooth: false, connectgaps: false,
      colorbar, hoverongaps: false,
      hovertemplate: 'TOF: %{x:.6f} µs<br>Sweep (row center): %{y}<br>Events in cell: %{customdata}<extra></extra>',
    }], {
      separators: typeof NumberDisplay!=='undefined'?NumberDisplay.separators:'.,',
      margin: { l: 90, r: 130, t: 20, b: 65 },
      xaxis: { ...driftTimeAxis(s.tofLowUs,s.tofHighUs,driftEjectionUs), range: [s.tofLowUs, s.tofHighUs] },
      yaxis: { title: { text: 'Sweep number' }, range: [grid.y[0], grid.y.at(-1)] },
    }, { responsive: true, displaylogo: false, showLink: false, modeBarButtonsToRemove: ['sendChartToCloud'] });
    if (request !== requestNumber) return;
    attachDriftAxisListener();
    if(typeof TofAxisEditor!=='undefined')TofAxisEditor.attach(document.getElementById('driftPlot'),navigateDriftTofReference);
    status.textContent = `${driftNumber(grid.acceptedEvents)} events · ${grid.columns} TOF bins × ${grid.rows} rows · ${grid.sweepBinWidth} sweep(s) per row, summed counts. ${logarithmic ? 'Logarithmic colors; zero-count cells are blank. ' : 'Linear colors. '}Linked to the main histogram viewer.`;
  } catch (error) {
    if (request === requestNumber && error.name !== 'AbortError') {
      Plotly.purge('driftPlot');
      document.getElementById('source').textContent = '';
      status.textContent = error.message;
    }
  }
}
syncDriftTagOptions();
document.getElementById('driftTag')?.addEventListener('change', loadDrift);
document.getElementById('driftControls').addEventListener('submit', loadDrift);
window.addEventListener('message', event => {
  if (event.origin !== window.location.origin || event.source !== window.parent ||
      event.data?.type !== 'drift-viewer-state' || typeof event.data.query !== 'string') return;
  params = new URLSearchParams(event.data.query);
  if(typeof NumberDisplay!=='undefined')NumberDisplay.set(params.get('thousandsSeparator')||'comma',false);
  syncDriftTagOptions();
  loadDrift();
});
if (window.parent !== window) {
  window.parent.postMessage({ type: 'drift-ready' }, window.location.origin);
} else {
  loadDrift();
}
