// Read a godown's daily stock Excel / CSV and turn it into stock rows.
//
// One file = one godown. No fixed template is needed. In every visible sheet we
// look for a header row (within the first 25 rows) and recognise the usual
// column names:
//   Colour Code / Design No / Code, Name, Polish / Finish, Type, Size, Grade,
//   Batch / Shade, Location / Rack, Box / Physical Stock / Qty, Sq.ft
//
// Real-world details that are handled:
//   * the design cell holds everything ("1055P-ESS-PGVT", "[4029-XKS] ECO-PARANAT GVT MATT 4029 (600X600)")
//   * grade / size / type come from the sheet name ("PRM 60X60 GVT & PGVT") or section rows ("PREMIUM")
//   * title rows ("... AS ON 25.11.2026") give the stock date
//   * TOTAL rows, repeated headers, blank rows and helper columns are skipped
//   * a sheet with one column per location ("wide" layout) also works

import * as XLSX from 'xlsx';
import { codeKey, contextFrom, isSectionText, parseDescription } from './describe.js';
import { sizeLabel } from './sizes.js';
import { norm } from './util.js';

const MAX_ROWS_PER_SHEET = 50_000;
const MAX_COLS = 40;
const HEADER_SCAN_ROWS = 25;
export const ALLOWED_EXTENSIONS = ['.xlsx', '.xlsm', '.xls', '.csv'];

export class StockFileError extends Error {}

const FIELD_EXACT = {
  code: ['CODE', 'COLOURCODE', 'COLORCODE', 'COLOUR', 'COLOR', 'DESIGNCODE', 'DESIGNNO', 'DESIGNNUMBER', 'DESIGN', 'ITEMCODE',
    'PRODUCTCODE', 'SKU', 'SKUCODE', 'ARTICLENO', 'ARTICLE', 'ITEMNO', 'CATNO', 'MODELNO', 'MODEL', 'DNO', 'CODENO'],
  name: ['NAME', 'DESIGNNAME', 'PRODUCTNAME', 'ITEMNAME', 'DESCRIPTION', 'ITEMDESCRIPTION', 'PRODUCT', 'PARTICULARS',
    'ITEM', 'PRODUCTDESCRIPTION'],
  polish: ['POLISH', 'FINISH', 'SURFACE', 'POLISHTYPE', 'FINISHTYPE', 'SURFACEFINISH'],
  category: ['CATEGORY', 'TYPE', 'PRODUCTTYPE', 'TILETYPE', 'SERIES', 'COLLECTION', 'RANGE', 'BODY'],
  size: ['SIZE', 'SIZEMM', 'SIZEINMM', 'TILESIZE', 'DIMENSION', 'DIMENSIONS', 'SIZECM'],
  grade: ['GRADE', 'QUALITY', 'QLTY', 'QLY'],
  shade: ['SHADE', 'SHADENO', 'BATCH', 'BATCHNO', 'LOT', 'LOTNO', 'SHADEBATCH', 'TONE'],
  location: ['LOCATION', 'RACK', 'RACKNO', 'BIN', 'BINNO', 'LNO', 'LOCNO', 'BAY', 'GODOWN', 'WAREHOUSE', 'BRANCH',
    'DEPOT', 'STORE', 'PLACE', 'LOC', 'GODOWNNAME', 'LOCATIONNAME', 'SHOWROOM'],
  qty: ['PHYSICALSTOCK', 'PHYSICALESTOCK', 'PHYSICAL', 'BOX', 'BOXES', 'NOOFBOXES', 'QTYBOXES', 'STOCKBOXES', 'BOXQTY',
    'CLOSINGSTOCK', 'CLOSINGQTY', 'CLOSING', 'BALANCE', 'BALANCEQTY', 'STOCK', 'STOCKQTY', 'AVAILABLESTOCK', 'AVAILABLE',
    'AVLSTOCK', 'AVL', 'QTY', 'QUANTITY', 'CTNS', 'CARTONS'],
  sqft: ['SQFT', 'STOCKSQFT', 'SQMT', 'SQM', 'AREA', 'QTYSQFT', 'TOTALSQFT'],
};
// For quantity the order above is the priority: "Physical stock" / "Box" beat a generic "Quantity".
const QTY_RANK = new Map(FIELD_EXACT.qty.map((h, i) => [h, i]));
const EXACT_LOOKUP = new Map();
for (const [field, names] of Object.entries(FIELD_EXACT)) for (const n of names) EXACT_LOOKUP.set(n, field);

