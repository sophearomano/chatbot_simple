import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'bot-unit-'));
const { compile, reflect, respond } = await import('../public/brain/eliza.js');
const { script } = await import('../public/brain/script.js');
const { splitMessage, toWhatsAppText, validSignature } = await import('../src/whatsapp.js');
await import('../public/markdown.js');
const { renderMarkdown } = globalThis;

const bot = compile(script, 'Orin');
const first = (text, options) => respond(bot, text, { random: () => 0, ...options });

test('turns the speaker around', () => {
  assert.equal(reflect('my mother hates me'), 'your mother hates you');
  assert.equal(reflect('i am tired of your jokes'), 'you are tired of my jokes');
  assert.equal(reflect('you are afraid of me'), 'I am afraid of you');
  assert.equal(reflect('you to help me'), 'me to help you');
  assert.equal(reflect('she likes you'), 'she likes me');
  assert.equal(reflect('i know my friend John'), 'you know your friend John');
});

test('the most important rule wins wherever it appears', () => {
  assert.equal(first('Well, the weather is bad. I am depressed.').text, 'I am sorry to hear that you are depressed.');
  assert.equal(first('I dont want to go').text, 'Do you really not want to go?');
  assert.equal(first("I can't sleep").text, 'What makes you think you cannot sleep?');
});

test('never leaves a blank or a placeholder in a reply', () => {
  for (const text of ['my', 'i', 'i am', 'i want', 'i feel', 'you', 'you are', 'my mother', 'i cannot', 'if', 'can you', '...', '???', '']) {
    const reply = first(text).text;
    assert.ok(reply.length > 3, text);
    assert.doesNotMatch(reply, /\(\d\)|\s[?.]$/, text);
  }
});

test('notes hold the whole thought', () => {
  assert.equal(first('My mother takes care of me').note, 'your mother takes care of you');
  assert.equal(first('my mother').note, 'your mother');
  assert.equal(first('my name is John').note, 'your name is John');
  assert.equal(first('hello').note, undefined);
});

test('avoids what it said lately, unless nothing else is left', () => {
  const said = first('bye').text;
  assert.notEqual(first('bye', { recent: [said] }).text, said);
  assert.equal(first('bye', { recent: bot.final }).text, bot.final[0]);
});

test('says goodbye only when that is the whole message', () => {
  assert.ok(bot.final.includes(first('Goodbye!').text));
  assert.ok(!bot.final.includes(first('I said goodbye to her').text));
});

test('a crisis overrides every other rule', () => {
  for (const text of ['my mother makes me want to die', "I don't want to live", 'thinking about SUICIDE', 'hello, I might hurt myself']) {
    assert.equal(first(text).text, bot.crisisReply, text);
  }
  assert.notEqual(first('my dog died').text, bot.crisisReply);
});

test('stays fast on the longest message allowed', () => {
  const started = performance.now();
  first('i am my you because '.repeat(400));
  first('you '.repeat(1600));
  first('i, '.repeat(2600));
  assert.ok(performance.now() - started < 200);
});

test('fills in the bot name', () => {
  assert.equal(first('what is your name').text, 'I am Orin. What should we talk about?');
});

test('runs without a server and keeps its memory in the browser', async () => {
  const stored = new Map();
  globalThis.localStorage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  const { history, runCommand, stream } = await import('../public/brain/standalone.js');
  const signal = new AbortController().signal;
  const words = [];
  let finished;
  await stream('my garden is dying', { text: ({ delta }) => words.push(delta), done: (result) => { finished = result; } }, signal);
  assert.equal(words.join(''), finished.text);
  assert.deepEqual(history().map((line) => line.role), ['user', 'assistant']);
  assert.deepEqual(JSON.parse(stored.get('orin-standalone')).notes, ['your garden is dying']);

  const stopped = new AbortController();
  stopped.abort();
  await assert.rejects(stream('hello', { text() {}, done() {} }, stopped.signal), { name: 'AbortError' });
  assert.equal(history().length, 2);

  assert.equal(runCommand('/forget').text, 'Done. I have erased my notes about you.');
  assert.deepEqual(JSON.parse(stored.get('orin-standalone')).notes, []);
  assert.equal(runCommand('/new').cleared, true);
  assert.deepEqual(history(), []);
  assert.match(runCommand('/link').text, /server version/);
  await stream('/help', { text() {}, done: (result) => { finished = result; } }, signal);
  assert.match(finished.text, /only in this browser/);
});

test('checks the WhatsApp signature exactly', () => {
  const body = Buffer.from('{"a":1}');
  const good = `sha256=${createHmac('sha256', 'secret').update(body).digest('hex')}`;
  assert.equal(validSignature(body, good, 'secret'), true);
  assert.equal(validSignature(Buffer.from('{"a":2}'), good, 'secret'), false);
  assert.equal(validSignature(body, 'sha256=abcd', 'secret'), false);
  assert.equal(validSignature(body, undefined, 'secret'), false);
});

test('converts Markdown for WhatsApp', () => {
  assert.equal(toWhatsAppText('# Title\n**bold** and [site](https://a.com/x)'), '*Title*\n*bold* and site (https://a.com/x)');
});

test('splits long WhatsApp messages at sensible points', () => {
  const parts = splitMessage(`${'a'.repeat(3000)}\n\n${'b'.repeat(3000)}`);
  assert.deepEqual(parts.map((p) => p.length), [3000, 3000]);
  const solid = splitMessage('x'.repeat(9000));
  assert.ok(solid.every((p) => p.length <= 4000));
  assert.equal(solid.join('').length, 9000);
  assert.deepEqual(splitMessage('short'), ['short']);
});

test('Markdown never lets HTML through', () => {
  assert.equal(renderMarkdown('<img src=x onerror=alert(1)>'), '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  assert.doesNotMatch(renderMarkdown('[x](javascript:alert(1))'), /<a/);
  assert.doesNotMatch(renderMarkdown('[x](https://a.com" onclick="evil)'), /onclick="/);
  assert.match(renderMarkdown('```\n<b>\n```'), /&lt;b&gt;/);
});

test('renders common Markdown', () => {
  const html = renderMarkdown('## Plan\n\n- one\n- **two**\n\n1. first\n\nUse `npm` and [docs](https://a.com).');
  assert.match(html, /<h3>Plan<\/h3>/);
  assert.match(html, /<ul><li>one<\/li><li><strong>two<\/strong><\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><\/ol>/);
  assert.match(html, /<code>npm<\/code>/);
  assert.match(html, /<a href="https:\/\/a\.com" target="_blank"/);
});
