// Persistent app state (localStorage) + small helpers.

const KEY = 'chess-openings-trainer.v1';
const DAY_MS = 86400000;
const ROLLOVER_HOURS = 4; // a "day" ends at 4am, like Anki

export const DEFAULT_SETTINGS = {
  newPerDay: 10,
  learnReps: 2,
  speed: 'normal',
  sound: true,
  volume: 0.6,
};

function blank() {
  return {
    version: 1,
    trees: { white: { children: [] }, black: { children: [] } },
    srs: {},
    settings: { ...DEFAULT_SETTINGS },
    daily: { day: 0, newCount: 0, extra: 0 },
    lastLine: '', // the full line played most recently, so the next one differs
  };
}

function normalize(data) {
  const base = blank();
  if (!data || typeof data !== 'object') return base;
  const tree = (t) => (t && Array.isArray(t.children) ? t : { children: [] });
  return {
    version: 1,
    trees: { white: tree(data.trees?.white), black: tree(data.trees?.black) },
    srs: data.srs && typeof data.srs === 'object' ? data.srs : {},
    settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
    daily: { ...base.daily, ...(data.daily || {}) },
    lastLine: typeof data.lastLine === 'string' ? data.lastLine : '',
  };
}

function load() {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    return blank();
  }
}

export const state = load();

let treeVersion = 0;
export const getTreeVersion = () => treeVersion;
/** Call after any change to the move trees so derived cards are rebuilt. */
export const touchTrees = () => { treeVersion++; };

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function replaceState(data) {
  const next = normalize(data);
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, next);
  touchTrees();
  save();
}

export function exportState() {
  return JSON.stringify(state);
}

/** Day number in local time, rolling over at 4am. */
export function today() {
  const now = new Date();
  const local = now.getTime() - now.getTimezoneOffset() * 60000;
  return Math.floor((local - ROLLOVER_HOURS * 3600000) / DAY_MS);
}

export function daily() {
  const t = today();
  if (state.daily.day !== t) state.daily = { day: t, newCount: 0, extra: 0 };
  return state.daily;
}

export function countMoves(node) {
  let n = 0;
  const stack = [...node.children];
  while (stack.length) {
    const x = stack.pop();
    n++;
    for (const c of x.children) stack.push(c);
  }
  return n;
}
