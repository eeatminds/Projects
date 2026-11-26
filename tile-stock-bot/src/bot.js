// Decides what to do with every incoming WhatsApp message.
//
// The bot is linked to the shop's own WhatsApp Business number, so it sees ALL
// chats. It must stay silent unless the message is clearly a stock question:
//   * own outgoing messages (admin typing on the phone) are ignored
//   * groups: only groups switched ON in the admin page, and only stock questions
//   * 1-to-1: numbers in the Contacts list (or everyone, if the admin chose that)
//   * "Message yourself" chat on the shop phone = admin console (Excel upload, status)
//   * Excel files are accepted only from admin numbers / the shop's own number;
//     the godown comes from the caption or the file name ("HUBLI_..._STOCK.xlsx")

import { ALLOWED_EXTENSIONS, StockFileError } from './importer.js';
import { answerMessage, helpText } from './replies.js';
import { norm } from './util.js';

const MAX_AGE_MS = 15 * 60 * 1000; // ignore messages that arrived while the bot was offline for long
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 12; // replies per chat per minute
const STATUS_WORDS = new Set(['STATUS', 'STOCKSTATUS', 'LASTUPDATE']);

export class StockBot {
  /**
   * @param {object} deps
   * @param {import('./db.js').Store} deps.store
   * @param {import('./stock-service.js').StockService} deps.stock
   * @param {object} deps.config
   * @param {{sendText(chatId: string, text: string, quote?: object): Promise<void>}} deps.transport
   * @param {object} [deps.logger]
   */
  constructor({ store, stock, config, transport, logger = console }) {
    this.store = store;
    this.stock = stock;
    this.config = config;
    this.transport = transport;
    this.logger = logger;
    this.rate = new Map();
  }

  /**
   * @param {object} msg normalised message
   *   { id, chatId, chatName, isGroup, isSelfChat, fromMe, senderPhone, senderName, text,
   *     document?: { fileName, size, download(): Promise<Buffer> }, timestamp: Date, quote?: object }
   * @returns {Promise<{action: string, reason?: string, reply?: string}>}
   */
  async handle(msg, now = new Date()) {
    if (msg.fromMe && !msg.isSelfChat) return { action: 'ignored', reason: 'own outgoing message' };
    if (msg.timestamp && now - msg.timestamp > MAX_AGE_MS) return { action: 'ignored', reason: 'old message' };

    const settings = this.store.getSettings();
    const contact = msg.isSelfChat ? null : this.store.findContact(msg.senderPhone);
    const activeContact = contact?.active ? contact : null;
    const isAdmin = msg.isSelfChat || activeContact?.role === 'admin';
    const allowed = isAdmin || !!activeContact || settings.accessMode === 'everyone';

    if (msg.isSelfChat && !settings.selfChatCommands) return { action: 'ignored', reason: 'self chat disabled' };

    // --- Excel upload over WhatsApp -------------------------------------
    if (msg.document) {
      if (msg.isGroup || !isAdmin) return { action: 'ignored', reason: 'document from non-admin' };
      const ext = (String(msg.document.fileName || '').toLowerCase().match(/\.[a-z0-9]+$/) || [''])[0];
      if (!ALLOWED_EXTENSIONS.includes(ext)) return { action: 'ignored', reason: 'not a stock file' };
      if (msg.document.size && msg.document.size > this.config.maxUploadMb * 1024 * 1024) {
        return this.reply(msg, `❌ File is too big (max ${this.config.maxUploadMb} MB).`, 'upload_failed');
      }
      try {
        const buffer = await msg.document.download();
        const who = msg.isSelfChat ? 'shop phone' : `${activeContact?.name || ''} ${msg.senderPhone}`.trim();
        const { upload, result } = this.stock.importFile(buffer, msg.document.fileName, {
          caption: msg.text || '',
          source: 'whatsapp',
          uploadedBy: who,
        });
        return this.reply(msg, this.stock.uploadSummary(upload, result), 'imported');
      } catch (err) {
        const text = err instanceof StockFileError ? err.message : 'Something went wrong while reading the file.';
        if (!(err instanceof StockFileError)) this.logger.error?.({ err }, 'whatsapp upload failed');
        return this.reply(msg, `❌ Stock NOT updated.\n${text}\n\nThe old stock list is still being used.`, 'upload_failed');
      }
    }

    const text = String(msg.text || '').trim();
    if (!text) return { action: 'ignored', reason: 'no text' };

    // --- admin commands -------------------------------------------------
    if (isAdmin && !msg.isGroup && STATUS_WORDS.has(norm(text))) {
      return this.reply(msg, this.stock.statusText(now), 'status');
    }

    // --- groups must be switched on -------------------------------------
    if (msg.isGroup) {
      const group = this.store.getGroup(msg.chatId);
      if (!group?.enabled) return { action: 'ignored', reason: 'group not enabled' };
    }

    const answer = answerMessage(this.stock.index, text, {
      timeZone: this.config.timeZone,
      now,
      strict: msg.isGroup,
      businessName: settings.businessName,
      showBatch: settings.showBatch,
      showRack: settings.showRack,
    });
    if (!answer.relevant) return { action: 'ignored', reason: 'not a stock question' };

    // --- unknown numbers in 1-to-1 chats --------------------------------
    if (!msg.isGroup && !allowed) {
      this.log(msg, answer.outcomes, false, 'blocked');
      const since = new Date(now.getTime() - 24 * 3600_000).toISOString();
      if (settings.unknownReplyEnabled && settings.unknownReply && msg.senderPhone && !this.store.unknownNotifiedSince(msg.senderPhone, since)) {
        this.store.markUnknownNotified(msg.senderPhone);
        await this.send(msg, settings.unknownReply);
        return { action: 'blocked', reason: 'unknown number (told once)', reply: settings.unknownReply };
      }
      return { action: 'blocked', reason: 'unknown number' };
    }

    if (!this.allowRate(msg.chatId, now)) return { action: 'ignored', reason: 'rate limit' };

    const reply = answer.help ? helpText(settings.businessName, { isAdmin: isAdmin && !msg.isGroup }) : answer.reply;
    await this.send(msg, reply);
    if (!answer.help) this.log(msg, answer.outcomes, true);
    return { action: 'replied', reply };
  }

  async reply(msg, text, action) {
    await this.send(msg, text);
    return { action, reply: text };
  }

  async send(msg, text) {
    // Quote the question in groups so everyone sees which message was answered.
    await this.transport.sendText(msg.chatId, text, msg.isGroup ? msg.quote : undefined);
  }

  log(msg, outcomes, replied, outcome) {
    try {
      this.store.logQuery({
        chatId: msg.chatId,
        chatName: msg.chatName,
        isGroup: msg.isGroup,
        senderPhone: msg.isSelfChat ? 'self' : msg.senderPhone,
        senderName: msg.isSelfChat ? 'Shop phone' : msg.senderName,
        text: msg.text,
        outcomes,
        replied,
        outcome,
      });
    } catch (err) {
      this.logger.error?.({ err }, 'could not log query');
    }
  }

  allowRate(chatId, now) {
    const t = now.getTime();
    const list = (this.rate.get(chatId) || []).filter((x) => t - x < RATE_WINDOW_MS);
    if (list.length >= RATE_MAX) {
      this.rate.set(chatId, list);
      return false;
    }
    list.push(t);
    this.rate.set(chatId, list);
    if (this.rate.size > 5000) this.rate.clear();
    return true;
  }
}
