import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'bot-unit-'));
const { echoable, estimateCost } = await import('../src/brain.js');
const { splitMessage, toWhatsAppText, validSignature } = await import('../src/whatsapp.js');
await import('../public/markdown.js');
const { renderMarkdown } = globalThis;

test('estimates cost from Opus 5.5 prices', () => {
  const usd = estimateCost({ input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6, server_tool_use: { web_search_requests: 2 } });
  assert.ok(Math.abs(usd - (4 + 20 + 0.2 + 5 + 0.02)) < 1e-9);
});

test('drops the abandoned model blocks before a fallback', () => {
  const content = [
    { type: 'thinking', thinking: '' },
    { type: 'text', text: 'partial' },
    { type: 'server_tool_use', id: 'a' },
    { type: 'web_search_tool_result', tool_use_id: 'a' },
    { type: 'server_tool_use', id: 'b' },
    { type: 'fallback' },
    { type: 'thinking', thinking: '' },
    { type: 'text', text: 'rest' },
  ];
  assert.deepEqual(echoable(content).map((b) => b.id ?? b.type), ['text', 'a', 'web_search_tool_result', 'fallback', 'thinking', 'text']);
  const plain = [{ type: 'thinking' }, { type: 'text' }];
  assert.equal(echoable(plain), plain);
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
