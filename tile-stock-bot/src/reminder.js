// Morning reminder: if any godown's stock Excel is not uploaded by the set time, message the admin(s).

import { zonedParts } from './util.js';

const LAST_HOUR = 20; // don't send reminders after 8 PM

export class Reminder {
  constructor({ store, stock, config, whatsapp, logger }) {
    this.store = store;
    this.stock = stock;
    this.config = config;
    this.whatsapp = whatsapp;
    this.logger = logger;
    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => this.check().catch((err) => this.logger.error({ err: err.message }, 'reminder failed')), 60_000);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }

  /** Who gets the reminder: admin contacts, or the shop's own "Message yourself" chat if none. */
  targets() {
    const admins = this.store.adminPhones().map((p) => `${p}@s.whatsapp.net`);
    if (admins.length) return admins;
    const self = this.whatsapp?.selfJid();
    return self ? [self] : [];
  }

  async check(now = new Date()) {
    const s = this.store.getSettings();
    if (!s.reminderEnabled) return 'disabled';
    const { date, time, hour } = zonedParts(now, this.config.timeZone);
    if (time < (s.reminderTime || '10:00') || hour >= LAST_HOUR) return 'not time';
    if (this.store.reminderFor(date)) return 'already done';
    const godowns = this.stock.godownStatus(now);
    const pending = godowns.filter((g) => !g.today).map((g) => g.name);
    if (godowns.length && !pending.length) {
      this.store.markReminder(date, 'not needed');
      return 'uploaded';
    }
    if (!this.whatsapp || this.whatsapp.status !== 'open') return 'whatsapp offline';
    const targets = this.targets();
    if (!targets.length) return 'no target';
    const link = this.config.publicUrl ? `\n\nOr upload on the admin page: ${this.config.publicUrl}` : '';
    const list = pending.length ? `\n${pending.map((n) => `• *${n}*`).join('\n')}` : '\n(no godown stock uploaded yet)';
    const how = '\n\nSend each godown\'s Excel here (godown name in the file name or caption).';
    for (const jid of targets) {
      try {
        await this.whatsapp.sendText(jid, `${s.reminderText}${list}${how}${link}`);
      } catch (err) {
        this.logger.warn({ err: err.message, jid }, 'reminder not sent');
      }
    }
    this.store.markReminder(date, 'sent');
    this.logger.info({ targets: targets.length }, 'morning reminder sent');
    return 'sent';
  }
}
