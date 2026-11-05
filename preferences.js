const fs = require('node:fs');
const path = require('node:path');
const DEFAULTS = Object.freeze({binWidthNs:32,minZoomUs:0.32,maxZoomUs:3200,ejectionBreakUs:40,tofLowUs:12,tofHighUs:16,yScale:'linear',thousandsSeparator:'comma',safeLowUs:2.5,safeHighUs:25,listModeDirectory:__dirname});
const FILE = path.join(__dirname,'preferences.xml');
function validate(values) {
  const result={...DEFAULTS,...values};
  for(const key of ['binWidthNs','tofLowUs','tofHighUs','safeLowUs','safeHighUs','ejectionBreakUs','minZoomUs','maxZoomUs']) {
    if(typeof result[key]!=='number'||!Number.isFinite(result[key]))throw new Error(`${key} must be a finite number.`);
  }
  if(result.minZoomUs<=0 || result.maxZoomUs<=result.minZoomUs)throw new Error('Zoom limits must be positive microsecond values, with maximum greater than minimum.');
  if(result.ejectionBreakUs<=0)throw new Error('Ejection break must be greater than zero.');
  if(result.binWidthNs<0.1 || !Number.isSafeInteger(Math.round(result.binWidthNs*10)) || Math.abs(result.binWidthNs*10-Math.round(result.binWidthNs*10))>1e-7)throw new Error('Bin width must be a positive multiple of 0.1 ns.');
  if(result.tofLowUs>=result.tofHighUs || result.safeLowUs>=result.safeHighUs)throw new Error('Each minimum must be less than its maximum.');
  if(!['linear','logarithmic'].includes(result.yScale))throw new Error('Choose Lin or Log scale.');
  if(!['comma','half-space'].includes(result.thousandsSeparator))throw new Error('Choose comma or half-space for thousands separators.');
  if(typeof result.listModeDirectory!=='string'||!path.isAbsolute(result.listModeDirectory)||/[\x00-\x1f]/.test(result.listModeDirectory))throw new Error('Enter an absolute directory path.');
  return Object.fromEntries(Object.keys(DEFAULTS).map(key=>[key,result[key]]));
}
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function serialize(values){return '<?xml version="1.0" encoding="UTF-8"?>\n<preferences>\n'+Object.entries(validate(values)).map(([key,value])=>`  <${key}>${escape(value)}</${key}>`).join('\n')+'\n</preferences>\n';}
function parse(xml){
  const body=xml.trim().replace(/^<\?xml[^?]*\?>\s*/, '');
  if(!/^<preferences>[\s\S]*<\/preferences>$/.test(body))throw new Error('Invalid preferences XML.');
  let remaining=body.slice(13,-14), values={};
  remaining=remaining.replace(/<([A-Za-z]+)>([^<]*)<\/\1>/g,(all,key,value)=>{
    if((!(key in DEFAULTS) && !['minZoomBins','maxZoomBins'].includes(key))||key in values)throw new Error('Unknown or duplicate preference: '+key);
    if(/&(?!(?:amp|lt|gt|quot|apos);)/.test(value))throw new Error('Invalid XML entity.');
    value=value.replace(/&(amp|lt|gt|quot|apos);/g,(_,entity)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[entity]));
    values[key]=(typeof DEFAULTS[key]==='number' || key.endsWith('ZoomBins'))?(value.trim()===''?NaN:Number(value)):value;
    return '';
  });
  if(remaining.trim())throw new Error('Invalid preferences XML content.');
  // Convert preferences saved with the former bin-based zoom limits.
  for(const bound of ['min','max']) {
    const legacy=bound+'ZoomBins', current=bound+'ZoomUs';
    if(legacy in values && !(current in values))values[current]=values[legacy]*(values.binWidthNs ?? DEFAULTS.binWidthNs)/1000;
    delete values[legacy];
  }
  return validate(values);
}
function load(file=FILE){try{return parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code!=='ENOENT')console.warn('Could not load preferences; using defaults: '+error.message);return {...DEFAULTS};}}
function save(values,file=FILE){const next=validate(values);fs.writeFileSync(file+'.tmp',serialize(next),'utf8');fs.renameSync(file+'.tmp',file);return next;}
module.exports={DEFAULTS,FILE,validate,serialize,parse,load,save};
