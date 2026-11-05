const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const web = path.join(__dirname, '../calcme2/ufo_finder_web_static');
const source = fs.readFileSync(path.join(web, 'render.js'), 'utf8');
test('published selection modes honor abundance, half-life and radioactive atom limits', async () => {
  const nodes = new Map();
  const node = () => ({style: {}, value: '', setAttribute() {}, addEventListener(type, handler) {this[type] = handler;}, appendChild(child) {nodes.set(child.id, child);}});
  const get = id => {if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id);};
  get('minAbundance').value = '1'; get('selMaxRI').value = '0'; get('minHalflife').value = '0.1';
  const ctx = {
    document: {getElementById: get, createElement: node, dispatchEvent() {}}, Event: class {},
    fetch: async () => ({text: async () => 'Cs 1 1'}), console,
    NUBASE: [
      {element: 'Cs', nuclide: 'Cs133', abundance: 100, halflifeSeconds: Infinity},
      {element: 'Cs', nuclide: 'Cs137', abundance: 0, halflifeSeconds: 1000},
      {element: 'Cs', nuclide: 'Cs140', abundance: 0, halflifeSeconds: 0.01}
    ]
  };
  const start = source.indexOf('function getChart(');
  const end = source.indexOf('var activeSCMSearch', start);
  vm.runInNewContext(source.slice(start, end), ctx);
  ctx.periodicData = ctx.getChart(node());
  await new Promise(resolve => setImmediate(resolve));
  const button = get('btnElement0');
  const isotopes = () => Array.from(ctx.getListOfSelectedIsotopes());
  button.click({shiftKey: true});
  assert.equal(button.style.backgroundColor, 'pink');
  assert.equal(get('selMaxRI').value, '0');
  assert.deepEqual(isotopes(), ['Cs133']);
  get('selMaxRI').value = '1';
  assert.deepEqual(isotopes(), ['Cs133', 'Cs137']);
  button.click({shiftKey: false});
  assert.equal(button.style.backgroundColor, 'green');
  assert.deepEqual(isotopes(), ['Cs133']);
  button.click({shiftKey: false});
  assert.equal(button.style.backgroundColor, 'yellow');
  assert.deepEqual(isotopes(), []);
  button.click({shiftKey: false});
  button.click({shiftKey: true});
  assert.equal(button.style.backgroundColor, 'pink');
  get('minAbundance').value = '100';
  assert.deepEqual(isotopes(), ['Cs137']);
  get('minHalflife').value = '0';
  assert.deepEqual(isotopes(), ['Cs137', 'Cs140']);
  button.click({shiftKey: true});
  assert.equal(button.style.backgroundColor, 'yellow');
  assert.deepEqual(isotopes(), []);
  button.click({shiftKey: true});
  ctx.fnSelectNone();
  assert.equal(button.style.backgroundColor, 'yellow');
  assert.deepEqual(isotopes(), []);
});
test('web manual link and scripts reference existing files', () => {
  const html = fs.readFileSync(path.join(web, 'index.html'), 'utf8');
  assert.match(html, /id="userManualLink" href="manual.html" target="_blank" rel="noopener"/);
  assert.match(html, /workspace-state.js/);
  for (const file of ['manual.html', 'images/manual-top.png', 'images/manual-ufo-search.png']) assert.ok(fs.existsSync(path.join(web, file)));
});
