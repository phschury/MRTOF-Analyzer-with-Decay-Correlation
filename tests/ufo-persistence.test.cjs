const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const {mountUfoWorkspace} = require('../ufo-workspace');

test('disk workspace survives a fresh server instance; invalid writes preserve the saved file', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ufo-workspace-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const file = path.join(directory, 'outputs', 'ufo-workspace.json');
  async function start() {
    const app = express(); app.use(express.json({limit: '25mb'})); mountUfoWorkspace(app, file);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {server.once('listening', resolve); server.once('error', reject);});
    t.after(() => {server.closeAllConnections(); server.close();});
    return {server, url: `http://127.0.0.1:${server.address().port}/api/ufo-workspace`};
  }
  const first = await start();
  assert.equal((await (await fetch(first.url)).json()).workspace, null);
  const workspace = {version: 1, updatedAt: Date.now(), fields: {NameRef1: '1Cs133'},
    elements: ['H'], radioactiveElements: ['Cs'], rows: [{cells: []}], t0: {val: 120, err: 0.2}};
  const response = await fetch(first.url, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(workspace)});
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), workspace);
  first.server.closeAllConnections();
  await new Promise(resolve => first.server.close(resolve));
  const second = await start();
  const restored = await fetch(second.url);
  assert.equal(restored.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await restored.json()).workspace, workspace);
  const invalid = await fetch(second.url, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: '{"version":99}'});
  assert.equal(invalid.status, 400);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), workspace);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['ufo-workspace.json']);
});
