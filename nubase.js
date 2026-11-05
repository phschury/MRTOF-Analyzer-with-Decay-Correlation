// nubase.js
// Minimal reusable NUBASE data module extracted from the renderer code.
// CommonJS module for Electron/Node.
//
// Usage:
//   const nubase = require("./nubase.js");
//   await nubase.loadNUBASE("./nubase_4.mas20.txt");
//   console.log(nubase.getMass("Rb85", 1));
//   console.log(nubase.getMz("1Rb85;2H1", 1));

const fs = require("fs/promises");

const ukeV = 931494.10372;
const eMasskeV = 510.99895069;

let NUBASE = [];
let nubaseByNuclide = new Map();

function stripLeadingZeroes(text) {
  const s = String(text ?? "").trim();
  const stripped = s.replace(/^0+/, "");
  return stripped.length ? stripped : "0";
}

function secondsFromHalfLife(value, unit) {
  if (!Number.isFinite(value)) return 0;

  switch (String(unit ?? "").trim()) {
    case "Py": return 1e12 * 365 * 24 * 3600 * value;
    case "Gy": return 1e9  * 365 * 24 * 3600 * value;
    case "My": return 1e6  * 365 * 24 * 3600 * value;
    case "ky": return 1e3  * 365 * 24 * 3600 * value;
    case "y":  return        365 * 24 * 3600 * value;
    case "d":  return              24 * 3600 * value;
    case "h":  return                   3600 * value;
    case "m":  return                     60 * value;
    case "s":  return value;
    case "ms": return 1e-3 * value;
    case "us": return 1e-6 * value;
    case "ns": return 1e-9 * value;
    default:   return 0;
  }
}

function finalParse(row) {

  row.nuclide = String(row.nuclide ?? "").trim();

  let element = "";
  for (let i = 0; i < row.nuclide.length; i++) {
    const c = row.nuclide.at(i);
    if (!(c >= "0" && c <= "9")) {
      element = row.nuclide.slice(i).trim();
      break;
    }
  }

  row.element = element;
  row.Z = parseInt(stripLeadingZeroes(row.Z), 10);
  row.A = parseInt(stripLeadingZeroes(row.A), 10);
  row.i = String(row.i ?? "").trim();

  row.state = String(row.state ?? "").trim();
  row.nuclide = row.element + row.A;
  if (["m", "n", "p", "q", "r", "x"].includes(row.state)) row.nuclide += row.state;

  row.MassTheory = false;
  row.MassExcess = String(row.MassExcess ?? "");

  if (row.MassExcess.includes("#")) {
    row.MassTheory = true;
    row.MassExcess = row.MassExcess.replace("#", "");
  }

  row.MassExcess = parseFloat(row.MassExcess);

  row.dMassExcess = parseFloat(
    String(row.dMassExcess ?? "").replace("#", "")
  );

  row.ExcitationEnergy = parseFloat(
    String(row.ExcitationEnergy ?? "").replace("#", "")
  );

  if (!Number.isFinite(row.ExcitationEnergy)) {
    row.ExcitationEnergy = 0;
  }

  row.dExcitationEnergy = parseFloat(
    String(row.dExcitationEnergy ?? "").replace("#", "")
  );

  if (!Number.isFinite(row.dExcitationEnergy)) {
    row.dExcitationEnergy = 0;
  }

  row.isIsomer = row.i === "1" || row.i === "2";
  row.isLevel = row.i === "3" || row.i === "4";
  row.isResonances = row.i === "5";
  row.isIAS = row.i === "8" || row.i === "9";

  row.Halflife = String(row.Halflife ?? "").trim();
  row.t12unit = String(row.t12unit ?? "").trim();

  row.dHalflife = parseFloat(
    String(row.dHalflife ?? "").trim()
  );

  if (!Number.isFinite(row.dHalflife)) {
    row.dHalflife = 0;
  }

  row.BR = String(row.BR ?? "");
  row.isStable = row.Halflife === "stbl";

  if (row.isStable) {
    row.halflifeSeconds = 1e14;

    const m = row.BR.match(/IS\s+([0-9.]+)/);
    row.abundance = m ? parseFloat(m[1]) : 0;
  }
  else {
    const halfLifeValue = parseFloat(row.Halflife);

    row.Halflife = Number.isFinite(halfLifeValue)
      ? halfLifeValue
      : 0;

    row.halflifeSeconds = secondsFromHalfLife(
      row.Halflife,
      row.t12unit
    );

    const m = row.BR.match(/IS\s+([0-9.]+)/);
    row.abundance = m ? parseFloat(m[1]) : 0;
  }

  return row;
}

function parseNUBASEText(text) {

  const rows = [];
  const map = new Map();

  const lines = String(text).split(/\r\n|\n/);

  for (const line of lines) {

    if (!line || line.at(0) === "#") continue;
    if (line.length < 31) continue;

    let row = {
      A: line.slice(0, 3),
      Z: line.slice(4, 7),
      i: line.at(7),
      nuclide: line.slice(11, 16),
      element: "",
      state: line.at(16),

      MassExcess: line.slice(18, 31),
      dMassExcess: line.slice(31, 42),

      MassTheory: false,
      isIsomer: false,
      isLevel: false,
      isResonances: false,
      isIAS: false,
      isStable: false,

      stateOrigin: line.slice(65, 67),
      isomericOrder: line.slice(67, 69),

      ExcitationEnergy: line.slice(42, 54),
      dExcitationEnergy: line.slice(54, 65),

      Halflife: line.slice(69, 78),
      t12unit: line.slice(78, 80),
      dHalflife: line.slice(81, 88),

      halflifeSeconds: 0,

      spin: line.slice(88, 102),
      ensdfYear: line.slice(102, 104),
      discoYear: line.slice(114, 118),

      abundance: 0,
      BR: line.slice(119, 209)
    };

    row = finalParse(row);

    rows.push(row);

    if (!map.has(row.nuclide)) {
      map.set(row.nuclide, row);
    }
  }

  return {
    rows,
    map
  };
}

