const form=document.getElementById('preferencesForm');
const fields=document.getElementById('preferenceFields');
const status=document.getElementById('preferenceStatus');
let defaults;
function populate(values){for(const [key,value] of Object.entries(values))form.elements.namedItem(key).value=value;}
(async()=>{try{
  const response=await fetch('/api/preferences');const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Could not load preferences.');
  defaults=data.defaults;populate(data.preferences);fields.disabled=false;status.textContent='';
}catch(error){status.textContent=error.message;}})();
document.getElementById('resetDefaults').addEventListener('click',()=>{populate(defaults);status.textContent='Defaults restored in this form. Save to apply them.';});
form.addEventListener('submit',async event=>{
  event.preventDefault();const values=Object.fromEntries(new FormData(form));
  for(const key of ['minZoomUs','maxZoomUs','binWidthNs','tofLowUs','tofHighUs','safeLowUs','safeHighUs','ejectionBreakUs'])values[key]=Number(values[key]);
  fields.disabled=true;
  try{const response=await fetch('/api/preferences',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Save failed.');
    NumberDisplay.set(data.preferences.thousandsSeparator);
    try{localStorage.setItem(NumberDisplay.key,NumberDisplay.choice)}catch{}
    populate(data.preferences);status.textContent='Preferences saved. New viewers will use these defaults.';
  }catch(error){status.textContent=error.message;}finally{fields.disabled=false;}
});

const browseDirectory=document.getElementById('browseDirectory');
browseDirectory.addEventListener('click',async()=>{
  fields.disabled=true;
  status.textContent='Choose a default directory…';
  try {
    const response=await fetch('/api/preferences/browse-directory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({directory:form.elements.namedItem('listModeDirectory').value})});
    const data=await response.json();
    if(!response.ok){
      if(data.alert)window.alert(data.alert);
      throw new Error(data.error||'Could not open the folder chooser.');
    }
    if(data.cancelled){status.textContent='';return;}
    form.elements.namedItem('listModeDirectory').value=data.directory;
    status.textContent='Directory selected. Save Preferences to apply it.';
  }catch(error){status.textContent=error.message;}
  finally{fields.disabled=false;}
});
