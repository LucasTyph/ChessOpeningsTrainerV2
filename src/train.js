// Training view: today's overview and the review session itself.

import { Chess } from 'chess.js';
import { state, save, countMoves, touchTrees } from './store.js';
import { getDeck, getToday, buildQueue, allowMoreNew, cardKind, introduce, grade } from './srs.js';
import { createBoard } from './board.js';
import { sfx } from './sound.js';
import { h, sleep, formatLine } from './ui.js';
import { importPgn } from './pgn.js';
import { SAMPLE_WHITE, SAMPLE_BLACK } from './sample.js';

const SPEEDS = { slow: 560, normal: 340, fast: 170 };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const inDays = (n) => (n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

export function mountTrain(root, { go }) {
  const boardEl = h('div.board');
  const panel = h('div.panel');
  root.append(h('div.layout', h('div.board-wrap', boardEl), panel));
  const board = createBoard(boardEl, { onUserMove });

  let session = null; // { queue, initial, finished, answered, correct }
  let cur = null;     // { card, chess, mode, failed, phase, lastMove, status, answer }
  let token = 0;      // bumps whenever the current card/screen changes, cancelling pending timers

  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if (!cur) return;
    e.preventDefault();
    if (cur.phase === 'await') next();
    else if (cur.phase === 'input' && cur.mode === 'quiz') reveal();
  };
  document.addEventListener('keydown', onKey);

  showHome();

  // ---------- overview ----------

  function showHome(finished = null) {
    token++;
    session = null;
    cur = null;
    board.setSpeed(180);
    board.arrows([]);
    board.show(new Chess(), { orientation: 'white', movable: false });

    const t = getToday();
    const todo = t.learning.length + t.reviews.length + t.fresh.length;
    panel.replaceChildren();

    if (!t.total) {
      panel.append(
        h('div.eyebrow', 'Welcome'),
        h('h2', 'Your repertoire is empty'),
        h('p.muted', 'Add the lines you want to learn — import a PGN or play the moves on the board — and they will show up here for daily practice.'),
        h('div.stack',
          h('button.btn.primary', { onclick: () => go('repertoire') }, 'Build repertoire'),
          h('button.btn', { onclick: loadSample }, 'Try a sample repertoire'),
        ),
      );
      return;
    }

    if (finished) {
      const acc = finished.answered ? Math.round((finished.correct / finished.answered) * 100) : null;
      panel.append(
        h('div.eyebrow.ok', 'Session complete'),
        h('h2', 'Nicely done'),
        h('p.muted', acc === null
          ? `${plural(finished.finished, 'move')} practised.`
          : `${plural(finished.finished, 'move')} practised · ${acc}% right first time.`),
      );
    } else {
      panel.append(h('div.eyebrow', 'Today'), h('h2', todo ? 'Ready to train' : 'All caught up'));
    }

    panel.append(h('div.stats',
      stat(t.fresh.length, 'New', 'new'),
      stat(t.learning.length, 'Learning', 'learn'),
      stat(t.reviews.length, 'Review', 'review'),
    ));

    if (todo) {
      panel.append(h('button.btn.primary.big', { onclick: start, autofocus: true }, finished ? 'Keep going' : 'Start training'));
    } else {
      const left = t.unseenTotal;
      panel.append(h('p.muted',
        t.nextDueIn === null ? 'Nothing is scheduled yet.' : `Next review ${inDays(t.nextDueIn)} (${plural(t.nextDueCount, 'move')}).`));
      if (left) {
        const n = Math.min(5, left);
        panel.append(h('button.btn', { onclick: () => { allowMoreNew(n); save(); showHome(); } },
          `Learn ${n} more new ${n === 1 ? 'move' : 'moves'}`));
      }
    }

    const w = countMoves(state.trees.white);
    const b = countMoves(state.trees.black);
    panel.append(h('div.spacer'), h('div.footnote',
      h('span', `${plural(t.total, 'move')} to know`),
      h('span.dot', '·'),
      h('span', `${t.unseenTotal} not started`),
      h('br'),
      h('span', `White tree ${w} · Black tree ${b}`),
    ));
  }

  function stat(n, label, kind) {
    return h(`div.stat.${kind}${n ? '' : '.zero'}`, h('div.stat-n', n), h('div.stat-l', label));
  }

  function loadSample() {
    importPgn(SAMPLE_WHITE, state.trees.white);
    importPgn(SAMPLE_BLACK, state.trees.black);
    touchTrees();
    save();
    showHome();
  }

  // ---------- session ----------

  function start() {
    const queue = buildQueue();
    if (!queue.length) return showHome();
    session = { queue, initial: queue.length, finished: 0, answered: 0, correct: 0 };
    next();
  }

  async function next() {
    if (!session) return;
    if (!session.queue.length) {
      const done = session;
      return showHome(done);
    }
    const my = ++token;
    const card = session.queue.shift();
    const chess = new Chess();
    cur = {
      card, chess,
      mode: cardKind(card) === 'new' ? 'intro' : 'quiz',
      failed: false, phase: 'leadin', lastMove: null, status: null, answer: null,
    };
    const n = card.path.length;
    const delay = Math.max(85, Math.min(SPEEDS[state.settings.speed] || SPEEDS.normal, 3600 / Math.max(1, n)));
    board.setSpeed(Math.min(180, Math.round(delay * 0.75)));
    board.arrows([]);
    board.show(chess, { orientation: card.color, movable: false });
    render();

    await sleep(n ? 280 : 160);
    for (const san of card.path) {
      if (my !== token) return;
      const mv = chess.move(san);
      cur.lastMove = [mv.from, mv.to];
      board.show(chess, { movable: false, lastMove: cur.lastMove });
      await sleep(delay);
    }
    if (my !== token) return;

    const ans = chess.move(card.san);
    chess.undo();
    cur.answer = { from: ans.from, to: ans.to };
    cur.phase = 'input';
    board.setSpeed(180);
    board.show(chess, { movable: card.color, lastMove: cur.lastMove });
    if (cur.mode === 'intro') {
      board.arrows([{ ...cur.answer, brush: 'green' }]);
      cur.status = { kind: 'new', text: `New move — play ${card.san}` };
    }
    render();
  }

  function reveal() {
    if (!cur || cur.phase !== 'input' || cur.mode !== 'quiz') return;
    cur.failed = true;
    board.arrows([{ ...cur.answer, brush: 'blue' }]);
    cur.status = { kind: 'bad', text: `The move is ${cur.card.san} — play it to continue` };
    render();
  }

  function onUserMove({ from, to, promotion }) {
    const restore = () => cur && board.show(cur.chess, { movable: cur.phase === 'input' ? cur.card.color : false, lastMove: cur.lastMove });
    if (!cur || cur.phase !== 'input') return restore();
    const { card, chess } = cur;
    let mv;
    try { mv = chess.move({ from, to, promotion }); } catch { return restore(); }
    if (mv.san === card.san) return onCorrect(mv);
    chess.undo();

    const my = token;
    const alsoMine = cur.mode === 'quiz' && !cur.failed && getDeck().alts.get(card.posKey)?.has(mv.san);
    if (alsoMine) {
      cur.status = { kind: 'info', text: `${mv.san} is in your repertoire too — a different move is wanted here` };
      render();
      setTimeout(() => { if (my === token) restore(); }, 380);
      return;
    }

    cur.phase = 'locked';
    if (cur.mode === 'quiz') cur.failed = true;
    board.flash(to, 'wrong');
    board.shake();
    sfx.wrong();
    cur.status = { kind: 'bad', text: `Not ${mv.san} — the move is ${card.san}` };
    render();
    setTimeout(() => {
      if (my !== token) return;
      cur.phase = 'input';
      restore();
      board.arrows([{ ...cur.answer, brush: cur.mode === 'intro' ? 'green' : 'blue' }]);
    }, 560);
  }

  function onCorrect(mv) {
    const { card } = cur;
    const my = token;
    cur.phase = 'locked';
    cur.lastMove = [mv.from, mv.to];
    board.arrows([]);
    board.show(cur.chess, { movable: false, lastMove: cur.lastMove });

    if (cur.mode === 'intro') {
      introduce(card);
      requeue(card, 3);
      cur.status = { kind: 'new', text: 'Got it — you will be asked again in a moment' };
    } else {
      const clean = !cur.failed;
      session.answered++;
      if (clean) {
        session.correct++;
        board.flash(mv.to, 'correct');
        sfx.correct();
      }
      const res = grade(card, clean);
      if (res.again) {
        requeue(card, 3 + (state.srs[card.key].streak || 0) * 2);
        cur.status = clean
          ? { kind: 'ok', text: 'Correct — once more later to lock it in' }
          : { kind: 'bad', text: 'This one will come back shortly' };
      } else {
        session.finished++;
        cur.status = { kind: 'ok', text: `Correct — next review ${inDays(res.ivl)}` };
      }
    }
    save();
    cur.done = true;

    if (card.comment) {
      cur.phase = 'await';
      render();
    } else {
      render();
      setTimeout(() => { if (my === token) next(); }, cur.failed ? 900 : 720);
    }
  }

  function requeue(card, gap) {
    session.queue.splice(Math.min(session.queue.length, gap), 0, card);
  }

  function render() {
    const { card } = cur;
    const counts = { new: 0, learn: 0, review: 0 };
    for (const c of session.queue) counts[cardKind(c)]++;
    if (!cur.done) counts[cur.mode === 'intro' ? 'new' : cardKind(card)]++;
    const pct = Math.round((session.finished / Math.max(1, session.initial)) * 100);
    const side = card.color === 'white' ? 'White' : 'Black';
    const shown = cur.done ? [...card.path, card.san] : card.path;
    const moveNo = Math.floor(card.path.length / 2) + 1;
    const blank = cur.done ? '' : card.path.length % 2 === 0 ? ` ${moveNo}. ?` : ' ?';

    panel.replaceChildren(...[
      h('div.session-top',
        h('div.counts',
          h('span.count.new', { title: 'New' }, counts.new),
          h('span.count.learn', { title: 'Learning' }, counts.learn),
          h('span.count.review', { title: 'Review' }, counts.review),
        ),
        h('button.btn.ghost.small', { onclick: () => showHome() }, 'End session'),
      ),
      h('div.progress', h('div.progress-bar', { style: `width:${pct}%` })),
      h('div.prompt',
        h(`span.side-chip.${card.color}`),
        h('div',
          h('div.eyebrow', cur.mode === 'intro' ? 'New move' : cur.phase === 'leadin' ? 'Watch the line' : 'Your move'),
          h('h2', cur.phase === 'leadin' ? `Playing as ${side}` : `${side} to play`),
        ),
      ),
      h('div.line', (formatLine(shown) || 'Starting position') + blank),
      cur.status ? h(`div.status.${cur.status.kind}`, cur.status.text) : h('div.status.idle', cur.phase === 'leadin' ? ' ' : 'Play your move on the board'),
      cur.done && card.comment ? h('div.note', card.comment) : null,
      h('div.spacer'),
      cur.phase === 'await'
        ? h('button.btn.primary', { onclick: next }, 'Continue')
        : cur.mode === 'quiz' && cur.phase !== 'leadin' && !cur.done
          ? h('button.btn', { onclick: reveal, disabled: cur.failed }, 'Show answer')
          : null,
      h('div.footnote', 'Space shows the answer or continues'),
    ].filter(Boolean));
  }

  return () => {
    token++;
    document.removeEventListener('keydown', onKey);
    board.destroy();
  };
}
