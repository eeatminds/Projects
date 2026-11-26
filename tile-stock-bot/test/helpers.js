import * as XLSX from 'xlsx';
import { Store } from '../src/db.js';
import { StockService } from '../src/stock-service.js';

/** Build an .xlsx buffer from { sheetName: rows[][] }. */
export function xlsx(sheets, { hugeRef = false } = {}) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (hugeRef) ws['!ref'] = ws['!ref'].replace(/[A-Z]+(\d+)$/, 'XFD$1');
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** A godown sheet in the same layout as the real Hubli file. */
export function godownSheet(title, rows, date = '25.11.2026') {
  return [
    [`${title}   AS ON`, date],
    ['COLOUR CODE ', 'BATCH ', 'SIZE', 'BOX', 'LOCATION', null, null, null],
    ...rows,
    [null, null, 'TOTAL', rows.reduce((s, r) => s + (Number(r[3]) || 0), 0), null],
  ];
}

export const HUBLI = {
  'PRM 60X60 GVT & PGVT': godownSheet('GVT & PGVT PREMIUM GRADE', [
    ['1005-ESS-GVT', 'SS01/20', '600X600', 117, 'A25', 117, 117, 'A25'],
    ['1005-ESS-GVT', 'SS02/20', '600X600', 25, 'A25', 25, 25, 'A25'],
    ['1055-ESS-GVT', 'SN 06', '600X600', 29, 'A24'],
    ['1055P-ESS-PGVT', 'SS06/21', 'BOX(600X600)', 46, 'A12'],
    ['1055P-ESS-PGVT', 'SN 08', 'BOX(600X600)', 38, 'P'],
    ['1202-ESS-GVT', 'SS01', '600X600', 0, 'A01'],
  ]),
  'STD 60X120': godownSheet('STANDARD GVT&PGVT 600X1200', [
    ['1055P-HSS-PGVT', 'SN 09', 'BOX(1200X600)', 18, 'MW4'],
    ['3003-HSS-GVT', 'SS06/21', '1200X600', 29, 'MW09'],
  ]),
  'PREM DC 60X60': godownSheet('PREMIUM 60X60 DC', [
    ['[5091D-ESS] PREM-GRAND CREMA SHINE 5091S (600X600)', 'SS/01/4T', 'BOX(600X600)', 9, 'MW9'],
    ['[4029-XKS] ECO-PARANAT GVT MATT 4029 (600X600)', 'KS/NB', 'BOX(600X600)', 12, 'MW12'],
  ]),
};

export const MANGALORE = {
  'PRM 60X60 GVT & PGVT': godownSheet('GVT & PGVT PREMIUM GRADE', [
    ['1005-ESS-GVT', 'SS07/21', '600X600', 64, 'R1'],
    ['1055P-ESS-PGVT', 'SS27', 'BOX(600X600)', 77, 'R2'],
  ]),
};

export function testConfig(overrides = {}) {
  return {
    timeZone: 'Asia/Kolkata',
    defaultUnit: 'boxes',
    defaultCountryCode: '91',
    maxUploadMb: 15,
    adminPassword: 'secret-pass',
    sessionSecret: 'test-secret',
    publicUrl: '',
    ...overrides,
  };
}

export function makeEnv(overrides = {}) {
  const config = testConfig(overrides);
  const store = new Store(':memory:');
  const stock = new StockService({ store, config });
  return { config, store, stock };
}
