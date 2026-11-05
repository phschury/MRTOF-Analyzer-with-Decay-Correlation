(function(root){
  let choice='comma';
  const key='correlyzer-thousands-separator';
  function format(value,options={}){
    if(!Number.isFinite(Number(value)))return String(value);
    const text=new Intl.NumberFormat('en-US',{useGrouping:true,maximumFractionDigits:6,...options}).format(Number(value));
    return choice==='half-space'?text.replaceAll(',', '\u2009'):text;
  }
  function set(value,notify=true){
    const next=value==='half-space'?'half-space':'comma';
    if(next===choice)return;
    choice=next;
    if(notify && typeof window!=='undefined' && window.dispatchEvent)window.dispatchEvent(new Event('number-display-change'));
  }
  const api={format,set,get choice(){return choice},get separators(){return choice==='half-space'?'.\u2009':'.,'},key};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else{
    root.NumberDisplay=api;
    try{set(localStorage.getItem(key))}catch{}
    window.addEventListener('storage',event=>{if(event.key===key)set(event.newValue)});
  }
})(typeof globalThis!=='undefined'?globalThis:this);
