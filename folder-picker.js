const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const run=promisify(execFile);
const title='Choose default ToF list mode directory';

// Arguments and environment values keep user paths out of executable scripts.
async function chooseDirectory(initial,{platform=process.platform,execute=run}={}) {
  const result=stdout=>{
    const directory=stdout.replace(/\r?\n$/, '');
    return directory ? {directory} : {cancelled:true};
  };
  if(platform==='darwin') {
    const script='on run argv\nset selectedFolder to choose folder with prompt "'+title+'" default location (POSIX file (item 1 of argv))\nreturn POSIX path of selectedFolder\nend run';
    try {return result((await execute('/usr/bin/osascript',['-e',script,initial])).stdout);}
    catch(error){if(String(error.stderr).includes('(-128)'))return {cancelled:true};throw error;}
  }
  if(platform==='win32') {
    const script=`Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '${title}'
$dialog.SelectedPath = $env:MRTOF_PICKER_DIRECTORY
try {
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
    [Console]::WriteLine($dialog.SelectedPath)
  }
} finally { $dialog.Dispose() }`;
    return result((await execute('powershell.exe',['-NoProfile','-STA','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{
      windowsHide:true,encoding:'utf8',env:{...process.env,MRTOF_PICKER_DIRECTORY:initial},
    })).stdout);
  }
  if(platform==='linux') {
    const pickers=[
      ['zenity',['--file-selection','--directory',`--title=${title}`,`--filename=${initial.replace(/\/$/,'')}/`]],
      ['kdialog',['--getexistingdirectory',initial,'--title',title]],
    ];
    for(const [command,args] of pickers) {
      try {return result((await execute(command,args)).stdout);}
      catch(error){
        if(error.code===1)return {cancelled:true};
        if(error.code!=='ENOENT')throw error;
      }
    }
    throw new Error('Folder browsing needs Zenity or KDialog on Linux. Install either one, or enter the directory path manually.');
  }
  throw new Error('Folder browsing is unavailable on this platform. Enter the directory path manually.');
}
module.exports={chooseDirectory};
