// listmode.js
//
// Node/Electron parser for MRTOF .lst list-mode files.
// Based on objListModeData.m / objListModeData.h.

const fs = require("fs");
const { DEFAULTS } = require("./preferences.js");

const BINS_PER_NS = 10;
const EJECT_ACCEPT_START_BINS = 5000;
const BINS_PER_US = BINS_PER_NS * 1000;

const MAX_LAG = 256;
const MINIMUM_IONS_BETWEEN_ROLLOVERS = 1000;
const MAXIMUM_SWEEPS_BETWEEN_IONS = 32000;

function lastBits(k, n) {
  return k & ((1n << BigInt(n)) - 1n);
}

function midBits(k, m, n) {
  return lastBits(k >> BigInt(m), n - m);
}

class ListModeData {
  constructor() {
    this.headerLines = [];
    this.header = {};
    this.cmline = {};
    this.timePatch = "";
    this.firstDataLine = -1;

    this.startTime = null;
    this.stopTime = null;

    this.ejectNs = [0, 0];
    this.ejectBins = [0, 0];

    this.masterPeriodUs = null;
    this.sweepPeriodUs = null;
    this.sweepRateHz = null;

    this.events = null;

    // Values observed in the decoded file before channel/edge filtering.
    this.observedChannels = new Set();
    this.observedTags = new Set();
    this.observedEdges = new Set();

    this.stats = {
      rawDataLines: 0,
      decodedEvents: 0,
      acceptedEvents: 0,
      rejectedZeroTof: 0,
      rejectedByEjectWindow: 0,
      rejectedMalformed: 0,
      ignoredTag3: 0,
      rejectedByChannel: 0,
      rejectedByEdge: 0,
    };
  }
}

function loadListModeFile(filename, optionsOrChannel = {}, edgeSpecifier = undefined) {
  const text = fs.readFileSync(filename, "utf8");
  return parseListModeText(text, optionsOrChannel, edgeSpecifier);
}

