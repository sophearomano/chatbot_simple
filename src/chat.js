// The one place every channel goes through, so a message behaves the same
// whether it came from a browser, a phone or anything else.
import Anthropic from '@anthropic-ai/sdk';
import { think } from './brain.js';
import { config } from './config.js';
import {
  addSpend, clearConversation, issueLinkCode, listNotes, loadTurns, logLine, markNotesSent,
  notesSent, redeemLinkCode, saveTurns, spentToday,
} from './db.js';
import { allow } from './limits.js';
import { contextBlock } from './prompt.js';

const HELP = [
  'Commands:',
  '/new - start a fresh conversation (saved notes stay)',
  '/link - get a code to connect another device',
  '/link 123456 - connect this device using a code',
].join('\n');

const queues = new Map();

// Two messages from one person must not race, or the history would fork.
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

function userContent(accountId, text, channel) {
  // Notes are only resent when they change, or after compaction summarised them away.
  const notes = listNotes(accountId);
  const signature = JSON.stringify(notes);
  const changed = notesSent(accountId) !== signature;
  if (changed) markNotesSent(accountId, signature);
  return [
    { type: 'text', text: contextBlock({ channel, notes: changed ? notes : null }) },
    { type: 'text', text },
  ];
}

function apology(error) {
  if (error instanceof Anthropic.RateLimitError) return 'I am very busy right now. Please try again in a minute.';
  if (error instanceof Anthropic.AuthenticationError) return 'My connection to my brain is not set up correctly yet.';
  if (error instanceof Anthropic.APIError && error.status === undefined) return 'I could not reach my brain just now. Please try again.';
  if (error instanceof Anthropic.APIError && error.status >= 500) return 'My brain is having trouble right now. Please try again shortly.';
  return 'Something went wrong on my side. Please try again.';
}

export async function handleMessage({ accountId, text, channel, ip, onText, onStatus, signal }) {
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
  if (spentToday() >= config.dailyBudgetUsd) {
    return { text: 'I have reached my daily limit. Please come back tomorrow.' };
  }

  return inTurn(accountId, async () => {
    try {
      const turn = await think({
        accountId,
        history: loadTurns(accountId),
        userContent: userContent(accountId, text, channel),
        onText,
        onStatus,
        signal,
      });
      addSpend(turn.cost);
      if (turn.refused) {
        markNotesSent(accountId, null);
        return { text: turn.text || 'I am not able to help with that one.' };
      }

      saveTurns(accountId, turn.added);
      if (turn.compacted) markNotesSent(accountId, null);
      logLine(accountId, 'user', text, channel);
      logLine(accountId, 'assistant', turn.text, channel);
      return { text: turn.text };
    } catch (error) {
      // A notes block that never reached the history must be sent again.
      markNotesSent(accountId, null);
      if (error instanceof Anthropic.APIUserAbortError) return { text: '', aborted: true };
      console.error(`Turn failed for ${channel}:`, error.message);
      return { text: apology(error), failed: true };
    }
  });
}
