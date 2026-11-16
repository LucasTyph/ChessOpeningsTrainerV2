// Repertoire editor: browse the move tree, add/remove moves, import/export PGN,
// and list coverage gaps.

import { Chess } from 'chess.js';
import { state, save, touchTrees, countMoves, getTreeVersion } from './store.js';
import { getDeck, moveState } from './srs.js';
import { nameForLine, splitName } from './openings.js';
import { findGaps } from './gaps.js';
import { importPgn, exportPgn } from './pgn.js';
import { createBoard } from './board.js';
import { h, modal, confirmDialog, toast, download, pickFiles, formatLine } from './ui.js';

const MAX_GAPS = 150;
const moveLabel = (san, ply) => `${Math.floor(ply / 2) + 1}${ply % 2 === 0 ? '.' : '…'} ${san}`;

let rememberedColor = 'white';

export function mountRepertoire(root) {
  let color = rememberedColor;
  let path = []; // nodes from the root to the selected move
  let view = 'moves'; // 'moves' | 'gaps'
  let allGaps = false; // also list the rarer book replies
  let hint = null; // arrow to show on the next board update
  let gapCache = null; // { key, gaps }

  const boardEl = h('div.board');
  const panel = h('div.panel.rep');
  root.append(h('div.layout', h('div.board-wrap', boardEl), panel));
  const board = createBoard(boardEl, { onUserMove });

  const tree = () => state.trees[color];
  const parentOf = (i) => (i === 0 ? tree() : path[i - 1]);

  function position() {
    const chess = new Chess();
    let last = null;
    for (const n of path) last = chess.move(n.san);
    return { chess, last };
  }

  function changed() {
    touchTrees();
    save();
  }

  function sync() {
    const { chess, last } = position();
    board.show(chess, { orientation: color, movable: 'both', lastMove: last ? [last.from, last.to] : null });
    board.arrows(hint ? [hint] : []);
    hint = null;
    render();
  }

  function onUserMove({ from, to, promotion }) {
    const { chess } = position();
    let mv;
    try { mv = chess.move({ from, to, promotion }); } catch { return sync(); }
    const parent = path.length ? path[path.length - 1] : tree();
    let child = parent.children.find((c) => c.san === mv.san);
    if (!child) {
      child = { san: mv.san, children: [] };
      parent.children.push(child);
      changed();
    }
    path.push(child);
    sync();
  }

  function goTo(newPath) {
    path = newPath;
    sync();
  }

  const back = () => path.length && goTo(path.slice(0, -1));
  const forward = () => {
    const parent = path.length ? path[path.length - 1] : tree();
    if (parent.children.length) goTo([...path, parent.children[0]]);
  };
  const toEnd = () => {
    const p = path.slice();
    let node = p.length ? p[p.length - 1] : tree();
    while (node.children.length) { node = node.children[0]; p.push(node); }
    goTo(p);
  };

  async function removeCurrent() {
    if (!path.length) return;
    const node = path[path.length - 1];
    const after = countMoves(node);
    const ok = await confirmDialog('Delete move',
      after ? `Delete ${node.san} and the ${after} move${after === 1 ? '' : 's'} that follow it?` : `Delete ${node.san}?`,
      { ok: 'Delete', danger: true });
    if (!ok) return;
    const parent = parentOf(path.length - 1);
    parent.children = parent.children.filter((c) => c !== node);
    changed();
    goTo(path.slice(0, -1));
  }

  function makeMain() {
    const node = path[path.length - 1];
    const parent = parentOf(path.length - 1);
    parent.children = [node, ...parent.children.filter((c) => c !== node)];
    changed();
    render();
  }

  function setColor(c) {
    color = rememberedColor = c;
    path = [];
    sync();
  }

  // ---------- import / export ----------

  function openImport() {
    modal('Import PGN', (close) => {
      let target = color;
      const area = h('textarea.input.pgn-area', { placeholder: 'Paste PGN here, or choose a file…', spellcheck: 'false' });
      const seg = h('div.seg');
      const drawSeg = () => seg.replaceChildren(...['white', 'black'].map((c) =>
        h(`button.seg-btn${target === c ? '.on' : ''}`, { onclick: () => { target = c; drawSeg(); } },
          h(`span.side-chip.small.${c}`), c === 'white' ? 'I play White' : 'I play Black')));
      drawSeg();
      const run = () => {
        const text = area.value.trim();
        if (!text) return toast('Nothing to import yet', 'bad');
        const res = importPgn(text, state.trees[target]);
        changed();
        close();
        if (target !== color) { color = rememberedColor = target; path = []; }
        sync();
        if (!res.games) toast('No moves found in that PGN', 'bad');
        else toast(`Added ${res.added} new move${res.added === 1 ? '' : 's'} from ${res.games} game${res.games === 1 ? '' : 's'}`
          + (res.errors.length ? ` · ${res.errors.length} problem${res.errors.length === 1 ? '' : 's'} skipped` : ''), res.errors.length ? 'warn' : 'ok');
        if (res.errors.length) console.warn('PGN import problems:\n' + res.errors.join('\n'));
      };
      return h('div',
        h('p.modal-text', 'Lines are merged into the repertoire you choose. Variations and comments are kept; moves you already have are not duplicated.'),
        seg,
        area,
        h('div.modal-actions',
          h('button.btn.ghost', {
            onclick: async () => {
              const files = await pickFiles('.pgn,.txt', true);
              if (files.length) area.value = files.map((f) => f.text).join('\n\n');
            },
          }, 'Choose file…'),
          h('div.spacer'),
          h('button.btn.ghost', { onclick: () => close() }, 'Cancel'),
          h('button.btn.primary', { onclick: run }, 'Import'),
        ),
      );
    });
  }

  function doExport() {
    if (!tree().children.length) return toast('This repertoire is empty', 'bad');
    download(`${color}-repertoire.pgn`, exportPgn(tree(), color), 'application/x-chess-pgn');
  }

  // ---------- coverage gaps ----------

  function gaps() {
    const key = `${color}:${getTreeVersion()}`;
    if (!gapCache || gapCache.key !== key) gapCache = { key, gaps: findGaps(color) };
    return gapCache.gaps;
  }

  /** Jump to the position of a gap so the missing moves can be added. */
  function openGap(gap) {
    view = 'moves';
    const label = moveLabel(gap.san, gap.sans.length);
    if (gap.type === 'unanswered') {
      const parent = gap.nodes.length ? gap.nodes[gap.nodes.length - 1] : tree();
      const node = parent.children.find((c) => c.san === gap.san);
      toast(`Play your answer to ${label} on the board`);
      return goTo(node ? [...gap.nodes, node] : gap.nodes.slice());
    }
    path = gap.nodes.slice();
    try {
      const { chess } = position();
      const mv = chess.move(gap.san);
      hint = { from: mv.from, to: mv.to, brush: 'yellow' };
    } catch { hint = null; }
    toast(`Play ${label} on the board, then your answer`);
    sync();
  }

  function renderGaps() {
    const all = gaps();
    const common = all.filter((g) => g.common);
    const list = (allGaps ? all : common).slice(0, MAX_GAPS);
    const box = h('div.tree.gaps');
    if (!list.length) {
      box.append(h('div.tree-empty',
        h('strong', all.length ? 'No common gaps' : 'No gaps found'),
        h('span', all.length
          ? 'Every common reply in the opening book has an answer. Rarer replies are still listed under "Show rare too".'
          : 'The opening book has no replies you are missing here.')));
    }
    for (const g of list) {
      box.append(h('button.gap', { onclick: () => openGap(g) },
        h('div.gap-top',
          h('span.gap-move', moveLabel(g.san, g.sans.length)),
          g.name ? h('span.gap-name', splitName(g.name).title) : null,
          g.type === 'unanswered' ? h('span.gap-tag', 'no answer') : h('span.gap-share', `${g.lines} ${g.lines === 1 ? 'line' : 'lines'}`)),
        g.sans.length ? h('div.gap-line', `after ${formatLine(g.sans)}`) : null));
    }
    const head = h('div.gap-head',
      h('span', `${allGaps ? all.length : common.length} ${allGaps ? 'gaps' : 'common gaps'}${list.length < (allGaps ? all.length : common.length) ? `, first ${list.length} shown` : ''}`),
      all.length > common.length
        ? h('button.btn.ghost.small', { onclick: () => { allGaps = !allGaps; render(); } }, allGaps ? 'Common only' : 'Show rare too')
        : null);
    return [head, box];
  }

  // ---------- rendering ----------

  function moveEl(node, nodePath, ply, forceNumber) {
    const num = Math.floor(ply / 2) + 1;
    const label = ply % 2 === 0 ? `${num}. ${node.san}` : forceNumber ? `${num}… ${node.san}` : node.san;
    const mine = (ply % 2 === 0) === (color === 'white');
    const active = path.length && path[path.length - 1] === node;
    const st = mine ? `.st-${moveState(getDeck().keyOf.get(node))}` : '';
    return h(`span.mv${mine ? '.mine' : ''}${st}${active ? '.active' : ''}`, { onclick: () => goTo(nodePath) }, label);
  }

  function renderLine(container, parent, parentPath, ply, forceNumber) {
    let p = parent;
    let pp = parentPath;
    while (p.children.length) {
      const [main, ...vars] = p.children;
      const mainPath = [...pp, main];
      container.append(moveEl(main, mainPath, ply, forceNumber), ' ');
      forceNumber = false;
      if (main.comment) { container.append(h('span.cmt', main.comment), ' '); forceNumber = true; }
      if (vars.length) {
        const block = h('div.vars');
        for (const v of vars) {
          const row = h('div.var');
          const vPath = [...pp, v];
          row.append(moveEl(v, vPath, ply, true), ' ');
          if (v.comment) row.append(h('span.cmt', v.comment), ' ');
          renderLine(row, v, vPath, ply + 1, !!v.comment);
          block.append(row);
        }
        container.append(block);
        forceNumber = true;
      }
      p = main;
      pp = mainPath;
      ply++;
    }
  }

  function render() {
    const node = path.length ? path[path.length - 1] : null;
    const parent = node ? parentOf(path.length - 1) : null;
    const openingName = nameForLine(path.map((n) => n.san));
    const opening = openingName ? splitName(openingName) : null;
    const treeBox = h('div.tree');
    if (tree().children.length) renderLine(treeBox, tree(), [], 0, false);
    else treeBox.append(h('div.tree-empty',
      h('strong', 'No moves yet'),
      h('span', `Play moves on the board to build your ${color === 'white' ? 'White' : 'Black'} repertoire, or import a PGN.`)));

    const note = node && h('input.input', {
      type: 'text', placeholder: `Note for ${node.san} (shown after you answer)`, value: node.comment || '',
      onchange: (e) => {
        const v = e.target.value.trim();
        if (v) node.comment = v; else delete node.comment;
        changed();
        render();
      },
    });

    panel.replaceChildren(...[
      h('div.rep-head',
        h('div.seg', ['white', 'black'].map((c) =>
          h(`button.seg-btn${color === c ? '.on' : ''}`, { onclick: () => setColor(c) },
            h(`span.side-chip.small.${c}`), c === 'white' ? 'White' : 'Black',
            h('span.seg-n', countMoves(state.trees[c]))))),
        h('div.rep-io',
          h('button.btn.small', { onclick: openImport }, 'Import PGN'),
          h('button.btn.small', { onclick: doExport }, 'Export PGN'),
        ),
      ),
      h('div.rep-tabs',
        h(`button.tab${view === 'moves' ? '.on' : ''}`, { onclick: () => { view = 'moves'; render(); } }, 'Moves'),
        h(`button.tab${view === 'gaps' ? '.on' : ''}`, { onclick: () => { view = 'gaps'; render(); } }, 'Gaps'),
        h('div.spacer'),
        opening ? h('div.opening', { title: opening.title }, h('span.eco', opening.eco), opening.title) : null,
      ),
      ...(view === 'gaps' ? renderGaps() : [treeBox]),
      view === 'moves' ? note : null,
      h('div.rep-nav',
        h('button.btn.icon', { title: 'Start (↑)', onclick: () => goTo([]), disabled: !node }, '⏮'),
        h('button.btn.icon', { title: 'Back (←)', onclick: back, disabled: !node }, '◀'),
        h('button.btn.icon', { title: 'Forward (→)', onclick: forward }, '▶'),
        h('button.btn.icon', { title: 'End (↓)', onclick: toEnd }, '⏭'),
        h('div.spacer'),
        node && parent.children[0] !== node ? h('button.btn.small', { onclick: makeMain, title: 'Make this the main line' }, 'Make main') : null,
        h('button.btn.small.danger-ghost', { onclick: removeCurrent, disabled: !node }, 'Delete move'),
      ),
      view === 'gaps'
        ? h('div.footnote', 'Opponent moves you have no answer to. The count is how many named opening-book lines follow that move: a rough guide to how standard it is, not game statistics.')
        : h('div.footnote',
          h('div.legend', ['new', 'learn', 'young', 'mature'].map((k) =>
            h('span.legend-item', h(`span.dot-st.st-${k}`), { new: 'New', learn: 'Learning', young: 'Young', mature: 'Mature' }[k]))),
          'Play a move on the board to add it. The dotted moves are yours, the ones you get quizzed on.'),
    ].filter(Boolean));
    const act = treeBox.querySelector('.mv.active');
    if (act) act.scrollIntoView({ block: 'nearest' });
  }

  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    const map = { ArrowLeft: back, ArrowRight: forward, ArrowUp: () => goTo([]), ArrowDown: toEnd };
    if (map[e.key]) { e.preventDefault(); map[e.key](); }
  };
  document.addEventListener('keydown', onKey);

  sync();

  return () => {
    document.removeEventListener('keydown', onKey);
    board.destroy();
  };
}
