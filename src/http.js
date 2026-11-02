import { createReadStream, existsSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { handleMessage } from './chat.js';
import { config, ROOT, whatsappEnabled } from './config.js';
import { accountForDevice, createDevice, readTranscript } from './db.js';
import { allow } from './limits.js';
import { processWebhook, validSignature } from './whatsapp.js';

const PUBLIC = path.join(ROOT, 'public');
const MAX_BODY = 256 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'",
};

function json(res, status, body) {
  res.writeHead(status, { ...SECURITY, 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  try {
    return JSON.parse((await readBody(req)).toString('utf8') || '{}');
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

const clientIp = (req) =>
  (config.trustProxy && String(req.headers['x-forwarded-for'] ?? '').split(',').at(-1).trim()) || req.socket.remoteAddress || 'unknown';

function account(req) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
  return match ? accountForDevice(match[1]) : null;
}

function sameSecret(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function createSession(req, res) {
  if (!allow(`session:${clientIp(req)}`, 20)) return json(res, 429, { error: 'Too many new sessions from this network.' });
  const { accessCode } = await readJson(req);
  if (config.accessCode && !sameSecret(String(accessCode ?? ''), config.accessCode)) {
    return json(res, 403, { error: 'That access code is not right.' });
  }
  return json(res, 201, { token: createDevice() });
}

async function chat(req, res) {
  const accountId = account(req);
  if (!accountId) return json(res, 401, { error: 'Unknown device.' });
  const { message, channel } = await readJson(req);
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) return json(res, 400, { error: 'message must be a non-empty string.' });
  if (text.length > config.maxMessageChars) return json(res, 413, { error: `Messages are limited to ${config.maxMessageChars} characters.` });

  const base = { accountId, text, channel: channel === 'web' ? 'web' : 'device', ip: clientIp(req) };
  if (!(req.headers.accept ?? '').includes('text/event-stream')) {
    return json(res, 200, await handleMessage(base));
  }

  // Leaving the page or pressing stop ends the turn, so nobody pays for unread words.
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) abort.abort();
  });
  res.writeHead(200, { ...SECURITY, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const result = await handleMessage({
    ...base,
    signal: abort.signal,
    onText: (delta) => emit('text', { delta }),
    onStatus: (status) => emit('status', { status }),
  });
  if (!res.writableEnded && !res.destroyed) {
    emit('done', result);
    res.end();
  }
}

function history(req, res) {
  const accountId = account(req);
  if (!accountId) return json(res, 401, { error: 'Unknown device.' });
  return json(res, 200, { messages: readTranscript(accountId) });
}

function verifyWhatsApp(url, res) {
  const { searchParams: q } = url;
  if (q.get('hub.mode') === 'subscribe' && sameSecret(q.get('hub.verify_token') ?? '', config.whatsapp.verifyToken)) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end(q.get('hub.challenge') ?? '');
  }
  return json(res, 403, { error: 'Verification failed.' });
}

async function whatsappWebhook(req, res) {
  const raw = await readBody(req);
  if (!validSignature(raw, req.headers['x-hub-signature-256'], config.whatsapp.appSecret)) {
    return json(res, 401, { error: 'Bad signature.' });
  }
  res.writeHead(200).end();
  return processWebhook(JSON.parse(raw.toString('utf8'))).catch((error) => console.error(error));
}

function serveStatic(pathname, res) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(PUBLIC, relative);
  if (!file.startsWith(PUBLIC + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
    return json(res, 404, { error: 'Not found.' });
  }
  res.writeHead(200, { ...SECURITY, 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  return createReadStream(file).pipe(res);
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const key = `${req.method} ${url.pathname}`;
  switch (key) {
    case 'GET /healthz':
      return json(res, 200, { ok: true });
    case 'GET /api/info':
      return json(res, 200, { name: config.botName, private: Boolean(config.accessCode), whatsapp: whatsappEnabled() });
    case 'POST /api/session':
      return createSession(req, res);
    case 'POST /api/chat':
      return chat(req, res);
    case 'GET /api/history':
      return history(req, res);
  }
  if (url.pathname === '/webhook/whatsapp' && whatsappEnabled()) {
    if (req.method === 'GET') return verifyWhatsApp(url, res);
    if (req.method === 'POST') return whatsappWebhook(req, res);
  }
  if (req.method === 'GET') return serveStatic(decodeURIComponent(url.pathname), res);
  return json(res, 404, { error: 'Not found.' });
}

export const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    if (!error.status) console.error(error);
    if (res.headersSent) res.end();
    else json(res, error.status ?? 500, { error: error.status ? error.message : 'Something went wrong.' });
  });
});
