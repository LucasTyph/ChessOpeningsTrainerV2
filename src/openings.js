// Opening book: names for positions and the known continuations from them.
// The data comes from the lichess chess-openings list (see scripts/build-openings.mjs).

import { Chess } from 'chess.js';
import { BOOK } from './openings-data.js';

export const fenKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

/** Short stable hash of a position key (cyrb53, base 36). */
export function hashKey(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

let book = null;

function load() {
  if (book) return book;
  book = new Map();
  for (const row of BOOK.split('\n')) {
    const [hash, name, moves] = row.split('|');
    book.set(hash, {
      name: name || null,
      moves: moves
        ? moves.split(',').map((m) => { const [san, n] = m.split(':'); return { san, n: Number(n) || 1 }; })
        : [],
    });
  }
  return book;
}

/** Book entry for a position: { name: 'C50 Italian Game' | null, moves: [{san, n}] } or undefined. */
export function lookup(fen) {
  return load().get(hashKey(fenKey(fen)));
}

/** Name of the deepest named position along a line of SAN moves, or null. */
export function nameForLine(sans) {
  const chess = new Chess();
  let name = null;
  for (const san of sans) {
    try { chess.move(san); } catch { break; }
    const entry = lookup(chess.fen());
    if (entry && entry.name) name = entry.name;
  }
  return name;
}

/** Split 'C50 Italian Game' into { eco, title }. */
export function splitName(name) {
  const i = name.indexOf(' ');
  return { eco: name.slice(0, i), title: name.slice(i + 1) };
}
