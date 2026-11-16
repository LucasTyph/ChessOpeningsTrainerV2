// Tiny DOM helpers, modal dialogs and toasts.

/** h('div.a.b', {onclick, title}, ...children) */
export function h(spec, attrs, ...children) {
  const [tag, ...classes] = spec.split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');
  if (attrs !== null && attrs !== undefined && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : String(c));
  };
  children.forEach(add);
  return el;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Show a modal. `build(close)` returns the body node. Resolves with whatever
 * close() is called with (undefined when dismissed).
 */
export function modal(title, build) {
  return new Promise((resolve) => {
    const close = (value) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.classList.add('out');
      setTimeout(() => overlay.remove(), 140);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else e.stopPropagation();
    };
    const box = h('div.modal', { role: 'dialog', 'aria-modal': 'true' }, title && h('h3', title), build(close));
    const overlay = h('div.overlay', { onmousedown: (e) => { if (e.target === overlay) close(); } }, box);
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    const focus = box.querySelector('[autofocus]') || box.querySelector('button');
    if (focus) focus.focus();
  });
}

export function confirmDialog(title, message, { ok = 'Confirm', danger = false } = {}) {
  return modal(title, (close) => h('div',
    h('p.modal-text', message),
    h('div.modal-actions',
      h('button.btn.ghost', { onclick: () => close(false) }, 'Cancel'),
      h(`button.btn${danger ? '.danger' : '.primary'}`, { onclick: () => close(true), autofocus: true }, ok),
    ),
  )).then((v) => !!v);
}

let toastBox = null;
export function toast(message, kind = '') {
  if (!toastBox) { toastBox = h('div.toasts'); document.body.append(toastBox); }
  const el = h(`div.toast${kind ? '.' + kind : ''}`, message);
  toastBox.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, 3200);
}

export function download(filename, text, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Open a file picker and resolve with [{name, text}]. */
export function pickFiles(accept, multiple = false) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple });
    input.addEventListener('change', async () => {
      const out = [];
      for (const f of input.files) out.push({ name: f.name, text: await f.text() });
      resolve(out);
    });
    input.click();
  });
}

/** "1. e4 e5 2. Nf3" from a list of SANs. */
export function formatLine(sans) {
  const parts = [];
  sans.forEach((san, i) => parts.push(i % 2 === 0 ? `${i / 2 + 1}. ${san}` : san));
  return parts.join(' ');
}
