(function(root){
  function initializeEnergyRoiDrag(plot,{getContext,onSelect}){
    let drag=null;
    const stop=event=>{event.preventDefault();event.stopImmediatePropagation();};
    const pixelAt=(event,selection)=>Math.max(0,Math.min(selection.axis._length,event.clientX-selection.left));
    const cancel=()=>{
      if(!drag)return;
      const previous=drag;drag=null;previous.preview.remove();
      if(plot.hasPointerCapture(previous.pointerId))plot.releasePointerCapture(previous.pointerId);
    };
    const finish=(event,commit)=>{
      if(!drag || event.pointerId!==drag.pointerId)return;
      stop(event);const previous=drag,end=pixelAt(event,previous);cancel();
      const context=getContext();
      if(!commit || Math.abs(end-previous.start)<3 || !context || JSON.stringify(context)!==JSON.stringify(previous.context))return;
      const bounds=[previous.axis.p2d(previous.start),previous.axis.p2d(end)].map(value=>(value-context.offset)/context.gain).sort((a,b)=>a-b);
      if(bounds.every(Number.isFinite) && bounds[1]>bounds[0])onSelect({low:bounds[0],high:bounds[1]},context);
    };
    plot.addEventListener('pointerdown',event=>{
      if(drag || !event.ctrlKey || event.button!==0 || !plot._fullLayout)return;
      const context=getContext();if(!context || !Number.isFinite(context.gain) || context.gain<=0 || !Number.isFinite(context.offset))return;
      const {xaxis,yaxis}=plot._fullLayout,rect=plot.getBoundingClientRect();
      if(!xaxis || !yaxis)return;
      const x=event.clientX-rect.left-xaxis._offset,y=event.clientY-rect.top-yaxis._offset;
      if(x<0 || x>xaxis._length || y<0 || y>yaxis._length)return;
      stop(event);
      const preview=document.createElement('div');preview.className='roi-drag-preview';
      Object.assign(preview.style,{left:(xaxis._offset+x)+'px',top:yaxis._offset+'px',height:yaxis._length+'px',width:'0px'});
      plot.appendChild(preview);
      drag={pointerId:event.pointerId,axis:xaxis,left:rect.left+xaxis._offset,start:x,preview,context:{...context}};
      plot.setPointerCapture(event.pointerId);
    },true);
    plot.addEventListener('mousedown',event=>{if(drag)stop(event);},true);
    plot.addEventListener('contextmenu',event=>{if(event.ctrlKey)event.preventDefault();});
    plot.addEventListener('pointermove',event=>{
      if(!drag || event.pointerId!==drag.pointerId)return;
      stop(event);const end=pixelAt(event,drag);
      drag.preview.style.left=(drag.axis._offset+Math.min(drag.start,end))+'px';
      drag.preview.style.width=Math.abs(end-drag.start)+'px';
    },true);
    plot.addEventListener('pointerup',event=>finish(event,true),true);
    plot.addEventListener('pointercancel',event=>finish(event,false),true);
    plot.addEventListener('lostpointercapture',event=>finish(event,false),true);
    return cancel;
  }
  if(typeof module!=='undefined' && module.exports)module.exports={initializeEnergyRoiDrag};else root.initializeEnergyRoiDrag=initializeEnergyRoiDrag;
})(typeof window!=='undefined'?window:globalThis);
