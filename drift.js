// Counts in TOF × sweep cells. Relative TOF uses the selected TAG's ejection.
function makeDriftHeatmap(lm, options) {
  const { channel, edge, tag, binWidth, tofLowUs, tofHighUs, sweepLow, sweepHigh } = options;
  const integer = (v, min = 0) => Number.isSafeInteger(v) && v >= min;
  if (![channel, edge, tag].every(v => integer(v)) || !integer(binWidth, 1) ||
      !integer(sweepLow) || !integer(sweepHigh) || sweepHigh <= sweepLow ||
      !Number.isFinite(tofLowUs) || !Number.isFinite(tofHighUs) || tofHighUs <= tofLowUs) {
    throw new Error('Invalid channel, edge, TAG, bin width, TOF range, or sweep range.');
  }
  const eject = lm.ejectBins[Math.abs(tag) % 2];
  if (!Number.isFinite(eject)) throw new Error('No ejection time for this TAG.');
  const tLow = eject + Math.round(tofLowUs * 10000);
  const tHigh = eject + Math.round(tofHighUs * 10000);
  const columns = Math.ceil((tHigh - tLow) / binWidth);
  // Size the automatic overview to both the row and cell budgets. Explicit widths remain unchanged.
  const targetRows = Math.max(1, Math.min(1000, Math.floor(2000000 / columns)));
  const sweepBinWidth = options.sweepBinWidth ?? Math.max(1, Math.ceil((sweepHigh - sweepLow) / targetRows));
  if (!integer(sweepBinWidth, 1)) throw new Error('Sweeps per row must be a positive integer.');
  const rows = Math.ceil((sweepHigh - sweepLow) / sweepBinWidth);
  if (columns < 1 || rows > 20000 || columns * rows > 2000000) {
    throw new Error('Heatmap too large. Increase Sweeps per row or narrow the histogram TOF/sweep range (maximum 2 million cells and 20,000 rows).');
  }
  const x = Array.from({ length: columns + 1 }, (_, i) => (Math.min(tLow + i * binWidth, tHigh) - eject) / 10000);
  const y = Array.from({ length: rows + 1 }, (_, i) => Math.min(sweepLow + i * sweepBinWidth, sweepHigh) - 0.5);
  const z = Array.from({ length: rows }, () => Array(columns).fill(0));
  let acceptedEvents = 0;
  const events = lm.events;
  for (let i = 0; i < events.length; i++) {
    if (events.channel[i] !== channel || events.edge[i] !== edge || events.tag[i] !== tag) continue;
    const sweep = events.sweep[i], tof = events.tof[i];
    if (sweep < sweepLow || sweep >= sweepHigh || tof < tLow || tof >= tHigh) continue;
    z[Math.floor((sweep - sweepLow) / sweepBinWidth)][Math.floor((tof - tLow) / binWidth)]++;
    acceptedEvents++;
  }
  return { x, y, z, acceptedEvents, sweepBinWidth, rows, columns,
    settings: { ejectUs: eject / 10000, channel, edge, tag, binWidth, tofLowUs, tofHighUs, sweepLow, sweepHigh } };
}
module.exports = { makeDriftHeatmap };
