// Game 2 - PICK & PLACE: grip the block with the coloured finger, carry it (hold 1 s), then relax to drop it in the bin.
import { W, H, FINGERS, LETTER, NAME, FINGER_COLOR, FONT_HEAD, INK, MUTED, MINT, RED, AMBER, CYAN, roundRect, text, panel, ring, bar, readiness, hudTop, drawPads, drawFloats, floatText } from './common.js';
import { shuffle } from '../util.js';

const DURATION = 60, CARRY = 1.0, GRACE = 0.35, GRIP_TIMEOUT = 10, GAP_NEXT = 0.6;

export const meta = {
  id: 'pickplace',
  title: 'Pick & Place',
  tag: 'Gripping · Holding · Releasing',
  icon: '<svg viewBox="0 0 48 48"><rect x="6" y="26" width="14" height="14" rx="2"/><rect x="28" y="30" width="14" height="10" rx="2"/><path d="M13 22V10m0 0l-4 4m4-4l4 4M30 14h10m0 0l-4-4m4 4l-4 4"/></svg>',
  blurb: 'Move as many blocks as you can in 60 seconds.',
  objective: 'Each block belongs to one finger. Grip it with that finger, hold the grip to carry it across, then relax to release it into the bin.',
  steps: [
    'The block shows which finger to use (its colour and letter).',
    'Curl that finger to GRIP the block, then keep it curled for 1 second to CARRY it.',
    'RELAX your hand to RELEASE the block into the bin. That counts one block.',
    'Letting go early drops the block; the wrong finger is a miss-grip. Relax and try again.',
  ],
  scoring: '100 per block, +20 for a quick release, −15 per drop, −10 per wrong finger.',
  trains: 'Gripping, Holding and Releasing: the full grasp cycle, like the Box and Block test.',
  duration: '1 minute',
  options: null,
};

