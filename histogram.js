// histogram.js
//
// Histogram utilities for MRTOF list-mode data parsed by listmode.js.
//
// Main functions:
//   makeTofHistogramsByTag(lm, options)
//   makeTofHistogramsByTagAndSweep(lm, options)
//   makeChartJsTofDatasets(histResult, options)
//
// Time units:
//   TOF values, tLow, tHigh, binWidth, ejectBins, and bin centers are
//   in raw 100 ps bins.
//
// Default time range:
//   [ejectBin, ejectBin + 400000)
// i.e. first 40 us after selected TAG ejection trigger.
//

const DEFAULT_SPAN_BINS = 400000; // 40 us at 100 ps/bin
const BINS_PER_US = 10000;        // 1 us / 100 ps

function makeTofHistogramsByTag(lm, options = {}) {
  return makeTofHistogramsByTagAndSweep(lm, {
    ...options,
    sweepLow: undefined,
    sweepHigh: undefined,
  });
}

function makeTofHistogramsByTagAndSweep(lm, options = {}) {
  validateListModeObject(lm);

  const binWidth = requirePositiveInteger(options.binWidth, "binWidth");
  const tagList = normalizeTagSelection(options.TAGnum, lm);

  const sweepLow = options.sweepLow;
  const sweepHigh = options.sweepHigh;

  if (sweepLow !== undefined && !Number.isFinite(sweepLow)) {
    throw new Error("sweepLow must be finite when provided.");
  }

  if (sweepHigh !== undefined && !Number.isFinite(sweepHigh)) {
    throw new Error("sweepHigh must be finite when provided.");
  }

  if (
    sweepLow !== undefined &&
    sweepHigh !== undefined &&
    sweepHigh <= sweepLow
  ) {
    throw new Error("sweepHigh must be greater than sweepLow.");
  }

  const cmlineData = makeCmlineData(lm);

  const histograms = [];

  for (const TAGnum of tagList) {
    const ejectBin = getEjectBinForTag(lm, TAGnum);

    const tLow =
      options.tLow !== undefined
        ? requireFiniteNumber(options.tLow, "tLow")
        : ejectBin;

    const tHigh =
      options.tHigh !== undefined
        ? requireFiniteNumber(options.tHigh, "tHigh")
        : ejectBin + DEFAULT_SPAN_BINS;

    if (tHigh <= tLow) {
      throw new Error("tHigh must be greater than tLow.");
    }

    const nBins = Math.ceil((tHigh - tLow) / binWidth);
    const counts = new Uint32Array(nBins);

    let acceptedEvents = 0;
    let inputEventsForTag = 0;
    let firstSweep = Infinity;
    let lastSweep = -Infinity;

    for (let i = 0; i < lm.events.length; i++) {
      if (lm.events.tag[i] !== TAGnum) continue;

      inputEventsForTag++;

      const sw = lm.events.sweep[i];

      if (sweepLow !== undefined && sw < sweepLow) continue;
      if (sweepHigh !== undefined && sw >= sweepHigh) continue;

      const t = lm.events.tof[i];

      if (t < tLow || t >= tHigh) continue;

      const bin = Math.floor((t - tLow) / binWidth);

      if (bin >= 0 && bin < nBins) {
        counts[bin]++;
        acceptedEvents++;

        if (sw < firstSweep) firstSweep = sw;
        if (sw > lastSweep) lastSweep = sw;
      }
    }

    const binEdges = new Float64Array(nBins + 1);
    const binCenters = new Float64Array(nBins);

    for (let i = 0; i <= nBins; i++) {
      binEdges[i] = tLow + i * binWidth;
    }

    for (let i = 0; i < nBins; i++) {
      binCenters[i] = tLow + (i + 0.5) * binWidth;
    }

    histograms.push({
      TAGnum,

      ejectBin,
      ejectNs: ejectBin / 10,
      ejectUs: ejectBin / BINS_PER_US,

      startTime: lm.startTime ?? null,

      cmline: cmlineData,

      sweepRange: {
        requestedLow: sweepLow ?? null,
        requestedHigh: sweepHigh ?? null,
        observedLow: Number.isFinite(firstSweep) ? firstSweep : null,
        observedHighExclusive: Number.isFinite(lastSweep) ? lastSweep + 1 : null,
      },

      binWidth,
      binWidthUs: binWidth / BINS_PER_US,
      tLow,
      tHigh,
      tLowUs: tLow / BINS_PER_US,
      tHighUs: tHigh / BINS_PER_US,
      nBins,

      counts,
      binEdges,
      binCenters,

      inputEventsForTag,
      acceptedEvents,
    });
  }

  return {
    binWidth,
    binWidthUs: binWidth / BINS_PER_US,

    tLow: options.tLow ?? null,
    tHigh: options.tHigh ?? null,
    tLowUs: options.tLow !== undefined ? options.tLow / BINS_PER_US : null,
    tHighUs: options.tHigh !== undefined ? options.tHigh / BINS_PER_US : null,

    sweepLow: sweepLow ?? null,
    sweepHigh: sweepHigh ?? null,

    startTime: lm.startTime ?? null,

    cmline: cmlineData,

    listModeInfo: {
      timePatch: lm.timePatch ?? null,
      ejectNs: lm.ejectNs ? [...lm.ejectNs] : [],
      ejectBins: lm.ejectBins ? [...lm.ejectBins] : [],
      sweepPeriodUs: lm.sweepPeriodUs ?? null,
      sweepRateHz: lm.sweepRateHz ?? null,
      stats: lm.stats ? { ...lm.stats } : {},
    },

    histograms,
  };
}

