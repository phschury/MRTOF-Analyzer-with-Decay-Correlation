function correlationTimeParams(){
    const state=loadedFileStates[activeFileStateIndex];
    if(!(state?.kind==='energy-correlated' || state?.correlationEnergySources?.length) || !roiIsReadyForFit() || !Number.isFinite(currentRoi.lowUs) || !Number.isFinite(currentRoi.highUs) || currentRoi.highUs<=currentRoi.lowUs)return null;
    const tag=currentRoi.tag??selectedRoiTag(),plotted=plottedTags.get(tag);
    const params=new URLSearchParams({datasetId:state.datasetId,tag,tofLowUs:currentRoi.lowUs,tofHighUs:currentRoi.highUs,
        channel:plotted?.settings.channel??document.getElementById('channel').value,
        edge:plotted?.settings.edge??document.getElementById('edge').value,
        thousandsSeparator:typeof NumberDisplay!=='undefined'?NumberDisplay.choice:'comma'});
    if(currentSweepRange){params.set('sweepLow',currentSweepRange.sweepLow);params.set('sweepHigh',currentSweepRange.sweepHigh);}
    params.set('energySources',JSON.stringify(state.correlationEnergySources || []));
    return params;
}
function showCorrelationTime(){
    const params=correlationTimeParams();if(!params)return;
    let popup=document.getElementById('correlationTimeWindow');
    if(!popup){
        popup=document.createElement('section');popup.id='correlationTimeWindow';popup.className='drift-results-window distro-window';
        popup.setAttribute('role','dialog');popup.setAttribute('aria-modal','false');popup.setAttribute('aria-label','Correlation time');
        popup.innerHTML='<header><span>Correlation time — drag to move</span><button type="button" aria-label="Close correlation time">×</button></header><iframe title="Correlation time histogram"></iframe>';
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
    }
    popup.querySelector('iframe').src='/correlation-time.html?'+params;
}
