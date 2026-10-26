// device.js - connects the website to the NPG: raw EMG batches in Firebase -> pipeline -> live finger state.
import { Rtdb } from './rtdb.js';
import { LivePipeline, RestGate, FINGERS } from './dsp.js';

export const ONLINE_MS = 3500;       // no new batch for this long => device is considered offline

function decodeB64Int16(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const n = Math.floor(bytes.length / 2);
  const out = new Int16Array(n);
  const dv = new DataView(bytes.buffer);
  for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, true);
  return out;
}

export async function loadModel(rtdb, deviceId, log = () => {}) {
  try {
    const rec = await rtdb.get(`models/${deviceId}`, 5000);
    if (rec && typeof rec.json === 'string') {
      const model = JSON.parse(rec.json);
      if (model.format === 'ikm-model-1') {
        log('model: loaded from cloud');
        return { model, source: 'cloud', demo: !!model.demo, updated: rec.updated || null };
      }
    }
  } catch (e) { log('model: cloud not available (' + (e.message || e) + ')'); }
  const r = await fetch('./model.demo.json', { cache: 'no-store' });
  const model = await r.json();
  log('model: using the built-in DEMO model');
  return { model, source: 'demo', demo: true, updated: null };
}

export class DeviceLink {
  constructor(cfg, model) {
    this.cfg = cfg;
    this.rtdb = new Rtdb(cfg.dbUrl);
    this.model = model;
    this.pipe = new LivePipeline(model, cfg.pipeline || {});
    this.status = 'offline';           // offline | waiting | online
    this.dbOk = null;                  // null = unknown, true/false
    this.meta = { seq: 0, rssi: null, up: 0, batches: 0, drops: 0, resets: 0 };
    this.onStatus = () => {};
    this.onFrame = () => {};
    this.onEvent = () => {};           // 'activate' / 'release' events of the DISPLAYED label
    this.lastChange = null;            // performance.now() of the last NEW batch
    this.lastSeq = null;
    this.nextS0 = null;
    this.lastUp = 0;
    this.prevLabel = 'REST';
    this.dev = null;                   // dev/keyboard injection state
    this.stream = null;
    this.timer = null;
    this.frameTimer = null;
    this.latest = this.pipe.out;
  }
  start() {
    this.stop();
    this.stream = this.rtdb.stream(`devices/${this.cfg.deviceId}/raw`, {
      onOpen: () => { this.dbOk = true; this.evaluate(); },
      onError: () => { this.dbOk = false; this.evaluate(); },
      onData: (v) => { this.dbOk = true; this.handleRaw(v); },
    });
    this.timer = setInterval(() => this.evaluate(), 300);
    window.addEventListener('offline', this._off = () => { this.dbOk = false; this.evaluate(); });
    window.addEventListener('online', this._on = () => { if (this.stream) this.stream.reopen(); });
  }
  stop() {
    if (this.stream) this.stream.close();
    if (this.timer) clearInterval(this.timer);
    if (this.frameTimer) clearInterval(this.frameTimer);
    if (this._off) window.removeEventListener('offline', this._off);
    if (this._on) window.removeEventListener('online', this._on);
    this.stream = this.timer = this.frameTimer = null;
  }
  setModel(model) {
    this.model = model;
    this.pipe = new LivePipeline(model, this.cfg.pipeline || {});
    this.nextS0 = null;
    this.latest = this.pipe.out;
  }
  evaluate() {
    const now = performance.now();
    let s;
    if (this.dev) s = 'online';
    else if (this.dbOk === false || (typeof navigator !== 'undefined' && navigator.onLine === false)) s = 'offline';
    else if (this.lastChange === null || now - this.lastChange > ONLINE_MS) s = 'waiting';
    else s = 'online';
    if (s !== this.status) {
      const prev = this.status;
      this.status = s;
      if (s !== 'online' && !this.dev) { this.pipe.reset(); this.nextS0 = null; this.latest = this.pipe.out; this.prevLabel = 'REST'; }
      this.onStatus(s, prev);
    }
  }
  handleRaw(v) {
    if (!v || typeof v !== 'object' || typeof v.b !== 'string' || typeof v.seq !== 'number') return;
    if (this.lastSeq === null) { this.lastSeq = v.seq; this.lastUp = v.up || 0; return; }   // first event = old data, ignore
    if (v.seq === this.lastSeq) return;
    this.lastSeq = v.seq;
    this.lastChange = performance.now();
    this.meta.seq = v.seq; this.meta.rssi = v.rssi ?? null; this.meta.batches++;
    if (this.dev) return;
    const n = Math.min(v.n | 0, 400);
    let samples;
    try { samples = decodeB64Int16(v.b); } catch (e) { return; }
    const have = Math.floor(samples.length / this.pipe.nch);
    const cnt = Math.min(n, have);
    if (!cnt) return;
    const s0 = typeof v.s0 === 'number' ? v.s0 : null;
    const reboot = (v.up || 0) + 2000 < this.lastUp;
    this.lastUp = v.up || 0;
    let skip = 0;
    if (this.nextS0 === null || reboot || v.g === 1 || s0 === null) {
      if (this.nextS0 !== null) { this.meta.resets++; }
      this.pipe.reset(); this.prevLabel = 'REST';
    } else if (s0 < this.nextS0) {
      skip = this.nextS0 - s0;                      // duplicate / overlap: drop the part we already have
      if (skip >= cnt) return;
    } else if (s0 > this.nextS0) {                  // missing samples -> stream no longer continuous
      this.meta.drops += s0 - this.nextS0; this.meta.resets++;
      this.pipe.reset(); this.prevLabel = 'REST';
    }
    const nch = this.pipe.nch;
    this.pipe.push(samples.subarray(skip * nch, cnt * nch), cnt - skip);
    this.nextS0 = (s0 === null ? 0 : s0) + cnt;
    if (s0 === null) this.nextS0 = null;
    this.publish();
  }
  publish() {
    const out = this.pipe.out;
    this.latest = out;
    const prev = this.prevLabel;
    if (out.label !== prev) {
      if (prev === 'REST') this.onEvent({ type: 'activate', finger: out.label, t: performance.now() });
      else if (out.label === 'REST') this.onEvent({ type: 'release', finger: prev, t: performance.now() });
      else this.onEvent({ type: 'switch', finger: out.label, from: prev, t: performance.now() });
      this.prevLabel = out.label;
    }
    this.onFrame(out, { ...this.meta, clip: this.pipe.clip.slice() });
  }

