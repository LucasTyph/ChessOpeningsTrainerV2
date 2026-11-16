// Settings and data management.

import { state, save, replaceState, exportState, countMoves } from './store.js';
import { sfx } from './sound.js';
import { h, confirmDialog, toast, download, pickFiles } from './ui.js';

export function mountSettings(root) {
  const s = state.settings;
  const set = (key, value) => { s[key] = value; save(); };

  const number = (key, min, max) => h('input.input.num', {
    type: 'number', min, max, value: s[key],
    onchange: (e) => {
      const v = Math.max(min, Math.min(max, Math.round(Number(e.target.value) || 0)));
      e.target.value = v;
      set(key, v);
    },
  });

  const row = (title, hint, control) => h('div.set-row',
    h('div', h('div.set-title', title), hint && h('div.set-hint', hint)), control);

  const speed = h('select.input', { onchange: (e) => set('speed', e.target.value) },
    [['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']].map(([v, label]) => {
      const o = h('option', { value: v }, label);
      o.selected = s.speed === v;
      return o;
    }));

  const sound = h('label.switch',
    h('input', { type: 'checkbox', checked: s.sound, onchange: (e) => { set('sound', e.target.checked); sfx.correct(); } }),
    h('span.switch-track'));

  const volume = h('input.range', {
    type: 'range', min: 0, max: 1, step: 0.05, value: s.volume,
    oninput: (e) => set('volume', Number(e.target.value)),
    onchange: () => sfx.correct(),
  });

  async function importBackup() {
    const [file] = await pickFiles('.json');
    if (!file) return;
    let data;
    try { data = JSON.parse(file.text); } catch { data = null; }
    if (!data || !data.trees) return toast('That file is not a trainer backup', 'bad');
    const ok = await confirmDialog('Restore backup',
      'This replaces your current repertoire, progress and settings with the contents of the backup.', { ok: 'Restore' });
    if (!ok) return;
    replaceState(data);
    toast('Backup restored', 'ok');
    root.replaceChildren();
    mountSettings(root);
  }

  async function resetProgress() {
    const ok = await confirmDialog('Reset progress',
      'All review history is cleared and every move becomes new again. Your repertoire itself is kept.', { ok: 'Reset', danger: true });
    if (!ok) return;
    state.srs = {};
    state.daily = { day: 0, newCount: 0, extra: 0 };
    save();
    toast('Progress reset', 'ok');
  }

  async function eraseAll() {
    const ok = await confirmDialog('Erase everything',
      'Both repertoires and all progress are deleted. This cannot be undone — export a backup first if unsure.', { ok: 'Erase', danger: true });
    if (!ok) return;
    replaceState({ settings: state.settings });
    toast('Everything erased', 'ok');
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const moves = countMoves(state.trees.white) + countMoves(state.trees.black);

  root.append(h('div.settings',
    h('h2', 'Settings'),
    h('div.card',
      h('div.card-title', 'Training'),
      row('New moves per day', 'How many unseen moves are introduced each day.', number('newPerDay', 0, 200)),
      row('Correct answers to learn a move', 'A new move must be played right this many times before it is scheduled for tomorrow.', number('learnReps', 1, 5)),
      row('Auto-play speed', 'How quickly the line is played out before your move.', speed),
    ),
    h('div.card',
      h('div.card-title', 'Sound'),
      row('Sound effects', null, sound),
      row('Volume', null, volume),
    ),
    h('div.card',
      h('div.card-title', 'Data'),
      row('Backup', `Everything (${moves} moves, progress, settings) lives in this browser. Save a backup file now and then.`,
        h('div.btn-row',
          h('button.btn.small', { onclick: () => download(`chess-trainer-backup-${stamp}.json`, exportState(), 'application/json') }, 'Export backup'),
          h('button.btn.small', { onclick: importBackup }, 'Restore…'))),
      row('Reset progress', 'Keep the repertoire, forget the review history.',
        h('button.btn.small.danger-ghost', { onclick: resetProgress }, 'Reset')),
      row('Erase everything', 'Delete repertoires and progress.',
        h('button.btn.small.danger-ghost', { onclick: eraseAll }, 'Erase')),
    ),
  ));

  return () => {};
}
