const {calibrationChannel}=require('./public/js/energy-import');
function defaultNikiCalibrations(){
  // Module 1 Box Si coefficients from the supplied BoxSi_ch11–15_calib files.
  return {
    '1:11':{gain:2.188907,offset:88.799035,filename:'BoxSi_ch11_calib'},
    '1:12':{gain:2.117418,offset:56.663297,filename:'BoxSi_ch12_calib'},
    '1:13':{gain:2.117418,offset:50.311042,filename:'BoxSi_ch13_calib'},
    '1:14':{gain:2.288235,offset:78.858824,filename:'BoxSi_ch14_calib'},
    '1:15':{gain:2.219234,offset:80.503667,filename:'BoxSi_ch15_calib'}
  };
}
function parseCalibration(text){
  const coefficients={};
  for(const line of String(text).split(/\r\n|\r|\n/)){
    const match=line.match(/^\s*([ab])\s*:\s*(.*?)\s*$/i);
    if(match){const value=Number(match[2]);if(!match[2] || !Number.isFinite(value))throw new Error('Invalid '+match[1]+' coefficient.');coefficients[match[1].toLowerCase()]=value;}
  }
  if(!Number.isFinite(coefficients.a) || !Number.isFinite(coefficients.b) || coefficients.b<=0)throw new Error('Calibration requires a finite offset a and positive gain b.');
  return {gain:coefficients.b,offset:coefficients.a};
}
function parseCalibrationFiles(files=[]){
  if(!Array.isArray(files) || files.length>5)throw new Error('Select at most one calibration file for each channel 11–15.');
  const calibrations={};
  for(const file of files){
    const channel=calibrationChannel(file.filename);
    if(channel===null || typeof file.text!=='string' || file.text.length>65536)throw new Error('Invalid calibration file.');
    const key='1:'+channel;
    if(calibrations[key])throw new Error('More than one calibration selected for channel '+channel+'.');
    try{calibrations[key]={...parseCalibration(file.text),filename:file.filename};}catch(error){throw new Error(file.filename+': '+error.message);}
  }
  return calibrations;
}
function boxDetectorCalibrations(data,module,calibrations={}){
  const selected=new Map();
  for(const row of data.channels){
    if(row.channel<11 || row.channel>15 || module!==null && row.module!==module)continue;
    const key=row.module+':'+row.channel,calibration=calibrations[key];
    if(!calibration || !Number.isFinite(calibration.gain) || calibration.gain<=0 || !Number.isFinite(calibration.offset))throw new Error('Box detector sum requires an energy calibration for module '+row.module+', channel '+row.channel+'. Load its calibration file first.');
    selected.set(key,calibration);
  }
  return selected;
}
function calibratedBoxEnergy(events,index,calibrations){
  const calibration=calibrations.get(events.module[index]+':'+events.channel[index]);
  const value=events.pulse[index]*calibration.gain+calibration.offset;
  if(!Number.isFinite(value))throw new Error('A calibrated box detector energy is outside the supported range.');
  return value;
}
module.exports={defaultNikiCalibrations,parseCalibration,parseCalibrationFiles,boxDetectorCalibrations,calibratedBoxEnergy};