  /* -------- developer / test injection (only reachable with ?dev=1) -------- */
  devStart() {
    if (this.dev) return;
    const classes = this.pipe.classes;
    this.dev = { gate: new RestGate(this.pipe.cooldown, 0.05), raw: 'REST', classes };
    this.lastChange = performance.now();
    this.prevLabel = 'REST';
    this.frameTimer = setInterval(() => this.devTick(), 50);
    this.evaluate();
  }
  devStop() {
    if (!this.dev) return;
    clearInterval(this.frameTimer);
    this.frameTimer = null;
    this.dev = null;
    this.evaluate();
  }
  devSet(rawLabel) { if (this.dev) this.dev.raw = rawLabel; }
  devTick() {
    const d = this.dev;
    if (!d) return;
    this.lastChange = performance.now();
    const label = d.gate.update(d.raw);
    const curl = Object.fromEntries(FINGERS.map((f) => [f, (this.model.fingers[label] || []).includes(f) ? 1 : 0]));
    const probs = Object.fromEntries(d.classes.map((c) => [c, c === label ? 0.97 : 0.03 / Math.max(1, d.classes.length - 1)]));
    this.pipe.out = {
      ready: true, label, rawLabel: d.raw, conf: 0.97, readyIn: d.gate.readyIn(), windows: (this.pipe.out.windows || 0) + 1,
      probs, curl, rms: [40, 40, 40], activity: label === 'REST' ? 1 : 3,
    };
    this.meta.batches++;
    this.publish();
  }
}