const FIELD_CONTAINS = [
  ['sqft', ['SQFT', 'SQMT', 'SQM']],
  ['code', ['CODE', 'DESIGNNO', 'ITEMNO']],
  ['shade', ['SHADE', 'BATCH', 'LOTNO']],
  ['polish', ['POLISH', 'FINISH', 'SURFACE']],
  ['size', ['SIZE']],
  ['grade', ['GRADE']],
  ['category', ['CATEGORY', 'TILETYPE', 'PRODUCTTYPE']],
  ['name', ['NAME', 'DESCRIPTION']],
  ['location', ['GODOWN', 'WAREHOUSE', 'LOCATION', 'BRANCH', 'DEPOT', 'RACK']],
  ['qty', ['QTY', 'QUANTITY', 'STOCK', 'BOXES', 'BALANCE', 'CLOSING']],
];

const IGNORE_EXACT = new Set(['SRNO', 'SNO', 'SLNO', 'SL', 'NO', 'SERIAL', 'SR', 'ID', 'UNIT', 'UOM', 'S', 'SN', 'SERIALNO', 'PCS']);
const IGNORE_CONTAINS = ['RATE', 'PRICE', 'MRP', 'AMOUNT', 'VALUE', 'REMARK', 'HSN', 'PERBOX', 'WEIGHT', 'GST', 'TAX',
  'DISCOUNT', 'REORDER', 'MINSTOCK', 'THICK', 'PCSBOX', 'BOXSQFT', 'COVERAGE', 'DATE', 'DIFF', 'DEFRENCE', 'DEFFRENCE',
  'NEWSTOCK', 'GROUP'];

const QTY_WORDS = /\b(closing|balance|available|avl|physical|stock|qty|quantity|boxes|box|ctns|cartons)\b/gi;

function fieldForHeader(h) {
  if (!h) return [null, false];
  const exact = EXACT_LOOKUP.get(h);
  if (exact) return [exact, true];
  for (const [field, words] of FIELD_CONTAINS) if (words.some((w) => h.includes(w))) return [field, false];
  return [null, false];
}

const isIgnoredHeader = (h) => IGNORE_EXACT.has(h) || IGNORE_CONTAINS.some((w) => h.includes(w));

export function cellStr(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
  if (v instanceof Date) {
    const d = String(v.getDate()).padStart(2, '0');
    const m = String(v.getMonth() + 1).padStart(2, '0');
    return `${d}-${m}-${v.getFullYear()}`;
  }
  return String(v).replace(/\s+/g, ' ').trim();
}

