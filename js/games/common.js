// games/common.js - shared helpers for the five games.
import { FINGER_COLOR } from '../util.js';

export const W = 960, H = 540;                       // logical stage size; the canvas is scaled to fit
export const FINGERS = ['THUMB', 'INDEX', 'MIDDLE', 'RING', 'LITTLE'];
export const LETTER = { THUMB: 'T', INDEX: 'I', MIDDLE: 'M', RING: 'R', LITTLE: 'L' };
export const NAME = { THUMB: 'Thumb', INDEX: 'Index', MIDDLE: 'Middle', RING: 'Ring', LITTLE: 'Little' };
export const FONT_HEAD = '"Orbitron","Rajdhani","Segoe UI",sans-serif';
export const FONT_BODY = '"Rajdhani","Segoe UI",system-ui,sans-serif';
export const FONT_MONO = '"Share Tech Mono","Consolas",monospace';
export const INK = '#d9f4ff', MUTED = '#6b8ba3', CYAN = '#19e3ff', MINT = '#3dffb5', RED = '#ff3d71', AMBER = '#ffc233';
export { FINGER_COLOR };

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function text(ctx, str, x, y, { size = 20, color = INK, align = 'left', font = FONT_BODY, weight = 600, glow = 0, base = 'alphabetic' } = {}) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.textAlign = align; ctx.textBaseline = base;
  ctx.fillStyle = color;
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
  ctx.fillText(str, x, y);
  ctx.restore();
}

export function panel(ctx, x, y, w, h, { fill = 'rgba(6,24,40,0.72)', stroke = 'rgba(25,227,255,0.45)', r = 14, lw = 1.5 } = {}) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke();
  ctx.restore();
}

export function bar(ctx, x, y, w, h, frac, color = CYAN, back = 'rgba(25,227,255,0.12)') {
  frac = Math.max(0, Math.min(1, frac));
  ctx.save();
  roundRect(ctx, x, y, w, h, h / 2); ctx.fillStyle = back; ctx.fill();
  if (frac > 0.001) { roundRect(ctx, x, y, Math.max(h, w * frac), h, h / 2); ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 10; ctx.fill(); }
  ctx.restore();
}

export function ring(ctx, cx, cy, r, frac, color, lw = 8) {
  ctx.save();
  ctx.lineWidth = lw; ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(25,227,255,0.15)';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  if (frac > 0.001) {
    ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, frac)); ctx.stroke();
  }
  ctx.restore();
}

// "ready" chip that tells the player whether the next finger will register (rest gate)
export function readiness(ctx, input) {
  // always bottom-right: clear of the finger pads and of every game's own text
  const x = W - 144, y = H - 54, w = 128;
  const wait = input.readyIn || 0;
  let label, color;
  if (!input.isRest) { label = 'ACTIVE'; color = MINT; }
  else if (wait > 0.04) { label = `RELAX ${wait.toFixed(1)}s`; color = AMBER; }
  else { label = 'READY'; color = CYAN; }
  panel(ctx, x, y, w, 34, { stroke: color, fill: 'rgba(6,24,40,0.85)', r: 17 });
  ctx.save();
  ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 8;
  ctx.beginPath(); ctx.arc(x + 18, y + 17, 5.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  text(ctx, label, x + 32, y + 23, { size: 15, color, font: FONT_HEAD, weight: 700 });
}

export function hudTop(ctx, left, right) {
  text(ctx, left, 28, 40, { size: 24, font: FONT_HEAD, weight: 700, color: CYAN, glow: 8 });
  text(ctx, right, W - 28, 40, { size: 24, font: FONT_HEAD, weight: 700, color: INK, align: 'right' });
}

export function floatText(list, str, x, y, color) { list.push({ str, x, y, color, born: null }); }

export function drawFloats(ctx, list, now) {
  for (let i = list.length - 1; i >= 0; i--) {
    const f = list[i];
    if (f.born === null) f.born = now;
    const age = now - f.born;
    if (age > 1.1) { list.splice(i, 1); continue; }
    ctx.save();
    ctx.globalAlpha = 1 - age / 1.1;
    text(ctx, f.str, f.x, f.y - age * 46, { size: 26, color: f.color, font: FONT_HEAD, weight: 700, align: 'center', glow: 10 });
    ctx.restore();
  }
}

// five finger pads at the bottom (live feedback of what the system sees)
export function drawPads(ctx, input, y = 462, hl = {}) {
  const gap = 150, x0 = W / 2 - gap * 2;
  FINGERS.forEach((f, i) => {
    const x = x0 + i * gap;
    const on = input.finger === f;
    const col = FINGER_COLOR[f];
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, on ? 36 : 30, 0, Math.PI * 2);
    ctx.fillStyle = on ? col : 'rgba(6,24,40,0.85)'; ctx.globalAlpha = on ? 0.9 : 1;
    ctx.shadowColor = col; ctx.shadowBlur = on ? 26 : (hl[f] ? 18 : 0);
    ctx.fill();
    ctx.globalAlpha = 1; ctx.lineWidth = hl[f] ? 4 : 2; ctx.strokeStyle = col; ctx.stroke();
    ctx.restore();
    text(ctx, LETTER[f], x, y + 8, { size: 24, font: FONT_HEAD, weight: 800, align: 'center', color: on ? '#04101a' : col });
    text(ctx, NAME[f], x, y + 58, { size: 15, color: MUTED, align: 'center' });
  });
}
