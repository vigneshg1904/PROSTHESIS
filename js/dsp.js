// dsp.js - the finger-detection pipeline, running in the browser.
// A line-by-line port of emg_hand_3ch.py (filters -> 96 features -> linear model -> REST bias ->
// activity floor -> sticky filter -> rest gate). Pure functions, no DOM: it is unit-tested in Node
// against the Python output (see dev/README.md).

export const FINGERS = ['THUMB', 'INDEX', 'MIDDLE', 'RING', 'LITTLE'];
export const FCODE = { THUMB: 'T', INDEX: 'I', MIDDLE: 'M', RING: 'R', LITTLE: 'L' };
export const CODE_FINGER = { T: 'THUMB', I: 'INDEX', M: 'MIDDLE', R: 'RING', L: 'LITTLE' };

const EPS = 1e-6;

/* ------------------------------------------------------------------ IIR filter (cascade of biquads) */
export class SosFilter {
  constructor(sos, zi, nch) {
    this.sos = sos;            // [[b0,b1,b2,a0,a1,a2], ...]
    this.zi = zi;              // steady-state start values per section [[z0,z1], ...]
    this.nch = nch;
    this.reset();
  }
  reset() {
    this.started = false;
    this.z = Array.from({ length: this.nch }, () => this.sos.map(() => [0, 0]));
  }
  // x: array-like of nch raw samples. Writes filtered values into out. The very first sample sets the
  // filter state to its steady state (same as scipy's sosfilt_zi trick used in the Python tools).
  process(x, out) {
    if (!this.started) {
      for (let c = 0; c < this.nch; c++) {
        for (let s = 0; s < this.sos.length; s++) {
          this.z[c][s][0] = this.zi[s][0] * x[c];
          this.z[c][s][1] = this.zi[s][1] * x[c];
        }
      }
      this.started = true;
    }
    for (let c = 0; c < this.nch; c++) {
      let v = x[c];
      for (let s = 0; s < this.sos.length; s++) {
        const k = this.sos[s];
        const z = this.z[c][s];
        const y = k[0] * v + z[0];
        z[0] = k[1] * v - k[4] * y + z[1];
        z[1] = k[2] * v - k[5] * y;
        v = y;
      }
      out[c] = v;
    }
    return out;
  }
}

/* ------------------------------------------------------------------ features */
const tableCache = new Map();
function tables(n, fs) {
  const key = n + ':' + fs;
  let t = tableCache.get(key);
  if (t) return t;
  const hann = new Float64Array(n);
  for (let k = 0; k < n; k++) hann[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1));
  const nb = Math.floor(n / 2) + 1;
  const cosT = new Float64Array(nb * n);
  const sinT = new Float64Array(nb * n);
  for (let k = 0; k < nb; k++) {
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * ((k * i) % n)) / n;
      cosT[k * n + i] = Math.cos(a);
      sinT[k * n + i] = Math.sin(a);
    }
  }
  const freqs = new Float64Array(nb);
  for (let k = 0; k < nb; k++) freqs[k] = (k * fs) / n;
  t = { hann, nb, cosT, sinT, freqs };
  tableCache.set(key, t);
  return t;
}

const BANDS = [[20, 45], [55, 80], [80, 110], [110, 150], [150, 200], [200, 250]];

function arCoeffs(x, order) {
  // least squares of x[t] on x[t-1..t-order] (normal equations, 4x4)
  const n = x.length, m = n - order;
  const A = Array.from({ length: order }, () => new Float64Array(order));
  const b = new Float64Array(order);
  for (let t = order; t < n; t++) {
    for (let i = 0; i < order; i++) {
      const xi = x[t - 1 - i];
      b[i] += xi * x[t];
      for (let j = 0; j < order; j++) A[i][j] += xi * x[t - 1 - j];
    }
  }
  let tr = 0;
  for (let i = 0; i < order; i++) tr += A[i][i];
  for (let i = 0; i < order; i++) A[i][i] += 1e-12 * (tr || 1);
  // gaussian elimination with partial pivoting
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < order; c++) {
    let p = c;
    for (let r = c + 1; r < order; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-30;
    for (let r = c + 1; r < order; r++) {
      const f = M[r][c] / d;
      for (let k = c; k <= order; k++) M[r][k] -= f * M[c][k];
    }
  }
  const sol = new Float64Array(order);
  for (let i = order - 1; i >= 0; i--) {
    let s = M[i][order];
    for (let j = i + 1; j < order; j++) s -= M[i][j] * sol[j];
    sol[i] = s / (M[i][i] || 1e-30);
  }
  void m;
  return sol;
}