/** A number, 0 for "nil" / "-", or null for blank / not a number. */
export function parseNumber(v) {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/,/g, '');
  if (!s) return null;
  if (['-', '--', 'nil', 'nill', 'zero', 'out'].includes(s.toLowerCase())) return 0;
  const m = s.match(/^-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

const rowIsEmpty = (row) => !row || !row.some((c) => cellStr(c) !== '');

function looksLikeTotal(text) {
  const n = norm(text);
  if (!n) return false;
  return /^(GRAND|SUB|NET|PAGE)?TOTALS?$/.test(n) || (n.startsWith('TOTAL') && n.length <= 11) || (n.endsWith('TOTAL') && n.length <= 12);
}
const rowHasTotal = (row) => (row || []).some((c) => typeof c === 'string' && c.length <= 20 && looksLikeTotal(c));

function unitFromHeader(header, fallback) {
  const h = norm(header);
  if (h.includes('SQFT')) return 'sq.ft';
  if (h.includes('SQM')) return 'sq.m';
  if (h.includes('BOX') || h.includes('PHYSICAL')) return 'boxes';
  if (h.includes('PCS') || h.includes('PIECE')) return 'pcs';
  if (h.includes('CTN') || h.includes('CARTON')) return 'cartons';
  return fallback;
}

function locationFromHeader(header) {
  const cleaned = header.replace(/[()[\]]/g, ' ').replace(QTY_WORDS, ' ').replace(/\s+/g, ' ').replace(/^[\s\-_:/]+|[\s\-_:/]+$/g, '');
  return cleaned || header.trim();
}

function extOf(filename) {
  const m = String(filename || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : '';
}

const DATE_RE = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/;

/** Find a stock date like "AS ON 25.11.2026" in the first rows of a sheet. Returns "YYYY-MM-DD" or null. */
function findDate(rows) {
  for (const row of rows.slice(0, 3)) {
    for (const c of row || []) {
      if (c instanceof Date && !Number.isNaN(c.getTime())) {
        return `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, '0')}-${String(c.getDate()).padStart(2, '0')}`;
      }
      const m = typeof c === 'string' ? c.match(DATE_RE) : null;
      if (m) {
        const [d, mo] = [Number(m[1]), Number(m[2])];
        const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
        if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && y >= 2000) return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
  }
  return null;
}

/** Returns [{ name, rows: any[][] }] for every visible sheet. */
export function readSheets(buffer, filename) {
  const ext = extOf(filename);
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new StockFileError('Please upload an Excel file (.xlsx or .xls) or a .csv file.');
  }
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, dense: true, sheetRows: MAX_ROWS_PER_SHEET });
  } catch (err) {
    throw new StockFileError(`Could not open the file. Is it a valid Excel file? (${err.message || err})`);
  }
  const meta = wb.Workbook?.Sheets || [];
  const sheets = [];
  wb.SheetNames.forEach((name, i) => {
    if (meta[i]?.Hidden) return;
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) return;
    // Some sheets claim 16,000+ columns (formatting dragged to XFD). Only read the first 40.
    const range = XLSX.utils.decode_range(ws['!ref']);
    range.e.c = Math.min(range.e.c, range.s.c + MAX_COLS - 1);
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false, range });
    sheets.push({ name: String(name).trim(), rows });
  });
  return sheets;
}

function numericRatio(rows, col) {
  let total = 0;
  let numeric = 0;
  for (const r of rows) {
    if (!r || col >= r.length) continue;
    if (cellStr(r[col]) === '') continue;
    total++;
    if (parseNumber(r[col]) !== null) numeric++;
  }
  return total ? numeric / total : 0;
}

function findHeader(rows) {
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
  for (let i = 0; i < limit; i++) {
    const headers = Array.from(rows[i] || [], cellStr);
    const assigned = {};
    const candidates = {};
    headers.forEach((text, col) => {
      const h = norm(text);
      const [field, exact] = fieldForHeader(h);
      if (!field) return;
      if (exact) {
        if (field === 'qty') {
          const cur = assigned.qty;
          if (cur === undefined || QTY_RANK.get(h) < QTY_RANK.get(norm(headers[cur]))) assigned.qty = col;
        } else if (!(field in assigned)) assigned[field] = col;
      } else {
        (candidates[field] ||= []).push(col);
      }
    });
    const found = new Set([...Object.keys(assigned), ...Object.keys(candidates)]);
    if (found.has('code') && found.size >= 2) return { hdrIdx: i, assigned, candidates, headers };
  }
  return null;
}

/**
 * Parse one sheet. Returns null if it has no recognisable header row.
 * @returns {{rows: object[], columns: object, locationColumns: string[], unit: string, warnings: string[], layout: string, stockDate: string|null}|null}
 */
