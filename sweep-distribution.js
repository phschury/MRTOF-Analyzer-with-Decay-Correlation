function makeSweepDistribution(lm, {channel, edge, sweepLow, sweepHigh, tagRanges}) {
  if (![channel, edge, sweepLow, sweepHigh].every(Number.isSafeInteger) || channel < 0 || edge < 0 ||
      sweepLow < 0 || sweepHigh <= sweepLow || !tagRanges || typeof tagRanges !== 'object' || Array.isArray(tagRanges)) {
    throw new Error('Invalid channel, edge, sweep range, or TAG ranges.');
  }
  const ranges = new Map();
  for (const [tag, range] of Object.entries(tagRanges)) {
    if (!Number.isSafeInteger(Number(tag)) || Number(tag) < 0) throw new Error('Invalid TAG.');
    if (range === null) continue;
    if (!range || !Number.isFinite(range.low) || !Number.isFinite(range.high) || range.high <= range.low) throw new Error('Invalid TOF range.');
    const eject = lm.ejectBins[Math.abs(Number(tag)) % 2];
    if (!Number.isFinite(eject)) throw new Error('No ejection time for this TAG.');
    ranges.set(Number(tag), {low: eject + range.low * 10000, high: eject + range.high * 10000});
  }
  const counts = new Map();
  let totalIons = 0;
  const events = lm.events;
  for (let i = 0; i < events.length; i++) {
    if (events.channel[i] !== channel || events.edge[i] !== edge) continue;
    const sweep = events.sweep[i], range = ranges.get(events.tag[i]);
    if (sweep < sweepLow || sweep >= sweepHigh || !range || events.tof[i] < range.low || events.tof[i] >= range.high) continue;
    counts.set(sweep, (counts.get(sweep) || 0) + 1);
    totalIons++;
  }
  const totalSweeps = sweepHigh - sweepLow;
  const frequencies = new Map([[0, totalSweeps - counts.size]]);
  for (const count of counts.values()) frequencies.set(count, (frequencies.get(count) || 0) + 1);
  const ionsPerSweep = [...frequencies.keys()].sort((a, b) => a - b);
  const nonemptySweeps = counts.size;
  return {ionsPerSweep, sweeps: ionsPerSweep.map(count => frequencies.get(count)), totalIons, totalSweeps, nonemptySweeps,
    meanIonsPerSweep: nonemptySweeps ? totalIons / nonemptySweeps : null, settings: {channel, edge, sweepLow, sweepHigh, tagRanges}};
}
module.exports = {makeSweepDistribution};