// 28 features of ONE channel window (Float64Array / array of n filtered samples)
export function channelFeatures(win, thr, fs, out) {
  const n = win.length;
  const x = new Float64Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += win[i];
  mean /= n;
  for (let i = 0; i < n; i++) x[i] = win[i] - mean;
  const d = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) d[i] = x[i + 1] - x[i];

  let sabs = 0, ssq = 0, wl = 0;
  for (let i = 0; i < n; i++) { sabs += Math.abs(x[i]); ssq += x[i] * x[i]; }
  for (let i = 0; i < n - 1; i++) wl += Math.abs(d[i]);
  const mav = sabs / n, rms = Math.sqrt(ssq / n);

  let zc = 0, ssc = 0;
  for (let i = 0; i < n - 1; i++) if (x[i] * x[i + 1] < 0 && Math.abs(d[i]) >= thr) zc++;
  for (let i = 0; i < n - 2; i++) {
    if (d[i] * d[i + 1] < 0 && (Math.abs(d[i]) >= thr || Math.abs(d[i + 1]) >= thr)) ssc++;
  }
  const variance = (a) => {
    let m = 0;
    for (let i = 0; i < a.length; i++) m += a[i];
    m /= a.length;
    let v = 0;
    for (let i = 0; i < a.length; i++) v += (a[i] - m) * (a[i] - m);
    return v / a.length;
  };
  const dd = new Float64Array(n - 2);
  for (let i = 0; i < n - 2; i++) dd[i] = d[i + 1] - d[i];
  const var0 = variance(x) + EPS, var1 = variance(d) + EPS, var2 = variance(dd) + EPS;
  const mobility = Math.sqrt(var1 / var0);
  const complexity = Math.sqrt(var2 / var1) / mobility;
  // np.std(x) + eps, x already mean-free (population std)
  const s = Math.sqrt(ssq / n) + EPS;
  let sk = 0, ku = 0;
  for (let i = 0; i < n; i++) { const z = x[i] / s; sk += z * z * z; ku += z * z * z * z; }
  sk /= n; ku /= n;

  // spectrum (Hann window, direct DFT - n is 125, so no power-of-two FFT)
  const T = tables(n, fs);
  const spec = new Float64Array(T.nb);
  const xw = new Float64Array(n);
  for (let i = 0; i < n; i++) xw[i] = x[i] * T.hann[i];
  for (let k = 0; k < T.nb; k++) {
    let re = 0, im = 0;
    const o = k * n;
    for (let i = 0; i < n; i++) { re += xw[i] * T.cosT[o + i]; im -= xw[i] * T.sinT[o + i]; }
    spec[k] = re * re + im * im;
  }
  const bp = new Float64Array(6);
  let bsum = 0;
  for (let b = 0; b < 6; b++) {
    let acc = 0;
    for (let k = 0; k < T.nb; k++) if (T.freqs[k] >= BANDS[b][0] && T.freqs[k] < BANDS[b][1]) acc += spec[k];
    bp[b] = acc + EPS;
    bsum += bp[b];
  }
  let sp = 0, sfp = 0, peakI = -1, peakV = -Infinity;
  const fl = [], pl = [];
  for (let k = 0; k < T.nb; k++) {
    if (T.freqs[k] >= 20) {
      const p = spec[k] + EPS;
      fl.push(T.freqs[k]); pl.push(p);
      sp += p; sfp += T.freqs[k] * p;
      if (p > peakV) { peakV = p; peakI = fl.length - 1; }
    }
  }
  const mnf = sfp / sp;
  let cum = 0, mdf = fl[fl.length - 1];
  const half = sp / 2;
  for (let i = 0; i < pl.length; i++) { cum += pl[i]; if (cum >= half) { mdf = fl[i]; break; } }
  const peak = fl[peakI];
  const ar = arCoeffs(x, 4);

  let o = 0;
  out[o++] = Math.log(mav + EPS); out[o++] = Math.log(rms + EPS); out[o++] = Math.log(wl + EPS);
  out[o++] = zc; out[o++] = ssc; out[o++] = mobility; out[o++] = complexity; out[o++] = sk; out[o++] = ku;
  out[o++] = mnf; out[o++] = mdf; out[o++] = peak;
  for (let b = 0; b < 6; b++) out[o++] = Math.log(bp[b]);
  for (let b = 0; b < 6; b++) out[o++] = bp[b] / bsum;
  for (let i = 0; i < 4; i++) out[o++] = ar[i];
  return out;
}

