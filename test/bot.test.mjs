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
      ANTHROPIC_API_KEY: 'test-key',
      ANTHROPIC_BASE_URL: fakes.url,
      WHATSAPP_TOKEN: 'wa-token',
      WHATSAPP_PHONE_NUMBER_ID: '555',
      WHATSAPP_VERIFY_TOKEN: 'verify-me',
      WHATSAPP_APP_SECRET: APP_SECRET,
      WHATSAPP_API_BASE: fakes.url,
      MESSAGES_PER_HOUR: '12',
      IP_MESSAGES_PER_HOUR: '1000',
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

test('sends the right model, thinking, fallback and compaction settings', async () => {
  const token = await newDevice();
  const reply = await say(token, 'hello');
  assert.equal(reply.text, 'Echo: hello');
  const { body, headers } = fakes.claudeRequests.at(-1);
  assert.equal(body.model, 'claude-opus-5-5');
  assert.deepEqual(body.thinking, { type: 'adaptive' });
  assert.equal(body.output_config.effort, 'high');
  assert.equal(body.fallbacks, 'default');
  assert.equal(body.stream, true);
  assert.deepEqual(body.cache_control, { type: 'ephemeral' });
  assert.equal(body.context_management.edits[0].type, 'compact_20260112');
  assert.match(headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.match(headers['anthropic-beta'], /compact-2026-01-12/);
  assert.ok(body.tools.some((tool) => tool.type === 'web_search_20260209'));
  assert.equal(body.temperature, undefined);
});

test('remembers the conversation and only ever appends to it', async () => {
  const token = await newDevice();
  await say(token, 'first');
  const firstHistory = fakes.claudeRequests.at(-1).body.messages;
  await say(token, 'second');
  const secondHistory = fakes.claudeRequests.at(-1).body.messages;
  assert.equal(firstHistory.length, 1);
  assert.equal(secondHistory.length, 3);
  assert.deepEqual(secondHistory[0], firstHistory[0]);
  assert.equal(secondHistory[1].role, 'assistant');
});

test('the time and notes travel in the user turn, not the cached system prompt', async () => {
  const token = await newDevice();
  await say(token, 'hello');
  const { body } = fakes.claudeRequests.at(-1);
  assert.match(body.messages[0].content[0].text, /<context>\nTime: .*UTC/);
  assert.doesNotMatch(body.system[0].text, /\d{4}-\d{2}-\d{2}/);
});

test('runs the remember tool and later messages carry the note', async () => {
  const token = await newDevice();
  const reply = await say(token, 'remember my dog is called Pip');
  assert.equal(reply.text, 'Done, I will keep that in mind.');
  await say(token, 'what next');
  const { messages } = fakes.claudeRequests.at(-1).body;
  const context = messages.at(-1).content[0].text;
  assert.match(context, /\[\d+\] my dog is called Pip/);
  const result = messages.find((m) => m.content.some?.((b) => b.type === 'tool_result'));
  assert.match(result.content[0].content, /Saved as note/);

  await say(token, 'and again');
  assert.doesNotMatch(fakes.claudeRequests.at(-1).body.messages.at(-1).content[0].text, /Saved notes/);
});

test('resumes a paused turn without inventing a user message', async () => {
  const token = await newDevice();
  const reply = await say(token, 'pause please');
  assert.equal(reply.text, 'Still looking. Resumed and finished.');
  const { messages } = fakes.claudeRequests.at(-1).body;
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant']);
});

test('a refusal is polite and leaves the history usable', async () => {
  const token = await newDevice();
  const reply = await say(token, 'refuse this');
  assert.equal(reply.text, 'I am not able to help with that one.');
  await say(token, 'hello again');
  assert.equal(fakes.claudeRequests.at(-1).body.messages.length, 1);
});

test('an API failure saves nothing and resends the notes', async () => {
  const token = await newDevice();
  fakes.state.failNext = 1;
  const reply = await say(token, 'hello');
  assert.equal(reply.failed, true);
  assert.match(reply.text, /not set up correctly/);
  await say(token, 'hello again');
  const { messages } = fakes.claudeRequests.at(-1).body;
  assert.equal(messages.length, 1);
  assert.match(messages[0].content[0].text, /Saved notes/);
});

test('compaction blocks are kept and notes are sent again afterwards', async () => {
  const token = await newDevice();
  await say(token, 'compact now');
  await say(token, 'next');
  const { messages } = fakes.claudeRequests.at(-1).body;
  assert.equal(messages[1].content[0].type, 'compaction');
  assert.match(messages.at(-1).content[0].text, /Saved notes/);
});

test('streams words over server-sent events', async () => {
  const token = await newDevice();
  const response = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ message: 'hello world', channel: 'web' }),
  });
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const raw = await response.text();
  assert.ok((raw.match(/event: text/g) ?? []).length >= 3);
  assert.match(raw, /event: done\ndata: {"text":"Echo: hello world"}/);
});

test('leaving mid-reply stops the turn and saves nothing', async () => {
  const token = await newDevice();
  const controller = new AbortController();
  const response = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ message: 'slow answer' }),
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
  await say(token, 'hello again');
  assert.equal(fakes.claudeRequests.at(-1).body.messages.length, 1);
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
  for (let i = 0; i < 13; i++) last = await say(token, 'count');
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
  const before = fakes.claudeRequests.length;
  assert.equal((await whatsapp(inbound('111', 'wamid.forged', 'hello'), 'wrong-secret')).status, 401);
  await wait(100);
  assert.equal(fakes.claudeRequests.length, before);
});

test('WhatsApp replies, keeps the conversation and ignores redelivery', async () => {
  assert.equal((await whatsapp(inbound('222', 'wamid.1', 'hi there'))).status, 200);
  await until(() => fakes.whatsappSent.some((m) => m.body.text?.body === 'Echo: hi there'));
  const sent = fakes.whatsappSent.find((m) => m.body.text?.body === 'Echo: hi there');
  assert.equal(sent.body.to, '222');
  assert.equal(sent.auth, 'Bearer wa-token');
  assert.match(sent.url, /\/v25\.0\/555\/messages/);
  assert.ok(fakes.whatsappSent.some((m) => m.body.typing_indicator?.type === 'text'));

  const count = fakes.claudeRequests.length;
  await whatsapp(inbound('222', 'wamid.1', 'hi there'));
  await wait(150);
  assert.equal(fakes.claudeRequests.length, count);

  await whatsapp(inbound('222', 'wamid.2', 'second'));
  await until(() => fakes.whatsappSent.some((m) => m.body.text?.body === 'Echo: second'));
  assert.equal(fakes.claudeRequests.at(-1).body.messages.length, 3);
});

test('a WhatsApp number and a browser can share one conversation', async () => {
  await whatsapp(inbound('333', 'wamid.3', '/link'));
  await until(() => fakes.whatsappSent.some((m) => m.body.to === '333' && /code is/.test(m.body.text?.body)));
  const code = /\d{6}/.exec(fakes.whatsappSent.findLast((m) => m.body.to === '333').body.text.body)[0];
  await whatsapp(inbound('333', 'wamid.4', 'hello from whatsapp'));
  await until(() => fakes.whatsappSent.some((m) => m.body.text?.body === 'Echo: hello from whatsapp'));

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
