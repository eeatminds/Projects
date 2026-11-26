// Admin web panel + JSON API.

import express from 'express';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { ROOT } from './config.js';
import { StockFileError } from './importer.js';
import { codeKey as codeKeyOf } from './describe.js';
import { answerMessage, groupVariants } from './replies.js';
import { norm, normPhone, startOfLocalDay, tzOffsetMinutes, zonedParts } from './util.js';

const COOKIE = 'tsb_session';
const SESSION_DAYS = 30;
const ROLES = new Set(['dealer', 'staff', 'admin']);

function sha(s) {
  return createHash('sha256').update(String(s)).digest();
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createWebApp({ config, store, stock, whatsapp, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  const sign = (v) => createHmac('sha256', config.sessionSecret).update(v).digest('base64url');
  const issueToken = () => {
    const exp = String(Date.now() + SESSION_DAYS * 86400_000);
    return `${exp}.${sign(exp)}`;
  };
  const validToken = (token) => {
    if (!token || !token.includes('.')) return false;
    const [exp, mac] = token.split('.');
    const good = Buffer.from(sign(exp));
    const given = Buffer.from(mac || '');
    return good.length === given.length && timingSafeEqual(good, given) && Number(exp) > Date.now();
  };
  const isLoggedIn = (req) => validToken(parseCookies(req.headers.cookie)[COOKIE]);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/health', (req, res) => res.json({ ok: true, whatsapp: whatsapp?.status || 'disabled' }));

  // --- login ------------------------------------------------------------
  const attempts = new Map();
  app.post('/api/login', express.json({ limit: '10kb' }), (req, res) => {
    const ip = req.ip || 'x';
    const now = Date.now();
    const a = attempts.get(ip) || { n: 0, first: now };
    if (now - a.first > 15 * 60_000) Object.assign(a, { n: 0, first: now });
    if (a.n >= 10) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    if (!config.adminPassword) return res.status(500).json({ error: 'ADMIN_PASSWORD is not set on the server.' });
    const ok = timingSafeEqual(sha(req.body?.password || ''), sha(config.adminPassword));
    if (!ok) {
      a.n++;
      attempts.set(ip, a);
      return res.status(401).json({ error: 'Wrong password' });
    }
    attempts.delete(ip);
    const secure = req.secure ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${COOKIE}=${issueToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  app.get('/api/session', (req, res) => res.json({ loggedIn: isLoggedIn(req) }));

  // Everything below needs login. Writes also need a custom header (blocks cross-site form posts).
  app.use('/api', (req, res, next) => {
    if (!isLoggedIn(req)) return res.status(401).json({ error: 'Please log in' });
    if (req.method !== 'GET' && req.get('x-requested-with') !== 'tsb') return res.status(403).json({ error: 'Bad request' });
    next();
  });

  const json = express.json({ limit: '200kb' });
  const daysAgo = (d) => new Date(Date.now() - Math.max(1, Math.min(365, Number(d) || 7)) * 86400_000).toISOString();

  // --- dashboard --------------------------------------------------------
  app.get('/api/status', (req, res) => {
    const settings = store.getSettings();
    const now = new Date();
    const today = zonedParts(now, config.timeZone).date;
    const startOfToday = startOfLocalDay(now, config.timeZone);
    const groups = store.listGroups();
    const godowns = stock.godownStatus(now);
    res.json({
      businessName: settings.businessName,
      timeZone: config.timeZone,
      godowns,
      pending: godowns.filter((g) => !g.today).map((g) => g.name),
      designs: stock.index.byCode.size,
      unit: stock.index.meta.unit,
      whatsapp: whatsapp ? whatsapp.info() : { status: 'disabled' },
      contacts: store.listContacts().length,
      groupsEnabled: groups.filter((g) => g.enabled).length,
      groupsTotal: groups.length,
      today: store.report(startOfToday.toISOString(), 5, tzOffsetMinutes(now, config.timeZone)).summary,
      reminder: { enabled: settings.reminderEnabled, time: settings.reminderTime, today: store.reminderFor(today) },
      accessMode: settings.accessMode,
    });
  });

  // --- stock upload -----------------------------------------------------
  app.get('/api/upload/detect', (req, res) => {
    const filename = String(req.query.filename || '');
    res.json({ godown: stock.detectGodown(filename), suggestion: stock.suggestGodownName(filename) });
  });

  app.post('/api/upload', express.raw({ type: () => true, limit: `${config.maxUploadMb}mb` }), (req, res) => {
    const filename = decodeURIComponent(req.get('x-filename') || 'stock.xlsx');
    const godownId = Number(req.query.godown) || null;
    const godownName = req.get('x-godown-name') ? decodeURIComponent(req.get('x-godown-name')).trim() : '';
    if (!req.body?.length) return res.status(400).json({ error: 'Empty file' });
    if (!godownId && !godownName) return res.status(400).json({ error: 'Choose the godown for this file' });
    try {
      const { upload, result } = stock.importFile(req.body, filename, { godownId, godownName, source: 'web', uploadedBy: 'admin page' });
      res.json({
        ok: true,
        upload,
        warnings: result.warnings,
        columns: result.columns,
        sheetsUsed: result.sheetsUsed,
        sheetsSkipped: result.sheetsSkipped,
        preview: result.rows.filter((r) => r.qty > 0).slice(0, 8),
        pending: stock.pendingGodowns(),
      });
    } catch (err) {
      if (err instanceof StockFileError) return res.status(422).json({ error: err.message });
      logger.error({ err: err.message }, 'upload failed');
      res.status(500).json({ error: 'Could not read the file.' });
    }
  });

  // --- godowns ----------------------------------------------------------
  app.get('/api/godowns', (req, res) => res.json(stock.godownStatus()));
  app.post('/api/godowns', json, (req, res) => {
    try {
      const g = store.addGodown(req.body?.name);
      stock.reload();
      res.json(g);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  app.put('/api/godowns/:id', json, (req, res) => {
    try {
      const g = store.renameGodown(req.params.id, req.body?.name);
      stock.reload();
      res.json(g);
    } catch (err) {
      res.status(400).json({ error: err.message.includes('UNIQUE') ? 'A godown with this name already exists' : err.message });
    }
  });
  app.delete('/api/godowns/:id', (req, res) => {
    const ok = store.deleteGodown(req.params.id);
    stock.reload();
    res.json({ ok });
  });

  app.get('/api/uploads', (req, res) => res.json(store.listUploads(30)));

  app.get('/api/stock', (req, res) => {
    const q = norm(req.query.q || '');
    const godown = String(req.query.godown || '');
    const idx = stock.index;
    const out = [];
    for (const [code, allRows] of idx.byCode) {
      const rows = godown ? allRows.filter((r) => r.godown === godown) : allRows;
      if (!rows.length) continue;
      const name = rows.find((r) => r.name)?.name || '';
      if (q && !code.includes(codeKeyOf(q)) && !norm(name).includes(q) && !rows.some((r) => norm(r.raw).includes(q))) continue;
      const variants = groupVariants(rows).map((v) => ({
        label: v.label,
        total: v.total,
        godowns: [...v.godowns.values()].filter((g) => g.total > 0).map((g) => ({
          name: g.name,
          total: g.total,
          batches: [...g.batches.values()].map((b) => ({ batch: b.batch, qty: b.qty, racks: [...b.racks] })),
        })),
      }));
      out.push({ code: idx.display.get(code), name, total: variants.reduce((s, v) => s + v.total, 0), variants });
    }
    out.sort((a, b) => b.total - a.total);
    res.json({ unit: idx.meta.unit, count: idx.byCode.size, matches: out.length, items: out.slice(0, 200) });
  });

  app.post('/api/test', json, (req, res) => {
    const settings = store.getSettings();
    const a = answerMessage(stock.index, String(req.body?.text || '').slice(0, 2000), {
      timeZone: config.timeZone,
      strict: !!req.body?.group,
      businessName: settings.businessName,
      showBatch: settings.showBatch,
      showRack: settings.showRack,
    });
    res.json({ relevant: a.relevant, reply: a.relevant ? a.reply : null, outcomes: a.outcomes });
  });

  // --- settings ---------------------------------------------------------
  app.get('/api/settings', (req, res) => res.json(store.getSettings()));
  app.put('/api/settings', json, (req, res) => {
    const b = req.body || {};
    const patch = {};
    if (typeof b.businessName === 'string' && b.businessName.trim()) patch.businessName = b.businessName.trim().slice(0, 80);
    if (['allowed', 'everyone'].includes(b.accessMode)) patch.accessMode = b.accessMode;
    if (typeof b.unknownReplyEnabled === 'boolean') patch.unknownReplyEnabled = b.unknownReplyEnabled;
    if (typeof b.unknownReply === 'string') patch.unknownReply = b.unknownReply.trim().slice(0, 1000);
    if (typeof b.reminderEnabled === 'boolean') patch.reminderEnabled = b.reminderEnabled;
    if (typeof b.reminderTime === 'string') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.reminderTime)) return res.status(400).json({ error: 'Reminder time must look like 10:00' });
      patch.reminderTime = b.reminderTime;
    }
    if (typeof b.reminderText === 'string' && b.reminderText.trim()) patch.reminderText = b.reminderText.trim().slice(0, 1000);
    if (typeof b.selfChatCommands === 'boolean') patch.selfChatCommands = b.selfChatCommands;
    if (typeof b.showBatch === 'boolean') patch.showBatch = b.showBatch;
    if (typeof b.showRack === 'boolean') patch.showRack = b.showRack;
    res.json(store.updateSettings(patch));
  });

  // --- contacts (allowed numbers) ----------------------------------------
  app.get('/api/contacts', (req, res) => res.json(store.listContacts()));

  app.post('/api/contacts', json, (req, res) => {
    const phone = normPhone(req.body?.phone, config.defaultCountryCode);
    if (phone.length < 8 || phone.length > 15) return res.status(400).json({ error: 'Please enter a valid mobile number' });
    const role = ROLES.has(req.body?.role) ? req.body.role : 'dealer';
    const contact = store.upsertContact({
      phone,
      name: String(req.body?.name || '').trim().slice(0, 80),
      role,
      active: req.body?.active !== false,
    });
    res.json(contact);
  });

  app.post('/api/contacts/bulk', json, (req, res) => {
    const role = ROLES.has(req.body?.role) ? req.body.role : 'dealer';
    let added = 0;
    const skipped = [];
    for (const line of String(req.body?.text || '').split(/\r?\n/)) {
      if (!line.trim()) continue;
      const m = line.match(/\+?\d[\d\s\-()]{8,}\d/);
      const phone = m ? normPhone(m[0], config.defaultCountryCode) : '';
      if (phone.length < 10 || phone.length > 15) {
        skipped.push(line.trim());
        continue;
      }
      const name = line.replace(m[0], ' ').replace(/[,;:\-–|\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      const existing = store.findContact(phone);
      store.upsertContact({ phone, name: name || existing?.name || '', role: existing?.role === 'admin' ? 'admin' : role, active: true });
      added++;
    }
    res.json({ added, skipped });
  });

  app.delete('/api/contacts/:phone', (req, res) => {
    res.json({ ok: store.deleteContact(normPhone(req.params.phone, config.defaultCountryCode)) });
  });

  // --- groups -----------------------------------------------------------
  app.get('/api/groups', (req, res) => res.json(store.listGroups()));
  app.post('/api/groups/refresh', async (req, res) => {
    if (!whatsapp || whatsapp.status !== 'open') return res.status(409).json({ error: 'Connect WhatsApp first' });
    try {
      store.syncGroups(await whatsapp.refreshGroups());
      res.json(store.listGroups());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.put('/api/groups/:jid', json, (req, res) => {
    res.json({ ok: store.setGroupEnabled(req.params.jid, !!req.body?.enabled) });
  });

  // --- reports ----------------------------------------------------------
  app.get('/api/reports', (req, res) => res.json(store.report(daysAgo(req.query.days), 15, tzOffsetMinutes(new Date(), config.timeZone))));
  app.get('/api/queries', (req, res) => {
    res.json(store.recentQueries({
      sinceIso: daysAgo(req.query.days || 30),
      limit: Math.min(200, Number(req.query.limit) || 50),
      offset: Number(req.query.offset) || 0,
    }));
  });
  app.get('/api/queries.csv', (req, res) => {
    const rows = store.recentQueries({ sinceIso: daysAgo(req.query.days || 30), limit: 100_000 });
    const esc = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop Excel formula injection
      return `"${s.replace(/"/g, '""')}"`;
    };
    const lines = [['Time', 'Name', 'Phone', 'Chat', 'Group', 'Message', 'Codes', 'Result', 'Replied'].map(esc).join(',')];
    for (const r of rows) {
      lines.push([r.at, r.sender_name, r.sender_phone, r.chat_name, r.is_group ? 'yes' : 'no', r.text, r.codes, r.outcome, r.replied ? 'yes' : 'no'].map(esc).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="stock-queries.csv"');
    res.send(`﻿${lines.join('\r\n')}`);
  });

  // --- whatsapp ---------------------------------------------------------
  app.get('/api/whatsapp', (req, res) => res.json(whatsapp ? whatsapp.info() : { status: 'disabled' }));
  app.post('/api/whatsapp/pair', json, async (req, res) => {
    if (!whatsapp) return res.status(409).json({ error: 'WhatsApp is disabled on this server' });
    const phone = normPhone(req.body?.phone, config.defaultCountryCode);
    if (phone.length < 10) return res.status(400).json({ error: 'Enter the shop WhatsApp number with country code' });
    try {
      res.json({ code: await whatsapp.pairingCode(phone) });
    } catch (err) {
      res.status(409).json({ error: err.message });
    }
  });
  app.post('/api/whatsapp/logout', async (req, res) => {
    if (!whatsapp) return res.status(409).json({ error: 'WhatsApp is disabled on this server' });
    await whatsapp.logout();
    res.json(whatsapp.info());
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  app.use(express.static(join(ROOT, 'public'), { index: 'index.html', maxAge: '1h' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: `File too big (max ${config.maxUploadMb} MB)` });
    logger.error({ err: err.message }, 'request failed');
    res.status(500).json({ error: 'Server error' });
  });

  return app;
}