export function create(host) {
  const rnd = host.rng;
  let bag = [];
  const nextFinger = (prev) => {
    if (!bag.length) bag = shuffle(FINGERS, rnd);
    let f = bag.shift();
    if (f === prev && bag.length) { bag.push(f); f = bag.shift(); }
    return f;
  };
  const g = {
    done: false, score: 0, blocks: 0, drops: 0, missgrips: 0, skipped: 0, floats: [], quickReleases: 0,
    phase: 'wait_grip', target: null, spawnAt: 0, gripAt: 0, held: 0, lost: 0, releaseAt: 0, nextAt: 0, carryProg: 0, binFlash: -9,
  };
  g.target = nextFinger(null);
  g.spawnAt = 0.4;
  host.setTargets([g.target]);

  const nextBlock = (now) => {
    const prev = g.target;
    g.target = nextFinger(prev);
    g.phase = 'wait_grip'; g.spawnAt = now; g.held = 0; g.lost = 0; g.carryProg = 0;
    host.setTargets([g.target]);
  };

  g.update = (now, input, dt) => {
    if (now >= DURATION) { g.done = true; host.setTargets([]); return; }
    if (g.phase === 'next') {
      // the next block appears once your hand has been relaxed long enough for the next finger to register
      if (now >= g.nextAt && ((input.isRest && input.readyIn <= 0.05) || now - g.nextAt > 6)) nextBlock(now);
    } else if (g.phase === 'wait_grip') {
      if (now - g.spawnAt > GRIP_TIMEOUT) {
        g.skipped++;
        host.log({ kind: 'activation', target: g.target, detected: null, ok: false });
        floatText(g.floats, 'TIMEOUT', W / 2, 230, AMBER);
        nextBlock(now);
      }
    } else if (g.phase === 'carry') {
      if (input.finger === g.target) { g.held += dt; g.lost = 0; }
      else {
        g.lost += dt;
        if (g.lost > GRACE) {
          g.drops++; g.score -= 15;
          host.log({ kind: 'carry', target: g.target, ok: false });
          host.sfx.bad(); floatText(g.floats, 'DROPPED', W / 2, 230, RED);
          g.phase = 'wait_grip'; g.spawnAt = now; g.held = 0; g.lost = 0; g.carryProg = 0;
        }
      }
      g.carryProg = Math.min(1, g.held / CARRY);
      if (g.phase === 'carry' && g.held >= CARRY) {
        host.log({ kind: 'carry', target: g.target, ok: true });
        host.log({ kind: 'hold', target: g.target, streakMs: Math.round(g.held * 1000), stability: 1, breaks: 0, ok: true });
        g.phase = 'release'; g.releaseAt = now; host.sfx.ok(); host.setTargets([]);
      }
    } else if (g.phase === 'release') {
      g.carryProg = 1;
      if (input.isRest) {
        const lat = (now - g.releaseAt) * 1000;
        host.log({ kind: 'release', latencyMs: Math.round(lat) });
        g.blocks++; g.score += 100;
        const quick = lat < 1500;
        if (quick) { g.score += 20; g.quickReleases++; }
        g.binFlash = now; host.sfx.finger(g.target);
        floatText(g.floats, quick ? '+120' : '+100', W - 210, 250, MINT);
        g.phase = 'next'; g.nextAt = now + GAP_NEXT;
      }
    }
  };

  g.onEvent = (ev, now) => {
    if (ev.type !== 'activate' && ev.type !== 'switch') return;
    if (!FINGERS.includes(ev.finger)) return;
    if (g.phase === 'wait_grip') {
      if (ev.finger === g.target) {
        host.log({ kind: 'activation', target: g.target, detected: ev.finger, ok: true, rtMs: Math.round((now - g.spawnAt) * 1000) });
        g.phase = 'carry'; g.held = 0; g.lost = 0; g.gripAt = now;
        host.sfx.finger(ev.finger);
      } else {
        g.missgrips++; g.score -= 10;
        host.log({ kind: 'activation', target: g.target, detected: ev.finger, ok: false });
        host.sfx.bad(); floatText(g.floats, 'WRONG FINGER', W / 2, 230, RED);
      }
    } else if (g.phase !== 'next') {
      host.log({ kind: 'false_activation', finger: ev.finger });
    }
  };

  g.draw = (ctx, input, now) => {
    hudTop(ctx, `BLOCKS ${g.blocks}`, `${Math.max(0, Math.ceil(DURATION - now))} s`);
    bar(ctx, 28, 54, W - 56, 8, 1 - now / DURATION, CYAN);
    // table, source pad and bin
    panel(ctx, 70, 150, 250, 190, { stroke: 'rgba(25,227,255,0.35)' });
    text(ctx, 'SOURCE', 195, 140, { size: 16, color: MUTED, align: 'center', font: FONT_HEAD });
    panel(ctx, W - 320, 150, 250, 190, { stroke: g.binFlash > now - 0.5 ? MINT : 'rgba(61,255,181,0.35)' });
    text(ctx, 'BIN', W - 195, 140, { size: 16, color: MUTED, align: 'center', font: FONT_HEAD });
    // stack in the bin
    for (let i = 0; i < Math.min(g.blocks, 12); i++) {
      const bx = W - 300 + (i % 4) * 56, by = 304 - Math.floor(i / 4) * 40;
      roundRect(ctx, bx, by, 48, 32, 6); ctx.fillStyle = 'rgba(61,255,181,0.45)'; ctx.fill();
    }
    // the block
    const col = FINGER_COLOR[g.target];
    let bx = 150, by = 250, lift = 0;
    if (g.phase === 'carry' || g.phase === 'release') {
      const p = g.phase === 'release' ? 1 : g.carryProg;
      bx = 150 + (W - 345 - 150) * p; lift = Math.sin(p * Math.PI) * 120; by = 250 - lift;
    }
    if (g.phase !== 'next') {
      ctx.save();
      roundRect(ctx, bx, by, 90, 64, 10);
      ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 24; ctx.fill();
      ctx.restore();
      text(ctx, LETTER[g.target], bx + 45, by + 44, { size: 38, font: FONT_HEAD, weight: 800, align: 'center', color: '#04101a' });
    }
    // instruction text + carry ring
    let msg = '', col2 = INK;
    if (g.phase === 'wait_grip') { msg = `GRIP with your ${NAME[g.target].toUpperCase()}`; col2 = col; }
    else if (g.phase === 'carry') { msg = 'HOLD to carry...'; col2 = MINT; }
    else if (g.phase === 'release') { msg = 'RELAX to release'; col2 = AMBER; }
    else msg = '';
    text(ctx, msg, W / 2, 400, { size: 30, font: FONT_HEAD, weight: 800, align: 'center', color: col2, glow: 10 });
    if (g.phase === 'carry' || g.phase === 'release') ring(ctx, W / 2, 330, 34, g.carryProg, MINT, 8);
    drawFloats(ctx, g.floats, now);
    drawPads(ctx, input, 474, { [g.target]: g.phase === 'wait_grip' });
    readiness(ctx, input, 28, 488);
  };

  g.result = () => ({
    score: Math.max(0, g.score), max: 1800, percent: Math.min(100, (Math.max(0, g.score) / 1800) * 100),
    durationS: DURATION,
    lines: [['Blocks moved', g.blocks], ['Quick releases', g.quickReleases], ['Dropped', g.drops], ['Wrong finger', g.missgrips], ['Timed out', g.skipped]],
  });
  return g;
}
void INK; void H;
