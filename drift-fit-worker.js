const {parentPort,workerData}=require('node:worker_threads');
try { parentPort.postMessage({ok:true,...require('./drift-fit').fitSweepTranches(workerData)}); }
catch(error) { parentPort.postMessage({ok:false,error:error.message}); }