// win: array of nch Float64Array windows -> Float64Array(nf*nch + 3*pairs + nch)
export function extractFeatures(wins, thr, fs, nf) {
  const nch = wins.length;
  const per = wins.map((w, c) => channelFeatures(w, thr[c], fs, new Float64Array(nf)));
  const pairs = [];
  for (let i = 0; i < nch; i++) for (let j = i + 1; j < nch; j++) pairs.push([i, j]);
  const out = new Float64Array(nf * nch + 3 * pairs.length + nch);
  let o = 0;
  for (const p of per) for (let i = 0; i < nf; i++) out[o++] = p[i];
  for (const [i, j] of pairs) {
    const a = wins[i], b = wins[j];
    const n = a.length;
    let ma = 0, mb = 0;
    for (let k = 0; k < n; k++) { ma += a[k]; mb += b[k]; }
    ma /= n; mb /= n;
    let dot = 0, na = 0, nb = 0;
    for (let k = 0; k < n; k++) { const u = a[k] - ma, v = b[k] - mb; dot += u * v; na += u * u; nb += v * v; }
    const corr = dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
    out[o++] = per[j][1] - per[i][1];
    out[o++] = corr;
    out[o++] = per[j][9] - per[i][9];
  }
  let rsum = 0;
  const rms = per.map((p) => Math.exp(p[1]));
  for (const v of rms) rsum += v;
  rsum = Math.max(rsum, 1e-9);
  for (let c = 0; c < nch; c++) out[o++] = rms[c] / rsum;
  return out;
}

/* ------------------------------------------------------------------ linear model (LDA / logistic regression) */
export class LinearModel {
  constructor(m) {
    this.classes = m.classes;
    this.mean = Float64Array.from(m.scaler.mean);
    this.scale = Float64Array.from(m.scaler.scale);
    this.coef = m.linear.coef.map((r) => Float64Array.from(r));
    this.intercept = Float64Array.from(m.linear.intercept);
    this.nFeat = this.mean.length;
  }
  proba(feat, out) {
    const K = this.classes.length;
    out = out || new Float64Array(K);
    const z = new Float64Array(this.nFeat);
    for (let i = 0; i < this.nFeat; i++) z[i] = (feat[i] - this.mean[i]) / this.scale[i];
    let mx = -Infinity;
    for (let k = 0; k < K; k++) {
      let s = this.intercept[k];
      const c = this.coef[k];
      for (let i = 0; i < this.nFeat; i++) s += c[i] * z[i];
      out[k] = s;
      if (s > mx) mx = s;
    }
    let sum = 0;
    for (let k = 0; k < K; k++) { out[k] = Math.exp(out[k] - mx); sum += out[k]; }
    for (let k = 0; k < K; k++) out[k] /= sum;
    return out;
  }
}

