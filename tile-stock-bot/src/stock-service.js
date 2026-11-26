// Holds the current stock of all godowns in memory and handles new uploads.
// Every godown has its own Excel: uploading Hubli's file replaces ONLY Hubli's stock.

import { StockFileError, importStock } from './importer.js';
import { StockIndex } from './search.js';
import { fmtDateTime, fmtNum, norm, zonedParts } from './util.js';

const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const NOT_A_NAME = new Set(['STOCK', 'GODOWN', 'GODOWNS', 'CERAMIC', 'CERAMICK', 'VITRIFIED', 'TILES', 'TILE', 'DAILY', 'REPORT',
  'LIST', 'NEW', 'COPY', 'FINAL', 'UPDATED', 'SHEET', 'BOOK', 'XLSX', 'XLS', 'CSV', 'TODAY', 'DATA']);

export class StockService {
  constructor({ store, config }) {
    this.store = store;
    this.config = config;
    this.listeners = new Set();
    this.reload();
  }

  reload() {
    this.godowns = this.store.currentUploads(); // [{ id, name, upload }]
    const units = new Map();
    for (const g of this.godowns) if (g.upload) units.set(g.upload.unit, (units.get(g.upload.unit) || 0) + 1);
    const unit = [...units.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || this.config.defaultUnit;
    this.index = new StockIndex(this.store.loadStockRows(), {
      unit,
      godowns: this.godowns.map((g) => ({ name: g.name, uploadedAt: g.upload?.uploadedAt || null, stockDate: g.upload?.stockDate || null })),
    });
  }

  onUpload(fn) {
    this.listeners.add(fn);
  }

  /** Known godown whose name appears in the caption or file name ("HUBLI_CERAMICK_..._STOCK.xlsx" -> Hubli). */
  detectGodown(filename = '', caption = '') {
    const godowns = this.store.listGodowns().sort((a, b) => norm(b.name).length - norm(a.name).length);
    for (const text of [caption, filename]) {
      const n = norm(text);
      if (!n) continue;
      const hit = godowns.find((g) => norm(g.name) && n.includes(norm(g.name)));
      if (hit) return hit;
    }
    return null;
  }

  /** A name to suggest for a new godown, from the file name ("HUBLI_..." -> "Hubli"). */
  suggestGodownName(filename = '') {
    const words = String(filename).replace(/\.[a-z0-9]+$/i, '').split(/[^A-Za-z]+/).filter((w) => w.length >= 3);
    const w = words.find((x) => !NOT_A_NAME.has(x.toUpperCase()));
    return w ? titleCase(w) : '';
  }

  /** Godown named in a WhatsApp caption: an existing one, or a new one if the caption is just a short name. */
  godownFromCaption(caption) {
    const text = String(caption || '').trim();
    if (!text) return null;
    const known = this.detectGodown('', text);
    if (known) return known;
    const words = text.split(/\s+/).filter((w) => !NOT_A_NAME.has(w.toUpperCase()));
    if (words.length >= 1 && words.length <= 3 && words.every((w) => /^[A-Za-z][A-Za-z.\-']*$/.test(w))) {
      return this.store.addGodown(titleCase(words.join(' ')));
    }
    return null;
  }

  /**
   * Parse a godown's stock file and replace that godown's stock.
   * @param {object} o { godownId?, godownName? (creates if new), caption? (WhatsApp), source, uploadedBy }
   * Throws StockFileError on a bad file or unknown godown (old stock stays).
   */
  importFile(buffer, filename, o = {}) {
    let godown = null;
    if (o.godownId) godown = this.store.getGodown(o.godownId);
    else if (o.godownName) godown = this.store.addGodown(o.godownName);
    else if (o.caption !== undefined) godown = this.godownFromCaption(o.caption) || this.detectGodown(filename);
    else godown = this.detectGodown(filename);
    if (!godown) {
      const known = this.store.listGodowns().map((g) => g.name);
      throw new StockFileError(
        'Which godown is this file for? ' +
          (known.length ? `Put the godown name (${known.join(', ')}) in the file name or caption.` : 'Send it again with the godown name as caption, e.g. Hubli.'),
      );
    }

    const result = importStock(buffer, filename, this.config.defaultUnit);
    const previous = this.godowns.find((g) => g.id === godown.id)?.upload;
    const today = zonedParts(new Date(), this.config.timeZone).date;
    const yesterday = zonedParts(new Date(Date.now() - 86400_000), this.config.timeZone).date;
    if (result.stockDate && result.stockDate < yesterday) {
      result.warnings.unshift(`The file says stock "as on ${fmtIsoDate(result.stockDate)}" – this looks like an old file. Today is ${fmtIsoDate(today)}.`);
    }
    if (result.stockDate && previous?.stockDate && result.stockDate < previous.stockDate) {
      result.warnings.unshift(`This file (${fmtIsoDate(result.stockDate)}) is OLDER than the one it replaced (${fmtIsoDate(previous.stockDate)}).`);
    }

    const upload = this.store.saveUpload({ godownId: godown.id, filename, source: o.source || 'web', uploadedBy: o.uploadedBy || '', result });
    this.reload();
    for (const fn of this.listeners) fn(upload);
    return { upload, result, godown };
  }

  uploadedToday(upload, now = new Date()) {
    if (!upload) return false;
    const tz = this.config.timeZone;
    return zonedParts(new Date(upload.uploadedAt), tz).date === zonedParts(now, tz).date;
  }

  /** [{ id, name, upload, today }] */
  godownStatus(now = new Date()) {
    return this.godowns.map((g) => ({ ...g, today: this.uploadedToday(g.upload, now) }));
  }

  pendingGodowns(now = new Date()) {
    return this.godownStatus(now).filter((g) => !g.today).map((g) => g.name);
  }

  /** Status for the admin ("status" command on WhatsApp). */
  statusText(now = new Date()) {
    const list = this.godownStatus(now);
    if (!list.length) return '📭 No godowns yet. Send a godown\'s stock Excel with the godown name as caption (e.g. *Hubli*).';
    const lines = ['📊 *Stock lists*'];
    for (const g of list) {
      if (!g.upload) {
        lines.push(`❌ *${g.name}*: never uploaded`);
        continue;
      }
      const when = fmtDateTime(new Date(g.upload.uploadedAt), this.config.timeZone);
      const asOn = g.upload.stockDate ? ` · as on ${fmtIsoDate(g.upload.stockDate)}` : '';
      lines.push(`${g.today ? '✅' : '⚠️'} *${g.name}*: ${when}${asOn} · ${fmtNum(g.upload.itemCount)} designs`);
    }
    const pending = list.filter((g) => !g.today).length;
    lines.push('', pending ? `${pending} godown${pending > 1 ? 's' : ''} not updated today.` : 'All godowns updated today ✅');
    return lines.join('\n');
  }

  /** Message sent back after an upload. */
  uploadSummary(upload, result) {
    const lines = [
      `✅ *${upload.godown} stock updated*`,
      `${fmtNum(upload.itemCount)} designs · ${fmtNum(upload.rowCount)} rows · ${fmtNum(upload.totalQty)} ${upload.unit}`,
    ];
    if (upload.stockDate) lines.push(`Stock as on ${fmtIsoDate(upload.stockDate)}`);
    if (result.warnings.length) lines.push('', '⚠️ Please check:', ...result.warnings.slice(0, 5).map((w) => `• ${w}`));
    const pending = this.pendingGodowns();
    lines.push('', pending.length ? `Still to update today: ${pending.join(', ')}` : 'All godowns are updated for today ✅');
    return lines.join('\n');
  }
}

export function fmtIsoDate(iso) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${iso}T12:00:00Z`));
}