function parseListModeText(text, optionsOrChannel = {}, edgeSpecifier = undefined) {
  const options = normalizeParseOptions(optionsOrChannel, edgeSpecifier);
  const lm = new ListModeData();

  const lines = splitLines(text);

  const dataIndex = lines.findIndex((line) => line.trim() === "[DATA]");
  if (dataIndex < 0) {
    throw new Error("Could not find [DATA] line in list-mode file.");
  }

  lm.firstDataLine = dataIndex + 1;
  lm.headerLines = lines.slice(0, lm.firstDataLine);

  parseHeaderLines(lm);

  const decoder = makeDecoder(lm.timePatch);
  const processed = lm.header.correlyzer_processed === '1';
  let sweepRuns = [];
  if (processed) {
    sweepRuns = JSON.parse(lm.header.correlyzer_sweep_runs || '[]');
    if (!Array.isArray(sweepRuns) || sweepRuns.some((run,i) => !Array.isArray(run) || run.length !== 2 ||
        !Number.isSafeInteger(run[0]) || run[0] < 0 || !Number.isSafeInteger(run[1]) ||
        (i === 0 ? run[0] !== 0 : run[0] <= sweepRuns[i-1][0]))) {
      throw new Error('Invalid saved sweep numbering.');
    }
  }
  let savedSweepRun = 0;

  const maxPossibleEvents = lines.length - lm.firstDataLine;

  const tof = new Float64Array(maxPossibleEvents);
  const sweep = new Int32Array(maxPossibleEvents);
  const rawSweep = new Int32Array(maxPossibleEvents);
  const tag = new Int32Array(maxPossibleEvents);
  const channel = new Int16Array(maxPossibleEvents);
  const edge = new Int8Array(maxPossibleEvents);
  const raw = new Array(maxPossibleEvents);

  let kept = 0;

  let maxTag = 0;
  let lastSweep = 0;
  let overruns = 0;

  let ionNumber = 0;
  let ionNumberAtLastRollover = 0;
  let ignoreTAG3 = false;

  const seenTags = new Set();

  for (let lineNumber = lm.firstDataLine; lineNumber < lines.length; lineNumber++) {
    const line = lines[lineNumber].trim();
    if (!line) continue;

    lm.stats.rawDataLines++;

    const decoded = decoder(line);

    if (!decoded) {
      lm.stats.rejectedMalformed++;
      continue;
    }

    ionNumber++;

    let evt = decoded;

    if (evt.tag > maxTag) maxTag = evt.tag;

    // Objective-C special handling for time_patch=5b
    if (processed) {
      const eventIndex = lm.stats.decodedEvents;
      while (savedSweepRun + 1 < sweepRuns.length && sweepRuns[savedSweepRun + 1][0] <= eventIndex) savedSweepRun++;
      evt.sweep = evt.rawSweep + (sweepRuns[savedSweepRun]?.[1] || 0);
    } else if (lm.timePatch === "5b") {
      if (evt.tag > 30000) {
        evt.tag = 3;
        ignoreTAG3 = true;
      }

      if (!seenTags.has(evt.tag)) {
        seenTags.add(evt.tag);
      }

      const keepGoing = evt.tag !== 3 || !ignoreTAG3;
      if (!keepGoing) {
        lm.stats.ignoredTag3++;
        continue;
      }

      const thisSweep = evt.rawSweep;

      if (thisSweep < lastSweep) {
        if (
          Math.abs(lastSweep - thisSweep) > MAX_LAG &&
          ionNumber - ionNumberAtLastRollover > MINIMUM_IONS_BETWEEN_ROLLOVERS
        ) {
          overruns++;
          ionNumberAtLastRollover = ionNumber;
        }

        lastSweep = thisSweep;
        evt.sweep = thisSweep + 65534 * overruns;
      } else if (thisSweep - lastSweep > MAXIMUM_SWEEPS_BETWEEN_IONS) {
        lastSweep = thisSweep;
        evt.sweep = thisSweep + 65534 * (overruns - 1);
      } else {
        lastSweep = thisSweep;
        evt.sweep = thisSweep + 65534 * overruns;
      }
    } else if (lm.timePatch === "2a") {
      const thisSweep = evt.rawSweep;

      if (thisSweep < lastSweep) {
        if (Math.abs(lastSweep - thisSweep) > 32) overruns++;
      }

      lastSweep = thisSweep;
      evt.sweep = thisSweep + 256 * overruns;
    } else if (lm.timePatch === "f3") {
      const thisSweep = evt.rawSweep;

      if (thisSweep < lastSweep) overruns++;

      lastSweep = thisSweep;
      evt.sweep = thisSweep + 128 * overruns;
    }

    lm.stats.decodedEvents++;

    // Record all successfully decoded values before user filtering.
    lm.observedChannels.add(evt.channel);
    lm.observedTags.add(evt.tag);
    lm.observedEdges.add(evt.edge ? 1 : 0);

    if (!matchesChannelAndEdgeFilters(evt, options)) {
      if (options.channel !== undefined && evt.channel !== options.channel) {
        lm.stats.rejectedByChannel++;
      } else {
        lm.stats.rejectedByEdge++;
      }
      continue;
    }

    if (evt.tof === 0) {
      lm.stats.rejectedZeroTof++;
      continue;
    }

    if (!processed && !isInsideEjectionWindow(evt, lm.ejectBins, options.ejectionBreakUs * BINS_PER_US)) {
      lm.stats.rejectedByEjectWindow++;
      continue;
    }

    tof[kept] = evt.tof;
    sweep[kept] = evt.sweep;
    rawSweep[kept] = evt.rawSweep;
    tag[kept] = evt.tag;
    channel[kept] = evt.channel;
    edge[kept] = evt.edge ? 1 : 0;
    raw[kept] = evt.rawHex;

    kept++;
  }

  lm.stats.acceptedEvents = kept;

  lm.events = {
    length: kept,
    // Copy into right-sized buffers so rejected noise does not retain storage.
    tof: tof.slice(0, kept),
    sweep: sweep.slice(0, kept),
    rawSweep: rawSweep.slice(0, kept),
    tag: tag.slice(0, kept),
    channel: channel.slice(0, kept),
    edge: edge.slice(0, kept),
    raw: raw.slice(0, kept),
  };

  if(processed && lm.header.correlyzer_energy_delays!==undefined){
    const delays=JSON.parse(lm.header.correlyzer_energy_delays);
    if(!Array.isArray(delays) || delays.length!==kept || delays.some(value=>value!==null && (!Number.isFinite(value) || value<0)))throw new Error('Invalid saved energy correlation times.');
    lm.events.energyDelaySeconds=Float64Array.from(delays,value=>value===null?NaN:value);
    lm.energyDelayDirection=lm.header.correlyzer_energy_delay_direction==='next'?'next':null;
    lm.energyDelaySource=lm.header.correlyzer_energy_delay_source==='box-sum'?'box-sum':null;
    if(lm.header.correlyzer_energy_events!==undefined){
      const details=JSON.parse(lm.header.correlyzer_energy_events);
      if(!Array.isArray(details) || details.length!==kept || details.some(row=>row!==null && (!Array.isArray(row) || row.length!==3 || !Number.isFinite(row[0]) || !Number.isInteger(row[1]) || row[1]< -1 || row[1]>65535 || !Number.isInteger(row[2]) || row[2]<11 || row[2]>15)))throw new Error('Invalid saved energy event details.');
      lm.events.energyDecayKeV=Float64Array.from(details,row=>row===null?NaN:row[0]);
      lm.events.energyDecayModule=Int32Array.from(details,row=>row===null?-1:row[1]);
      lm.events.energyDecayChannel=Int32Array.from(details,row=>row===null?-1:row[2]);
    }
  }

  return lm;
}

