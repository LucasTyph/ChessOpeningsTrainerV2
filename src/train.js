// Training view: today's overview and the review session itself.

import { Chess } from 'chess.js';
import { state, save, countMoves, touchTrees } from './store.js';
import { getDeck, getToday, buildQueue, allowMoreNew, cardKind, introduce, grade, pickLine } from './srs.js';
import { lookup, nameForLine, splitName } from './openings.js';
import { createBoard } from './board.js';
import { sfx } from './sound.js';
import { h, sleep, formatLine } from './ui.js';
import { importPgn } from './pgn.js';
import { SAMPLE_WHITE, SAMPLE_BLACK } from './sample.js';

const SPEEDS = { slow: 560, normal: 340, fast: 170 };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const inDays = (n) => (n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

function openingEl(name) {
  if (!name) return null;
  const { eco, title } = splitName(name);
  return h('div.opening', h('span.eco', eco), title);
}

export function mountTrain(root, { go }) {
  const boardEl = h('div.board');
  const panel = h('div.panel');
  root.append(h('div.layout', h('div.board-wrap', boardEl), panel));
  const board = createBoard(boardEl, { onUserMove });

  let session = null; // { queue, initial, finished, answered, correct, line: { total, clean } | undefined }
  let cur = null;     // card: { card, chess, mode: 'intro' | 'quiz', failed, phase, lastMove, status, answer, names }
                      // full line: { line, chess, mode: 'line', ply, step, failed, phase, lastMove, status, answer, name }
  let token = 0;      // bumps whenever the current card/screen changes, cancelling pending timers

  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    if (e.key !== ' ' && e.key !== 'Enter') return;
    if (!cur) return;
    e.preventDefault();
    if (cur.phase === 'await') next();
    else if (cur.phase === 'input' && cur.mode === 'quiz') reveal();
    else if (cur.phase === 'input' && cur.mode === 'line') revealLine();
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

    if (finished && (finished.initial || finished.line)) {
      const acc = finished.answered ? Math.round((finished.correct / finished.answered) * 100) : null;
      const lineText = finished.line
        ? `Full line: ${finished.line.clean} of ${plural(finished.line.total, 'move')} right first time.`
        : null;
      panel.append(...[
        h('div.eyebrow.ok', finished.initial ? 'Session complete' : 'Line complete'),
        h('h2', 'Nicely done'),
        finished.initial
          ? h('p.muted', acc === null
            ? `${plural(finished.finished, 'move')} practised.`
            : `${plural(finished.finished, 'move')} practised · ${acc}% right first time.`)
          : null,
        lineText ? h('p.muted', lineText) : null,
      ].filter(Boolean));
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
      if (pickLine()) panel.append(h('button.btn', { onclick: startLineOnly }, 'Play a full line'));
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
      // Every session ends with one line played through in full.
      const line = session.line ? null : pickLine(state.lastLine);
      if (line) return startLine(line);
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
      names: [nameForLine(card.path), nameForLine([...card.path, card.san])],
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
    const restore = () => cur && board.show(cur.chess, {
      movable: cur.phase === 'input' ? (cur.mode === 'line' ? cur.line.color : cur.card.color) : false,
      lastMove: cur.lastMove,
    });
    if (!cur || cur.phase !== 'input') return restore();
    if (cur.mode === 'line') return onLineMove({ from, to, promotion }, restore);
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
      openingEl(cur.names[cur.done ? 1 : 0]),
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

  // ---------- full line ----------

  function startLineOnly() {
    session = { queue: [], initial: 0, finished: 0, answered: 0, correct: 0 };
    next();
  }

  function startLine(line) {
    const my = ++token;
    session.line = { total: line.steps.length, clean: 0 };
    state.lastLine = line.id;
    save();
    cur = {
      line, chess: new Chess(), mode: 'line', ply: 0, step: 0,
      failed: false, phase: 'leadin', lastMove: null, status: null, answer: null, name: null,
    };
    board.setSpeed(180);
    board.arrows([]);
    board.show(cur.chess, { orientation: line.color, movable: false });
    renderLine();
    setTimeout(() => { if (my === token) advanceLine(); }, 450);
  }

  function playLineMove(san) {
    const mv = cur.chess.move(san);
    cur.lastMove = [mv.from, mv.to];
    cur.ply++;
    const entry = lookup(cur.chess.fen());
    if (entry && entry.name) cur.name = entry.name;
    board.show(cur.chess, { movable: false, lastMove: cur.lastMove });
    return mv;
  }

  /** Auto-play the opponent's moves until it is your turn or the line ends. */
  async function advanceLine() {
    const my = token;
    const { line, chess } = cur;
    const delay = SPEEDS[state.settings.speed] || SPEEDS.normal;
    while (cur.ply < line.sans.length) {
      const mine = (cur.ply % 2 === 0) === (line.color === 'white');
      if (mine) {
        const ans = chess.move(line.sans[cur.ply]);
        chess.undo();
        cur.answer = { from: ans.from, to: ans.to };
        cur.failed = false;
        cur.phase = 'input';
        board.show(chess, { movable: line.color, lastMove: cur.lastMove });
        renderLine();
        return;
      }
      cur.phase = 'leadin';
      await sleep(delay);
      if (my !== token) return;
      playLineMove(line.sans[cur.ply]);
      renderLine();
    }
    cur.phase = 'locked';
    cur.done = true;
    cur.status = { kind: 'ok', text: `${session.line.clean} of ${session.line.total} right first time` };
    renderLine();
    await sleep(1400);
    if (my !== token) return;
    const done = session;
    showHome(done);
  }

  function revealLine() {
    if (!cur || cur.mode !== 'line' || cur.phase !== 'input') return;
    cur.failed = true;
    board.arrows([{ ...cur.answer, brush: 'blue' }]);
    cur.status = { kind: 'bad', text: `The move is ${cur.line.sans[cur.ply]} — play it to continue` };
    renderLine();
  }

  function onLineMove({ from, to, promotion }, restore) {
    const { line, chess } = cur;
    const want = line.sans[cur.ply];
    const my = token;
    let mv;
    try { mv = chess.move({ from, to, promotion }); } catch { return restore(); }
    chess.undo();

    if (mv.san === want) {
      const clean = !cur.failed;
      cur.phase = 'locked';
      board.arrows([]);
      playLineMove(want);
      cur.step++;
      cur.status = clean ? { kind: 'ok', text: 'Correct' } : null;
      if (clean) {
        session.line.clean++;
        board.flash(mv.to, 'correct');
        sfx.correct();
      }
      renderLine();
      advanceLine();
      return;
    }

    if (!cur.failed && getDeck().alts.get(line.steps[cur.step].posKey)?.has(mv.san)) {
      cur.status = { kind: 'info', text: `${mv.san} is in your repertoire too — this line continues differently` };
      renderLine();
      setTimeout(() => { if (my === token) restore(); }, 380);
      return;
    }

    cur.phase = 'locked';
    cur.failed = true;
    board.flash(to, 'wrong');
    board.shake();
    sfx.wrong();
    cur.status = { kind: 'bad', text: `Not ${mv.san} — the move is ${want}` };
    renderLine();
    setTimeout(() => {
      if (my !== token) return;
      cur.phase = 'input';
      restore();
      board.arrows([{ ...cur.answer, brush: 'blue' }]);
      renderLine();
    }, 560);
  }

  function renderLine() {
    const { line } = cur;
    const total = line.steps.length;
    const side = line.color === 'white' ? 'White' : 'Black';
    const pct = Math.round((cur.step / total) * 100);
    panel.replaceChildren(...[
      h('div.session-top',
        h('div.counts', h('span.count.line', cur.done ? 'Done' : `Move ${Math.min(cur.step + 1, total)} of ${total}`)),
        h('button.btn.ghost.small', { onclick: () => showHome(session) }, cur.done ? 'Finish' : 'Skip line'),
      ),
      h('div.progress', h('div.progress-bar', { style: `width:${pct}%` })),
      h('div.prompt',
        h(`span.side-chip.${line.color}`),
        h('div',
          h('div.eyebrow', 'Full line'),
          h('h2', cur.done ? 'Line complete' : cur.phase === 'input' ? `${side} to play` : `Playing as ${side}`),
        ),
      ),
      h('div.line', formatLine(line.sans.slice(0, cur.ply)) || 'Starting position'),
      openingEl(cur.name),
      cur.status ? h(`div.status.${cur.status.kind}`, cur.status.text) : h('div.status.idle', 'Play every one of your moves from memory'),
      h('div.spacer'),
      cur.phase === 'input' ? h('button.btn', { onclick: revealLine, disabled: cur.failed }, 'Show move') : null,
      h('div.footnote', 'Extra practice: this line does not change your review schedule'),
    ].filter(Boolean));
  }

  return () => {
    token++;
    document.removeEventListener('keydown', onKey);
    board.destroy();
  };
}
