import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StockBot } from '../src/bot.js';
import { Reminder } from '../src/reminder.js';
import { zonedParts } from '../src/util.js';
import { HUBLI, MANGALORE, makeEnv, xlsx } from './helpers.js';

function setup({ withStock = true } = {}) {
  const e = makeEnv();
  if (withStock) e.stock.importFile(xlsx(HUBLI), 'HUBLI_STOCK.xlsx', { godownName: 'Hubli' });
  const sent = [];
  const transport = { sendText: async (chatId, text, quote) => sent.push({ chatId, text, quote }) };
  const bot = new StockBot({ ...e, transport, logger: { error() {}, warn() {}, info() {} } });
  return { ...e, bot, sent };
}

const dm = (phone, text, extra = {}) => ({
  id: Math.random().toString(36).slice(2),
  chatId: `${phone}@s.whatsapp.net`,
  chatName: 'Ravi',
  isGroup: false,
  isSelfChat: false,
  fromMe: false,
  senderPhone: phone,
  senderName: 'Ravi',
  text,
  timestamp: new Date(),
  ...extra,
});

test('own outgoing messages and old messages are ignored', async () => {
  const s = setup();
  assert.equal((await s.bot.handle(dm('919800000001', '1005', { fromMe: true }))).action, 'ignored');
  assert.equal((await s.bot.handle(dm('919800000001', '1005', { timestamp: new Date(Date.now() - 3600_000) }))).action, 'ignored');
  assert.equal(s.sent.length, 0);
});

test('only people in the list get stock; unknown numbers get the polite message once a day', async () => {
  const s = setup();
  const r1 = await s.bot.handle(dm('919800000001', '1005 gvt'));
  assert.equal(r1.action, 'blocked');
  assert.match(s.sent[0].text, /only for registered dealers/);
  const r2 = await s.bot.handle(dm('919800000001', '1055 pgvt'));
  assert.equal(r2.action, 'blocked');
  assert.equal(s.sent.length, 1, 'told only once');
  // normal chat from unknown numbers is never answered
  assert.equal((await s.bot.handle(dm('919800000002', 'hello, what is the rate?'))).action, 'ignored');

  s.store.upsertContact({ phone: '919800000001', name: 'Ravi', role: 'dealer' });
  const r3 = await s.bot.handle(dm('919800000001', '1005 gvt'));
  assert.equal(r3.action, 'replied');
  assert.match(s.sent.at(-1).text, /Hubli: \*142 boxes\*/);

  s.store.updateSettings({ accessMode: 'everyone' });
  assert.equal((await s.bot.handle(dm('919800000003', '1005'))).action, 'replied');
});

test('groups: silent unless switched on, then replies quoting the question', async () => {
  const s = setup();
  s.store.syncGroups([{ jid: '123@g.us', name: 'Dealers Hubli', participants: 20 }]);
  const msg = { ...dm('919800000009', '1055 pgvt'), chatId: '123@g.us', isGroup: true, quote: { key: { id: 'q' } } };
  assert.equal((await s.bot.handle(msg)).action, 'ignored');
  s.store.setGroupEnabled('123@g.us', true);
  assert.equal((await s.bot.handle({ ...msg, id: 'x2' })).action, 'replied');
  assert.deepEqual(s.sent.at(-1).quote, { key: { id: 'q' } });
  assert.equal((await s.bot.handle({ ...msg, id: 'x3', text: 'ok noted' })).action, 'ignored');
});

test('admin sends godown Excel on WhatsApp: godown from caption or file name', async () => {
  const s = setup({ withStock: false });
  const doc = (fileName, buffer) => ({ fileName, size: buffer.length, download: async () => buffer });

  // shop phone "Message yourself" chat, new godown named in the caption
  const r1 = await s.bot.handle(dm('919811111111', 'Mangalore', { isSelfChat: true, fromMe: true, document: doc('stock.xlsx', xlsx(MANGALORE)) }));
  assert.equal(r1.action, 'imported');
  assert.match(s.sent.at(-1).text, /Mangalore stock updated/);

  // admin contact, godown found in the file name, no caption
  s.store.addGodown('Hubli');
  s.store.upsertContact({ phone: '919822222222', name: 'Office', role: 'admin' });
  const r2 = await s.bot.handle(dm('919822222222', '', { document: doc('HUBLI_CERAMICK_VITRIFIED_GODOWN_STOCK_04.03.2026_16.xlsx', xlsx(HUBLI)) }));
  assert.equal(r2.action, 'imported');
  assert.match(s.sent.at(-1).text, /Hubli stock updated/);
  assert.match(s.sent.at(-1).text, /Stock as on 25 Nov 2026/);
  assert.deepEqual(s.store.listGodowns().map((g) => g.name), ['Hubli', 'Mangalore']);

  // unknown godown in file name and no caption: refused, nothing changes
  const r3 = await s.bot.handle(dm('919822222222', '', { document: doc('stock_today.xlsx', xlsx(HUBLI)) }));
  assert.equal(r3.action, 'upload_failed');
  assert.match(s.sent.at(-1).text, /Which godown/);

  // dealers cannot upload
  s.store.upsertContact({ phone: '919833333333', name: 'Dealer', role: 'dealer' });
  assert.equal((await s.bot.handle(dm('919833333333', 'Hubli', { document: doc('h.xlsx', xlsx(HUBLI)) }))).action, 'ignored');

  // status command
  await s.bot.handle(dm('919822222222', 'status'));
  assert.match(s.sent.at(-1).text, /✅ \*Hubli\*/);
  assert.match(s.sent.at(-1).text, /✅ \*Mangalore\*/);
});

test('morning reminder lists godowns not updated today', async () => {
  const s = setup({ withStock: false });
  s.store.addGodown('Hubli');
  s.stock.importFile(xlsx(MANGALORE), 'm.xlsx', { godownName: 'Mangalore' });
  s.store.upsertContact({ phone: '919822222222', name: 'Office', role: 'admin' });
  const wa = { status: 'open', sent: [], selfJid: () => '919811111111@s.whatsapp.net', sendText: async (jid, text) => wa.sent.push({ jid, text }) };
  const reminder = new Reminder({ ...s, whatsapp: wa, logger: { info() {}, warn() {}, error() {} } });

  const istToday = zonedParts(new Date(), 'Asia/Kolkata').date;
  const at = (hhmm) => new Date(`${istToday}T${hhmm}:00+05:30`);
  assert.equal(await reminder.check(at('09:30')), 'not time');
  assert.equal(await reminder.check(at('10:05')), 'sent');
  assert.equal(wa.sent[0].jid, '919822222222@s.whatsapp.net');
  assert.match(wa.sent[0].text, /• \*Hubli\*/);
  assert.doesNotMatch(wa.sent[0].text, /Mangalore/);
  assert.equal(await reminder.check(at('10:30')), 'already done');
});
