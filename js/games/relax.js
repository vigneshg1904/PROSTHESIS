// Game 5 - RELAX CONTROL: stay calm, squeeze when told, then let go completely. Measures unwanted activations and release speed.
import { W, H, FINGERS, LETTER, NAME, FINGER_COLOR, FONT_HEAD, INK, MUTED, MINT, RED, AMBER, CYAN, text, panel, ring, bar, readiness, hudTop, drawFloats, floatText } from './common.js';

const CYCLES = 5, CALM_NEED = 5.0, CALM_MAX = 12, CUE = 3.0, ACT_MIN_HOLD = 1.0, REL_MAX = 4.0, SETTLE = 1.4;

export const meta = {
  id: 'relax',
  title: 'Relax Control',
  tag: 'Releasing',
  icon: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="6"/><circle cx="24" cy="24" r="12" opacity=".6"/><circle cx="24" cy="24" r="18" opacity=".3"/></svg>',
  blurb: 'Stay calm, squeeze on cue, then let go fully.',
  objective: 'A good prosthesis user can be completely still when no grip is wanted, and release instantly when it is time to let go. Five short cycles.',
  steps: [
    'CALM: keep the whole hand relaxed until the orb fills (5 seconds of true relaxation). Any twitch counts against you.',
    'SQUEEZE: when the cue appears, curl ANY finger and keep it curled until the cue ends.',
    'RELEASE: when told, let go completely. The faster you reach full relaxation, the better.',
    'Repeat five times.',
  ],
  scoring: 'Per cycle up to 100: calm 40, squeeze 30, release speed 30.',
  trains: 'Releasing: unintended activations and slow release are what make real prostheses frustrating.',
  duration: 'about 1.5 minutes',
  options: null,
};

