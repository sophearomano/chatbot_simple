// A conversation engine in the style of ELIZA (Joseph Weizenbaum, 1966). It has
// no understanding: it finds the most important rule that matches, then turns
// the person's own words around. The rules themselves live in script.js.
const MAX_PARTS = 40;
const MAX_PART_CHARS = 300;
const BEFORE = "(?<![\\p{L}\\p{N}'])";
const AFTER = "(?![\\p{L}\\p{N}'])";

const SWAPS = {
  i: 'you', me: 'you', my: 'your', mine: 'yours', myself: 'yourself',
  your: 'my', yours: 'mine', yourself: 'myself', am: 'are',
};
const STARTS_A_CLAUSE = new Set(['and', 'or', 'that', 'because', 'if', 'when', 'while', 'as', 'so']);
const VERB_AFTER_I = { am: 'are', was: 'were' };
const VERB_AFTER_YOU = { are: 'am', were: 'was' };

function toRegex(pattern, synonyms) {
  let source = '';
  let previous = '*';
  for (const token of pattern.split(' ')) {
    if (token === '*') source += '\\s*(.*?)\\s*';
    else {
      if (previous !== '*') source += '\\s+';
      source += token.startsWith('@')
        ? `${BEFORE}(${synonyms[token.slice(1)].join('|')})${AFTER}`
        : `${BEFORE}${token}${AFTER}`;
    }
    previous = token;
  }
  return new RegExp(`^${source}$`, 'iu');
}

export function compile(script, name) {
  return {
    ...script,
    quit: new Set(script.quit),
    crisis: script.crisis.map((phrase) => new RegExp(`${BEFORE}${phrase}${AFTER}`, 'iu')),
    // Sorting is stable, so rules of equal rank stay in the order they were written.
    rules: script.rules
      .map((rule) => ({ ...rule, pattern: toRegex(rule.match, script.synonyms), replies: rule.replies.map((reply) => reply.replaceAll('{name}', name)) }))
      .toSorted((a, b) => b.rank - a.rank),
  };
}

function normalize(bot, input) {
  return input
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}'.,;:!?\s-]/gu, ' ')
    .replace(/[\p{L}\p{N}']+/gu, (word) => bot.expansions[word.toLowerCase()] ?? word);
}

// Swaps the speaker, so "my mother hates me" comes back as "your mother hates you".
export function reflect(text) {
  const words = text.trim().split(/\s+/);
  let after = null;
  return words.map((word, index) => {
    const lower = word.toLowerCase();
    const verbs = after;
    after = null;
    if (verbs?.[lower]) return verbs[lower];
    if (lower === 'i') {
      after = VERB_AFTER_I;
      return 'you';
    }
    if (lower === 'you') {
      const object = words[index + 1]?.toLowerCase() === 'to' || (index > 0 && !STARTS_A_CLAUSE.has(words[index - 1].toLowerCase()));
      if (object) return 'me';
      after = VERB_AFTER_YOU;
      return 'I';
    }
    return SWAPS[lower] ?? word;
  }).join(' ');
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const references = (template) => [...template.matchAll(/\((\d)\)/g)].map((found) => Number(found[1]));

function fill(template, captures) {
  return capitalize(template.replace(/\((\d)\)/g, (_, number) => reflect(captures[number])));
}

export function respond(bot, input, { notes = [], recent = [], random = Math.random } = {}) {
  // Picks from what was not said lately, so the bot repeats itself as little as it can.
  const choose = (options) => {
    const fresh = options.filter((option) => !recent.includes(option));
    const pool = fresh.length ? fresh : options;
    return pool[Math.floor(random() * pool.length)];
  };

  const text = normalize(bot, input);
  if (bot.crisis.some((phrase) => phrase.test(text))) return { text: bot.crisisReply };

  const parts = text
    .split(/[.,;:!?\n]+|\s+but\s+/i)
    .map((part) => part.trim().slice(0, MAX_PART_CHARS))
    .filter(Boolean)
    .slice(0, MAX_PARTS);
  if (parts.length === 1 && bot.quit.has(parts[0].toLowerCase())) return { text: choose(bot.final) };

  for (const rule of bot.rules) {
    for (const part of parts) {
      const captures = rule.pattern.exec(part);
      if (!captures) continue;
      const options = rule.replies
        .filter((reply) => references(reply).every((number) => captures[number]))
        .map((reply) => fill(reply, captures));
      if (!options.length) continue;
      const note = rule.keep && reflect(rule.keep.replace(/\((\d)\)/g, (_, number) => captures[number]));
      return { text: choose(options), note };
    }
  }

  if (notes.length && random() < bot.recallChance) {
    return { text: choose(notes.flatMap((note) => bot.recall.map((line) => line.replace('(1)', note)))) };
  }
  return { text: choose(bot.fallback) };
}
