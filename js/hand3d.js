// hand3d.js - a small 3D hand (no libraries): finger bones, joints, hologram palm, perspective projection.
import { FINGER_COLOR, lerp, clamp } from './util.js';

const ORDER = ['LITTLE', 'RING', 'MIDDLE', 'INDEX', 'THUMB'];
const LETTER = { THUMB: 'T', INDEX: 'I', MIDDLE: 'M', RING: 'R', LITTLE: 'L' };
// segment lengths (palm units), base position on the palm edge
const SPEC = {
  LITTLE: { base: [-1.55, 1.9, 0], seg: [0.95, 0.65, 0.55], w: 0.30 },
  RING: { base: [-0.52, 2.1, 0], seg: [1.25, 0.85, 0.65], w: 0.34 },
  MIDDLE: { base: [0.52, 2.15, 0], seg: [1.4, 0.95, 0.7], w: 0.35 },
  INDEX: { base: [1.55, 2.0, 0], seg: [1.2, 0.85, 0.65], w: 0.34 },
  THUMB: { base: [2.0, -1.0, 0], seg: [1.05, 0.85, 0.7], w: 0.38 },
};
const BEND = [1.25, 1.55, 1.0];       // radians at full curl for the three joints

function rotX(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c]; }
function rotY(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; }
function rotZ(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]]; }

