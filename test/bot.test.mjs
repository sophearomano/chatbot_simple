import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startFakes } from './fakes.mjs';

const APP_SECRET = 'test-secret';
const PORT = 4300 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = mkdtempSync(path.join(tmpdir(), 'bot-test-'));
let fakes;
let child;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await wait(25)) if (check()) return;
  throw new Error('Timed out waiting');
}

before(async () => {
  fakes = await startFakes();
  child = spawn(process.execPath, ['server.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      WHATSAPP_TOKEN: 'wa-token',
      WHATSAPP_PHONE_NUMBER_ID: '555',
      WHATSAPP_VERIFY_TOKEN: 'verify-me',
      WHATSAPP_APP_SECRET: APP_SECRET,
      WHATSAPP_API_BASE: fakes.url,
      MESSAGES_PER_HOUR: '30',
      IP_MESSAGES_PER_HOUR: '1000',
      TYPING_MS: '20',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${BASE}/healthz`).then((r) => r.ok, () => false)) return;
    await wait(50);
  }
  throw new Error('Server did not start');
});

after(() => {
  child.kill();
  fakes.close();
  try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* Windows may still hold the file. */ }
});

async function newDevice() {
  const response = await fetch(`${BASE}/api/session`, { method: 'POST' });
  assert.equal(response.status, 201);
  return (await response.json()).token;
}

async function say(token, message) {
  const response = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  return { status: response.status, ...(await response.json()) };
}

function whatsapp(payload, secret = APP_SECRET) {
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  return fetch(`${BASE}/webhook/whatsapp`, { method: 'POST', headers: { 'X-Hub-Signature-256': signature }, body });
}

const inbound = (from, id, text) => ({
  entry: [{ changes: [{ value: { messages: [{ from, id, type: 'text', text: { body: text } }] } }] }],
});

test('answers with no keys and turns the words around', async () => {
  const token = await newDevice();
  const reply = await say(token, 'I am worried about my exam');
  assert.equal(reply.status, 200);
  assert.ok(reply.text.length > 3);
});

test('keeps the transcript in order', async () => {
  const token = await newDevice();
  await say(token, 'hello');
  await say(token, 'bye');
  const { messages } = await fetch(`${BASE}/api/history`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(messages[0].text, 'hello');
});

test('does not repeat itself while it has something fresh to say', async () => {
  const token = await newDevice();
  const replies = [];
  for (let i = 0; i < 3; i++) replies.push((await say(token, 'I feel lonely')).text);
  assert.equal(new Set(replies).size, replies.length);
});

test('brings back what it was told, and /forget erases it', async () => {
  const token = await newDevice();
  await say(token, 'my garden is dying');
  let recalled = false;
  for (let i = 0; i < 20 && !recalled; i++) recalled = /your garden is dying/.test((await say(token, 'pizza')).text);
  assert.equal(recalled, true);
  assert.match((await say(token, '/forget')).text, /erased/);
  for (let i = 0; i < 3; i++) assert.doesNotMatch((await say(token, 'pizza')).text, /garden/);
});

test('sends someone in crisis to real help', async () => {
  const token = await newDevice();
  const { text } = await say(token, "I don't want to live, I want to kill myself");
  assert.match(text, /findahelpline\.com/);
  assert.match(text, /emergency/);
});

test('streams words over server-sent events', async () => {
  const token = await newDevice();
  const response = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ message: 'bye', channel: 'web' }),
  });
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const raw = await response.text();
  assert.ok((raw.match(/event: text/g) ?? []).length >= 3);
  assert.match(raw, /event: done\ndata: {"text":"(Goodbye|Take care)/);
});

test('leaving mid-reply stops the turn and saves nothing', async () => {
  const token = await newDevice();
  const controller = new AbortController();
  const response = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ message: `I am ${'very '.repeat(40)}busy` }),
    signal: controller.signal,
  });
  await response.body.getReader().read();
  controller.abort();
  await wait(200);
  const history = await fetch(`${BASE}/api/history`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  assert.deepEqual(history.messages, []);
});

test('two devices link with a code and share history', async () => {
  const phone = await newDevice();
  const laptop = await newDevice();
  await say(phone, 'hello from phone');
  const { text } = await say(phone, '/link');
  const code = /\d{6}/.exec(text)[0];
  assert.equal((await say(laptop, `/link ${code}`)).linked, true);
  const history = await fetch(`${BASE}/api/history`, { headers: { Authorization: `Bearer ${laptop}` } }).then((r) => r.json());
  assert.equal(history.messages[0].text, 'hello from phone');
  assert.match((await say(laptop, `/link ${code}`)).text, /wrong or has expired/);
});

test('/new clears the conversation', async () => {
  const token = await newDevice();
  await say(token, 'hello');
  assert.equal((await say(token, '/new')).cleared, true);
  const history = await fetch(`${BASE}/api/history`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  assert.deepEqual(history.messages, []);
});

test('rejects unknown devices and bad input', async () => {
  assert.equal((await say('not-a-token', 'hello')).status, 401);
  const token = await newDevice();
  assert.equal((await say(token, '   ')).status, 400);
  assert.equal((await say(token, 'x'.repeat(8001))).status, 413);
});

test('limits messages per hour for one account', async () => {
  const token = await newDevice();
  let last;
  for (let i = 0; i < 31; i++) last = await say(token, 'count');
  assert.match(last.text, /short break/);
});

test('does not serve files outside public', async () => {
  for (const attempt of ['/..%2fpackage.json', '/%2e%2e/.env', '/../server.js']) {
    assert.notEqual((await fetch(BASE + attempt)).status, 200, attempt);
  }
  assert.equal((await fetch(`${BASE}/`)).status, 200);
});

test('WhatsApp verifies the webhook handshake', async () => {
  const good = await fetch(`${BASE}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc`);
  assert.equal(await good.text(), 'abc');
  const bad = await fetch(`${BASE}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc`);
  assert.equal(bad.status, 403);
});

test('WhatsApp rejects a forged message', async () => {
  assert.equal((await whatsapp(inbound('111', 'wamid.forged', 'hello'), 'wrong-secret')).status, 401);
  await wait(100);
  assert.equal(fakes.whatsappSent.some((m) => m.body.to === '111'), false);
});

test('WhatsApp replies and ignores redelivery', async () => {
  const replies = () => fakes.whatsappSent.filter((m) => m.body.to === '222' && m.body.text);
  assert.equal((await whatsapp(inbound('222', 'wamid.1', 'bye'))).status, 200);
  await until(() => replies().length === 1);
  const sent = replies()[0];
  assert.match(sent.body.text.body, /Goodbye|Take care/);
  assert.equal(sent.auth, 'Bearer wa-token');
  assert.match(sent.url, /\/v25\.0\/555\/messages/);
  assert.ok(fakes.whatsappSent.some((m) => m.body.typing_indicator?.type === 'text'));

  await whatsapp(inbound('222', 'wamid.1', 'bye'));
  await wait(150);
  assert.equal(replies().length, 1);
});

test('a WhatsApp number and a browser can share one conversation', async () => {
  await whatsapp(inbound('333', 'wamid.3', '/link'));
  await until(() => fakes.whatsappSent.some((m) => m.body.to === '333' && /code is/.test(m.body.text?.body)));
  const code = /\d{6}/.exec(fakes.whatsappSent.findLast((m) => m.body.to === '333').body.text.body)[0];
  await whatsapp(inbound('333', 'wamid.4', 'hello from whatsapp'));
  await until(() => fakes.whatsappSent.filter((m) => m.body.to === '333' && m.body.text).length === 2);

  const browser = await newDevice();
  assert.equal((await say(browser, `/link ${code}`)).linked, true);
  const history = await fetch(`${BASE}/api/history`, { headers: { Authorization: `Bearer ${browser}` } }).then((r) => r.json());
  assert.equal(history.messages[0].text, 'hello from whatsapp');
  assert.equal(history.messages[0].channel, 'whatsapp');
});

test('WhatsApp explains that it cannot read other message types', async () => {
  await whatsapp({ entry: [{ changes: [{ value: { messages: [{ from: '444', id: 'wamid.5', type: 'image' }] } }] }] });
  await until(() => fakes.whatsappSent.some((m) => m.body.to === '444' && /only read text/.test(m.body.text?.body)));
});
