// Spaced repetition. One card = one of *your* moves in a given position.
// Card state lives in state.srs[key]:
//   { s: 'learn' | 'review', streak, ease, ivl (days), due (day number), lapses }
// A card with no entry is "new".

import { Chess } from 'chess.js';
import { state, today, daily, getTreeVersion } from './store.js';

const fenKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

let cache = null;
let cacheVersion = -1;

/** All cards derived from the two repertoire trees, in PGN order. */
export function getDeck() {
  if (cache && cacheVersion === getTreeVersion()) return cache;
  const cards = [];
  const byKey = new Map();
  const alts = new Map(); // posKey -> Set of repertoire SANs there
  for (const color of ['white', 'black']) {
    const chess = new Chess();
    const path = [];
    const walk = (node) => {
      const mine = (chess.turn() === 'w') === (color === 'white');
      const posKey = mine ? `${color}|${fenKey(chess.fen())}` : null;
      for (const child of node.children) {
        if (mine) {
          if (!alts.has(posKey)) alts.set(posKey, new Set());
          alts.get(posKey).add(child.san);
          const key = `${posKey}|${child.san}`;
          const known = byKey.get(key);
          if (!known) {
            const card = { key, color, posKey, san: child.san, path: path.slice(), comment: child.comment || '' };
            byKey.set(key, card);
            cards.push(card);
          } else if (!known.comment && child.comment) known.comment = child.comment;
        }
        try { chess.move(child.san); } catch { continue; }
        path.push(child.san);
        walk(child);
        path.pop();
        chess.undo();
      }
    };
    walk(state.trees[color]);
  }
  cache = { cards, alts };
  cacheVersion = getTreeVersion();
  return cache;
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Alternate white and black new cards, keeping each colour's own order. */
function zipColors(cards) {
  const w = cards.filter((c) => c.color === 'white');
  const b = cards.filter((c) => c.color === 'black');
  const out = [];
  for (let i = 0; i < Math.max(w.length, b.length); i++) {
    if (i < w.length) out.push(w[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

/** What is there to do today. */
export function getToday() {
  const { cards } = getDeck();
  const t = today();
  const d = daily();
  const learning = [];
  const reviews = [];
  const unseen = [];
  let nextDue = null;
  let nextDueCount = 0;
  for (const c of cards) {
    const s = state.srs[c.key];
    if (!s) unseen.push(c);
    else if (s.s === 'learn') learning.push(c);
    else if (s.due <= t) reviews.push(c);
    else if (nextDue === null || s.due < nextDue) { nextDue = s.due; nextDueCount = 1; }
    else if (s.due === nextDue) nextDueCount++;
  }
  const allowance = Math.max(0, state.settings.newPerDay + d.extra - d.newCount);
  const fresh = zipColors(unseen).slice(0, allowance);
  return {
    total: cards.length,
    learning, reviews, fresh,
    unseenTotal: unseen.length,
    nextDueIn: nextDue === null ? null : nextDue - t,
    nextDueCount,
  };
}

/** Build the session queue: learning first, then reviews (shuffled) with new moves spread through. */
export function buildQueue() {
  const { learning, reviews, fresh } = getToday();
  const rest = shuffle(reviews.slice());
  if (fresh.length) {
    const step = (rest.length + fresh.length) / fresh.length;
    fresh.forEach((c, i) => rest.splice(Math.min(rest.length, Math.round(i * step)), 0, c));
  }
  return [...shuffle(learning.slice()), ...rest];
}

export function allowMoreNew(n) {
  daily().extra += n;
}

export const cardKind = (card) => {
  const s = state.srs[card.key];
  return !s ? 'new' : s.s === 'learn' ? 'learn' : 'review';
};

/** First time a new move has been shown and played. */
export function introduce(card) {
  state.srs[card.key] = { s: 'learn', streak: 0, ease: 2.5, ivl: 0, due: today(), lapses: 0 };
  daily().newCount++;
}

const fuzz = (n) => (n < 4 ? n : Math.max(2, Math.round(n * (0.92 + Math.random() * 0.16))));

/**
 * Record an answer. Returns { again: boolean, ivl } — `again` means the card
 * must come back later in this session.
 */
export function grade(card, ok) {
  const s = state.srs[card.key];
  const t = today();
  const need = Math.max(1, state.settings.learnReps | 0);
  if (s.s === 'learn') {
    if (!ok) { s.streak = 0; return { again: true }; }
    s.streak++;
    if (s.streak < need) return { again: true };
    s.s = 'review';
    s.ivl = 1;
    s.due = t + 1;
    return { again: false, ivl: 1 };
  }
  if (ok) {
    const elapsed = Math.max(s.ivl, t - (s.due - s.ivl));
    s.ivl = fuzz(Math.max(s.ivl + 1, Math.round(elapsed * s.ease)));
    s.due = t + s.ivl;
    return { again: false, ivl: s.ivl };
  }
  s.lapses++;
  s.ease = Math.max(1.3, s.ease - 0.2);
  s.s = 'learn';
  s.ivl = 0;
  s.streak = Math.max(0, need - 2); // relearning takes at most two correct answers
  return { again: true };
}
