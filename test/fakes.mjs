// Stand-ins for the Claude API and the WhatsApp API. The real SDK and the real
// server talk to these over HTTP, so everything except the model itself is exercised.
import http from 'node:http';

const words = (text) => text.match(/\S+\s*/g) ?? [];

function textBlock(index, text) {
  return [
    { type: 'content_block_start', index, content_block: { type: 'text', text: '', citations: null } },
    ...words(text).map((word) => ({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: word } })),
    { type: 'content_block_stop', index },
  ];
}

function toolBlock(index, name, input) {
  const json = JSON.stringify(input);
  return [
    { type: 'content_block_start', index, content_block: { type: 'tool_use', id: `toolu_${index}${name}`, name, input: {} } },
    { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json } },
    { type: 'content_block_stop', index },
  ];
}

function wrap(blocks, stopReason) {
  return [
    {
      type: 'message_start',
      message: {
        id: 'msg_fake', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null,
        usage: { input_tokens: 1000, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    },
    ...blocks,
    { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: 100 } },
    { type: 'message_stop' },
  ];
}

const lastUserText = (messages) => {
  const content = messages.findLast((m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => b.type === 'text')).content;
  return content.findLast((b) => b.type === 'text').text;
};

// Picks a scripted reply from the words in the latest user message.
function script(body) {
  const said = lastUserText(body.messages);
  const last = body.messages.at(-1);
  if (last.role === 'user' && last.content.some?.((b) => b.type === 'tool_result')) {
    return wrap(textBlock(0, 'Done, I will keep that in mind.'), 'end_turn');
  }
  if (said.includes('remember')) return wrap(toolBlock(0, 'remember', { fact: said.replace('remember ', '') }), 'tool_use');
  if (said.includes('pause')) {
    if (last.role === 'assistant') return wrap(textBlock(0, 'Resumed and finished.'), 'end_turn');
    return wrap(textBlock(0, 'Still looking. '), 'pause_turn');
  }
  if (said.includes('refuse')) return wrap([], 'refusal');
  if (said.includes('slow')) return wrap(textBlock(0, 'word '.repeat(400)), 'end_turn');
  if (said.includes('compact')) {
    return wrap([
      { type: 'content_block_start', index: 0, content_block: { type: 'compaction', content: 'summary' } },
      { type: 'content_block_stop', index: 0 },
      ...textBlock(1, 'Compacted reply.'),
    ], 'end_turn');
  }
  return wrap(textBlock(0, `Echo: ${said}`), 'end_turn');
}

export function startFakes() {
  const claudeRequests = [];
  const whatsappSent = [];
  const state = { failNext: 0 };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', async () => {
      const body = raw ? JSON.parse(raw) : {};
      if (req.url.includes('/messages') && req.url.includes('/v1/')) {
        claudeRequests.push({ url: req.url, headers: req.headers, body });
        if (state.failNext > 0) {
          state.failNext -= 1;
          res.writeHead(401, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } }));
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const slow = lastUserText(body.messages).includes('slow');
        for (const event of script(body)) {
          if (res.destroyed) return undefined;
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          if (slow) await new Promise((resolve) => setTimeout(resolve, 5));
        }
        return res.end();
      }
      whatsappSent.push({ url: req.url, auth: req.headers.authorization, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"messages":[{"id":"wamid.out"}]}');
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, claudeRequests, whatsappSent, state, close: () => server.close() });
    });
  });
}
