const {test}=require('node:test');
const assert=require('node:assert/strict');
const {chooseDirectory}=require('../folder-picker');
test('macOS passes paths as arguments and handles cancellation',async()=>{
 const initial='/tmp/a "quoted" & folder';
 assert.deepEqual(await chooseDirectory(initial,{platform:'darwin',execute:async(command,args)=>{
   assert.equal(command,'/usr/bin/osascript');assert.equal(args[2],initial);assert.ok(!args[1].includes(initial));return {stdout:initial+'/\n'};
 }}),{directory:initial+'/'});
 assert.deepEqual(await chooseDirectory(initial,{platform:'darwin',execute:async()=>{throw {stderr:'User canceled. (-128)'};}}),{cancelled:true});
});
test('Windows uses STA folder dialog, safely supplies initial path, and preserves Unicode',async()=>{
 const initial='C:\\Data\\日本語';
 assert.deepEqual(await chooseDirectory(initial,{platform:'win32',execute:async(command,args,options)=>{
   assert.equal(command,'powershell.exe');assert.ok(args.includes('-STA'));
   assert.equal(options.env.MRTOF_PICKER_DIRECTORY,initial);
   const script=Buffer.from(args.at(-1),'base64').toString('utf16le');
   assert.match(script,/FolderBrowserDialog/);assert.ok(!script.includes(initial));
   return {stdout:initial+'\r\n'};
 }}),{directory:initial});
 assert.deepEqual(await chooseDirectory(initial,{platform:'win32',execute:async()=>({stdout:''})}),{cancelled:true});
});
test('Linux falls back to KDialog when Zenity is absent',async()=>{
 const calls=[];
 assert.deepEqual(await chooseDirectory('/tmp/data',{platform:'linux',execute:async(command,args)=>{
   calls.push(command);if(command==='zenity')throw {code:'ENOENT'};
   assert.equal(args[1],'/tmp/data');return {stdout:'/tmp/chosen\n'};
 }}),{directory:'/tmp/chosen'});
 assert.deepEqual(calls,['zenity','kdialog']);
});
test('Linux cancellation stops without opening another picker; missing tools and failures are reported',async()=>{
 let calls=0;
 assert.deepEqual(await chooseDirectory('/tmp',{platform:'linux',execute:async()=>{calls++;throw {code:1};}}),{cancelled:true});
 assert.equal(calls,1);
 await assert.rejects(chooseDirectory('/tmp',{platform:'linux',execute:async()=>{throw {code:'ENOENT'};}}),/Zenity or KDialog/);
 await assert.rejects(chooseDirectory('/tmp',{platform:'linux',execute:async()=>{throw new Error('No display');}}),/No display/);
});
