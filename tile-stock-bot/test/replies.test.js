import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerMessage } from '../src/replies.js';
import { HUBLI, MANGALORE, makeEnv, xlsx } from './helpers.js';

function env() {
  const e = makeEnv();
  e.stock.importFile(xlsx(HUBLI), 'HUBLI_GODOWN_STOCK.xlsx', { godownName: 'Hubli' });
  e.stock.importFile(xlsx(MANGALORE), 'MANGALORE_STOCK.xlsx', { godownName: 'Mangalore' });
  return e;
}
const ask = (e, text, opts = {}) => answerMessage(e.stock.index, text, { timeZone: 'Asia/Kolkata', businessName: 'Naveen Tiles', ...opts });

test('code + polish answers with every godown and batch', () => {
  const e = env();
  const a = ask(e, '1055 pgvt');
  assert.equal(a.relevant, true);
  assert.match(a.reply, /\*1055\*/);
  assert.match(a.reply, /PGVT · Premium · 600x600/);
  assert.match(a.reply, /🏬 Mangalore: \*77 boxes\*/);
  assert.match(a.reply, /🏬 Hubli: \*84 boxes\*/);
  assert.match(a.reply, /SS06\/21 – 46/);
  assert.match(a.reply, /Total: \*161 boxes\*/);
  assert.match(a.reply, /PGVT · Standard · 600x1200/);
  assert.doesNotMatch(a.reply, /\*GVT · /, 'GVT version must be filtered out');
  assert.match(a.reply, /Stock as on: Hubli, Mangalore 25 Nov/);
});

test('godown, size and grade filters', () => {
  const e = env();
  const hubli = ask(e, '1055 pgvt hubli').reply;
  assert.doesNotMatch(hubli, /Mangalore:/);
  const size = ask(e, '1055 pgvt 60x120').reply;
  assert.match(size, /600x1200/);
  assert.doesNotMatch(size, /600x600/);
  const std = ask(e, '1055 std').reply;
  assert.match(std, /Standard/);
  assert.doesNotMatch(std, /Premium/);
});

test('design suffix, typing without space, leading zero and names', () => {
  const e = env();
  assert.doesNotMatch(ask(e, '1055P').reply, /\*GVT/);
  assert.match(ask(e, '1005gvt').reply, /GVT · Premium · 600x600/);
  assert.match(ask(e, 'grand crema').reply, /\*5091\* – Grand Crema/);
  assert.match(ask(e, '5091 dc').reply, /DC · Shine · Premium/);
});

test('not available, out of stock, not found with suggestions', () => {
  const e = env();
  const na = ask(e, '1005 pgvt');
  assert.equal(na.outcomes[0].outcome, 'unavailable');
  assert.match(na.reply, /Not available in PGVT/);
  assert.match(na.reply, /Available:\n• GVT · Premium · 600x600: 206 boxes/);
  assert.equal(ask(e, '1202').outcomes[0].outcome, 'out_of_stock');
  const nf = ask(e, '1006 gvt');
  assert.equal(nf.outcomes[0].outcome, 'not_found');
  assert.match(nf.reply, /Did you mean: .*\*1005\*/);
});

test('several codes, one per line', () => {
  const a = ask(env(), '1005\n3003 gvt\n9999 pgvt');
  assert.deepEqual(a.outcomes.map((o) => o.outcome), ['in_stock', 'in_stock', 'not_found']);
});

test('stays silent on normal chat', () => {
  const e = env();
  for (const t of ['ok thanks', 'call me on 9876543210', 'send 50 boxes tomorrow', 'good morning sir']) {
    assert.equal(ask(e, t).relevant, false, t);
  }
  // groups are stricter: an unknown bare number is ignored there
  assert.equal(ask(e, '7777', { strict: true }).relevant, false);
  assert.equal(ask(e, '7777', { strict: false }).relevant, true);
});

test('warns when a godown was not updated today', () => {
  const e = env();
  const later = new Date(Date.now() + 2 * 86400_000);
  const a = ask(e, '1005', { now: later });
  assert.match(a.reply, /⚠️ _Hubli, Mangalore not updated today/);
});

test('batch and rack display settings', () => {
  const e = env();
  assert.doesNotMatch(ask(e, '1005', { showBatch: false }).reply, /SS01\/20/);
  assert.match(ask(e, '1005', { showRack: true }).reply, /SS01\/20 – 117 \(A25\)/);
});

test('new upload replaces only that godown', () => {
  const e = env();
  const updated = { 'PRM 60X60 GVT & PGVT': [['COLOUR CODE', 'BATCH', 'SIZE', 'BOX'], ['1005-ESS-GVT', 'NEW1', '600X600', 5]] };
  e.stock.importFile(xlsx(updated), 'hubli new.xlsx', { godownName: 'Hubli' });
  const a = ask(e, '1005').reply;
  assert.match(a, /Hubli: \*5 boxes\*/);
  assert.match(a, /Mangalore: \*64 boxes\*/);
  assert.doesNotMatch(a, /SS01\/20/, 'old Hubli batches are gone');
  assert.equal(ask(e, '3003').relevant, true);
  assert.match(ask(e, '3003').reply, /not in the stock list/, 'Hubli-only design disappears after the new Hubli file');
});

test('no stock uploaded yet', () => {
  const e = makeEnv();
  const a = answerMessage(e.stock.index, '1055 pgvt', {});
  assert.equal(a.relevant, true);
  assert.match(a.reply, /not uploaded yet/);
});