async function loadNUBASE(path = "nubase_4.mas20.txt") {

  const text = await fs.readFile(path, "utf8");

  const parsed = parseNUBASEText(text);

  NUBASE = parsed.rows;
  nubaseByNuclide = parsed.map;

  return NUBASE;
}

function setNUBASEFromText(text) {

  const parsed = parseNUBASEText(text);

  NUBASE = parsed.rows;
  nubaseByNuclide = parsed.map;

  return NUBASE;
}

function parseFormula(formula) {

  if (typeof formula !== "string" || formula.trim() === "") {
    return [];
  }

  const parts = formula.split(/;|:/).map(p => p.trim());
  const atoms = [];
  for (const part of parts) {
    const match = part.match(/^(\d*)([A-Za-z][A-Za-z0-9]*)$/);
    if (!match) return [];
    const count = match[1] === "" ? 1 : Number(match[1]);
    if (!Number.isSafeInteger(count) || count <= 0) return [];
    atoms.push({nuclide: match[2], count});
  }

  return atoms;
}

function getNuclide(nuclide) {
  return nubaseByNuclide.get(nuclide);
}

function checkFormula(formula) {

  const atoms = parseFormula(formula);

  if (atoms.length === 0) return false;

  return atoms.every(atom =>
    Number.isFinite(atom.count) &&
    atom.count > 0 &&
    nubaseByNuclide.has(atom.nuclide)
  );
}

function getNeutralMassKeV(formula) {

  const atoms = parseFormula(formula);

  if (atoms.length === 0) {
    throw new Error("Empty formula");
  }

  let massKeV = 0;

  for (const atom of atoms) {

    const data = getNuclide(atom.nuclide);

    if (!data) {
      throw new Error(
        "Unknown nuclide: " + atom.nuclide
      );
    }

    massKeV += atom.count * (
      data.A * ukeV +
      data.MassExcess
    );
  }

  return massKeV;
}

function getMass(formula, charge = 1) {

  const q = parseFloat(charge);

  const ionMassKeV =
    getNeutralMassKeV(formula) -
    q * eMasskeV;

  return ionMassKeV / ukeV;
}

function getMz(formula, charge = 1) {

  const q = parseFloat(charge);

  return getMass(formula, q) / q;
}

function getMassExcess(formula, charge = 0) {

  const q = parseFloat(charge);

  const massU = getMass(formula, q);

  const nominalA = parseFormula(formula)
    .reduce((sum, atom) => {

      const data = getNuclide(atom.nuclide);

      if (!data) {
        throw new Error(
          "Unknown nuclide: " + atom.nuclide
        );
      }

      return sum + atom.count * data.A;

    }, 0);

  return (
    (massU - nominalA) * ukeV +
    q * eMasskeV
  );
}

function getMarkup(formula, charge = 1) {

  const atoms = parseFormula(formula);

  let markup = "";

  for (const atom of atoms) {

    const data = getNuclide(atom.nuclide);

    if (!data) {
      throw new Error(
        "Unknown nuclide: " + atom.nuclide
      );
    }

    let atomMarkup =
      `<sup>${data.A}</sup>${data.element}`;

    if (atom.count > 1) {
      atomMarkup += `<sub>${atom.count}</sub>`;
    }

    markup += atomMarkup;
  }

  const q = parseFloat(charge);

  if (q === 1) {
    markup += "<sup>+</sup>";
  }
  else if (q > 1) {
    markup += `<sup>${q}+</sup>`;
  }

  return markup;
}

function howRadioactive(formula) {

  const atoms = parseFormula(formula);

  let numRI = 0;

  for (const atom of atoms) {

    const data = getNuclide(atom.nuclide);

    if (!data) {
      throw new Error(
        "Unknown nuclide: " + atom.nuclide
      );
    }

    if (parseFloat(data.abundance) === 0) {
      numRI += atom.count;
    }
  }

  return numRI;
}

function getIsotopesForElement(
  element,
  options = {}
) {

  const {
    minAbundance = 0,
    maxRadioactive = Infinity,
    minHalflifeSeconds = 0
  } = options;

  const isotopes = [];

  for (const row of NUBASE) {

    if (row.element !== element) continue;

    const abundance =
      parseFloat(row.abundance) || 0;

    const radioactive = abundance === 0;

    if (abundance > minAbundance) {

      isotopes.push(row.nuclide);

    }
    else if (
      maxRadioactive > 0 &&
      radioactive &&
      row.halflifeSeconds > minHalflifeSeconds
    ) {

      isotopes.push(row.nuclide);
    }
  }

  return isotopes;
}

function getAllNuclides() {
  return NUBASE;
}

function getNuclideMap() {
  return nubaseByNuclide;
}

module.exports = {

  ukeV,
  eMasskeV,

  loadNUBASE,
  setNUBASEFromText,
  parseNUBASEText,
  finalParse,

  parseFormula,
  checkFormula,

  getNuclide,
  getAllNuclides,
  getNuclideMap,

  getNeutralMassKeV,
  getMass,
  getMz,
  getMassExcess,
  getMarkup,
  howRadioactive,
  getIsotopesForElement
};