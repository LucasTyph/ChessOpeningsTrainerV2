import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import './style.css';

import { h, toast } from './ui.js';
import { save } from './store.js';
import { mountTrain } from './train.js';
import { mountRepertoire } from './repertoire.js';
import { mountSettings } from './settings.js';

const VIEWS = {
  train: { label: 'Train', mount: mountTrain },
  repertoire: { label: 'Repertoire', mount: mountRepertoire },
  settings: { label: 'Settings', mount: mountSettings },
};

const main = h('main');
const nav = h('nav');
let cleanup = null;
let active = null;

function go(name) {
  if (cleanup) cleanup();
  active = name;
  main.replaceChildren();
  nav.replaceChildren(...Object.entries(VIEWS).map(([key, v]) =>
    h(`button.nav-btn${key === name ? '.on' : ''}`, { onclick: () => go(key) }, v.label)));
  cleanup = VIEWS[name].mount(main, { go });
}

document.body.append(
  h('header',
    h('div.brand', h('span.brand-mark', '♞'), h('span', 'Openings Trainer')),
    nav,
  ),
  main,
);

go('train');

if (!save()) toast('This browser is blocking storage — progress will not be kept after you close the page', 'bad');
