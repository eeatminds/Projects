import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codeKey, parseDescription } from '../src/describe.js';
import { StockFileError, importStock } from '../src/importer.js';
import { sizeLabel } from '../src/sizes.js';
import { HUBLI, xlsx } from './helpers.js';

test('parses godown descriptions', () => {
  const cases = [
    ['1005-ESS-GVT', { design: '1005', base: '1005', type: 'GVT' }],
    ['1055P-ESS-PGVT', { design: '1055P', base: '1055', type: 'PGVT' }],
    ['[4029-XKS] ECO-PARANAT GVT MATT 4029 (600X600)', { design: '4029', name: 'Paranat', type: 'GVT', finish: 'Matt', grade: 'Economy' }],
    ['9645-EGS-VOX SMOK-DC', { design: '9645', name: 'Vox Smok', type: 'DC' }],
    ['0708-EKS] PREM-IVORY PLAIN SHINE 0708 (600X600)', { design: '0708', base: '708', finish: 'Shine', grade: 'Premium' }],
    ['222 M', { design: '222', finish: 'Matt' }],
    ['4209A-ESS-APGVT', { design: '4209A', base: '4209', type: 'PGVT' }],
    [366, { design: '366', base: '366' }],
    ['O213', { design: '0213', base: '213' }],
  ];
  for (const [input, expected] of cases) {
    const got = parseDescription(input);
    for (const [k, v] of Object.entries(expected)) assert.equal(got[k], v, `${input} -> ${k}`);
  }
  const noNumber = parseDescription('GRENNZO BROWN- PGVT-EGS');
  assert.equal(noNumber.design, null);
  assert.equal(noNumber.label, 'GRENNZO BROWN');
  assert.equal(noNumber.type, 'PGVT');
  assert.equal(codeKey('PL WHITE'), 'PLWHITE');
});

test('normalises sizes to nominal mm', () => {
  assert.equal(sizeLabel('BOX(600X600)'), '600x600');
  assert.equal(sizeLabel('1200X600'), '600x1200');
  assert.equal(sizeLabel('794X1588'), '800x1600');
  assert.equal(sizeLabel('592x592'), '600x600');
  assert.equal(sizeLabel('60x120'), '600x1200');
  assert.equal(sizeLabel('2x4'), '600x1200');
  assert.equal(sizeLabel('30*30'), '300x300');
  assert.equal(sizeLabel('MIX SIZE'), '');
});

test('reads the real godown layout: sheets, grades, batches, racks, totals, stock date', () => {
  const r = importStock(xlsx(HUBLI), 'HUBLI_CERAMICK_VITRIFIED_GODOWN_STOCK.xlsx');
  assert.equal(r.stockDate, '2026-11-25');
  assert.equal(r.columns.code, 'COLOUR CODE');
  assert.equal(r.columns.qty, 'BOX');
  assert.equal(r.unit, 'boxes');
  assert.equal(r.rows.length, 10, 'TOTAL rows must be skipped');
  const pgvt = r.rows.find((x) => x.code === '1055P' && x.shade === 'SS06/21');
  assert.deepEqual(
    { key: pgvt.key, category: pgvt.category, grade: pgvt.grade, size: pgvt.size, location: pgvt.location, qty: pgvt.qty },
    { key: '1055', category: 'PGVT', grade: 'Premium', size: '600x600', location: 'A12', qty: 46 },
  );
  const std = r.rows.find((x) => x.code === '3003');
  assert.equal(std.grade, 'Standard');
  assert.equal(std.size, '600x1200');
  const dc = r.rows.find((x) => x.key === '5091');
  assert.equal(dc.category, 'DC', 'type from sheet name "PREM DC 60X60"');
  assert.equal(dc.name, 'Grand Crema');
  // grade written in the description wins over the sheet name
  assert.equal(r.rows.find((x) => x.key === '4029').grade, 'Economy');
});

test('sheets claiming 16,000 columns are read quickly', () => {
  const t0 = Date.now();
  const r = importStock(xlsx(HUBLI, { hugeRef: true }), 'hubli.xlsx');
  assert.equal(r.rows.length, 10);
  assert.ok(Date.now() - t0 < 3000);
});

test('"Physical stock" / "Box" beats a generic "Quantity" column', () => {
  const buf = xlsx({
    'PRM 800X1600': [
      ['800X1600 PREMIUM GRADE AS ON', '25.11.2026'],
      ['COLOUR CODE', 'BATCH', 'SIZE', 'Product/Item Group', 'Quantity in Boxes', 'Quantity', 'BOX', 'LOCATION'],
      ['GVT 800X1600'],
      ['5421-GVT', 'SS01/24', '796X1592', 'Premium', 9, 22.86, 8, 'WG1'],
    ],
  });
  const r = importStock(buf, 'x.xlsx');
  assert.equal(r.rows.length, 1, 'section row "GVT 800X1600" is not an item');
  assert.equal(r.rows[0].qty, 8);
  assert.equal(r.rows[0].size, '800x1600');
});

test('falls back to a grade-named quantity column and section rows set the grade', () => {
  const buf = xlsx({
    '50X50 OLDE': [
      ['PREMIUM'],
      ['COLOUR CODE', 'SIZE', 'BATCH', 'PREMIUM (A)', 'L.NO'],
      [123, '502X502', 'S 20', 115, 'MW10'],
      ['STANDARD'],
      [213, '498X498', 'S 03', 16, 'MW10'],
      [null, 'TOTAL', null, 131],
    ],
  });
  const r = importStock(buf, 'x.xlsx');
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].qty, 115);
  assert.equal(r.rows[0].grade, 'Premium');
  assert.equal(r.rows[1].grade, 'Standard');
  assert.equal(r.rows[1].size, '500x500');
  assert.match(r.warnings.join(' '), /PREMIUM \(A\)/);
});

test('simple one-sheet files and wide layouts also work', () => {
  const simple = importStock(Buffer.from('Design No,Name,Polish,Size,Qty\n8025,Statuario,PGVT,600x1200,120\n'), 'stock.csv');
  assert.equal(simple.rows[0].code, '8025');
  assert.equal(simple.rows[0].polish, 'PGVT');
  assert.equal(simple.rows[0].qty, 120);

  const wide = importStock(xlsx({ S: [['Code', 'Polish', 'Rack A', 'Rack B', 'Total'], ['8025', 'PGVT', 10, 5, 15]] }), 'w.xlsx');
  assert.equal(wide.layout, 'wide');
  assert.deepEqual(wide.rows.map((x) => [x.location, x.qty]), [['Rack A', 10], ['Rack B', 5]]);
});

test('bad files give a clear error', () => {
  assert.throws(() => importStock(Buffer.from('hello'), 'stock.pdf'), StockFileError);
  assert.throws(() => importStock(xlsx({ S: [['Name', 'City'], ['A', 'B']] }), 'x.xlsx'), /design code column/);
});
