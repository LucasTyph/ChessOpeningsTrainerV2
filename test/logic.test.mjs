// Quick checks of the PGN and scheduling logic. Run: node test/logic.test.mjs
import assert from 'node:assert/strict';

const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };

const { state, touchTrees, today, countMoves } = await import('../src/store.js');
const { importPgn, exportPgn } = await import('../src/pgn.js');
const { getDeck, getToday, buildQueue, introduce, grade, allowMoreNew } = await import('../src/srs.js');
const { SAMPLE_WHITE, SAMPLE_BLACK } = await import('../src/sample.js');

// --- PGN import ---
let r = importPgn(SAMPLE_WHITE, state.trees.white);
assert.equal(r.errors.length, 0, r.errors.join('; '));
assert.equal(r.games, 1);
const whiteMoves = countMoves(state.trees.white);
assert.equal(r.added, whiteMoves);
r = importPgn(SAMPLE_BLACK, state.trees.black);
assert.equal(r.errors.length, 0, r.errors.join('; '));

// re-import adds nothing
assert.equal(importPgn(SAMPLE_WHITE, state.trees.white).added, 0);

// round trip through export
for (const color of ['white', 'black']) {
  const pgn = exportPgn(state.trees[color], color);
  const copy = { children: [] };
  const rr = importPgn(pgn, copy);
  assert.equal(rr.errors.length, 0, rr.errors.join('; '));
  assert.deepEqual(copy, state.trees[color], `${color} round trip`);
}

// messy input: NAGs, annotations, zeros for castling, multiple games, bad move
const messy = `[Event "a"]\n1.e4! e5 $1 2.Nf3 {dev [%cal Gg1f3]} Nc6 3.Bc4 Bc5 4.0-0 Nf6?! 1-0\n\n[Event "b"]\n1. d4 d5 2. Qh5 (2. c4 e6) 2... Nf6 *`;
const t = { children: [] };
r = importPgn(messy, t);
assert.equal(r.games, 2);
assert.equal(r.errors.length, 1);
assert.equal(t.children.length, 2);
assert.equal(t.children[0].children[0].children[0].comment, 'dev');
assert.equal(countMoves(t), 8 + 4);

// --- deck ---
touchTrees();
const deck = getDeck();
assert.ok(deck.cards.length > 0);
assert.ok(deck.cards.every((c) => c.color === 'white' ? c.path.length % 2 === 0 : c.path.length % 2 === 1));
assert.equal(new Set(deck.cards.map((c) => c.key)).size, deck.cards.length);

// --- scheduling ---
state.settings.newPerDay = 4;
state.settings.learnReps = 2;
let td = getToday();
assert.equal(td.fresh.length, 4);
assert.deepEqual(td.fresh.map((c) => c.color), ['white', 'black', 'white', 'black']);
let q = buildQueue();
assert.equal(q.length, 4);

const card = q[0];
introduce(card);
assert.equal(state.srs[card.key].s, 'learn');
assert.equal(grade(card, true).again, true);   // 1 of 2
assert.equal(grade(card, false).again, true);  // reset
assert.equal(grade(card, true).again, true);
let g = grade(card, true);                      // graduates
assert.equal(g.again, false);
assert.equal(state.srs[card.key].s, 'review');
assert.equal(state.srs[card.key].due, today() + 1);

td = getToday();
assert.equal(td.fresh.length, 3, 'new allowance used up by one');
assert.equal(td.nextDueIn, 1);
allowMoreNew(5);
assert.equal(getToday().fresh.length, 8);

// review tomorrow: interval grows; lapse resets
state.srs[card.key].due = today();
g = grade(card, true);
assert.ok(g.ivl >= 2 && g.ivl <= 3, `ivl ${g.ivl}`);
state.srs[card.key].due = today();
g = grade(card, false);
assert.equal(g.again, true);
assert.equal(state.srs[card.key].s, 'learn');
assert.ok(state.srs[card.key].ease < 2.5);

console.log(`ok — ${deck.cards.length} cards, ${whiteMoves} white-tree moves`);
