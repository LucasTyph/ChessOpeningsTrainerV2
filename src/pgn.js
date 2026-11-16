// PGN import (with variations and comments) and export for move trees.
// A tree is { children: [ { san, children, comment? } ] }.

import { Chess } from 'chess.js';

const RESULTS = new Set(['1-0', '0-1', '1/2-1/2', '*']);
const HEADER_RE = /\[\s*(\w+)\s*"((?:[^"\\]|\\.)*)"\s*\]/y;

function tokenize(text) {
  const games = [];
  let cur = null;
  const game = () => {
    if (!cur) { cur = { headers: {}, tokens: [] }; games.push(cur); }
    return cur;
  };
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '[') {
      HEADER_RE.lastIndex = i;
      const m = HEADER_RE.exec(text);
      if (m) {
        if (cur && cur.tokens.length) cur = null;
        game().headers[m[1]] = m[2];
        i = HEADER_RE.lastIndex;
      } else i++;
      continue;
    }
    if (ch === '{') {
      const end = text.indexOf('}', i);
      const stop = end === -1 ? n : end;
      const c = text.slice(i + 1, stop).replace(/\[%[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
      if (c) game().tokens.push({ t: 'c', v: c });
      i = stop + 1;
      continue;
    }
    if (ch === ';' || (ch === '%' && (i === 0 || text[i - 1] === '\n'))) {
      const end = text.indexOf('\n', i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (ch === '(' || ch === ')') { game().tokens.push({ t: ch }); i++; continue; }
    let j = i;
    while (j < n && !/[\s(){};]/.test(text[j])) j++;
    let word = text.slice(i, j);
    i = j;
    if (RESULTS.has(word)) { cur = null; continue; }
    if (word[0] === '$') continue;
    word = word.replace(/^\d+\.*/, '').replace(/^\.+/, '');
    word = word.replace(/[!?]+$/, '');
    if (!word) continue;
    word = word.replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O');
    game().tokens.push({ t: 'm', v: word });
  }
  return games;
}

function addChild(parent, san) {
  let child = parent.children.find((c) => c.san === san);
  if (child) return { child, added: false };
  child = { san, children: [] };
  parent.children.push(child);
  return { child, added: true };
}

/**
 * Merge every game in `text` into `tree`.
 * Returns { games, added, errors: [string] }.
 */
export function importPgn(text, tree) {
  const games = tokenize(text.replace(/^﻿/, ''));
  const startFen = new Chess().fen();
  let added = 0;
  let used = 0;
  const errors = [];

  games.forEach((g, gi) => {
    if (!g.tokens.some((t) => t.t === 'm')) return;
    if (g.headers.FEN && g.headers.FEN.trim() !== startFen) {
      errors.push(`Game ${gi + 1}: starts from a custom position, skipped`);
      return;
    }
    used++;
    // ctx: where the next move attaches. prev: state before the last move (for variations).
    let ctx = { parent: tree, fen: startFen, prev: null, last: null, dead: false };
    const stack = [];
    for (const tok of g.tokens) {
      if (tok.t === '(') {
        stack.push(ctx);
        ctx = !ctx.prev
          ? { parent: null, fen: null, prev: null, last: null, dead: true }
          : { parent: ctx.prev.parent, fen: ctx.prev.fen, prev: null, last: null, dead: false };
      } else if (tok.t === ')') {
        if (stack.length) ctx = stack.pop();
      } else if (ctx.dead) {
        // Skipping the rest of a broken line; later variations no longer have an anchor.
        if (tok.t === 'm') ctx.prev = null;
      } else if (tok.t === 'c') {
        if (ctx.last && !(ctx.last.comment || '').includes(tok.v)) {
          ctx.last.comment = ctx.last.comment ? `${ctx.last.comment} ${tok.v}` : tok.v;
        }
      } else {
        const chess = new Chess(ctx.fen);
        let mv;
        try { mv = chess.move(tok.v); } catch { mv = null; }
        if (!mv) {
          errors.push(`Game ${gi + 1}: can't play "${tok.v}" — rest of that line skipped`);
          // Variations right after the bad move are still alternatives to it.
          ctx = { ...ctx, dead: true, prev: { parent: ctx.parent, fen: ctx.fen } };
          continue;
        }
        const { child, added: isNew } = addChild(ctx.parent, mv.san);
        if (isNew) added++;
        ctx = {
          parent: child, fen: chess.fen(), last: child, dead: false,
          prev: { parent: ctx.parent, fen: ctx.fen },
        };
      }
    }
  });

  return { games: used, added, errors };
}

function moveText(san, ply, forceNumber) {
  const num = Math.floor(ply / 2) + 1;
  if (ply % 2 === 0) return `${num}. ${san}`;
  return forceNumber ? `${num}... ${san}` : san;
}

const cleanComment = (c) => c.replace(/[{}]/g, '').trim();

function writeLine(parent, ply, forceNumber, out) {
  let p = parent;
  while (p.children.length) {
    const [main, ...vars] = p.children;
    out.push(moveText(main.san, ply, forceNumber));
    forceNumber = false;
    if (main.comment) { out.push(`{${cleanComment(main.comment)}}`); forceNumber = true; }
    for (const v of vars) {
      const sub = [moveText(v.san, ply, true)];
      if (v.comment) sub.push(`{${cleanComment(v.comment)}}`);
      writeLine(v, ply + 1, !!v.comment, sub);
      sub[0] = '(' + sub[0];
      sub[sub.length - 1] += ')';
      out.push(...sub);
      forceNumber = true;
    }
    p = main;
    ply++;
  }
}

function wrap(words, width = 80) {
  const lines = [];
  let line = '';
  for (const w of words.join(' ').split(' ')) {
    if (line && line.length + 1 + w.length > width) { lines.push(line); line = w; }
    else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

export function exportPgn(tree, color) {
  const d = new Date();
  const date = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  const name = color === 'white' ? 'White' : 'Black';
  const headers = [
    ['Event', `${name} repertoire`],
    ['Site', 'Chess Openings Trainer'],
    ['Date', date],
    ['Round', '-'],
    ['White', color === 'white' ? 'Repertoire' : 'Opponent'],
    ['Black', color === 'black' ? 'Repertoire' : 'Opponent'],
    ['Result', '*'],
  ];
  const words = [];
  writeLine(tree, 0, false, words);
  words.push('*');
  return headers.map(([k, v]) => `[${k} "${v}"]`).join('\n') + '\n\n' + wrap(words) + '\n';
}
