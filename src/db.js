// Everything the bot keeps lives in one SQLite file. A person owns one account,
// and each of their devices is an identity that points at it, which is how a
// conversation started on a phone can carry on in a browser.
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

mkdirSync(config.dataDir, { recursive: true });
const db = new DatabaseSync(path.join(config.dataDir, 'bot.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    notes_sent TEXT
  );
  CREATE TABLE IF NOT EXISTS identities (
    channel TEXT NOT NULL,
    external_id TEXT NOT NULL,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    PRIMARY KEY (channel, external_id)
  );
  CREATE TABLE IF NOT EXISTS turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    message TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS transcript (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    channel TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    fact TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS link_codes (
    code TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS spend (day TEXT PRIMARY KEY, usd REAL NOT NULL);
  CREATE TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY, at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS turns_by_account ON turns (account_id, id);
  CREATE INDEX IF NOT EXISTS transcript_by_account ON transcript (account_id, id);
`);

const hash = (value) => createHash('sha256').update(value).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

function createAccount() {
  const id = randomUUID();
  db.prepare('INSERT INTO accounts (id, created_at) VALUES (?, ?)').run(id, Date.now());
  return id;
}

// Browsers and devices hold a secret token; only its hash is stored.
export function createDevice() {
  const token = randomBytes(32).toString('base64url');
  db.prepare("INSERT INTO identities VALUES ('device', ?, ?)").run(hash(token), createAccount());
  return token;
}

export function accountForDevice(token) {
  return db.prepare("SELECT account_id FROM identities WHERE channel = 'device' AND external_id = ?").get(hash(token))?.account_id ?? null;
}

export function accountForWhatsApp(phone) {
  const found = db.prepare("SELECT account_id FROM identities WHERE channel = 'whatsapp' AND external_id = ?").get(phone);
  if (found) return found.account_id;
  const id = createAccount();
  db.prepare("INSERT INTO identities VALUES ('whatsapp', ?, ?)").run(phone, id);
  return id;
}

export function issueLinkCode(accountId) {
  db.prepare('DELETE FROM link_codes WHERE account_id = ? OR expires_at < ?').run(accountId, Date.now());
  const code = String(randomInt(100000, 1000000));
  db.prepare('INSERT OR REPLACE INTO link_codes VALUES (?, ?, ?)').run(code, accountId, Date.now() + 10 * 60 * 1000);
  return code;
}

// Moves every identity of `accountId` onto the account that issued the code.
export function redeemLinkCode(code, accountId) {
  const row = db.prepare('SELECT account_id, expires_at FROM link_codes WHERE code = ?').get(code);
  db.prepare('DELETE FROM link_codes WHERE code = ?').run(code);
  if (!row || row.expires_at < Date.now()) return { ok: false };
  if (row.account_id === accountId) return { ok: true, same: true };
  db.prepare('UPDATE identities SET account_id = ? WHERE account_id = ?').run(row.account_id, accountId);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
  return { ok: true, same: false };
}

export const loadTurns = (accountId) =>
  db.prepare('SELECT message FROM turns WHERE account_id = ? ORDER BY id').all(accountId).map((row) => JSON.parse(row.message));

export function saveTurns(accountId, messages) {
  const insert = db.prepare('INSERT INTO turns (account_id, message) VALUES (?, ?)');
  db.exec('BEGIN');
  try {
    for (const message of messages) insert.run(accountId, JSON.stringify(message));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function clearConversation(accountId) {
  db.prepare('DELETE FROM turns WHERE account_id = ?').run(accountId);
  db.prepare('DELETE FROM transcript WHERE account_id = ?').run(accountId);
  markNotesSent(accountId, null);
}

export function logLine(accountId, role, text, channel) {
  db.prepare('INSERT INTO transcript (account_id, role, text, channel, at) VALUES (?, ?, ?, ?, ?)').run(accountId, role, text, channel, Date.now());
}

export const readTranscript = (accountId, limit = 200) =>
  db.prepare('SELECT role, text, channel, at FROM transcript WHERE account_id = ? ORDER BY id DESC LIMIT ?').all(accountId, limit).reverse();

export const listNotes = (accountId) =>
  db.prepare('SELECT id, fact FROM notes WHERE account_id = ? ORDER BY id').all(accountId);

export function addNote(accountId, fact) {
  return Number(db.prepare('INSERT INTO notes (account_id, fact) VALUES (?, ?)').run(accountId, fact).lastInsertRowid);
}

export function removeNote(accountId, id) {
  return db.prepare('DELETE FROM notes WHERE account_id = ? AND id = ?').run(accountId, id).changes > 0;
}

export const notesSent = (accountId) => db.prepare('SELECT notes_sent FROM accounts WHERE id = ?').get(accountId)?.notes_sent ?? null;

export function markNotesSent(accountId, value) {
  db.prepare('UPDATE accounts SET notes_sent = ? WHERE id = ?').run(value, accountId);
}

export const spentToday = () => db.prepare('SELECT usd FROM spend WHERE day = ?').get(today())?.usd ?? 0;

export function addSpend(usd) {
  db.prepare('INSERT INTO spend VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET usd = usd + excluded.usd').run(today(), usd);
}

// True the first time an id is seen. WhatsApp redelivers webhooks.
export function firstSighting(id) {
  db.prepare('DELETE FROM seen WHERE at < ?').run(Date.now() - 2 * 24 * 60 * 60 * 1000);
  return db.prepare('INSERT OR IGNORE INTO seen VALUES (?, ?)').run(id, Date.now()).changes > 0;
}
