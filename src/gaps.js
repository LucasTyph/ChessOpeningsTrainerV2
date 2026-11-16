// Coverage gaps: opponent moves your repertoire has no answer for.
//  - 'unanswered': an opponent move that is in your tree but has no reply from you
//  - 'missing':    a reply known to the opening book that is not in your tree at all

import { Chess } from 'chess.js';
import { state } from './store.js';
import { lookup, fenKey } from './openings.js';

// How "common" a missing reply is gets judged by how much book theory follows it:
// either many named lines in absolute terms, or a big share of the lines from that position.
const isCommon = (lines, share) => lines >= 10 || (lines >= 2 && share >= 0.25);

/**
 * Returns gaps for one colour, most important first:
 * { type, nodes, sans, san, name, share, lines, common }
 * `nodes`/`sans` lead to the position where the opponent plays `san`.
 */
export function findGaps(color) {
  const chess = new Chess();
  const gaps = [];
  const seen = new Set();

  const walk = (node, nodes, sans) => {
    const oppToMove = (chess.turn() === 'w') !== (color === 'white');
    if (oppToMove) {
      const key = fenKey(chess.fen());
      const entry = seen.has(key) ? null : lookup(chess.fen());
      seen.add(key);
      if (entry && entry.moves.length) {
        const total = entry.moves.reduce((sum, m) => sum + m.n, 0);
        for (const m of entry.moves) {
          if (node.children.some((c) => c.san === m.san)) continue;
          let name = null;
          try {
            chess.move(m.san);
            name = lookup(chess.fen())?.name || null;
            chess.undo();
          } catch { continue; }
          const share = m.n / total;
          gaps.push({
            type: 'missing', nodes: nodes.slice(), sans: sans.slice(), san: m.san, name,
            share, lines: m.n, common: isCommon(m.n, share),
          });
        }
      }
    }
    for (const child of node.children) {
      try { chess.move(child.san); } catch { continue; }
      if (oppToMove && !child.children.length) {
        gaps.push({
          type: 'unanswered', nodes: nodes.slice(), sans: sans.slice(), san: child.san,
          name: lookup(chess.fen())?.name || null, share: 1, lines: 0, common: true,
        });
      }
      nodes.push(child);
      sans.push(child.san);
      walk(child, nodes, sans);
      nodes.pop();
      sans.pop();
      chess.undo();
    }
  };
  walk(state.trees[color], [], []);

  const rank = (g) => (g.type === 'unanswered' ? Infinity : g.lines);
  return gaps.sort((a, b) => rank(b) - rank(a) || b.share - a.share || a.sans.length - b.sans.length);
}
