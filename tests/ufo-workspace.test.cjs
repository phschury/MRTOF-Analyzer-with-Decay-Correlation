const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../calcme2/ufo_finder_web_static/workspace-state.js'), 'utf8');
const KEY = 'ufoFinderWorkspace.v1';
function open(storage, overrides = {}) {
  const elements = new Map();
  class Node {
    constructor(tag, text = '') { this.nodeName = tag.toUpperCase(); this.nodeType = tag === '#text' ? 3 : 1; this.text = text; this.childNodes = []; this.style = {}; this.dataset = {}; this.value = ''; }
    get children() { return this.childNodes.filter(n => n.nodeType !== 3); }
    get textContent() { return this.text + this.childNodes.map(n => n.textContent).join(''); }
    set textContent(text) { this.text = String(text); this.childNodes = []; }
    appendChild(node) { this.childNodes.push(node); return node; }
    setAttribute() {}
  }
  const get = id => { if (!elements.has(id)) elements.set(id, new Node('div')); return elements.get(id); };
  const controls = ['NameRef1', 'NameAnalyte', 'ToF_SCM', 'selChargeSCM', 'minHalflife'].map(id => { const node = get(id); node.id = id; node.value = 'default'; return node; });
  const listeners = {};
  const body = new Node('body');
  const context = {
    document: {body, getElementById: get, createElement: tag => new Node(tag), createTextNode: text => new Node('#text', text),
      querySelectorAll: selector => selector.startsWith('input') ? controls : get('tbody').children,
      addEventListener: (event, handler) => { listeners[event] = handler; }},
    window: {addEventListener: (event, handler) => { listeners[event] = handler; }},
    localStorage: {getItem: key => storage[key] || null, setItem: (key, value) => { storage[key] = value; }},
    periodicData: [], t0withErr: {val: 125, err: 10}, bwithErr: {val: 26497, err: 1}, activeSCMSearch: null,
    clearSCMTable: () => { get('tbody').childNodes = []; return get('tbody'); },
    updateElementButton: (element, button) => {
      button.style.backgroundColor = element.selected === 'R' ? 'pink' : element.selected === 'Y' ? 'green' : 'yellow';
    },
    MutationObserver: class {observe() {}}, setTimeout, clearTimeout
  };
  Object.assign(context, overrides);
  vm.runInNewContext(source, context);
  return {context, get, listeners, Node, body};
}
test('workspace survives closing with blank inputs, selections, calculation uncertainty and formatted search results', () => {
  const storage = {};
  const first = open(storage);
  first.get('NameRef1').value = '1Cs133';
  first.get('NameAnalyte').value = '';
  first.get('selChargeSCM').value = '3';
  first.context.t0withErr = {val: '127.12', err: '0.23'};
  first.context.periodicData.push({Symbol: 'Cs', selected: 'R'});
  first.get('lblCalct0').textContent = '127.12 ± 0.23';
  const row = first.get('tbody').appendChild(new first.Node('tr'));
  row.style.backgroundColor = 'pink';
  const cell = row.appendChild(new first.Node('td'));
  cell.dataset.copyText = '1Cs133';
  cell.appendChild(new first.Node('sup')).textContent = '133';
  cell.appendChild(new first.Node('#text', 'Cs'));
  first.context.activeSCMSearch = {};
  first.listeners.pagehide();
  const second = open(storage);
  assert.equal(second.get('NameRef1').value, '1Cs133');
  assert.equal(second.get('NameAnalyte').value, '');
  assert.equal(second.get('selChargeSCM').value, '3');
  assert.equal(second.context.t0withErr.err, '0.23');
  assert.equal(second.get('lblCalct0').textContent, '127.12 ± 0.23');
  const restored = second.get('tbody').children[0];
  assert.equal(restored.style.backgroundColor, 'pink');
  assert.equal(restored.children[0].dataset.copyText, '1Cs133');
  assert.equal(restored.children[0].children[0].nodeName, 'SUP');
  assert.match(second.get('lblSearching').textContent, /interrupted/);
  // Closing before the periodic data fetch finishes must not erase selections.
  second.listeners.pagehide();
  assert.deepEqual(JSON.parse(storage[KEY]).elements, []);
  assert.deepEqual(JSON.parse(storage[KEY]).radioactiveElements, ['Cs']);
  second.context.periodicData.push({Symbol: 'Cs', selected: 'N'}, {Symbol: 'H', selected: 'N'});
  second.listeners['ufo-elements-ready']();
  assert.equal(second.context.periodicData[0].selected, 'R');
  assert.equal(second.get('btnElement0').style.backgroundColor, 'pink');

});
test('bad or unavailable storage does not prevent using the finder', () => {
  const storage = {[KEY]: '{broken'};
  const page = open(storage);
  assert.match(page.body.children[0].textContent, /could not be read/);
  page.get('ToF_SCM').value = '123';
  page.listeners.input();
  assert.equal(JSON.parse(storage[KEY]).fields.ToF_SCM, '123');
  page.context.localStorage.setItem = () => { throw Error('quota'); };
  assert.doesNotThrow(page.listeners.pagehide);
  assert.match(page.body.children[0].textContent, /could not be saved/);
});
test('reference-only legacy settings migrate without losing blank values', () => {
  const storage = {ufoFinderLastRefSettings: JSON.stringify({NameRef1: '1Rb87', NameAnalyte: ''})};
  const page = open(storage);
  assert.equal(page.get('NameRef1').value, '1Rb87');
  page.listeners.pagehide();
  assert.equal(JSON.parse(storage[KEY]).fields.NameAnalyte, '');
});

test('server workspace restores without browser storage and uploads subsequent edits', async () => {
  const remote = {version: 1, updatedAt: 100, fields: {NameRef1: '1Cs133'},
    elements: [], radioactiveElements: ['Cs'], rows: [], t0: {val: 120, err: 0.5}};
  const requests = [];
  const storage = {};
  const page = open(storage, {
    AbortSignal, Blob,
    setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, options) => {
      requests.push({url, options});
      return {ok: true, json: async () => ({workspace: remote})};
    }
  });
  assert.equal(page.body.inert, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.body.inert, false);
  assert.equal(page.get('NameRef1').value, '1Cs133');
  assert.equal(page.context.t0withErr.err, 0.5);
  assert.equal(requests[1].options.method, 'PUT');
  assert.equal(JSON.parse(requests[1].options.body).fields.NameRef1, '1Cs133');
  page.get('NameRef1').value = '1Rb87';
  page.listeners.pagehide();
  assert.equal(JSON.parse(requests.at(-1).options.body).fields.NameRef1, '1Rb87');
});

test('failed startup read never overwrites a disk workspace with page defaults', async () => {
  const requests = [], timers = [];
  let online = false;
  const remote = {version: 1, updatedAt: 100, fields: {NameRef1: '1Cs133'}, elements: [], radioactiveElements: [], rows: []};
  const page = open({}, {
    AbortSignal, Blob, setTimeout: callback => {timers.push(callback); return 1;}, clearTimeout() {},
    fetch: async (url, options) => {
      requests.push(options);
      if (!online) throw Error('offline');
      return {ok: true, json: async () => ({workspace: remote})};
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  page.listeners.pagehide();
  assert.equal(requests.length, 1);
  online = true;
  timers[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.get('NameRef1').value, '1Cs133');
  assert.equal(JSON.parse(requests.at(-1).body).fields.NameRef1, '1Cs133');
});
