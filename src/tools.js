import { addNote, listNotes, removeNote } from './db.js';

const MAX_NOTES = 100;
const MAX_NOTE_CHARS = 500;

// The search tools run on Anthropic's side and need no code here.
export const TOOLS = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 5 },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5 },
  {
    name: 'remember',
    description: 'Save a lasting fact about this person, such as their name, preferences or an ongoing project. Saved notes follow them across all their devices and conversations.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { fact: { type: 'string', description: 'One short, self-contained fact.' } },
      required: ['fact'],
    },
  },
  {
    name: 'forget',
    description: 'Delete a saved note by the number shown in brackets in the saved notes.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { id: { type: 'integer', description: 'The note number.' } },
      required: ['id'],
    },
  },
];

function remember(accountId, input) {
  const fact = typeof input.fact === 'string' ? input.fact.trim() : '';
  if (!fact) return { error: 'fact must be a non-empty string' };
  if (fact.length > MAX_NOTE_CHARS) return { error: `fact must be under ${MAX_NOTE_CHARS} characters` };
  if (listNotes(accountId).length >= MAX_NOTES) return { error: 'The notebook is full. Ask which notes to forget first.' };
  return { result: `Saved as note ${addNote(accountId, fact)}.` };
}

function forget(accountId, input) {
  if (!Number.isInteger(input.id)) return { error: 'id must be an integer' };
  return removeNote(accountId, input.id) ? { result: 'Forgotten.' } : { error: 'There is no note with that number.' };
}

const HANDLERS = { remember, forget };

// Streamed tool input is not validated by the API, so each handler checks its own.
export function runTool(accountId, block) {
  const handler = HANDLERS[block.name];
  const { result, error } = handler ? handler(accountId, block.input ?? {}) : { error: `Unknown tool ${block.name}` };
  return error
    ? { type: 'tool_result', tool_use_id: block.id, is_error: true, content: error }
    : { type: 'tool_result', tool_use_id: block.id, content: result };
}