export function parseSheet(name, rows, defaultUnit = 'boxes') {
  const found = findHeader(rows);
  if (!found) return null;
  const { hdrIdx, assigned, candidates, headers } = found;
  const dataRows = rows.slice(hdrIdx + 1);
  const warnings = [];
  const stockDate = findDate(rows.slice(0, hdrIdx + 1));

  const idx = { ...assigned };
  for (const [field, cols] of Object.entries(candidates)) {
    const taken = new Set(Object.values(idx));
    const free = cols.filter((c) => !taken.has(c) && !isIgnoredHeader(norm(headers[c])));
    if (field in idx || !free.length) continue;
    if ((field === 'qty' || field === 'location') && free.length > 1) continue; // several = wide sheet
    idx[field] = free[0];
  }
  if ('location' in idx && numericRatio(dataRows, idx.location) > 0.8) delete idx.location;
  if (!('code' in idx)) return null;

  const qtyIsTotal = 'qty' in idx && norm(headers[idx.qty]).includes('TOTAL');
  const used = new Set(Object.values(idx));
  const numericFree = [];
  headers.forEach((text, col) => {
    const h = norm(text);
    if (used.has(col) || !h || isIgnoredHeader(h) || h.includes('TOTAL')) return;
    const [field] = fieldForHeader(h);
    if (field && field !== 'qty' && field !== 'location') return;
    if (numericRatio(dataRows, col) >= 0.8) numericFree.push(col);
  });

  let layout = 'long';
  let wideCols = [];
  if (!('location' in idx) && numericFree.length && (!('qty' in idx) || qtyIsTotal)) {
    layout = 'wide';
    wideCols = numericFree;
    delete idx.qty;
  } else if (!('qty' in idx)) {
    if (!numericFree.length) {
      return { rows: [], columns: {}, locationColumns: [], unit: defaultUnit, warnings: [`Sheet "${name}" skipped: no stock quantity column found.`], layout, stockDate };
    }
    idx.qty = numericFree[0]; // e.g. "PREMIUM (A)"
    warnings.push(`Sheet "${name}": used column "${headers[idx.qty]}" as the stock quantity.`);
  }

  const get = (row, field) => {
    const col = idx[field];
    return col !== undefined && row && col < row.length ? cellStr(row[col]) : '';
  };
  const raw = (row, col) => (col !== undefined && row && col < row.length ? row[col] : null);

  const sheetCtx = contextFrom(`${name} ${rows.slice(0, hdrIdx).map((r) => Array.from(r || [], cellStr).join(' ')).join(' ')}`);
  let section = {};
  const codeHeader = norm(headers[idx.code]);
  const out = [];
  let prev = null;
  let textQty = 0;

  for (const row of dataRows) {
    if (rowIsEmpty(row) || rowHasTotal(row)) continue;
    const codeCell = raw(row, idx.code);
    let codeText = cellStr(codeCell);
    if (norm(codeText) === codeHeader) continue; // header repeated on every printed page

    const qtyRaw = layout === 'long' ? raw(row, idx.qty) : null;
    const otherText = ['shade', 'size', 'location', 'name'].map((f) => get(row, f)).join('');
    const firstText = Array.from(row, cellStr).find((c) => c) || '';

    // Section rows: "PREMIUM", "STANDARD", "PGVT", "GVT 800X1600" with nothing else on the row.
    if ((!codeText || isSectionText(codeText)) && cellStr(qtyRaw) === '' && !otherText && isSectionText(firstText)) {
      section = contextFrom(firstText);
      continue;
    }

    if (!codeText) {
      // Grouped report: code written once, following rows only have location + qty.
      if (layout === 'long' && prev && parseNumber(qtyRaw) !== null && (get(row, 'shade') || get(row, 'location'))) {
        codeText = prev.raw;
      } else continue;
    }

    const desc = parseDescription(codeCell ?? codeText);
    const sizeText = get(row, 'size');
    const item = {
      code: desc.design || desc.label,
      key: desc.base || codeKey(codeText),
      raw: codeText,
      name: get(row, 'name') || desc.name,
      category: get(row, 'category') || desc.type || section.type || sheetCtx.type || '',
      polish: get(row, 'polish') || desc.finish || section.finish || sheetCtx.finish || '',
      grade: get(row, 'grade') || desc.grade || section.grade || sheetCtx.grade || '',
      size: sizeLabel(sizeText) || section.size || sheetCtx.size || sizeText,
      shade: get(row, 'shade'),
      location: '',
      qty: 0,
      sqft: null,
    };
    if (!item.key) continue;

    if (layout === 'long') {
      const qty = parseNumber(qtyRaw);
      if (qty === null && cellStr(qtyRaw) !== '') textQty++;
      const rack = get(row, 'location');
      out.push({ ...item, location: rack === '0' ? '' : rack, qty: qty ?? 0, sqft: 'sqft' in idx ? parseNumber(raw(row, idx.sqft)) : null });
      prev = out[out.length - 1];
    } else {
      let added = false;
      for (const col of wideCols) {
        const qty = parseNumber(raw(row, col));
        if (qty === null) continue;
        out.push({ ...item, location: locationFromHeader(headers[col]), qty });
        added = true;
      }
      if (!added) out.push(item);
    }
  }

  if (textQty) warnings.push(`Sheet "${name}": ${textQty} rows had text instead of a number for quantity (taken as 0).`);

  const columns = Object.fromEntries(Object.entries(idx).map(([f, c]) => [f, headers[c]]));
  const locationColumns = wideCols.map((c) => headers[c]);
  const unitHeader = 'qty' in idx ? headers[idx.qty] : locationColumns[0] || '';
  return { rows: out, columns, locationColumns, unit: unitFromHeader(unitHeader, defaultUnit), warnings, layout, stockDate };
}

