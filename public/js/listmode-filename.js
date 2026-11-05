(function(root){
  function listmodeFilename(name){
    return String(name || 'spectrum').replace(/\.lst(?=\s*\[|$)/gi,'') + '.lst';
  }
  if(typeof module==='object' && module.exports)module.exports={listmodeFilename};
  else root.listmodeFilename=listmodeFilename;
})(typeof window==='object'?window:globalThis);
