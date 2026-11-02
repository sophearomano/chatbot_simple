// WhatsApp Cloud API: Meta posts messages to the webhook, replies go out over HTTPS.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { handleMessage } from './chat.js';
import { config } from './config.js';
import { accountForWhatsApp, firstSighting } from './db.js';

const MAX_CHARS = 4000;

export function validSignature(rawBody, header, secret) {
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice(7), 'hex');
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// WhatsApp has its own small formatting language, and no headings or link syntax.
export function toWhatsAppText(markdown) {
  return markdown
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 ($2)');
}

// Splits on paragraph, then line, then word breaks, whichever fits.
export function splitMessage(text, limit = MAX_CHARS) {
  const parts = [];
  let rest = text.trim();
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const cut = [window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf(' ')].find((at) => at > limit / 2) ?? limit;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

async function post(body) {
  const { apiBase, apiVersion, phoneNumberId, token } = config.whatsapp;
  const response = await fetch(`${apiBase}/${apiVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
  });
  if (!response.ok) throw new Error(`WhatsApp API ${response.status}: ${(await response.text()).slice(0, 300)}`);
}

const send = (to, text) => post({ recipient_type: 'individual', to, type: 'text', text: { body: text } });
const showTyping = (id) => post({ status: 'read', message_id: id, typing_indicator: { type: 'text' } });

async function receive(message) {
  if (!firstSighting(message.id)) return;
  if (message.type !== 'text') {
    await send(message.from, 'For now I can only read text messages.');
    return;
  }
  const text = message.text.body.slice(0, config.maxMessageChars);
  await showTyping(message.id).catch((error) => console.error(error.message));
  const accountId = accountForWhatsApp(message.from);
  const reply = await handleMessage({ accountId, text, channel: 'whatsapp' });
  for (const part of splitMessage(toWhatsAppText(reply.text || 'I had nothing to add.'))) await send(message.from, part);
}

// Answered with 200 before this runs, because Meta retries slow webhooks.
export async function processWebhook(payload) {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        await receive(message).catch((error) => console.error('WhatsApp message failed:', error.message));
      }
    }
  }
}
