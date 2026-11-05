(async function(){
  const indicators=[...document.querySelectorAll('[data-memory-usage]')];
  if(!indicators.length)return;
  const intervalMs=60000;
  let pending=false,stopped=false,controller=null,lastReading=null,timer;
  const bytes=value=>{
    if(value>=1024**3)return (value/1024**3).toFixed(2)+' GiB';
    if(value>=1024**2)return (value/1024**2).toFixed(1)+' MiB';
    if(value>=1024)return (value/1024).toFixed(1)+' KiB';
    return Math.round(value)+' B';
  };
  function display(reading,failed=false){
    const text=reading?'Server RAM: '+bytes(reading.rssBytes)+(failed?' (update failed)':''):'Server RAM: unavailable';
    const detail=reading?'RAM used by the data-server process, including loaded event data (RSS). JavaScript heap: '+bytes(reading.heapUsedBytes)+
      '; array buffers: '+bytes(reading.arrayBuffersBytes)+'. Updated '+new Date(reading.sampledAt).toLocaleTimeString()+'. Browser memory is not included.'
      :'Data-server memory reading is unavailable. Retrying approximately once per minute.';
    for(const indicator of indicators){indicator.textContent=text;indicator.title=detail;}
  }
  async function refresh(){
    if(pending || stopped)return;
    pending=true;controller=new AbortController();
    const timeout=setTimeout(()=>controller?.abort(),10000);
    try{
      const response=await fetch('/api/memory-usage',{cache:'no-store',signal:controller.signal});
      const reading=await response.json();
      if(!response.ok || !reading.ok || !Number.isFinite(reading.rssBytes) || reading.rssBytes<0)throw new Error('Memory reading unavailable.');
      if(!stopped){lastReading=reading;display(reading);}
    }catch(error){if(!stopped)display(lastReading,true);}
    finally{clearTimeout(timeout);pending=false;controller=null;}
  }
  timer=setInterval(refresh,intervalMs);
  window.addEventListener('pagehide',()=>{stopped=true;clearInterval(timer);controller?.abort();});
  window.addEventListener('pageshow',()=>{if(stopped){stopped=false;timer=setInterval(refresh,intervalMs);refresh();}});
  await refresh();
})();
