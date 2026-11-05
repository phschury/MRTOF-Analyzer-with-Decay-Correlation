const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('Ctrl-drag sets bounded ROI in either direction without changing zoom; ordinary drags pass through', () => {
  const handlers = {};
  let redraws = 0;
  let captured = false;
  const plot = {
    _fullLayout: {xaxis: {_offset: 50, _length: 400, p2d: x => 10 + x / 100}, yaxis: {_offset: 20, _length: 200}},
    addEventListener: (name, fn) => handlers[name] = fn,
    getBoundingClientRect: () => ({left: 100, top: 100}),
    appendChild() {}, setPointerCapture() { captured = true; },
    hasPointerCapture: () => captured, releasePointerCapture() { captured = false; },
  };
  const context = vm.createContext({plot, redraw: () => redraws++, window: {addEventListener() {}}, document: {
    addEventListener() {}, getElementById() { return null; },
    createElement: () => ({style: {}, remove() {}}),
  }});
  vm.runInContext(fs.readFileSync('public/js/histogram-page.js', 'utf8'), context);
  vm.runInContext('chart = plot; loadedFileStates = [{}]; activeFileStateIndex = 0; drawCombinedChart = redraw; initializeRoiDrag(plot);', context);
  const event = (clientX, ctrlKey = true) => ({clientX, clientY: 150, ctrlKey, button: 0, pointerId: 1,
    prevented: false, preventDefault() {this.prevented = true;}, stopImmediatePropagation() {}});
  const ordinary = event(250, false);
  handlers.pointerdown(ordinary);
  assert.equal(ordinary.prevented, false);
  handlers.pointerdown(event(450));
  handlers.pointermove(event(250));
  handlers.pointerup(event(250));
  assert.equal(vm.runInContext('JSON.stringify(currentRoi)', context), '{"lowUs":11,"highUs":13}');
  assert.equal(vm.runInContext('loadedFileStates[0].roi.lowUs', context), 11);
  assert.equal(redraws, 1);
  handlers.pointerdown(event(250));
  handlers.pointerup(event(900));
  assert.equal(vm.runInContext('currentRoi.highUs', context), 14);
  handlers.pointerdown(event(250));
  handlers.pointercancel(event(350));
  assert.equal(redraws, 2);
  handlers.pointerdown(event(250));
  handlers.pointerup(event(251));
  assert.equal(redraws, 2);
});
