// Links to the shop's WhatsApp Business app as a "linked device" (like WhatsApp Web)
// using Baileys. The phone keeps working normally.

import { EventEmitter } from 'node:events';
import { rmSync } from 'node:fs';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  areJidsSameUser,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  getContentType,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  isLidUser,
  isPnUser,
  jidDecode,
  jidNormalizedUser,
  normalizeMessageContent,
  useMultiFileAuthState,
} from 'baileys';
import pino from 'pino';
import QRCode from 'qrcode';

const IGNORED_TYPES = new Set(['protocolMessage', 'reactionMessage', 'senderKeyDistributionMessage', 'pollUpdateMessage', 'messageContextInfo', 'stickerMessage']);

function toNumber(ts) {
  if (ts === null || ts === undefined) return 0;
  if (typeof ts === 'object' && typeof ts.toNumber === 'function') return ts.toNumber();
  return Number(ts);
}

export class WhatsAppClient extends EventEmitter {
  constructor({ authDir, logger, onMessage }) {
    super();
    this.authDir = authDir;
    this.logger = logger;
    this.onMessage = onMessage;
    this.baileysLogger = pino({ level: 'warn' }).child({ module: 'baileys' });
    this.sock = null;
    this.status = 'stopped'; // stopped | connecting | qr | open | logged_out
    this.qr = null;
    this.qrDataUrl = null;
    this.me = null;
    this.lastError = null;
    this.retries = 0;
    this.groupNames = new Map();
    this.sentIds = new Set();
    this.stopping = false;
  }

  info() {
    return {
      status: this.status,
      qr: this.status === 'qr' ? this.qrDataUrl : null,
      me: this.me,
      lastError: this.lastError,
    };
  }

  setStatus(status, extra = {}) {
    Object.assign(this, extra);
    this.status = status;
    this.emit('status', this.info());
  }

