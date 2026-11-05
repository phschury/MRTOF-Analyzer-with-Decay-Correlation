let distroSyncTimer, lastDistroSnapshot='';
function distroViewerParams() {
    const params=driftViewerParams();
    if(!params)return null;
    const ranges={};
    const absoluteRanges=params.has('tagRanges')?JSON.parse(params.get('tagRanges')):null;
    for(const tag of plottedTags.keys()) {
        const trace=chart.data?.find(trace=>trace.name==='TAG '+tag);
        if(trace && (trace.visible===false || trace.visible==='legendonly'))continue;
        ranges[tag]=absoluteRanges?absoluteRanges[tag]??null:{low:Number(params.get('tofLowUs')),high:Number(params.get('tofHighUs'))};
    }
    params.set('tagRanges',JSON.stringify(ranges));
    return params;
}
function syncDistroWindow(force=false) {
    clearTimeout(distroSyncTimer);
    distroSyncTimer=setTimeout(()=>{
        const frame=document.querySelector('#distroWindow iframe');
        if(!frame)return;
        const params=distroViewerParams();
        if(!params)return;
        const snapshot=params.toString();
        if(!force && snapshot===lastDistroSnapshot)return;
        lastDistroSnapshot=snapshot;
        frame.contentWindow.postMessage({type:'distro-viewer-state',query:snapshot},window.location.origin);
    },150);
}
function showDistro() {
    const params=distroViewerParams();
    if(!params)return;
    let popup=document.getElementById('distroWindow');
    if(!popup) {
        popup=document.createElement('section');
        popup.id='distroWindow';popup.className='drift-results-window distro-window';
        popup.setAttribute('role','dialog');popup.setAttribute('aria-modal','false');popup.setAttribute('aria-label','Ions per sweep distribution');
        popup.innerHTML='<header><span>Ions per sweep — drag to move</span><button type="button" aria-label="Close distribution">×</button></header><iframe title="Ions per sweep distribution"></iframe>';
        document.body.appendChild(popup);
        popup.querySelector('button').addEventListener('click',()=>popup.remove());
        const header=popup.querySelector('header');
        header.addEventListener('pointerdown',event=>{
            if(event.target.closest('button'))return;
            const rect=popup.getBoundingClientRect(),dx=event.clientX-rect.left,dy=event.clientY-rect.top;
            header.setPointerCapture(event.pointerId);
            header.onpointermove=move=>{
                popup.style.left=Math.max(0,Math.min(window.innerWidth-120,move.clientX-dx))+'px';
                popup.style.top=Math.max(0,Math.min(window.innerHeight-40,move.clientY-dy))+'px';
            };
            header.onpointerup=header.onlostpointercapture=()=>{header.onpointermove=null;};
        });
        lastDistroSnapshot='';
        popup.querySelector('iframe').src='/distro.html?'+params;
    }else syncDistroWindow(true);
}
window.addEventListener('message',event=>{
    const frame=document.querySelector('#distroWindow iframe');
    if(event.origin===window.location.origin && frame && event.source===frame.contentWindow && event.data?.type==='distro-ready')syncDistroWindow(true);
});
document.addEventListener('DOMContentLoaded',()=>document.getElementById('distroButton').addEventListener('click',showDistro));