function normalizeParseOptions(optionsOrChannel, edgeSpecifier) {
  const options = { ejectionBreakUs: DEFAULTS.ejectionBreakUs };

  if (
    optionsOrChannel !== null &&
    typeof optionsOrChannel === "object" &&
    !Array.isArray(optionsOrChannel)
  ) {
    if (optionsOrChannel.ejectionBreakUs !== undefined) {
      const cutoff = Number(optionsOrChannel.ejectionBreakUs);
      if (!Number.isFinite(cutoff) || cutoff <= 0) {
        throw new Error("ejectionBreakUs must be a positive finite number.");
      }
      options.ejectionBreakUs = cutoff;
    }

    if (optionsOrChannel.channel !== undefined) {
      options.channel = normalizeIntegerOption(optionsOrChannel.channel, "channel");
    }

    if (optionsOrChannel.edge !== undefined) {
      options.edge = normalizeIntegerOption(optionsOrChannel.edge, "edge");
    }
  } else if (optionsOrChannel !== undefined) {
    options.channel = normalizeIntegerOption(optionsOrChannel, "channel");
  }

  if (edgeSpecifier !== undefined) {
    options.edge = normalizeIntegerOption(edgeSpecifier, "edge");
  }

  return options;
}

function normalizeIntegerOption(value, name) {
  if (value === null || value === "") return undefined;

  const number = Number(value);

  if (!Number.isInteger(number)) {
    throw new Error(`${name} filter must be an integer if specified.`);
  }

  return number;
}

function matchesChannelAndEdgeFilters(evt, options) {
  if (options.channel !== undefined && evt.channel !== options.channel) {
    return false;
  }

  if (options.edge !== undefined && evt.edge !== options.edge) {
    return false;
  }

  return true;
}

function splitLines(text) {
  // Acquisition headers can contain embedded CRs, and older exports mixed
  // their inherited CRLF header lines with LF event records.
  return text.split(/\r\n|\n|\r/);
}

function parseHeaderLines(lm) {
  for (const line of lm.headerLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const eq = trimmed.indexOf("=");
    if (eq >= 0) {
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();

      lm.header[key] = value;

      const cm = key.match(/^cmline(\d+)$/i);
      if (cm) {
        lm.cmline[Number(cm[1])] = value;
      }

      if (key === "time_patch") {
        lm.timePatch = value;
      }
    }
  }

  parseDate(lm);
  parseEjectionInfo(lm);
  parseRateInfo(lm);

  if (!lm.timePatch) {
    throw new Error("Could not find time_patch= in list-mode header.");
  }
}

function parseDate(lm) {
  const cm0 = lm.cmline[0];
  if (!cm0) return;

  const dateString = cm0.trim();

  const m = dateString.match(
    /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:\s|$)/
  );

  if (!m) {
    lm.header.dateString = dateString;
    return;
  }

  const [, MM, DD, YYYY, hh, mm, ss, fraction = ""] = m;

  const date = new Date(
    Number(YYYY),
    Number(MM) - 1,
    Number(DD),
    Number(hh),
    Number(mm),
    Number(ss),
    Number((fraction + "000").slice(0, 3))
  );

  lm.header.dateString = dateString;
  lm.startTime = date;
  lm.stopTime = new Date(date.getTime() + 1000);
}

function parseEjectionInfo(lm) {
  const cm2 = lm.cmline[2];
  if (!cm2) return;

  if (!cm2.startsWith("TP:")) return;

  const strEjInfo = cm2.slice(3);
  const parts = strEjInfo.split(",").map((v) => v.trim());

  if (parts.length >= 3) {
    const eject0us = Number.parseFloat(parts[1]);
    const eject1us = Number.parseFloat(parts[2]);

    if (Number.isFinite(eject0us) && Number.isFinite(eject1us)) {
      lm.ejectNs = [eject0us * 1000, eject1us * 1000];
      lm.ejectBins = lm.ejectNs.map((ns) => lm.header.correlyzer_processed === "1" ? ns * BINS_PER_NS : Math.round(ns * BINS_PER_NS));
    }
  }
}