/** Parse an uploaded stock file. Throws StockFileError with an admin-friendly message. */
export function importStock(buffer, filename, defaultUnit = 'boxes') {
  const sheets = readSheets(buffer, filename);
  const result = { rows: [], warnings: [], columns: {}, locationColumns: [], sheetsUsed: [], sheetsSkipped: [], unit: defaultUnit, layout: 'long', stockDate: null };
  const units = new Map();
  const dates = new Map();
  for (const sheet of sheets) {
    let p;
    try {
      p = parseSheet(sheet.name, sheet.rows, defaultUnit);
    } catch (err) {
      result.warnings.push(`Sheet "${sheet.name}" skipped: ${err.message}`);
      result.sheetsSkipped.push(sheet.name);
      continue;
    }
    if (!p || !p.rows.length) {
      if (p) result.warnings.push(...p.warnings);
      else if (sheet.rows.slice(0, 5).some((r) => !rowIsEmpty(r))) result.warnings.push(`Sheet "${sheet.name}" skipped: no header row with a design code column.`);
      result.sheetsSkipped.push(sheet.name);
      continue;
    }
    result.warnings.push(...p.warnings);
    result.rows.push(...p.rows);
    result.sheetsUsed.push(sheet.name);
    units.set(p.unit, (units.get(p.unit) || 0) + p.rows.length);
    if (p.stockDate) dates.set(p.stockDate, (dates.get(p.stockDate) || 0) + 1);
    if (p.layout === 'wide') result.layout = 'wide';
    for (const [f, h] of Object.entries(p.columns)) if (!(f in result.columns)) result.columns[f] = h;
    for (const h of p.locationColumns) if (!result.locationColumns.includes(h)) result.locationColumns.push(h);
  }
  if (!result.rows.length) {
    throw new StockFileError(
      'Could not find the stock table. The sheet needs a header row with a design code column ' +
        '(Colour Code / Design No / Code) and a quantity column (Box / Physical Stock / Qty).',
    );
  }
  result.unit = [...units.entries()].sort((a, b) => b[1] - a[1])[0][0];
  result.stockDate = [...dates.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  result.itemCount = new Set(result.rows.map((r) => r.key)).size;
  result.locationCount = new Set(result.rows.map((r) => r.location).filter(Boolean)).size;
  result.totalQty = result.rows.reduce((s, r) => s + (r.qty > 0 ? r.qty : 0), 0);
  return result;
}
