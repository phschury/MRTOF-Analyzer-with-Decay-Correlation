// CSV uses numeric nanoseconds, with uncertainties in separate columns.
function driftResultsCsv(data) {
  const cell = value => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  };
  const ns = value => Number.isFinite(value) ? Number((value * 1000).toPrecision(12)) : '';
  const headings = ['Source file','Channel','Edge','TAG','Sweeps per tranche','First sweep','Last sweep (exclusive)','Sweep midpoint','Events','Success','Center [ns after ejection]','Center uncertainty [ns]','FWHM [ns]','FWHM uncertainty [ns]','Reduced chi squared','Warning','Error'];
  const rows = data.results.map(row => [data.filename,data.channel,data.edge,data.tag,data.trancheSize,
    row.sweepLow,row.sweepHigh,row.sweepCenter,row.counts,row.success,
    ns(row.centerUs),ns(row.centerSigmaUs),ns(row.fwhmUs),ns(row.fwhmSigmaUs),row.reducedChi2,row.warning,row.error]);
  return [headings,...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
if (typeof module !== 'undefined') module.exports = { driftResultsCsv };
