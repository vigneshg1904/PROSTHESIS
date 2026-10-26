// util.js - helpers + a tiny WebAudio synth (no audio files needed)

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
export const shuffle = (arr, rnd = Math.random) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

export const FINGER_COLOR = { THUMB: '#ffb02e', INDEX: '#19e3ff', MIDDLE: '#3dffb5', RING: '#b388ff', LITTLE: '#ff6ec7' };
export const FINGER_NOTE = { THUMB: 261.63, INDEX: 293.66, MIDDLE: 329.63, RING: 349.23, LITTLE: 392.0 };

class Sound {
  constructor() { this.ctx = null; this.muted = false; }
  ensure() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { this.ctx = new AC(); } catch (e) { this.ctx = null; }
    return this.ctx;
  }
  unlock() { const c = this.ensure(); if (c && c.state === 'suspended') c.resume().catch(() => {}); }
  tone(freq, dur = 0.18, type = 'sine', vol = 0.07, when = 0) {
    if (this.muted) return;
    const c = this.ensure();
    if (!c) return;
    try {
      const t0 = c.currentTime + when;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t0); o.stop(t0 + dur + 0.03);
    } catch (e) { /* audio is optional */ }
  }
  finger(name, dur = 0.35) { this.tone(FINGER_NOTE[name] || 440, dur, 'triangle', 0.09); }
  ok() { this.tone(880, 0.12, 'sine', 0.06); this.tone(1320, 0.18, 'sine', 0.05, 0.08); }
  bad() { this.tone(150, 0.2, 'sawtooth', 0.05); }
  tick() { this.tone(660, 0.05, 'square', 0.025); }
  go() { this.tone(523, 0.1, 'triangle', 0.07); this.tone(784, 0.1, 'triangle', 0.07, 0.1); this.tone(1046, 0.25, 'triangle', 0.07, 0.2); }
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.07, i * 0.11)); }
  click() { this.tone(420, 0.05, 'square', 0.03); }
}
export const sfx = new Sound();

export function fmtMs(ms) { return ms == null ? '-' : (ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms'); }
export function fmtDate(ts) { try { return new Date(ts).toLocaleString(); } catch (e) { return String(ts); } }