export class Hand3D {
  constructor(canvas, opts = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.labels = opts.labels !== false;
    this.auto = opts.auto !== false;
    this.cur = { THUMB: 0, INDEX: 0, MIDDLE: 0, RING: 0, LITTLE: 0 };
    this.tgt = { ...this.cur };
    this.targets = new Set();
    this.yaw = 0.35; this.pitch = -0.18;
    this.dragYaw = 0; this.dragPitch = 0;
    this.raf = null; this.t0 = performance.now();
    this.quality = opts.quality || 1;
    this._bind();
  }
  _bind() {
    let down = null;
    const c = this.cv;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, yaw: this.dragYaw, pitch: this.dragPitch }; c.setPointerCapture?.(e.pointerId); });
    c.addEventListener('pointermove', (e) => {
      if (!down) return;
      this.dragYaw = clamp(down.yaw + (e.clientX - down.x) * 0.008, -1.2, 1.2);
      this.dragPitch = clamp(down.pitch + (e.clientY - down.y) * 0.006, -0.6, 0.6);
    });
    const up = () => { down = null; };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
  }
  setCurl(curl) { for (const f of Object.keys(this.tgt)) if (curl && typeof curl[f] === 'number') this.tgt[f] = clamp(curl[f], 0, 1); }
  setTargets(list) { this.targets = new Set(list || []); }
  start() { if (!this.raf) { this.raf = requestAnimationFrame((t) => this.frame(t)); } }
  stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = null; }
  resize() {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.quality;
    this.cv.width = Math.max(10, Math.round(r.width * dpr));
    this.cv.height = Math.max(10, Math.round(r.height * dpr));
    this.dpr = dpr;
  }
  frame(now) {
    this.raf = requestAnimationFrame((t) => this.frame(t));
    if (this.cv.width < 20 || this.cv.clientWidth === 0) { this.resize(); return; }
    if (this.cv.width !== Math.round(this.cv.clientWidth * this.dpr)) this.resize();
    for (const f of Object.keys(this.cur)) this.cur[f] += (this.tgt[f] - this.cur[f]) * 0.28;
    this.draw((now - this.t0) / 1000);
  }
  project(p, W, H, scale) {
    const f = 9;
    const k = f / (f + p[2] * 0.55);
    return [W / 2 + p[0] * scale * k, H * 0.60 - p[1] * scale * k, k, p[2]];
  }
  transform(p) {
    const t = (performance.now() - this.t0) / 1000;
    const sway = this.auto ? Math.sin(t * 0.55) * 0.28 : 0;
    let q = rotY(p, this.yaw + sway + this.dragYaw);
    q = rotX(q, this.pitch + this.dragPitch);
    return q;
  }
  fingerPoints(name) {
    const sp = SPEC[name];
    const c = this.cur[name];
    const pts = [sp.base.slice()];
    let dir;
    let ang = 0;
    for (let i = 0; i < 3; i++) {
      if (name === 'THUMB') {
        const a = 0.55 + c * BEND[i] * 0.55;                 // swing across the palm
        const lift = c * BEND[i] * 0.45;                     // and toward the viewer
        ang += i === 0 ? 0 : 0;
        dir = rotX(rotZ([0, 1, 0], -a * (i + 1) * 0.55 + 0.1), -lift * (i + 1) * 0.6);
        dir = rotZ(dir, 0.0);
      } else {
        ang += c * BEND[i];
        dir = rotX([0, 1, 0], -ang);                         // curl toward the viewer (+z)
        dir = [dir[0], dir[1], -dir[2]];
      }
      const p = pts[pts.length - 1];
      pts.push([p[0] + dir[0] * sp.seg[i], p[1] + dir[1] * sp.seg[i], p[2] + dir[2] * sp.seg[i]]);
    }
    return pts;
  }
  draw(t) {
    const ctx = this.ctx, W = this.cv.width, H = this.cv.height;
    ctx.clearRect(0, 0, W, H);
    const scale = Math.min(W / 7.8, H / 9.6);
    const P = (p) => this.project(this.transform(p), W, H, scale);

    // hologram base ring
    ctx.save();
    ctx.strokeStyle = 'rgba(25,227,255,0.18)';
    ctx.lineWidth = Math.max(1, scale * 0.02);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      for (let a = 0; a <= 64; a++) {
        const th = (a / 64) * Math.PI * 2;
        const q = P([Math.cos(th) * (3.6 + i * 0.5), -3.3, Math.sin(th) * (3.6 + i * 0.5) * 0.8]);
        if (a === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
      }
      ctx.stroke();
    }
    ctx.restore();

    // palm
    const palm = [[-2.1, 2.0, 0], [2.1, 2.1, 0], [2.3, -1.4, 0], [1.2, -2.7, 0], [-1.2, -2.7, 0], [-2.1, -1.2, 0]].map(P);
    ctx.beginPath();
    palm.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
    ctx.closePath();
    const g = ctx.createLinearGradient(0, palm[0][1], 0, palm[3][1]);
    g.addColorStop(0, 'rgba(25,227,255,0.16)'); g.addColorStop(1, 'rgba(61,255,181,0.05)');
    ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = 'rgba(25,227,255,0.7)'; ctx.lineWidth = Math.max(1, scale * 0.035); ctx.stroke();
    // palm circuit lines
    ctx.strokeStyle = 'rgba(61,255,181,0.35)'; ctx.lineWidth = Math.max(1, scale * 0.02);
    for (const [a, b] of [[[-1.4, 1.2, 0], [-1.4, -1.8, 0]], [[0, 1.4, 0], [0, -2.2, 0]], [[1.2, 1.1, 0], [1.2, -1.2, 0]], [[-1.8, -0.4, 0], [1.9, -0.4, 0]]]) {
      const p1 = P(a), p2 = P(b);
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
    }
    // wrist
    const w1 = P([-1.1, -2.7, 0]), w2 = P([1.1, -2.7, 0]), w3 = P([1.0, -3.6, 0]), w4 = P([-1.0, -3.6, 0]);
    ctx.beginPath(); ctx.moveTo(w1[0], w1[1]); ctx.lineTo(w2[0], w2[1]); ctx.lineTo(w3[0], w3[1]); ctx.lineTo(w4[0], w4[1]); ctx.closePath();
    ctx.strokeStyle = 'rgba(25,227,255,0.35)'; ctx.stroke();

    // fingers sorted far -> near
    const items = ORDER.map((name) => {
      const pts = this.fingerPoints(name).map(P);
      const depth = pts.reduce((s, q) => s + q[3], 0) / pts.length;
      return { name, pts, depth };
    }).sort((a, b) => b.depth - a.depth);

    for (const it of items) {
      const col = FINGER_COLOR[it.name];
      const curl = this.cur[it.name];
      const active = curl > 0.55;
      const isTarget = this.targets.has(it.name);
      const sp = SPEC[it.name];
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 0; i < 3; i++) {
        const a = it.pts[i], b = it.pts[i + 1];
        const wpx = Math.max(2, sp.w * scale * 0.5 * (a[2] + b[2]));
        ctx.strokeStyle = active ? col : 'rgba(150,215,240,0.55)';
        ctx.globalAlpha = active ? 0.95 : 0.8;
        ctx.shadowColor = active ? col : 'rgba(25,227,255,0.4)';
        ctx.shadowBlur = active ? wpx * 1.6 : wpx * 0.5;
        ctx.lineWidth = wpx;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      // joints
      for (let i = 0; i < 4; i++) {
        const q = it.pts[i];
        ctx.fillStyle = i === 3 ? (active ? col : '#bff6ff') : '#082030';
        ctx.strokeStyle = active ? col : 'rgba(25,227,255,0.8)';
        ctx.lineWidth = Math.max(1, scale * 0.025);
        ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(2, scale * (i === 3 ? 0.17 : 0.1) * q[2]), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      // target pulse
      if (isTarget) {
        const tip = it.pts[3];
        const ph = (t * 1.4) % 1;
        ctx.strokeStyle = col; ctx.globalAlpha = 1 - ph; ctx.lineWidth = Math.max(2, scale * 0.05);
        ctx.beginPath(); ctx.arc(tip[0], tip[1], scale * (0.3 + ph * 0.7), 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (this.labels) {
        const tip = it.pts[3];
        ctx.fillStyle = active || isTarget ? col : 'rgba(190,235,255,0.75)';
        ctx.font = `700 ${Math.round(scale * 0.34)}px Orbitron, Rajdhani, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(LETTER[it.name], tip[0], tip[1] - scale * 0.5);
      }
      ctx.restore();
    }
  }
}

export { LETTER };
void lerp;
