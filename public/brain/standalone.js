// Orin without a server, for static hosts such as Vercel. The same engine runs
// in the visitor's browser, and everything it keeps stays in that browser.
import { compile, respond } from './eliza.js';
import { script } from './script.js';

const KEY = 'orin-standalone';
const MAX_NOTES = 20;
const RECENT = 12;
const TYPING_MS = 60;
const HELP = [
  'Commands:',
  '/new - start a fresh conversation (saved notes stay)',
  '/forget - erase everything I noted about you',
  '',
  'Our conversation is saved only in this browser.',
].join('\n');

const bot = compile(script, 'Orin');
const state = load();

function load() {
  try {
    return { messages: [], notes: [], ...JSON.parse(localStorage.getItem(KEY)) };
  } catch {
    return { messages: [], notes: [] };
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch { /* The conversation then lasts as long as the page. */ }
}

const recentReplies = () => state.messages.filter((line) => line.role === 'assistant').slice(-RECENT).map((line) => line.text);

function keepNote(note) {
  state.notes = [...state.notes.filter((fact) => fact !== note), note].slice(-MAX_NOTES);
}

export const history = () => state.messages;

export function runCommand(text) {
  switch (text.trim().split(/\s+/)[0].toLowerCase()) {
    case '/help':
      return { text: HELP };
    case '/new':
      state.messages = [];
      save();
      return { text: 'Fresh start. I still have your saved notes.', cleared: true };
    case '/forget':
      state.notes = [];
      save();
      return { text: 'Done. I have erased my notes about you.' };
    case '/link':
      return { text: 'Linking devices needs the server version of Orin.' };
    default:
      return null;
  }
}

// Speaks the same events as the server's stream, so the page treats both alike.
export async function stream(text, handlers, signal) {
  const command = text.trim().startsWith('/') ? runCommand(text) : null;
  if (command) return handlers.done(command);

  const reply = respond(bot, text, { notes: state.notes, recent: recentReplies() });
  for (const word of reply.text.match(/\S+\s*/g) ?? []) {
    signal.throwIfAborted();
    handlers.text({ delta: word });
    await new Promise((resolve) => setTimeout(resolve, TYPING_MS));
  }
  signal.throwIfAborted();
  if (reply.note) keepNote(reply.note);
  state.messages.push({ role: 'user', text }, { role: 'assistant', text: reply.text });
  save();
  return handlers.done({ text: reply.text });
}
