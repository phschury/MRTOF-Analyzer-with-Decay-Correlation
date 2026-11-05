'use strict';
const timeParams=new URLSearchParams(window.location.search);
let timeRequest=0,timeController,schmidtEnabled=false;
timeParams.delete('energySources');
// Each newly opened window starts with the full Box detector sum.
timeParams.delete('energyRoiId');
function setTimeEnergyRois(rois,selected){
    const select=document.getElementById('energyRoi');select.replaceChildren();
    for(const roi of [{id:'',name:'Full Box detector sum'},...rois]){
        const option=document.createElement('option');option.value=roi.id;option.textContent=roi.name;select.appendChild(option);
    }
    select.value=rois.some(roi=>roi.id===selected)?selected:'';
}
async function loadCorrelationTime(){
    const serial=++timeRequest;timeController?.abort();timeController=new AbortController();
    const status=document.getElementById('status');status.textContent='Loading correlation times…';
    const fitResult=document.getElementById('fitResult');fitResult.hidden=true;fitResult.textContent='';
    const schmidtResult=document.getElementById('schmidtResult');schmidtResult.hidden=true;schmidtResult.textContent='';
    try{
        if(typeof NumberDisplay!=='undefined')NumberDisplay.set(timeParams.get('thousandsSeparator')||'comma',false);
        const log=document.getElementById('timeXScale').value==='log';
        if(!log)schmidtEnabled=false;
        document.getElementById('timeFitSchmidt').setAttribute('aria-pressed',String(schmidtEnabled));
        timeParams.delete('fitSchmidt');if(schmidtEnabled)timeParams.set('fitSchmidt','true');
        document.getElementById('timeBinWidth').disabled=log;
        document.getElementById('timeBinWidth').title=log?'Log scale uses 100 bins spaced evenly in log time.':'';
        timeParams.set('xScale',log?'log':'linear');
        timeParams.delete('fitExponential');if(document.getElementById('timeFitExponential').checked)timeParams.set('fitExponential','true');
        const width=log?'':document.getElementById('timeBinWidth').value.trim();
        if(width && (!Number.isFinite(Number(width)) || Number(width)<=0))throw new Error('Enter a positive bin width in seconds, or leave it blank for Auto.');
        timeParams.delete('binWidth');if(width)timeParams.set('binWidth',width);
        const response=await fetch('/api/correlation-time?'+timeParams,{signal:timeController.signal}),data=await response.json();
        if(serial!==timeRequest)return;
        if(!response.ok || !data.ok)throw new Error(data.error||'Could not load correlation times.');
        if(data.energyDatasetId)timeParams.set('energyDatasetId',data.energyDatasetId);
        setTimeEnergyRois(data.energyRois || [],data.energyRoiId);
        const energyName=(data.energyRois || []).find(roi=>roi.id===data.energyRoiId)?.name || 'Box detector sum';
        const format=value=>typeof NumberDisplay!=='undefined'?NumberDisplay.format(value,{maximumFractionDigits:10}):String(value);
        const precision=value=>typeof NumberDisplay!=='undefined'?NumberDisplay.format(value,{maximumSignificantDigits:6}):Number(value.toPrecision(6)).toString();
        document.getElementById('source').textContent=data.filename;
        const hover=data.counts.map((count,i)=>{
            const event=count===1?data.singleEvents?.[i]:null;
            return '%{x:.6g} s<br>%{y} events'+(event?'<br>Energy: %{customdata[0]:.6g} keV<br>Detector: %{customdata[1]}':'')+'<extra></extra>';
        });
        const traces=[{type:'bar',name:'Correlation times',x:data.x,y:data.counts,width:data.widths || data.binWidth,
            customdata:data.counts.map((count,i)=>count===1 && data.singleEvents?.[i]?[data.singleEvents[i].energyKeV,data.singleEvents[i].detector]:[null,null]),
            marker:{color:'#003366'},hovertemplate:hover}];
        if(data.fit){
            fitResult.hidden=false;
            if(data.fit.ok){
                fitResult.textContent='Half-life: '+precision(data.fit.halfLife)+' ± '+precision(data.fit.halfLifeError)+' s (1σ standard error) · Single exponential, no background · Unbinned maximum likelihood using all '+format(data.fit.events)+' delays, including zero delays; independent of binning.';
                traces.push({type:'scatter',mode:'lines',name:'Exponential fit',x:data.x,y:data.fit.counts,line:{color:'#d35400',width:2},hovertemplate:'%{x:.6g} s<br>%{y:.6g} expected events<extra>Exponential fit</extra>'});
            }else fitResult.textContent='Exponential fit unavailable: '+data.fit.error;
        }
        if(data.schmidtFit){
            schmidtResult.hidden=false;
            const fit=data.schmidtFit;
            if(fit.ok){
                schmidtResult.textContent='Schmidt half-life: '+precision(fit.halfLife)+' ± '+precision(fit.halfLifeError)+' s (approximate 1σ standard error) · Peak / mean lifetime τ: '+precision(fit.peakTime)+' s · T½ = τ ln(2) · Poisson fit to '+format(fit.events)+' events in equal log-time bins, no background; '+format(data.zeroDelay)+' zero-delay events excluded.';
                traces.push({type:'scatter',mode:'lines',name:'Schmidt fit',x:data.x,y:fit.counts,line:{color:'#14804a',width:2},hovertemplate:'%{x:.6g} s<br>%{y:.6g} expected events<extra>Schmidt fit</extra>'});
            }else schmidtResult.textContent='Schmidt fit unavailable: '+fit.error;
        }
        await Plotly.react('distroPlot',traces,{
            margin:{l:75,r:20,t:15,b:60},separators:typeof NumberDisplay!=='undefined'?NumberDisplay.separators:'.,',
            showlegend:!!(data.fit?.ok || data.schmidtFit?.ok),legend:{orientation:'h'},
            shapes:data.schmidtFit?.ok?[{type:'line',xref:'x',x0:data.schmidtFit.peakTime,x1:data.schmidtFit.peakTime,yref:'paper',y0:0,y1:1,line:{color:'#14804a',dash:'dot',width:1}}]:[],
            xaxis:{title:{text:'Time to next '+energyName+' event [s]'},type:log?'log':'linear',...(log?{}:{rangemode:'tozero'})},
            yaxis:{title:{text:log?'ToF events / log-time bin':'ToF events / '+format(Math.round(data.binWidth))+' s'},rangemode:'tozero',tickformat:',~f'},bargap:0
        },{responsive:true,displaylogo:false});
        status.textContent=format(data.totalEvents)+' ToF events · '+format(data.missingSuccessor)+' excluded without an unambiguous following '+energyName+' event.'+(log?' '+format(data.zeroDelay)+' zero-delay events omitted on log scale.':'')+' Each ToF implantation uses the next selected Energy decay event (Energy time − ToF time); an intervening ion within the selected ToF population disqualifies the earlier implantation.';
    }catch(error){if(error.name!=='AbortError' && serial===timeRequest){status.textContent=error.message;fitResult.hidden=true;schmidtResult.hidden=true;Plotly.purge('distroPlot');}}
}
document.getElementById('timeControls').addEventListener('submit',event=>{event.preventDefault();loadCorrelationTime();});
document.getElementById('timeXScale').addEventListener('change',loadCorrelationTime);
document.getElementById('timeFitExponential').addEventListener('change',loadCorrelationTime);
document.getElementById('timeFitSchmidt').addEventListener('click',()=>{
    schmidtEnabled=!schmidtEnabled;
    if(schmidtEnabled)document.getElementById('timeXScale').value='log';
    return loadCorrelationTime();
});
document.getElementById('energyRoi').addEventListener('change',event=>{timeParams.delete('energyRoiId');if(event.target.value)timeParams.set('energyRoiId',event.target.value);return loadCorrelationTime();});
loadCorrelationTime();
