// SQLite storage (Node's built-in node:sqlite, no native build needed).

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_SETTINGS = {
  businessName: 'Naveen Tiles',
  // 'allowed' = only numbers in the Contacts list get replies in 1-to-1 chats; 'everyone' = anybody.
  accessMode: 'allowed',
  unknownReplyEnabled: true,
  unknownReply:
    'Namaste 🙏 Automatic stock replies are only for registered dealers and staff. Please contact our office to get access.',
  reminderEnabled: true,
  reminderTime: '10:00',
  reminderText: "⏰ Good morning! Today's stock list is not uploaded yet for:",
  selfChatCommands: true,
  showBatch: true, // list batch-wise stock under each godown
  showRack: false, // add rack/bin location (A25, MW09) after each batch
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS godowns (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT, godown_id INTEGER NOT NULL,
  filename TEXT, uploaded_at TEXT NOT NULL, stock_date TEXT, source TEXT, uploaded_by TEXT,
  row_count INTEGER, item_count INTEGER, location_count INTEGER, total_qty REAL, unit TEXT, layout TEXT,
  columns_json TEXT, warnings_json TEXT, sheets_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_uploads_godown ON uploads(godown_id, id);
CREATE TABLE IF NOT EXISTS stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  godown_id INTEGER NOT NULL, upload_id INTEGER NOT NULL,
  key TEXT NOT NULL, code TEXT NOT NULL, raw TEXT, name TEXT, polish TEXT, category TEXT, size TEXT, grade TEXT,
  shade TEXT, location TEXT, qty REAL NOT NULL DEFAULT 0, sqft REAL
);
CREATE INDEX IF NOT EXISTS idx_stock_godown ON stock(godown_id);
CREATE TABLE IF NOT EXISTS contacts (
  phone TEXT PRIMARY KEY, name TEXT, role TEXT NOT NULL DEFAULT 'dealer', active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wa_groups (
  jid TEXT PRIMARY KEY, name TEXT, enabled INTEGER NOT NULL DEFAULT 0, participants INTEGER, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL, chat_id TEXT, chat_name TEXT, is_group INTEGER, sender_phone TEXT, sender_name TEXT,
  text TEXT, outcome TEXT, replied INTEGER
);
CREATE INDEX IF NOT EXISTS idx_queries_at ON queries(at);
CREATE TABLE IF NOT EXISTS query_items (
  query_id INTEGER NOT NULL, code TEXT, token TEXT, outcome TEXT
);
CREATE INDEX IF NOT EXISTS idx_query_items_q ON query_items(query_id);
CREATE TABLE IF NOT EXISTS reminders (day TEXT PRIMARY KEY, sent_at TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS unknown_notified (phone TEXT PRIMARY KEY, at TEXT NOT NULL);
`;

const OUTCOME_RANK = ['in_stock', 'out_of_stock', 'unavailable', 'ambiguous', 'not_found', 'no_stock_list'];

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  tx(fn) {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // --- settings ---------------------------------------------------------
  getSettings() {
    const out = { ...DEFAULT_SETTINGS };
    for (const { key, value } of this.db.prepare('SELECT key, value FROM settings').all()) {
      try {
        out[key] = JSON.parse(value);
      } catch {
        /* ignore broken value */
      }
    }
    return out;
  }

  hasSetting(key) {
    return !!this.db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key);
  }

  updateSettings(patch) {
    const stmt = this.db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    this.tx(() => {
      for (const [k, v] of Object.entries(patch)) if (k in DEFAULT_SETTINGS) stmt.run(k, JSON.stringify(v));
    });
    return this.getSettings();
  }

  // --- godowns ----------------------------------------------------------
  listGodowns() {
    return this.db.prepare('SELECT * FROM godowns ORDER BY name COLLATE NOCASE').all().map((g) => ({ id: g.id, name: g.name, createdAt: g.created_at }));
  }

  getGodown(id) {
    const g = this.db.prepare('SELECT * FROM godowns WHERE id = ?').get(Number(id));
    return g ? { id: g.id, name: g.name, createdAt: g.created_at } : null;
  }

  findGodownByName(name) {
    const g = this.db.prepare('SELECT * FROM godowns WHERE name = ? COLLATE NOCASE').get(String(name || '').trim());
    return g ? { id: g.id, name: g.name, createdAt: g.created_at } : null;
  }

  addGodown(name) {
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!clean) throw new Error('Godown name is empty');
    const existing = this.findGodownByName(clean);
    if (existing) return existing;
    const info = this.db.prepare('INSERT INTO godowns(name, created_at) VALUES(?, ?)').run(clean, new Date().toISOString());
    return this.getGodown(Number(info.lastInsertRowid));
  }

  renameGodown(id, name) {
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!clean) throw new Error('Godown name is empty');
    this.db.prepare('UPDATE godowns SET name = ? WHERE id = ?').run(clean, Number(id));
    return this.getGodown(id);
  }

  deleteGodown(id) {
    return this.tx(() => {
      this.db.prepare('DELETE FROM stock WHERE godown_id = ?').run(Number(id));
      this.db.prepare('DELETE FROM uploads WHERE godown_id = ?').run(Number(id));
      return this.db.prepare('DELETE FROM godowns WHERE id = ?').run(Number(id)).changes > 0;
    });
  }

  // --- stock ------------------------------------------------------------
  /** Replace ONE godown's stock with a new upload. Other godowns are not touched. */
  saveUpload({ godownId, filename, source, uploadedBy, result, at = new Date() }) {
    return this.tx(() => {
      const info = this.db
        .prepare(`INSERT INTO uploads(godown_id, filename, uploaded_at, stock_date, source, uploaded_by, row_count, item_count,
                  location_count, total_qty, unit, layout, columns_json, warnings_json, sheets_json)
                  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(godownId, filename, at.toISOString(), result.stockDate || null, source, uploadedBy || '', result.rows.length,
          result.itemCount, result.locationCount, result.totalQty ?? 0, result.unit, result.layout,
          JSON.stringify(result.columns), JSON.stringify(result.warnings),
          JSON.stringify({ used: result.sheetsUsed || [], skipped: result.sheetsSkipped || [] }));
      const uploadId = Number(info.lastInsertRowid);
      this.db.prepare('DELETE FROM stock WHERE godown_id = ?').run(godownId);
      const ins = this.db.prepare(
        'INSERT INTO stock(godown_id, upload_id, key, code, raw, name, polish, category, size, grade, shade, location, qty, sqft) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      );
      for (const r of result.rows) {
        ins.run(godownId, uploadId, r.key, r.code, r.raw || '', r.name || '', r.polish || '', r.category || '', r.size || '',
          r.grade || '', r.shade || '', r.location || '', r.qty ?? 0, r.sqft ?? null);
      }
      // keep the last 60 uploads per godown in the history
      this.db
        .prepare('DELETE FROM uploads WHERE godown_id = ? AND id NOT IN (SELECT id FROM uploads WHERE godown_id = ? ORDER BY id DESC LIMIT 60)')
        .run(godownId, godownId);
      return this.getUpload(uploadId);
    });
  }

  getUpload(id) {
    const row = this.db.prepare('SELECT u.*, g.name AS godown FROM uploads u JOIN godowns g ON g.id = u.godown_id WHERE u.id = ?').get(id);
    return row ? mapUpload(row) : null;
  }

  /** The upload currently in use for every godown (godowns without upload included, upload = null). */
  currentUploads() {
    const rows = this.db
      .prepare(`SELECT g.id AS gid, g.name AS gname, u.*, g.name AS godown FROM godowns g
                LEFT JOIN uploads u ON u.id = (SELECT MAX(id) FROM uploads WHERE godown_id = g.id)
                ORDER BY g.name COLLATE NOCASE`)
      .all();
    return rows.map((r) => ({ id: r.gid, name: r.gname, upload: r.id ? mapUpload(r) : null }));
  }

  listUploads(limit = 30) {
    return this.db
      .prepare('SELECT u.*, g.name AS godown FROM uploads u JOIN godowns g ON g.id = u.godown_id ORDER BY u.id DESC LIMIT ?')
      .all(limit)
      .map(mapUpload);
  }

  loadStockRows() {
    return this.db
      .prepare(`SELECT s.key, s.code, s.raw, s.name, s.polish, s.category, s.size, s.grade, s.shade, s.location, s.qty, s.sqft,
                       g.name AS godown, s.godown_id AS godownId
                FROM stock s JOIN godowns g ON g.id = s.godown_id ORDER BY s.id`)
      .all();
  }

  // --- contacts ---------------------------------------------------------
  listContacts() {
    return this.db.prepare('SELECT * FROM contacts ORDER BY role = \'admin\' DESC, name COLLATE NOCASE').all().map(mapContact);
  }

  findContact(phone) {
    if (!phone) return null;
    const row = this.db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone);
    return row ? mapContact(row) : null;
  }

  upsertContact({ phone, name = '', role = 'dealer', active = true }) {
    this.db
      .prepare(`INSERT INTO contacts(phone, name, role, active, created_at) VALUES(?,?,?,?,?)
                ON CONFLICT(phone) DO UPDATE SET name = excluded.name, role = excluded.role, active = excluded.active`)
      .run(phone, name, role, active ? 1 : 0, new Date().toISOString());
    return this.findContact(phone);
  }

  deleteContact(phone) {
    return this.db.prepare('DELETE FROM contacts WHERE phone = ?').run(phone).changes > 0;
  }

  adminPhones() {
    return this.db.prepare("SELECT phone FROM contacts WHERE role = 'admin' AND active = 1").all().map((r) => r.phone);
  }

  // --- groups -----------------------------------------------------------
  syncGroups(groups) {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`INSERT INTO wa_groups(jid, name, participants, updated_at) VALUES(?,?,?,?)
      ON CONFLICT(jid) DO UPDATE SET name = excluded.name, participants = COALESCE(excluded.participants, participants), updated_at = excluded.updated_at`);
    this.tx(() => {
      for (const g of groups) stmt.run(g.jid, g.name || '', g.participants ?? null, now);
    });
  }

  listGroups() {
    return this.db.prepare('SELECT * FROM wa_groups ORDER BY enabled DESC, name COLLATE NOCASE').all().map(mapGroup);
  }

  getGroup(jid) {
    const row = this.db.prepare('SELECT * FROM wa_groups WHERE jid = ?').get(jid);
    return row ? mapGroup(row) : null;
  }

  setGroupEnabled(jid, enabled) {
    return this.db.prepare('UPDATE wa_groups SET enabled = ? WHERE jid = ?').run(enabled ? 1 : 0, jid).changes > 0;
  }

  // --- query log --------------------------------------------------------
  logQuery({ at = new Date(), chatId, chatName, isGroup, senderPhone, senderName, text, outcomes = [], replied = true, outcome }) {
    const overall = outcome || outcomes.map((o) => o.outcome).sort((a, b) => OUTCOME_RANK.indexOf(a) - OUTCOME_RANK.indexOf(b))[0] || 'none';
    return this.tx(() => {
      const info = this.db
        .prepare('INSERT INTO queries(at, chat_id, chat_name, is_group, sender_phone, sender_name, text, outcome, replied) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(at.toISOString(), chatId || '', chatName || '', isGroup ? 1 : 0, senderPhone || '', senderName || '', String(text || '').slice(0, 1000), overall, replied ? 1 : 0);
      const id = Number(info.lastInsertRowid);
      const ins = this.db.prepare('INSERT INTO query_items(query_id, code, token, outcome) VALUES(?,?,?,?)');
      for (const o of outcomes) ins.run(id, o.code || null, o.token || null, o.outcome);
      return id;
    });
  }

  prune(days = 180) {
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
    this.tx(() => {
      this.db.prepare('DELETE FROM query_items WHERE query_id IN (SELECT id FROM queries WHERE at < ?)').run(cutoff);
      this.db.prepare('DELETE FROM queries WHERE at < ?').run(cutoff);
    });
  }

  /** offsetMinutes: local timezone offset, so "daily" counts use local days (IST = 330). */
  report(sinceIso, limit = 15, offsetMinutes = 0) {
    const summary = this.db
      .prepare(`SELECT COUNT(*) AS total,
                       COUNT(DISTINCT CASE WHEN sender_phone <> '' THEN sender_phone END) AS people,
                       SUM(outcome = 'in_stock') AS inStock,
                       SUM(outcome IN ('out_of_stock','unavailable')) AS outOfStock,
                       SUM(outcome IN ('not_found','ambiguous')) AS notFound,
                       SUM(outcome = 'blocked') AS blocked
                FROM queries WHERE at >= ?`)
      .get(sinceIso);
    const items = (where) =>
      this.db
        .prepare(`SELECT COALESCE(i.code, i.token) AS code, COUNT(*) AS count, COUNT(DISTINCT q.sender_phone) AS people, MAX(q.at) AS last
                  FROM query_items i JOIN queries q ON q.id = i.query_id
                  WHERE q.at >= ? AND ${where} AND COALESCE(i.code, i.token) IS NOT NULL
                  GROUP BY COALESCE(i.code, i.token) ORDER BY count DESC, last DESC LIMIT ?`)
        .all(sinceIso, limit);
    return {
      summary: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, Number(v) || 0])),
      topCodes: items("i.outcome IN ('in_stock','out_of_stock','unavailable')"),
      outOfStock: items("i.outcome IN ('out_of_stock','unavailable')"),
      notFound: items("i.outcome IN ('not_found','ambiguous')"),
      topPeople: this.db
        .prepare(`SELECT sender_phone AS phone, MAX(sender_name) AS name, COUNT(*) AS count FROM queries
                  WHERE at >= ? AND sender_phone <> '' GROUP BY sender_phone ORDER BY count DESC LIMIT ?`)
        .all(sinceIso, limit),
      daily: this.db
        .prepare("SELECT date(at, ? || ' minutes') AS day, COUNT(*) AS count FROM queries WHERE at >= ? GROUP BY day ORDER BY day")
        .all(String(offsetMinutes >= 0 ? `+${offsetMinutes}` : offsetMinutes), sinceIso),
    };
  }

  recentQueries({ limit = 50, offset = 0, sinceIso = '' } = {}) {
    return this.db
      .prepare(`SELECT q.*, (SELECT GROUP_CONCAT(COALESCE(code, token), ', ') FROM query_items WHERE query_id = q.id) AS codes
                FROM queries q WHERE q.at >= ? ORDER BY q.id DESC LIMIT ? OFFSET ?`)
      .all(sinceIso, limit, offset)
      .map((r) => ({ ...r, is_group: !!r.is_group, replied: !!r.replied }));
  }

  // --- reminders / polite replies ---------------------------------------
  reminderFor(day) {
    return this.db.prepare('SELECT * FROM reminders WHERE day = ?').get(day) || null;
  }

  markReminder(day, status) {
    this.db
      .prepare('INSERT INTO reminders(day, sent_at, status) VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET sent_at = excluded.sent_at, status = excluded.status')
      .run(day, new Date().toISOString(), status);
  }

  unknownNotifiedSince(phone, sinceIso) {
    const row = this.db.prepare('SELECT at FROM unknown_notified WHERE phone = ?').get(phone);
    return !!row && row.at >= sinceIso;
  }

  markUnknownNotified(phone) {
    this.db
      .prepare('INSERT INTO unknown_notified(phone, at) VALUES(?, ?) ON CONFLICT(phone) DO UPDATE SET at = excluded.at')
      .run(phone, new Date().toISOString());
  }
}

function mapUpload(r) {
  return {
    id: r.id,
    godownId: r.godown_id,
    godown: r.godown,
    filename: r.filename,
    uploadedAt: r.uploaded_at,
    stockDate: r.stock_date,
    totalQty: r.total_qty,
    sheets: safeJson(r.sheets_json, { used: [], skipped: [] }),
    source: r.source,
    uploadedBy: r.uploaded_by,
    rowCount: r.row_count,
    itemCount: r.item_count,
    locationCount: r.location_count,
    unit: r.unit,
    layout: r.layout,
    columns: safeJson(r.columns_json, {}),
    warnings: safeJson(r.warnings_json, []),
  };
}

const mapContact = (r) => ({ phone: r.phone, name: r.name, role: r.role, active: !!r.active, createdAt: r.created_at });
const mapGroup = (r) => ({ jid: r.jid, name: r.name, enabled: !!r.enabled, participants: r.participants, updatedAt: r.updated_at });

function safeJson(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}
