// The two synthesized sound effects (Web Audio): right and wrong answer. No audio files needed.

import { state } from './store.js';

let ctx = null;
let master = null;
let noiseBuf = null;

function audio() {
  if (!state.settings.sound) return null;
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    master.gain.value = Math.max(0, Math.min(1, state.settings.volume));
    return ctx;
  } catch {
    return null;
  }
}

/** A short woody knock: filtered noise click + a low thump. */
function knock(at, { bright = 1100, gain = 0.5, body = 150, len = 0.06 } = {}) {
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = bright;
  bp.Q.value = 0.9;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + len);
  src.connect(bp).connect(g).connect(master);
  src.start(t);
  src.stop(t + len + 0.02);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(body, t);
  osc.frequency.exponentialRampToValueAtTime(body * 0.55, t + 0.08);
  const og = ctx.createGain();
  og.gain.setValueAtTime(gain * 0.7, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  osc.connect(og).connect(master);
  osc.start(t);
  osc.stop(t + 0.11);
}

function tone(at, freq, { type = 'sine', gain = 0.1, len = 0.18, to = null } = {}) {
  const t = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + len + 0.03);
}

export const sfx = {
  correct() {
    if (!audio()) return;
    tone(0.02, 659.25, { gain: 0.07, len: 0.16 });
    tone(0.12, 987.77, { gain: 0.07, len: 0.26 });
  },
  wrong() {
    if (!audio()) return;
    tone(0, 196, { type: 'triangle', gain: 0.13, len: 0.2, to: 138 });
    knock(0, { gain: 0.25, bright: 500, body: 95 });
  },
};
