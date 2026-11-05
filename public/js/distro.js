let params=new URLSearchParams(window.location.search),activeRequest,requestNumber=0;
async function loadDistro() {
    const request=++requestNumber;
    activeRequest?.abort();activeRequest=new AbortController();
    const status=document.getElementById('status');
    status.textContent='Loading distribution…';
    try {
        if(typeof NumberDisplay!=='undefined')NumberDisplay.set(params.get('thousandsSeparator')||'comma',false);
        const response=await fetch('/api/sweep-distribution?'+params,{signal:activeRequest.signal});
        const data=await response.json();
        if(request!==requestNumber)return;
        if(!response.ok || !data.ok)throw new Error(data.error||'Could not load distribution.');
        const format=value=>typeof NumberDisplay!=='undefined'?NumberDisplay.format(value):String(value);
        document.getElementById('source').textContent=data.filename;
        await Plotly.react('distroPlot',[{type:'bar',x:data.ionsPerSweep,y:data.sweeps,width:0.9,
            marker:{color:'#003366'},hovertemplate:'%{x} ions per sweep<br>%{y} sweeps<extra></extra>'}],{
            margin:{l:75,r:20,t:15,b:55},separators:typeof NumberDisplay!=='undefined'?NumberDisplay.separators:'.,',
            xaxis:{title:{text:'Ions per sweep'},dtick:1,rangemode:'tozero'},
            yaxis:{title:{text:'Number of sweeps'},rangemode:'tozero',tickformat:',~f'},
            bargap:0.1},{responsive:true,displaylogo:false});
        const mean=data.meanIonsPerSweep===null?'—':format(Number(data.meanIonsPerSweep.toFixed(3)));
        status.textContent=`${format(data.totalIons)} ions · ${format(data.totalSweeps)} sweeps · Mean ${mean} ions/sweep (${format(data.nonemptySweeps)} nonempty sweeps). Histogram includes zero-ion sweeps; mean excludes them. Linked to the visible ToF range, TAGs, channel, edge, and sweep selection.`;
    }catch(error){
        if(error.name!=='AbortError' && request===requestNumber){status.textContent=error.message;Plotly.purge('distroPlot');}
    }
}
window.addEventListener('message',event=>{
    if(event.origin!==window.location.origin || event.source!==window.parent || event.data?.type!=='distro-viewer-state' || typeof event.data.query!=='string')return;
    params=new URLSearchParams(event.data.query);loadDistro();
});
if(window.parent!==window)window.parent.postMessage({type:'distro-ready'},window.location.origin);
else loadDistro();
