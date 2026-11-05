// Recorded TOFs are in 0.1 ns bins. Compare the full source event set,
// including removed events, without applying viewer filters.
function makeDebouncedData(lm, minNs = 20, maxNs = 1000) {
  if (!Number.isFinite(minNs) || !Number.isFinite(maxNs) || minNs < 0 || maxNs <= minNs || !Number.isFinite(maxNs * 10)) {
    throw new Error('Debounce requires 0 ≤ min < max, in nanoseconds.');
  }
  const source = lm.events;
  const order = Uint32Array.from({length: source.length}, (_, i) => i);
  order.sort((a, b) => source.sweep[a] - source.sweep[b] || source.tof[a] - source.tof[b] || a - b);
  const removed = new Uint8Array(source.length);
  const minBins = minNs * 10, maxBins = maxNs * 10;
  let start = 0, eligible = 0;
  for (let pos = 0; pos < order.length; pos++) {
    const index = order[pos];
    if (pos === 0 || source.sweep[index] !== source.sweep[order[pos - 1]]) {
      start = pos;
      eligible = pos;
    }
    const tof = source.tof[index];
    // Advance to the latest earlier event at least minBins before this one.
    // A tolerance accommodates fractional bins produced by drift correction.
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(tof)) * 4;
    while (eligible < pos) {
      const delta = tof - source.tof[order[eligible]];
      if (delta <= 0 || delta + tolerance < minBins) break;
      eligible++;
    }
    if (eligible > start) {
      const delta = tof - source.tof[order[eligible - 1]];
      if (delta > 0 && delta <= maxBins + tolerance) removed[index] = 1;
    }
  }
  const keep = [];
  for (let i = 0; i < source.length; i++) if (!removed[i]) keep.push(i);
  const events = {length: keep.length};
  for (const [key, values] of Object.entries(source)) {
    if (key === 'length') continue;
    if (values && values.length === source.length && (Array.isArray(values) || ArrayBuffer.isView(values))) {
      events[key] = Array.isArray(values) ? keep.map(i => values[i]) : values.constructor.from(keep, i => values[i]);
    } else events[key] = values;
  }
  const debouncing = {minNs, maxNs, sourceEvents: source.length, totalEvents: events.length,
    removedEvents: source.length - events.length, referenceEvents: 'all source events in the same sweep', inclusive: true};
  return {lm: {...lm, events, stats: {...lm.stats, acceptedEvents: events.length},
    observedTags: new Set(events.tag), observedChannels: new Set(events.channel), observedEdges: new Set(events.edge), debouncing}, debouncing};
}
module.exports = {makeDebouncedData};