  async start() {
    this.stopping = false;
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    let version;
    try {
      ({ version } = await fetchLatestBaileysVersion());
    } catch {
      /* use Baileys' built-in version */
    }
    this.setStatus('connecting');
    const sock = makeWASocket({
      auth: state,
      version,
      logger: this.baileysLogger,
      browser: Browsers.macOS('Tile Stock Bot'),
      markOnlineOnConnect: false, // keep notifications coming to the shop phone
      syncFullHistory: false, // Baileys' default light sync is kept: it carries the LID <-> phone number mappings
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined,
    });
    this.sock = sock;

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => this.onConnectionUpdate(sock, u));
    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const m of messages) this.dispatch(m);
    });
    sock.ev.on('groups.upsert', (groups) => this.rememberGroups(groups));
    sock.ev.on('groups.update', (updates) => {
      for (const g of updates) if (g.id && g.subject) this.groupNames.set(g.id, g.subject);
      this.emit('groups', this.groupList());
    });
  }

  async onConnectionUpdate(sock, u) {
    if (sock !== this.sock) return;
    if (u.qr) {
      this.qr = u.qr;
      this.qrDataUrl = await QRCode.toDataURL(u.qr, { margin: 1, width: 320 });
      this.setStatus('qr');
    }
    if (u.connection === 'open') {
      this.retries = 0;
      const user = sock.user || {};
      const phone = jidDecode(user.id)?.user || '';
      this.setStatus('open', { me: { id: user.id, lid: user.lid, name: user.name || user.verifiedName || '', phone }, lastError: null, qr: null, qrDataUrl: null });
      this.logger.info({ phone }, 'WhatsApp connected');
      this.refreshGroups().catch((err) => this.logger.warn({ err: err.message }, 'could not load groups'));
    }
    if (u.connection === 'close') {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      this.lastError = u.lastDisconnect?.error?.message || null;
      if (this.stopping) return;
      if (code === DisconnectReason.loggedOut) {
        this.logger.warn('WhatsApp logged out (device removed from phone). Showing a new QR code.');
        this.clearAuth();
        this.setStatus('logged_out', { me: null });
        setTimeout(() => this.start().catch((err) => this.logger.error({ err }, 'restart failed')), 1000);
        return;
      }
      if (code === DisconnectReason.connectionReplaced) {
        this.setStatus('stopped', { lastError: 'Another copy of the bot connected with the same login. This one stopped.' });
        return;
      }
      const delay = code === DisconnectReason.restartRequired ? 0 : Math.min(60_000, 2000 * 2 ** this.retries++);
      this.setStatus('connecting');
      setTimeout(() => this.start().catch((err) => this.logger.error({ err }, 'reconnect failed')), delay);
    }
  }

  clearAuth() {
    try {
      rmSync(this.authDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  async stop() {
    this.stopping = true;
    try {
      this.sock?.end(undefined);
    } catch {
      /* ignore */
    }
    this.sock = null;
    this.setStatus('stopped');
  }

  /** Unlink this device from the shop's WhatsApp and show a fresh QR. */
  async logout() {
    this.stopping = true;
    try {
      await this.sock?.logout();
    } catch {
      /* already gone */
    }
    this.sock = null;
    this.clearAuth();
    this.setStatus('logged_out', { me: null });
    await this.start();
  }

  /** Link with an 8-character code instead of scanning (handy when the admin page is open on the same phone). */
  async pairingCode(phone) {
    if (!this.sock || this.status === 'open') throw new Error('WhatsApp is already linked.');
    if (this.sock.authState?.creds?.registered) throw new Error('Already linked.');
    const code = await this.sock.requestPairingCode(phone);
    return code?.match(/.{1,4}/g)?.join('-') || code;
  }

  selfJid() {
    return this.sock?.user?.id ? jidNormalizedUser(this.sock.user.id) : null;
  }

  async sendText(jid, text, quote) {
    if (!this.sock || this.status !== 'open') throw new Error('WhatsApp is not connected');
    const sent = await this.sock.sendMessage(jid, { text }, quote ? { quoted: quote } : undefined);
    if (sent?.key?.id) {
      this.sentIds.add(sent.key.id);
      if (this.sentIds.size > 2000) this.sentIds = new Set([...this.sentIds].slice(-1000));
    }
  }

  rememberGroups(groups) {
    for (const g of groups) if (g.id) this.groupNames.set(g.id, g.subject || g.id);
    this.emit('groups', this.groupList(groups));
  }

  groupList(meta) {
    if (meta) return meta.map((g) => ({ jid: g.id, name: g.subject || '', participants: g.participants?.length ?? null }));
    return [...this.groupNames.entries()].map(([jid, name]) => ({ jid, name }));
  }

  async refreshGroups() {
    if (!this.sock) return [];
    const all = await this.sock.groupFetchAllParticipating();
    const list = Object.values(all);
    this.rememberGroups(list);
    return this.groupList(list);
  }

  async phoneOf(jids) {
    for (const j of jids) if (j && isPnUser(j)) return jidDecode(j)?.user || null;
    for (const j of jids) {
      if (j && isLidUser(j)) {
        try {
          const pn = await this.sock?.signalRepository?.lidMapping?.getPNForLID(j);
          if (pn) return jidDecode(pn)?.user || null;
        } catch {
          /* unknown mapping */
        }
      }
    }
    return null;
  }

  async dispatch(m) {
    try {
      const msg = await this.normalize(m);
      if (msg) await this.onMessage(msg);
    } catch (err) {
      this.logger.error({ err: err.message }, 'message handling failed');
    }
  }

  async normalize(m) {
    const key = m.key || {};
    const chatId = key.remoteJid;
    if (!chatId || !m.message) return null;
    if (isJidStatusBroadcast(chatId) || isJidNewsletter(chatId) || isJidBroadcast(chatId)) return null;
    if (key.id && this.sentIds.has(key.id)) return null; // our own reply

    const content = normalizeMessageContent(m.message);
    const type = getContentType(content);
    if (!content || !type || IGNORED_TYPES.has(type)) return null;

    const isGroup = !!isJidGroup(chatId);
    const user = this.sock?.user || {};
    const isSelfChat = !isGroup && (areJidsSameUser(chatId, user.id) || (!!user.lid && areJidsSameUser(chatId, user.lid)));
    const text =
      content.conversation ||
      content.extendedTextMessage?.text ||
      content.imageMessage?.caption ||
      content.videoMessage?.caption ||
      '';

    let document = null;
    if (content.documentMessage) {
      const d = content.documentMessage;
      document = {
        fileName: d.fileName || 'stock.xlsx',
        mimetype: d.mimetype || '',
        size: toNumber(d.fileLength),
        download: () => downloadMediaMessage(m, 'buffer', {}, { logger: this.baileysLogger, reuploadRequest: this.sock.updateMediaMessage }),
      };
    }
    if (!text && !document) return null;

    const senderPhone = isSelfChat
      ? jidDecode(user.id)?.user || null
      : await this.phoneOf(isGroup ? [key.participantAlt, key.participant] : [key.remoteJidAlt, chatId]);

    return {
      id: key.id,
      chatId,
      chatName: isGroup ? this.groupNames.get(chatId) || '' : m.pushName || '',
      isGroup,
      isSelfChat,
      fromMe: !!key.fromMe,
      senderPhone,
      senderName: m.pushName || '',
      text: text || content.documentMessage?.caption || '',
      document,
      timestamp: new Date(toNumber(m.messageTimestamp) * 1000 || Date.now()),
      quote: m,
    };
  }
}
