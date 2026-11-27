// Entry point: admin website + WhatsApp bot + morning reminder.

import pino from 'pino';
import { StockBot } from './bot.js';
import { loadConfig } from './config.js';
import { Store } from './db.js';
import { Reminder } from './reminder.js';
import { StockService } from './stock-service.js';
import { createWebApp } from './web.js';
import { WhatsAppClient } from './whatsapp.js';

const config = loadConfig();
const logger = pino({ level: config.logLevel, transport: undefined });

if (!config.adminPassword || config.adminPassword === 'change-me-to-a-long-password') {
  logger.fatal('Set your own ADMIN_PASSWORD in the .env file (open it with Notepad), then start again.');
  console.error('\n>>> Set your own ADMIN_PASSWORD in the .env file (open it with Notepad), then start again.\n');
  process.exit(1);
}

const store = new Store(config.dbPath);
if (!store.hasSetting('businessName')) store.updateSettings({ businessName: config.businessName });
const stock = new StockService({ store, config });

let whatsapp = null;
if (config.whatsappEnabled) {
  let bot;
  whatsapp = new WhatsAppClient({
    authDir: config.authDir,
    logger,
    onMessage: (msg) => bot.handle(msg),
  });
  bot = new StockBot({ store, stock, config, transport: whatsapp, logger });
  whatsapp.on('groups', (groups) => {
    try {
      store.syncGroups(groups.filter((g) => g.name));
    } catch (err) {
      logger.warn({ err: err.message }, 'group sync failed');
    }
  });
  whatsapp.on('status', (s) => {
    if (s.status === 'qr') logger.info('WhatsApp: open the admin page and scan the QR code to link the shop number.');
  });
  whatsapp.start().catch((err) => logger.error({ err: err.message }, 'WhatsApp start failed'));
}

const reminder = new Reminder({ store, stock, config, whatsapp, logger });
reminder.start();

const pruneTimer = setInterval(() => store.prune(180), 12 * 3600_000);
pruneTimer.unref();

const app = createWebApp({ config, store, stock, whatsapp, logger });
const server = app.listen(config.port, config.host, () => {
  logger.info(`Admin page: http://localhost:${config.port}`);
});

async function shutdown() {
  logger.info('Shutting down');
  reminder.stop();
  server.close();
  await whatsapp?.stop();
  store.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