/* ------------------------------------------------------------------ steady display */
export class StickyFilter {
  constructor(n, restIdx, pStay, beta, tau) {
    this.n = n; this.p = pStay; this.beta = beta; this.tau = tau;
    this.a = new Float64Array(n).fill(1 / n);
    if (restIdx !== null && restIdx >= 0) {
      this.a[restIdx] = 0.5;
      let s = 0;
      for (const v of this.a) s += v;
      for (let i = 0; i < n; i++) this.a[i] /= s;
    }
    this.label = null;
  }
  step(q) {
    const n = this.n, a = this.a;
    let s = 0;
    for (let i = 0; i < n; i++) {
      const pred = this.p * a[i] + ((1 - this.p) * (1 - a[i])) / Math.max(n - 1, 1);
      a[i] = pred * Math.pow(q[i] + 1e-4, this.beta);
      s += a[i];
    }
    let best = 0;
    for (let i = 0; i < n; i++) { a[i] /= s; if (a[i] > a[best]) best = i; }
    if (this.label === null) this.label = best;
    else if (best !== this.label && a[best] >= this.tau) this.label = best;
    return this.label;
  }
}

export class RestGate {
  constructor(cooldown, dt) {
    this.cooldown = Math.max(0, cooldown);
    this.dt = dt;
    this.restRun = 0;
    this.label = null;
  }
  update(raw) {
    const prev = this.restRun;
    this.restRun = raw === 'REST' ? this.restRun + this.dt : 0;
    if (this.label === null) this.label = raw;
    else if (raw !== this.label) {
      if (raw === 'REST') this.label = 'REST';
      else if (this.label === 'REST' && prev >= this.cooldown) this.label = raw;
    }
    return this.label;
  }
  readyIn() { return Math.max(0, this.cooldown - this.restRun); }
}