function makeChartJsTofDatasets(histResult, options = {}) {
  if (!histResult || !Array.isArray(histResult.histograms)) {
    throw new Error("Expected result from makeTofHistogramsByTag().");
  }

  const xUnits = options.xUnits ?? "us"; // "us" or "bins"
  const useRelativeTime = options.relativeToEject ?? true;
  const stepped = options.stepped ?? true;

  const datasets = histResult.histograms.map((hist) => {
    const data = [];

    for (let i = 0; i < hist.nBins; i++) {
      let x = hist.binCenters[i];

      if (useRelativeTime) {
        x -= hist.ejectBin;
      }

      if (xUnits === "us") {
        x /= BINS_PER_US;
      } else if (xUnits !== "bins") {
        throw new Error('xUnits must be "us" or "bins".');
      }

      data.push({
        x,
        y: hist.counts[i],
        tofUs: hist.binCenters[i] / BINS_PER_US,
      });
    }

    return {
      label: `TAG ${hist.TAGnum}`,
      data,
      parsing: false,
      stepped,

      // Extra metadata retained for tooltips, legends, exporting, etc.
      TAGnum: hist.TAGnum,
      ejectBin: hist.ejectBin,
      ejectNs: hist.ejectNs,
      ejectUs: hist.ejectUs,
      binWidth: hist.binWidth,
      binWidthUs: hist.binWidthUs,
      tLow: hist.tLow,
      tHigh: hist.tHigh,
      tLowUs: hist.tLowUs,
      tHighUs: hist.tHighUs,
      sweepRange: hist.sweepRange,
      acceptedEvents: hist.acceptedEvents,
      inputEventsForTag: hist.inputEventsForTag,
      startTime: hist.startTime,
      cmline: hist.cmline,
    };
  });

  return {
    datasets,

    // Useful top-level metadata for Chart.js plugins or plot annotations.
    metadata: {
      xUnits,
      relativeToEject: useRelativeTime,
      binWidth: histResult.binWidth,
      binWidthUs: histResult.binWidthUs,
      sweepLow: histResult.sweepLow,
      sweepHigh: histResult.sweepHigh,
      startTime: histResult.startTime,
      cmline: histResult.cmline,
      listModeInfo: histResult.listModeInfo,
    },
  };
}

function makeCmlineData(lm) {
  const cmline = {};

  if (lm.cmline && typeof lm.cmline === "object") {
    for (const [key, value] of Object.entries(lm.cmline)) {
      cmline[key] = value;
    }
  }

  return {
    raw: cmline,

    cmline0: cmline[0] ?? null,
    cmline1: cmline[1] ?? null,
    cmline2: cmline[2] ?? null,
    cmline3: cmline[3] ?? null,
    cmline4: cmline[4] ?? null,
    cmline5: cmline[5] ?? null,
    cmline6: cmline[6] ?? null,
    cmline7: cmline[7] ?? null,
    cmline8: cmline[8] ?? null,
    cmline9: cmline[9] ?? null,

    dateString: lm.header?.dateString ?? null,
    timePatch: lm.timePatch ?? null,

    ejectNs: lm.ejectNs ? [...lm.ejectNs] : [],
    ejectBins: lm.ejectBins ? [...lm.ejectBins] : [],

    sweepPeriodUs: lm.sweepPeriodUs ?? null,
    sweepRateHz: lm.sweepRateHz ?? null,
  };
}

function getEjectBinForTag(lm, TAGnum) {
  if (!lm.ejectBins || lm.ejectBins.length < 2) {
    return 0;
  }

  const idx = Math.abs(TAGnum) % 2;
  const ejectBin = lm.ejectBins[idx];

  if (!Number.isFinite(ejectBin)) {
    return 0;
  }

  return ejectBin;
}

function normalizeTagSelection(TAGnum, lm) {
  if (TAGnum === undefined || TAGnum === null || TAGnum === "all") {
    return getUniqueTags(lm);
  }

  if (Array.isArray(TAGnum)) {
    if (TAGnum.length === 0) {
      throw new Error("TAGnum array must not be empty.");
    }

    return [...new Set(TAGnum.map((t) => requireInteger(t, "TAGnum")))].sort(
      (a, b) => a - b
    );
  }

  return [requireInteger(TAGnum, "TAGnum")];
}

function getUniqueTags(lm) {
  const tags = new Set();

  for (let i = 0; i < lm.events.length; i++) {
    tags.add(lm.events.tag[i]);
  }

  return [...tags].sort((a, b) => a - b);
}

function validateListModeObject(lm) {
  if (!lm || typeof lm !== "object") {
    throw new Error("Expected lm object from loadListModeFile().");
  }

  if (!lm.events || typeof lm.events !== "object") {
    throw new Error("lm.events is missing.");
  }

  const required = ["tof", "tag", "sweep", "length"];

  for (const key of required) {
    if (lm.events[key] === undefined) {
      throw new Error(`lm.events.${key} is missing.`);
    }
  }
}

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return value;
}

function requireInteger(value, name) {
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer.`);
  }

  return value;
}

function requireFiniteNumber(value, name) {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite.`);
  }

  return value;
}

module.exports = {
  makeTofHistogramsByTag,
  makeTofHistogramsByTagAndSweep,
  makeChartJsTofDatasets,
};