function parseRateInfo(lm) {
  const cm3 = lm.cmline[3];
  if (!cm3) return;

  // MP is a master cycle containing two recorded sweeps (alternating TAGs).
  // Legacy P metadata already specifies the duration of one recorded sweep.
  const match = cm3.match(/(?:^|[\s,])(MP|P)\s*:\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/i);
  if (!match) return;
  const periodUs = Number(match[2]);
  if (!Number.isFinite(periodUs) || periodUs <= 0) return;

  const isMaster = match[1].toUpperCase() === "MP";
  lm.masterPeriodUs = isMaster ? periodUs : null;
  lm.sweepPeriodUs = isMaster ? periodUs / 2 : periodUs;
  lm.sweepRateHz = 1e6 / lm.sweepPeriodUs;
}

function isInsideEjectionWindow(evt, ejectBins, acceptEndBins) {
  if (!ejectBins || ejectBins.length < 2) return true;

  if (!ejectBins[0] && !ejectBins[1]) {
    return true;
  }

  const ejectIndex = Math.abs(evt.tag) % 2;
  const ejectBin = ejectBins[ejectIndex];

  if (!Number.isFinite(ejectBin)) return true;

  const dtBins = evt.tof - ejectBin;

  return (
    dtBins >= EJECT_ACCEPT_START_BINS &&
    dtBins <= acceptEndBins
  );
}

function makeDecoder(timePatch) {
  if (timePatch === "2a") return decode2a;
  if (timePatch === "f3") return decodeF3;
  if (timePatch === "5b") return decode5b;
  if (timePatch === "1a") return decode1a;

  throw new Error(`Unsupported time_patch=${timePatch}`);
}

function parseHexLine(line, expectedLength) {
  if (line.length !== expectedLength) return null;
  if (!/^[0-9a-fA-F]+$/.test(line)) return null;
  if (/^0+$/.test(line)) return null;

  return BigInt("0x" + line);
}

function decode2a(line) {
  const listVal = parseHexLine(line, 12);
  if (listVal === null) return null;

  const channelNumber = Number(midBits(listVal, 0, 3));
  const edge = Number(midBits(listVal, 3, 4));
  const binNumber = Number(midBits(listVal, 4, 32));
  const sweepNumber = Number(midBits(listVal, 32, 40));
  let tagNumber = Number(midBits(listVal, 40, 48));

  tagNumber = tagNumber + 2 * channelNumber;

  return {
    rawHex: line,
    channel: 2 * channelNumber,
    edge,
    tof: binNumber,
    rawSweep: sweepNumber,
    sweep: sweepNumber,
    tag: tagNumber,
  };
}

function decodeF3(line) {
  const listVal = parseHexLine(line, 16);
  if (listVal === null) return null;

  const channelNumber = Number(midBits(listVal, 0, 3));
  const edge = Number(midBits(listVal, 3, 4));
  const binNumberA = Number(midBits(listVal, 4, 32));
  const binNumberB = Number(midBits(listVal, 32, 40));
  const binNumber = binNumberA + 268435456 * binNumberB;
  const sweepNumber = Number(midBits(listVal, 40, 47));
  let tagNumber = Number(midBits(listVal, 48, 63));

  tagNumber = tagNumber + 2 * channelNumber;

  return {
    rawHex: line,
    channel: 2 * channelNumber,
    edge,
    tof: binNumber,
    rawSweep: sweepNumber,
    sweep: sweepNumber,
    tag: tagNumber,
  };
}

function decode5b(line) {
  const listVal = parseHexLine(line, 16);
  if (listVal === null) return null;

  const channelNumber = Number(midBits(listVal, 0, 2));
  const edge = Number(midBits(listVal, 3, 4));
  const binNumber = Number(midBits(listVal, 4, 32));
  const sweepNumber = Number(midBits(listVal, 32, 48));
  let tagNumber = Number(midBits(listVal, 48, 63));

  tagNumber = tagNumber + 2 * channelNumber;

  return {
    rawHex: line,
    channel: channelNumber,
    edge,
    tof: binNumber,
    rawSweep: sweepNumber,
    sweep: sweepNumber,
    tag: tagNumber,
  };
}

function decode1a(line) {
  const listVal = parseHexLine(line, 12);
  if (listVal === null) return null;

  const channelNumber = Number(midBits(listVal, 0, 2));
  const edge = Number(midBits(listVal, 3, 4));
  const binNumber = Number(midBits(listVal, 4, 32));
  const sweepNumber = Number(midBits(listVal, 32, 48));

  return {
    rawHex: line,
    channel: channelNumber,
    edge,
    tof: binNumber,
    rawSweep: sweepNumber,
    sweep: sweepNumber,
    tag: 0,
  };
}

module.exports = {
  loadListModeFile,
  parseListModeText,
  ListModeData,
};
