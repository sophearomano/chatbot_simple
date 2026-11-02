import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const number = (name, fallback) => {
  const value = Number(env[name]);
  return env[name] && Number.isFinite(value) ? value : fallback;
};

export const config = {
  port: number('PORT', 3000),
  dataDir: env.DATA_DIR || path.join(ROOT, 'data'),
  trustProxy: env.TRUST_PROXY === '1',
  accessCode: env.ACCESS_CODE || '',

  botName: env.BOT_NAME || 'Orin',
  typingMs: number('TYPING_MS', 60),

  messagesPerHour: number('MESSAGES_PER_HOUR', 30),
  ipMessagesPerHour: number('IP_MESSAGES_PER_HOUR', 60),
  maxMessageChars: number('MAX_MESSAGE_CHARS', 8000),

  whatsapp: {
    token: env.WHATSAPP_TOKEN || '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
    appSecret: env.WHATSAPP_APP_SECRET || '',
    apiBase: env.WHATSAPP_API_BASE || 'https://graph.facebook.com',
    apiVersion: env.WHATSAPP_API_VERSION || 'v25.0',
  },
};

export const whatsappEnabled = () =>
  Boolean(config.whatsapp.token && config.whatsapp.phoneNumberId && config.whatsapp.verifyToken && config.whatsapp.appSecret);
