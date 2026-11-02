// The one place every channel goes through, so a message behaves the same
// whether it came from a browser, a phone or anything else.
import { setTimeout as delay } from 'node:timers/promises';
import { config } from './config.js';
import { clearConversation, clearNotes, issueLinkCode, keepNote, listNotes, logLine, recentReplies, redeemLinkCode } from './db.js';
import { compile, respond } from '../public/brain/eliza.js';
import { script } from '../public/brain/script.js';
import { allow } from './limits.js';

const HELP = [
  'Commands:',
  '/new - start a fresh conversation (saved notes stay)',
  '/forget - erase everything I noted about you',
  '/link - get a code to connect another device',
  '/link 123456 - connect this device using a code',
].join('\n');

const bot = compile(script, config.botName);
const queues = new Map();

// Two messages from one person must not race, or replies could interleave.
function inTurn(accountId, work) {
  const run = (queues.get(accountId) ?? Promise.resolve()).then(work, work);
  const settled = run.catch(() => {}).finally(() => {
    if (queues.get(accountId) === settled) queues.delete(accountId);
  });
  queues.set(accountId, settled);
  return run;
}

function runCommand(accountId, text) {
  const [command, argument] = text.trim().split(/\s+/);
  switch (command.toLowerCase()) {
    case '/help':
      return { text: HELP };
    case '/new':
      clearConversation(accountId);
      return { text: 'Fresh start. I still have your saved notes.', cleared: true };
    case '/forget':
      clearNotes(accountId);
      return { text: 'Done. I have erased my notes about you.' };
    case '/link': {
      if (!argument) {
        return { text: `Your code is ${issueLinkCode(accountId)}. On the other device, send /link followed by the code within 10 minutes.` };
      }
      if (!allow(`link:${accountId}`, 5)) return { text: 'Too many tries. Please wait an hour and try again.' };
      const { ok, same } = redeemLinkCode(argument, accountId);
      if (!ok) return { text: 'That code is wrong or has expired.' };
      return { text: same ? 'This device is already connected.' : 'Connected. This device now shares your conversation and notes.', linked: true };
    }
    default:
      return null;
  }
}

// The reply is ready at once; it is sent word by word so it reads like typing.
async function type(text, onText, signal) {
  for (const word of text.match(/\S+\s*/g) ?? []) {
    if (signal?.aborted) return false;
    onText(word);
    await delay(config.typingMs);
  }
  return !signal?.aborted;
}

export async function handleMessage({ accountId, text, channel, ip, onText, signal }) {
  if (text.trim().startsWith('/')) {
    const command = runCommand(accountId, text);
    if (command) return { ...command, command: true };
  }
  if (!allow(`account:${accountId}`, config.messagesPerHour)) {
    return { text: 'That is a lot of messages. Please take a short break and try again within the hour.' };
  }
  if (ip && !allow(`ip:${ip}`, config.ipMessagesPerHour)) {
    return { text: 'Too many messages from this network. Please try again within the hour.' };
  }

  return inTurn(accountId, async () => {
    try {
      const reply = respond(bot, text, { notes: listNotes(accountId), recent: recentReplies(accountId) });
      if (onText && !(await type(reply.text, onText, signal))) return { text: '', aborted: true };
      if (reply.note) keepNote(accountId, reply.note);
      logLine(accountId, 'user', text, channel);
      logLine(accountId, 'assistant', reply.text, channel);
      return { text: reply.text };
    } catch (error) {
      console.error(`Turn failed for ${channel}:`, error.message);
      return { text: 'Something went wrong on my side. Please try again.', failed: true };
    }
  });
}
