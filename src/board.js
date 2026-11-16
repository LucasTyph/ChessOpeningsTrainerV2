// Thin wrapper around chessground driven by a chess.js position.

import { Chessground } from 'chessground';
import { h } from './ui.js';

function destsOf(chess) {
  const dests = new Map();
  for (const m of chess.moves({ verbose: true })) {
    if (!dests.has(m.from)) dests.set(m.from, []);
    dests.get(m.from).push(m.to);
  }
  return dests;
}

/**
 * createBoard(el, { onUserMove({from,to,promotion}) })
 * `el` must be an empty element inside a `.board-wrap`.
 */
export function createBoard(el, { onUserMove }) {
  let current = null; // last chess.js position shown
  let lastOpts = {};
  let flashTimer = 0;

  const cg = Chessground(el, {
    coordinates: true,
    animation: { enabled: true, duration: 180 },
    highlight: { lastMove: true, check: true },
    movable: { free: false, color: undefined, showDests: true, rookCastle: false, events: { after: onAfter } },
    premovable: { enabled: false },
    draggable: { showGhost: true },
    drawable: { enabled: true, defaultSnapToValidMove: true },
  });

  const onResize = () => cg.redrawAll();
  window.addEventListener('resize', onResize);

  function onAfter(from, to) {
    const piece = current && current.get(from);
    const promo = piece && piece.type === 'p' && (to[1] === '8' || to[1] === '1');
    if (!promo) return onUserMove({ from, to });
    askPromotion(piece.color).then((p) => {
      if (p) onUserMove({ from, to, promotion: p });
      else api.show(current, lastOpts);
    });
  }

  function askPromotion(color) {
    return new Promise((resolve) => {
      const side = color === 'w' ? 'white' : 'black';
      const pick = (p) => { layer.remove(); resolve(p); };
      const layer = h('div.promo', { onmousedown: (e) => { if (e.target === layer) pick(null); } },
        h('div.promo-box', [['q', 'queen'], ['r', 'rook'], ['b', 'bishop'], ['n', 'knight']].map(([p, role]) =>
          h('button.promo-btn', { title: role, onclick: () => pick(p) }, h(`piece.${role}.${side}`)))));
      el.parentElement.append(layer);
    });
  }

  const api = {
    /**
     * Show a chess.js position.
     * opts: { orientation, movable: false | 'white' | 'black' | 'both', lastMove: [from,to] | null }
     */
    show(chess, opts = {}) {
      current = chess;
      lastOpts = opts;
      const turn = chess.turn() === 'w' ? 'white' : 'black';
      const m = opts.movable || false;
      const canMove = m === 'both' || m === turn;
      const config = {
        fen: chess.fen(),
        turnColor: turn,
        check: chess.inCheck(),
        lastMove: opts.lastMove || undefined,
        movable: { color: canMove ? turn : undefined, dests: canMove ? destsOf(chess) : new Map() },
      };
      if (opts.orientation) config.orientation = opts.orientation;
      cg.set(config);
    },
    setSpeed(ms) {
      cg.set({ animation: { duration: ms } });
    },
    /** Draw arrows: [{from, to, brush}] */
    arrows(list) {
      cg.setAutoShapes(list.map((a) => ({ orig: a.from, dest: a.to, brush: a.brush || 'green' })));
      cg.setShapes([]);
    },
    /** Briefly tint a square ('correct' | 'wrong'). */
    flash(square, kind) {
      clearTimeout(flashTimer);
      cg.set({ highlight: { custom: new Map([[square, `flash-${kind}`]]) } });
      flashTimer = setTimeout(() => cg.set({ highlight: { custom: new Map() } }), 750);
    },
    shake() {
      const wrap = el.parentElement;
      wrap.classList.remove('shake');
      void wrap.offsetWidth;
      wrap.classList.add('shake');
    },
    destroy() {
      clearTimeout(flashTimer);
      window.removeEventListener('resize', onResize);
      cg.destroy();
    },
  };
  return api;
}
