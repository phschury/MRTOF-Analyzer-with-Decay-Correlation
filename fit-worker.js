const { parentPort, workerData } = require('node:worker_threads');
try {
  const result = require('./fit-engine.js').fitPeak(workerData);
  parentPort.postMessage({ ok: true, ...result });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error.message });
}