/* ------------------------------------------------------------------ the live pipeline */
export class LivePipeline {
  constructor(model, opts = {}) {
    this.m = model;
    this.fs = model.fs; this.win = model.win; this.step = model.step; this.nch = model.n_ch; this.nf = model.nf;
    this.lin = new LinearModel(model);
    this.classes = model.classes;
    this.K = this.classes.length;
    this.restIdx = this.classes.indexOf('REST');
    const d = Object.assign({}, model.defaults || {}, opts);
    this.restBias = d.rest_bias ?? 2;
    this.activityFloor = d.activity_floor ?? 1.15;
    this.cooldown = d.cooldown ?? 1.0;
    this.steadyName = d.steady ?? 'normal';
    this.vote = d.vote ?? 8;
    this.thr = model.thr.slice();
    this.ref = model.thr.slice();           // reference rest noise for the activity floor (can be re-calibrated)
    this.weights = {};
    for (const c of this.classes) {
      const fs = model.fingers[c] || [];
      this.weights[c] = Object.fromEntries(FINGERS.map((f) => [f, fs.length ? (fs.includes(f) ? 1 / 1 : 0) : 0]));
    }
    this.filt = new SosFilter(model.sos, model.zi, this.nch);
    this.reset();
  }
  reset() {
    this.filt.reset();
    this.buf = Array.from({ length: this.nch }, () => new Float64Array(this.win));
    this.count = 0;       // samples seen since reset
    this.since = 0;
    const [p, b, t] = this.m.steady[this.steadyName];
    this.sticky = new StickyFilter(this.K, this.restIdx, p, b, t);
    this.gate = new RestGate(this.cooldown, this.step / this.fs);
    this.recent = [];     // last `vote` probability rows
    this.out = this.blank();
    this.calib = null;
    this.tmp = new Float64Array(this.nch);
    this.clip = new Array(this.nch).fill(false);
  }
  blank() {
    return {
      ready: false, label: 'REST', rawLabel: 'REST', conf: 0, readyIn: this.cooldown, windows: 0,
      probs: Object.fromEntries(this.classes.map((c) => [c, c === 'REST' ? 1 : 0])),
      curl: Object.fromEntries(FINGERS.map((f) => [f, 0])), rms: new Array(this.nch).fill(0), activity: 0,
    };
  }
  // start collecting window RMS values while the hand is relaxed to learn today's resting noise
  startCalibration() { this.calib = []; }
  finishCalibration() {
    const c = this.calib;
    this.calib = null;
    if (!c || c.length < 20) return false;
    for (let ch = 0; ch < this.nch; ch++) {
      const v = c.map((r) => r[ch]).sort((a, b) => a - b);
      const med = v[Math.floor(v.length / 2)];
      this.ref[ch] = Math.min(Math.max(med, 0.5 * this.thr[ch]), 2 * this.thr[ch]);
    }
    return true;
  }
  // raw: Int16Array / array, interleaved ch1,ch2,ch3 per sample. Returns number of new decisions.
  push(raw, nSamples) {
    let decisions = 0;
    const nch = this.nch, x = this.tmp, y = new Float64Array(nch);
    const lo = new Array(nch).fill(Infinity), hi = new Array(nch).fill(-Infinity);
    for (let i = 0; i < nSamples; i++) {
      for (let c = 0; c < nch; c++) {
        x[c] = raw[i * nch + c];
        if (x[c] < lo[c]) lo[c] = x[c];
        if (x[c] > hi[c]) hi[c] = x[c];
      }
      this.filt.process(x, y);
      const pos = this.count % this.win;
      for (let c = 0; c < nch; c++) this.buf[c][pos] = y[c];
      this.count++;
      this.since++;
      if (this.count < this.fs || this.count < this.win || this.since < this.step) continue;
      this.since = 0;
      this.decide();
      decisions++;
    }
    for (let c = 0; c < nch; c++) this.clip[c] = lo[c] <= 5 || hi[c] >= 4090;
    return decisions;
  }
  windowOf(c) {          // chronological copy of the last `win` samples of channel c
    const w = new Float64Array(this.win);
    const end = this.count % this.win;
    for (let i = 0; i < this.win; i++) w[i] = this.buf[c][(end + i) % this.win];
    return w;
  }
  decide() {
    const wins = [];
    for (let c = 0; c < this.nch; c++) wins.push(this.windowOf(c));
    const feat = extractFeatures(wins, this.thr, this.fs, this.nf);
    const P = this.lin.proba(feat);
    if (this.restBias !== 1 && this.restIdx >= 0) P[this.restIdx] *= this.restBias;
    const rms = [];
    for (let c = 0; c < this.nch; c++) rms.push(Math.exp(feat[c * this.nf + 1]));
    if (this.calib) this.calib.push(rms.slice());
    let activity = 0;
    for (let c = 0; c < this.nch; c++) activity = Math.max(activity, rms[c] / Math.max(this.ref[c], 1e-9));
    if (this.activityFloor > 1 && this.restIdx >= 0 && activity < this.activityFloor) {
      P.fill(0);
      P[this.restIdx] = 1;
    }
    let s = 0;
    for (let k = 0; k < this.K; k++) s += P[k];
    if (s === 0) s = 1;
    for (let k = 0; k < this.K; k++) P[k] /= s;

    this.recent.push(Float64Array.from(P));
    if (this.recent.length > this.vote) this.recent.shift();
    const raw = this.classes[this.sticky.step(P)];
    const label = this.gate.update(raw);

    const avg = new Float64Array(this.K);
    for (const r of this.recent) for (let k = 0; k < this.K; k++) avg[k] += r[k] / this.recent.length;
    const probs = {};
    this.classes.forEach((c, k) => { probs[c] = avg[k]; });
    const curl = {};
    for (const f of FINGERS) {
      let v = 0;
      for (const c of this.classes) if ((this.m.fingers[c] || []).includes(f)) v += probs[c] / Math.max(1, 1);
      curl[f] = Math.min(1, v);
    }
    this.out = {
      ready: true, label, rawLabel: raw, conf: probs[label] ?? 0, readyIn: this.gate.readyIn(),
      windows: this.out.windows + 1, probs, curl, rms, activity,
    };
  }
}
