// One turn of thinking: streams from Claude, runs any tools, and hands back what
// to add to the history. Nothing is saved until the turn ends cleanly, so a
// failure can never leave an unanswered tool call in the conversation.
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { systemPrompt } from './prompt.js';
import { runTool, TOOLS } from './tools.js';

const MAX_HOPS = 10;
const MAX_JSON_RETRIES = 2;

// Dollars per million tokens, for the daily budget estimate.
const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};
const SEARCH_USD = 0.01;

let client;
const claude = () => (client ??= new Anthropic());

export function estimateCost(usage, model = config.model) {
  const price = PRICES[model] ?? PRICES['claude-opus-5-5'];
  return (
    ((usage.input_tokens ?? 0) * price.input +
      (usage.output_tokens ?? 0) * price.output +
      (usage.cache_read_input_tokens ?? 0) * price.cacheRead +
      (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite) / 1e6 +
    (usage.server_tool_use?.web_search_requests ?? 0) * SEARCH_USD
  );
}

const INTERNAL_BLOCKS = new Set(['thinking', 'redacted_thinking', 'tool_use']);

// After a mid-output fallback, the API rejects the abandoned model's internal
// blocks, so only what follows the last switch point keeps them.
export function echoable(content) {
  const boundary = content.findLastIndex((block) => block.type === 'fallback');
  if (boundary < 0) return content;
  const unpaired = (block, index) =>
    block.type === 'server_tool_use' && !content.slice(index + 1).some((later) => later.tool_use_id === block.id);
  return content.filter((block, index) => index >= boundary || !(INTERNAL_BLOCKS.has(block.type) || unpaired(block, index)));
}

function request(messages) {
  return {
    model: config.model,
    max_tokens: config.maxTokens,
    betas: ['server-side-fallback-2026-07-01', 'compact-2026-01-12'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: config.effort },
    cache_control: { type: 'ephemeral' },
    context_management: {
      edits: [{ type: 'compact_20260112', trigger: { type: 'input_tokens', value: config.compactAt } }],
    },
    system: [{ type: 'text', text: systemPrompt() }],
    tools: TOOLS,
    messages,
  };
}

const STATUS = { web_search: 'Searching the web', web_fetch: 'Reading a page', remember: 'Saving a note', forget: 'Removing a note' };

export async function think({ accountId, history, userContent, onText, onStatus, signal }) {
  const added = [{ role: 'user', content: userContent }];
  const result = { text: '', added, cost: 0, compacted: false, refused: false };
  let jsonRetries = 0;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const stream = claude().beta.messages.stream(request([...history, ...added]), { signal });
    let hopText = '';
    let message;
    try {
      for await (const event of stream) {
        if (event.type === 'content_block_start' && (event.content_block.type === 'server_tool_use' || event.content_block.type === 'tool_use')) {
          onStatus?.(STATUS[event.content_block.name] ?? 'Working');
        } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          hopText += event.delta.text;
          onText?.(event.delta.text);
        }
      }
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (error) {
      // Only a tool input too broken to parse is worth trying again.
      if (error instanceof Anthropic.APIError || jsonRetries++ >= MAX_JSON_RETRIES) throw error;
      continue;
    }

    result.cost += estimateCost(message.usage, message.model);
    result.text += hopText;
    if (message.content.some((block) => block.type === 'compaction')) result.compacted = true;

    if (message.stop_reason === 'refusal') {
      result.refused = true;
      return result;
    }

    const assistant = { role: 'assistant', content: echoable(message.content) };
    if (message.stop_reason === 'pause_turn') {
      added.push(assistant);
      continue;
    }

    const calls = message.content.filter((block) => block.type === 'tool_use');
    if (calls.length === 0) {
      added.push(assistant);
      return result;
    }
    if (message.stop_reason === 'max_tokens') throw new Error('Tool input was cut off at max_tokens');

    added.push(assistant, { role: 'user', content: calls.map((call) => runTool(accountId, call)) });
  }
  throw new Error('The turn did not finish within the hop limit');
}
