// Creates example godown stock files in sample_data/ so you can try the bot before using real data.
//   npm run sample
// The layout copies a real godown sheet (title row with "AS ON" date, one sheet per grade/size,
// COLOUR CODE / BATCH / SIZE / BOX / LOCATION columns, TOTAL row). All numbers are made up.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'sample_data');
mkdirSync(outDir, { recursive: true });

const today = new Date();
const asOn = `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;

function sheet(title, rows) {
  const total = rows.reduce((s, r) => s + (Number(r[3]) || 0), 0);
  return [
    [`${title}   AS ON`, asOn],
    ['COLOUR CODE', 'BATCH', 'SIZE', 'BOX', 'LOCATION', 'NEW STOCK', 'DEFRENCE', 'LOCATION'],
    ...rows.map((r) => [...r, r[3], r[3], r[4]]),
    [null, null, 'TOTAL', total],
  ];
}

const godowns = {
  HUBLI: {
    'PRM 60X60 GVT & PGVT': sheet('GVT & PGVT PREMIUM GRADE', [
      ['1005-ESS-GVT', 'SS01/20', '600X600', 117, 'A25'],
      ['1005-ESS-GVT', 'SS02/20', '600X600', 25, 'A25'],
      ['1055-ESS-GVT', 'SN 06', '600X600', 29, 'A24'],
      ['1055P-ESS-PGVT', 'SS06/21', 'BOX(600X600)', 46, 'A12'],
      ['1055P-ESS-PGVT', 'SN 08', 'BOX(600X600)', 38, 'P'],
      ['4029-EKS-GVT', 'KS/14', '600X600', 0, 'A05'],
    ]),
    'STD 60X120': sheet('STANDARD GVT&PGVT 600X1200', [
      ['3003-HSS-GVT', 'SS06/21', '1200X600', 29, 'MW09'],
      ['4209P-HSS-PGVT', 'SN52/24', 'BOX(1200X600)', 13, 'B27'],
    ]),
    'PREM DC 60X60': sheet('PREMIUM 60X60 DC', [
      ['[5091D-ESS] PREM-GRAND CREMA SHINE 5091S (600X600)', 'SS/01/4T', 'BOX(600X600)', 9, 'MW9'],
      ['[5109-ESS] PREM-BOLD WHITE SHINE 5109 (600X600)', 'SS/03', 'BOX(600X600)', 21, 'WJ15'],
    ]),
  },
  MANGALORE: {
    'PRM 60X60 GVT & PGVT': sheet('GVT & PGVT PREMIUM GRADE', [
      ['1005-ESS-GVT', 'SS07/21', '600X600', 64, 'R1'],
      ['1055P-ESS-PGVT', 'SS27', 'BOX(600X600)', 77, 'R2'],
    ]),
    'ECO GVT & PGVT 600X1200': sheet('ECONOMY GVT&PGVT 600X1200', [
      ['[3514-XSS] ECO-WHITE STONE GVT MATT 3514', 'SSNB/20', 'BOX(1200X600)', 50, 'MW10'],
    ]),
  },
};

for (const [godown, sheets] of Object.entries(godowns)) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 48 }, { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  const file = join(outDir, `${godown}_SAMPLE_GODOWN_STOCK.xlsx`);
  writeFileSync(file, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  console.log('written', file);
}
