// Understand tile descriptions as they are written in the godown sheets, e.g.
//   "1005-ESS-GVT"                                   -> design 1005, GVT
//   "1055P-ESS-PGVT"                                 -> design 1055P (base 1055), PGVT
//   "[4029-XKS] ECO-PARANAT GVT MATT 4029 (600X600)" -> design 4029, Paranat, GVT, Matt, Economy
//   "9645-EGS-VOX SMOK-DC"                           -> design 9645, Vox Smok, DC
//   "222 M" / "141 MATT" / "3552 GVT" / 366          -> design + finish/type
//   "PL WHITE" / "MIX COLOUR"                         -> no number: the text is the code
// and sheet names / titles such as "PRM 60X60 GVT & PGVT" or "STANDARD GVT&PGVT 600X1200".

import { sizeLabel } from './sizes.js';

export const GRADE_WORDS = {
  PRM: 'Premium', PREM: 'Premium', PREMIUM: 'Premium', PRE: 'Premium',
  STD: 'Standard', STANDARD: 'Standard', STAND: 'Standard',
  ECO: 'Economy', ECONOMY: 'Economy', ECON: 'Economy',
  COMMERCIAL: 'Commercial',
};

export const TYPE_WORDS = {
  GVT: 'GVT', PGVT: 'PGVT', RGVT: 'RGVT', DC: 'DC', DCVT: 'DC', FB: 'FB', FULLBODY: 'FB',
  SSW: 'SSW', CERAMIC: 'Ceramic', CERAMICS: 'Ceramic', PORCELAIN: 'Porcelain', CEGRES: 'Cegres',
};

export const FINISH_WORDS = {
  SHINE: 'Shine', GLOSSY: 'Glossy', GLOSS: 'Glossy', MATT: 'Matt', MATTE: 'Matt', MAT: 'Matt',
  NANO: 'Nano', HG: 'HG', RUSTIC: 'Rustic', RUSTRIC: 'Rustic', CARVING: 'Carving', SATIN: 'Satin',
  SUGAR: 'Sugar', LAPPATO: 'Lappato', LAPATO: 'Lappato', METALLIC: 'Metallic', POLISHED: 'Polished',
};

const PLANT_RE = /^[EHX]?(SS|KS|GS|HO|KM|SF)$/; // factory/plant codes like ESS, HSS, XKS, EGS
const DESIGN_RE = /^O?\d{2,6}[A-Z]{0,3}$/;
const NOISE = new Set(['AS', 'ON', 'GRADE', 'AND', 'OLD', 'STOCK', 'BOX', 'MM', 'TILE', 'TILES', 'NEW', 'THE']);

const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** "0708" -> "708", "O213" -> "213", "1055P" -> "1055". Non-numeric codes: letters+digits only. */
export function codeKey(value) {
  const n = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = n.match(/^O?0*(\d+)[A-Z]{0,3}$/);
  if (m) return m[1];
  return n;
}

function tokensOf(text) {
  return String(text ?? '')
    .toUpperCase()
    .replace(/\((?:[^()]|\([^()]*\))*\)/g, ' ') // "(600X600)", "(14TILE)", "(400X400(9T))"
    .replace(/[[\]&+]/g, ' ')
    .split(/[\s\-_/,.:]+/)
    .filter(Boolean);
}

function typeOf(t) {
  if (TYPE_WORDS[t]) return TYPE_WORDS[t];
  const m = t.match(/^[A-Z]?(PGVT|GVT)$/); // "APGVT", "XPGVT", "CGVT" variants
  return m ? m[1] : '';
}

/**
 * Split a description cell into its parts.
 * @returns {{design: string|null, base: string, name: string, type: string, finish: string, grade: string, label: string}}
 */
export function parseDescription(value) {
  const text = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  const tokens = tokensOf(text).map((t) => t.replace(/[^A-Z0-9]/g, '')).filter(Boolean);
  let design = null;
  for (const t of tokens) {
    if (DESIGN_RE.test(t) && /\d/.test(t)) {
      design = t.replace(/^O(?=\d)/, '0');
      break;
    }
  }
  const base = design ? codeKey(design) : '';
  const name = [];
  const finishes = [];
  let type = '';
  let grade = '';
  let designSeen = false;
  for (const t of tokens) {
    if (design && !designSeen && t.replace(/^O(?=\d)/, '0') === design) {
      designSeen = true;
      continue;
    }
    if (design && codeKey(t) === base && /\d/.test(t)) continue; // number repeated at the end ("... 4029", "888K")
    if (PLANT_RE.test(t)) continue;
    if (GRADE_WORDS[t]) {
      grade ||= GRADE_WORDS[t];
      continue;
    }
    const ty = typeOf(t);
    if (ty) {
      if (!type || ty === 'PGVT') type = ty;
      continue;
    }
    if (FINISH_WORDS[t]) {
      if (!finishes.includes(FINISH_WORDS[t])) finishes.push(FINISH_WORDS[t]);
      continue;
    }
    if (t === 'M' && design) {
      if (!finishes.includes('Matt')) finishes.push('Matt');
      continue;
    }
    if (/^\d+$/.test(t) || /^\d+T$/.test(t) || (t.length === 1 && design)) continue;
    name.push(t);
  }
  if (!design) {
    // No design number: the remaining words are the code ("PL WHITE", "GRENNZO BROWN").
    const label = name.join(' ') || tokens.filter((t) => !PLANT_RE.test(t)).join(' ') || text.toUpperCase();
    return { design: null, base: codeKey(label), name: '', type, finish: finishes.join(' '), grade, label };
  }
  return { design, base, name: titleCase(name.join(' ')), type, finish: finishes.join(' '), grade, label: design };
}

/** Grade / type / finish / size hinted by a sheet name, title row or section row. */
export function contextFrom(text) {
  const tokens = tokensOf(text);
  const types = new Set();
  const finishes = [];
  let grade = '';
  for (const t of tokens) {
    if (GRADE_WORDS[t]) grade ||= GRADE_WORDS[t];
    else if (TYPE_WORDS[t]) types.add(TYPE_WORDS[t]);
    else if (FINISH_WORDS[t] && !finishes.includes(FINISH_WORDS[t])) finishes.push(FINISH_WORDS[t]);
  }
  const sizeMatch = String(text ?? '').toUpperCase().match(/(\d+(?:\.\d+)?)\s*[X*×]\s*(\d+(?:\.\d+)?)/);
  return {
    grade,
    type: types.size === 1 ? [...types][0] : '', // "GVT & PGVT" sheets: type comes from each row
    finish: finishes.join(' '),
    size: sizeMatch ? sizeLabel(sizeMatch[0]) : '',
  };
}

/** True when the text is just a heading like "PREMIUM", "PGVT", "GVT 800X1600". */
export function isSectionText(text) {
  const tokens = tokensOf(text);
  if (!tokens.length) return false;
  return tokens.every((t) => GRADE_WORDS[t] || TYPE_WORDS[t] || FINISH_WORDS[t] || NOISE.has(t) || /^\d+X\d+$/.test(t));
}
