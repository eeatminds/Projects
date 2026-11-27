import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createWebApp } from '../src/web.js';
import { HUBLI, makeEnv, xlsx } from './helpers.js';

let server;
let base;
let cookie = '';
const env = makeEnv();

before(async () => {
  const app = createWebApp({ ...env, whatsapp: null, logger: { error() {}, warn() {}, info() {} } });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = (path, { method = 'GET', body, headers = {}, raw } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(method !== 'GET' ? { 'x-requested-with': 'tsb' } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });

test('admin API needs login; wrong password rejected', async () => {
  assert.equal((await call('/api/status')).status, 401);
  assert.equal((await call('/api/login', { method: 'POST', body: { password: 'nope' } })).status, 401);
  const ok = await call('/api/login', { method: 'POST', body: { password: 'secret-pass' } });
  assert.equal(ok.status, 200);
  cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.match(ok.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal((await call('/api/status')).status, 200);
});

test('writes need the custom header (blocks cross-site form posts)', async () => {
  const r = await fetch(`${base}/api/godowns`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{"name":"X"}' });
  assert.equal(r.status, 403);
});

test('upload a godown file, see it in status, stock and the test chat', async () => {
  const detect = await (await call('/api/upload/detect?filename=HUBLI_CERAMICK_VITRIFIED_GODOWN_STOCK.xlsx')).json();
  assert.equal(detect.godown, null);
  assert.equal(detect.suggestion, 'Hubli');

  const noGodown = await call('/api/upload', { method: 'POST', raw: xlsx(HUBLI), headers: { 'x-filename': 'h.xlsx' } });
  assert.equal(noGodown.status, 400);

  const up = await call('/api/upload', { method: 'POST', raw: xlsx(HUBLI), headers: { 'x-filename': 'HUBLI_STOCK.xlsx', 'x-godown-name': 'Hubli' } });
  assert.equal(up.status, 200);
  const u = await up.json();
  assert.equal(u.upload.godown, 'Hubli');
  assert.equal(u.upload.stockDate, '2026-11-25');

  const again = await (await call('/api/upload/detect?filename=HUBLI_STOCK_27.xlsx')).json();
  assert.equal(again.godown.name, 'Hubli');

  const status = await (await call('/api/status')).json();
  assert.equal(status.godowns.length, 1);
  assert.equal(status.godowns[0].today, true);
  assert.deepEqual(status.pending, []);

  const stock = await (await call('/api/stock?q=1055')).json();
  assert.equal(stock.items[0].code, '1055');
  assert.equal(stock.items[0].variants[0].godowns[0].name, 'Hubli');

  const t = await (await call('/api/test', { method: 'POST', body: { text: '1055 pgvt' } })).json();
  assert.equal(t.relevant, true);
  assert.match(t.reply, /Hubli: \*84 boxes\*/);

  const bad = await call('/api/upload', { method: 'POST', raw: Buffer.from('x'), headers: { 'x-filename': 'a.pdf', 'x-godown-name': 'Hubli' } });
  assert.equal(bad.status, 422);
});

test('contacts: add one, bulk add, delete', async () => {
  const one = await (await call('/api/contacts', { method: 'POST', body: { name: 'Ravi', phone: '98765 43210', role: 'admin' } })).json();
  assert.equal(one.phone, '919876543210');
  const bulk = await (await call('/api/contacts/bulk', { method: 'POST', body: { text: 'Sri Ganesh - 9845012345\nno number here', role: 'dealer' } })).json();
  assert.equal(bulk.added, 1);
  assert.equal(bulk.skipped.length, 1);
  assert.equal((await (await call('/api/contacts')).json()).length, 2);
  await call('/api/contacts/919845012345', { method: 'DELETE' });
  assert.equal((await (await call('/api/contacts')).json()).length, 1);
});

test('settings validate input', async () => {
  assert.equal((await call('/api/settings', { method: 'PUT', body: { reminderTime: '25:99' } })).status, 400);
  const s = await (await call('/api/settings', { method: 'PUT', body: { reminderTime: '09:30', showRack: true } })).json();
  assert.equal(s.reminderTime, '09:30');
  assert.equal(s.showRack, true);
});

test('CSV export guards against formula injection', async () => {
  env.store.logQuery({ chatId: 'c', senderPhone: '91', senderName: '=HYPERLINK("x")', text: '1055', outcomes: [] });
  const csv = await (await call('/api/queries.csv?days=7')).text();
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
});
