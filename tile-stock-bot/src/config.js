// Settings from environment variables (or a .env file next to package.json).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadDotenv(file = join(ROOT, '.env')) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = value;
  }
}

const env = (name, fallback = '') => (process.env[name] ?? fallback).toString().trim();

export function loadConfig(overrides = {}) {
  loadDotenv();
  const dataDir = resolve(ROOT, env('DATA_DIR', 'data'));
  mkdirSync(dataDir, { recursive: true });

  let sessionSecret = env('SESSION_SECRET');
  if (!sessionSecret) {
    const file = join(dataDir, 'session-secret.txt');
    if (existsSync(file)) sessionSecret = readFileSync(file, 'utf8').trim();
    else {
      sessionSecret = randomBytes(32).toString('hex');
      writeFileSync(file, sessionSecret, { mode: 0o600 });
    }
  }

  return {
    port: Number(env('PORT', '3000')) || 3000,
    host: env('HOST', '0.0.0.0'),
    adminPassword: env('ADMIN_PASSWORD'),
    sessionSecret,
    dataDir,
    dbPath: join(dataDir, 'stock.db'),
    authDir: join(dataDir, 'whatsapp-auth'),
    timeZone: env('TIMEZONE', 'Asia/Kolkata'),
    defaultCountryCode: env('DEFAULT_COUNTRY_CODE', '91'),
    defaultUnit: env('DEFAULT_UNIT', 'boxes'),
    maxUploadMb: Number(env('MAX_UPLOAD_MB', '15')) || 15,
    publicUrl: env('PUBLIC_URL'),
    businessName: env('BUSINESS_NAME', 'Naveen Tiles'),
    whatsappEnabled: env('WHATSAPP_ENABLED', 'true') !== 'false',
    logLevel: env('LOG_LEVEL', 'info'),
    ...overrides,
  };
}