export function create(host) {
  const g = {
    done: false, score: 0, cycle: 0, phase: 'calm', t0: 0.6, calm: 0, calmClock: 0, floats: [],
    squeezed: false, actAt: null, held: 0, cueEnd: 0, relStart: 0, relLat: null, falseActs: 0, cycleFalse: 0, results: [], actRts: [],
  };

  const newCycle = (now) => {
    g.phase = 'calm'; g.t0 = now; g.calm = 0; g.calmClock = 0; g.squeezed = false; g.actAt = null; g.held = 0; g.cycleFalse = 0; g.relLat = null;
  };
  const endCycle = (now, calmPts, actPts, relPts) => {
    const pts = Math.round(calmPts + actPts + relPts);
    g.score += pts; g.results.push({ calmPts, actPts, relPts, pts });
    floatText(g.floats, `+${pts}`, W / 2, 250, MINT); host.sfx.win();
    g.cycle++;
    if (g.cycle >= CYCLES) { g.done = true; return; }
    g.phase = 'settle'; g.t0 = now;
  };

  g.update = (now, input, dt) => {
    if (g.phase === 'calm') {
      if (now < g.t0) return;
      g.calmClock += dt;
      if (input.isRest) g.calm += dt;
      if (g.calm >= CALM_NEED || g.calmClock >= CALM_MAX) {
        g.calmPts = Math.max(0, 40 * Math.min(1, g.calm / g.calmClock) - 8 * g.cycleFalse);
        if (g.calmPts < 0) g.calmPts = 0;
        g.phase = 'cue'; g.t0 = now; g.cueEnd = now + CUE; host.sfx.go();
      }
    } else if (g.phase === 'cue') {
      if (g.squeezed && input.isRest && now - g.actAt > ACT_MIN_HOLD && now < g.cueEnd) {
        // released early: counts as a short squeeze
        g.releasedEarly = true;
      }
      if (g.squeezed && !input.isRest) g.held += dt;
      if (now >= g.cueEnd) {
        g.phase = 'release'; g.relStart = now;
        g.actPts = g.squeezed ? 30 * Math.min(1, g.held / (ACT_MIN_HOLD + 0.5)) : 0;
        if (!g.squeezed) host.log({ kind: 'activation', target: 'ANY', detected: null, ok: false });
        host.sfx.tick();
      }
    } else if (g.phase === 'release') {
      if (input.isRest) {
        const lat = (now - g.relStart) * 1000;
        g.relLat = lat;
        if (g.squeezed) host.log({ kind: 'release', latencyMs: Math.round(lat) });
        const relPts = g.squeezed ? Math.max(0, Math.min(30, 30 * (1 - Math.max(0, lat - 800) / 2200))) : 0;
        endCycle(now, g.calmPts, g.actPts, relPts);
      } else if (now - g.relStart > REL_MAX) {
        host.log({ kind: 'release', latencyMs: Math.round(REL_MAX * 1000) });
        endCycle(now, g.calmPts, g.actPts, 0);
      }
    } else if (g.phase === 'settle') {
      if (now - g.t0 >= SETTLE && input.isRest) newCycle(now);
      else if (now - g.t0 > 8) newCycle(now);
    }
  };

  g.onEvent = (ev, now) => {
    if (ev.type !== 'activate' && ev.type !== 'switch') return;
    if (!FINGERS.includes(ev.finger)) return;
    if (g.phase === 'cue') {
      if (!g.squeezed) {
        g.squeezed = true; g.actAt = now; g.held = 0;
        g.actRts.push((now - g.t0) * 1000);
        host.log({ kind: 'activation', target: 'ANY', detected: ev.finger, ok: true, rtMs: Math.round((now - g.t0) * 1000) });
        host.sfx.finger(ev.finger);
      }
    } else if (g.phase === 'calm' || g.phase === 'settle') {
      if (now >= g.t0 || g.phase === 'settle') {
        g.falseActs++; g.cycleFalse++;
        host.log({ kind: 'false_activation', finger: ev.finger });
        host.sfx.bad(); floatText(g.floats, 'TWITCH', W / 2, 250, AMBER);
      }
    }
  };

  g.draw = (ctx, input, now) => {
    hudTop(ctx, `CYCLE ${Math.min(g.cycle + 1, CYCLES)} / ${CYCLES}`, `SCORE ${g.score}`);
    const cx = W / 2, cy = 230;
    const pulse = 1 + 0.06 * Math.sin(now * 2.2);
    let col = CYAN, msg = '', sub = '', frac = 0;
    if (g.phase === 'calm') { col = CYAN; msg = 'STAY CALM'; sub = 'relax your whole hand, breathe slowly'; frac = g.calm / CALM_NEED; }
    else if (g.phase === 'cue') { col = MINT; msg = 'SQUEEZE!'; sub = g.squeezed ? 'keep it curled until the cue ends' : 'curl ANY finger now'; frac = Math.max(0, (g.cueEnd - now) / CUE); }
    else if (g.phase === 'release') { col = AMBER; msg = 'RELEASE'; sub = 'let go completely'; frac = Math.max(0, 1 - (now - g.relStart) / REL_MAX); }
    else { col = MUTED; msg = 'WELL DONE'; sub = 'relax for the next cycle'; frac = 1; }
    ring(ctx, cx, cy, 118, frac, col, 14);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, 96 * pulse * (g.phase === 'cue' ? 1.12 : 1), 0, Math.PI * 2);
    const gr = ctx.createRadialGradient(cx, cy, 10, cx, cy, 100 * pulse);
    gr.addColorStop(0, col + 'aa'); gr.addColorStop(1, col + '11');
    ctx.fillStyle = gr; ctx.shadowColor = col; ctx.shadowBlur = 36; ctx.fill();
    ctx.restore();
    text(ctx, msg, cx, 396, { size: 36, font: FONT_HEAD, weight: 800, align: 'center', color: col, glow: 12 });
    text(ctx, sub, cx, 430, { size: 21, align: 'center', color: MUTED });
    if (g.phase === 'calm') text(ctx, `${g.cycleFalse} twitch${g.cycleFalse === 1 ? '' : 'es'} this cycle`, cx, 100, { size: 18, align: 'center', color: g.cycleFalse ? AMBER : MUTED });
    // live state
    const act = !input.isRest;
    panel(ctx, W / 2 - 150, 456, 300, 52, { stroke: act ? MINT : CYAN, fill: 'rgba(6,24,40,0.85)' });
    text(ctx, act ? `ACTIVE · ${input.finger ? NAME[input.finger] : (input.label || '')}` : 'HAND RELAXED', W / 2, 489, { size: 22, font: FONT_HEAD, weight: 700, align: 'center', color: act ? MINT : CYAN });
    drawFloats(ctx, g.floats, now);
    readiness(ctx, input, 28, 488);
  };

  g.result = (now) => {
    const avgRel = g.results.length ? g.results.reduce((s, r) => s + r.relPts, 0) / g.results.length : 0;
    return {
      score: g.score, max: CYCLES * 100, percent: (g.score / (CYCLES * 100)) * 100, durationS: Math.max(1, now),
      lines: [['Cycles completed', `${g.results.length} / ${CYCLES}`], ['Unwanted twitches', g.falseActs], ['Average release score', Math.round(avgRel) + ' / 30']],
    };
  };
  return g;
}
void INK; void H; void LETTER; void FINGER_COLOR; void RED; void bar;
