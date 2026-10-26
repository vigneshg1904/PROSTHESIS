// Game 3 - HOLD STEADY: five rounds, one per finger. Curl the target finger and keep it steady for 5 seconds.
import { W, H, FINGERS, LETTER, NAME, FINGER_COLOR, FONT_HEAD, INK, MUTED, MINT, RED, AMBER, CYAN, text, panel, ring, bar, readiness, hudTop, drawPads, drawFloats, floatText } from './common.js';
import { shuffle } from '../util.js';

const NEED = 5.0, GRACE = 0.4, MAX_BREAKS = 3, ROUND_LIMIT = 28, PREP = 2.2, BETWEEN = 1.6;

export const meta = {
  id: 'hold',
  title: 'Hold Steady',
  tag: 'Holding',
  icon: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="16"/><path d="M24 24V12"/><circle cx="24" cy="24" r="3" fill="currentColor" stroke="none"/></svg>',
  blurb: 'Keep one finger perfectly steady, five times.',
  objective: 'Five rounds, one for each finger in random order. Curl the target finger and hold it steady until the ring is full (5 seconds).',
  steps: [
    'Relax first. The target finger lights up on the hand and on the pad.',
    'Curl ONLY that finger and keep the effort steady, not maximal.',
    'The ring fills while you stay on target. Wobbling away for more than a moment breaks the hold.',
    'Three breaks in one round ends it. Relax between rounds.',
  ],
  scoring: 'Up to 200 per round: 100 for finishing plus your steadiness %, minus 25 per break.',
  trains: 'Holding: sustaining a grip without drifting or letting go, like holding a posture in a virtual target test.',
  duration: 'about 1.5 minutes',
  options: null,
};

export function create(host) {
  const order = shuffle(FINGERS, host.rng);
  const g = {
    done: false, score: 0, round: 0, phase: 'prep', t0: 0, floats: [],
    target: order[0], held: 0, lost: 0, breaks: 0, logged: false, onTime: 0, totalTime: 0, bestStreak: 0, actSum: 0,
    results: [],
  };
  host.setTargets([g.target]);

  const finishRound = (now, ok) => {
    const stability = g.totalTime > 0 ? Math.min(1, g.onTime / g.totalTime) : 0;
    const strength = g.onTime > 0.5 ? g.actSum / g.onTime : undefined;
    host.log({ kind: 'hold', target: g.target, streakMs: Math.round(g.bestStreak * 1000), stability, breaks: g.breaks, ok, strength });
    const pts = ok ? Math.max(0, Math.round(100 + stability * 100 - 25 * g.breaks)) : Math.round(stability * 40);
    g.score += pts; g.results.push({ finger: g.target, ok, stability, breaks: g.breaks, pts });
    floatText(g.floats, ok ? `+${pts}` : 'ROUND FAILED', W / 2, 250, ok ? MINT : RED);
    if (ok) host.sfx.win(); else host.sfx.bad();
    g.phase = 'between'; g.t0 = now; host.setTargets([]);
  };
  const startRound = (now) => {
    g.round++;
    if (g.round >= order.length) { g.done = true; return; }
    g.target = order[g.round];
    g.phase = 'prep'; g.t0 = now; g.held = g.lost = g.breaks = 0; g.logged = false; g.onTime = g.totalTime = g.bestStreak = g.actSum = 0;
    host.setTargets([g.target]);
  };

  g.update = (now, input, dt) => {
    if (g.phase === 'prep') {
      if (now - g.t0 >= PREP && ((input.isRest && input.readyIn <= 0.05) || now - g.t0 > PREP + 6)) { g.phase = 'go'; g.t0 = now; g.roundStart = now; }
    } else if (g.phase === 'go') {
      if (now - g.roundStart > ROUND_LIMIT) finishRound(now, false);
    } else if (g.phase === 'hold') {
      g.totalTime += dt;
      if (input.finger === g.target) { g.held += dt; g.onTime += dt; g.lost = 0; g.bestStreak = Math.max(g.bestStreak, g.held); g.actSum += (input.activity || 0) * dt; }
      else {
        g.lost += dt;
        if (g.lost > GRACE) {
          g.breaks++; g.held = 0; g.lost = 0; host.sfx.bad();
          floatText(g.floats, 'BREAK', W / 2, 250, AMBER);
          if (g.breaks >= MAX_BREAKS) finishRound(now, false);
          else { g.phase = 'go'; }
        }
      }
      if (g.phase === 'hold' && g.held >= NEED) finishRound(now, true);
      else if (g.phase === 'hold' && now - g.roundStart > ROUND_LIMIT) finishRound(now, false);
    } else if (g.phase === 'between') {
      if ((now - g.t0 >= BETWEEN && input.isRest) || now - g.t0 > 7) startRound(now);
    }
  };

  g.onEvent = (ev, now) => {
    if (ev.type !== 'activate' && ev.type !== 'switch') return;
    if (!FINGERS.includes(ev.finger)) return;
    if (g.phase === 'go') {
      if (ev.finger === g.target) {
        if (!g.logged) {
          g.logged = true;
          host.log({ kind: 'activation', target: g.target, detected: ev.finger, ok: true, rtMs: Math.round((now - g.roundStart) * 1000) });
        }
        g.phase = 'hold'; g.held = 0; g.lost = 0; host.sfx.finger(ev.finger);
      } else {
        host.log({ kind: 'activation', target: g.target, detected: ev.finger, ok: false });
        host.sfx.bad(); floatText(g.floats, 'WRONG FINGER', W / 2, 250, RED);
      }
    } else if (g.phase === 'prep' || g.phase === 'between') {
      host.log({ kind: 'false_activation', finger: ev.finger });
    }
  };

  g.draw = (ctx, input, now) => {
    hudTop(ctx, `ROUND ${Math.min(g.round + 1, order.length)} / ${order.length}`, `SCORE ${g.score}`);
    const col = FINGER_COLOR[g.target];
    const cx = W / 2, cy = 235;
    ring(ctx, cx, cy, 120, g.phase === 'hold' ? g.held / NEED : (g.phase === 'between' ? (g.results[g.results.length - 1]?.ok ? 1 : 0) : 0), col, 16);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, 92, 0, Math.PI * 2);
    ctx.fillStyle = input.finger === g.target ? col + '44' : 'rgba(6,24,40,0.6)'; ctx.fill();
    ctx.restore();
    text(ctx, LETTER[g.target], cx, cy + 26, { size: 84, font: FONT_HEAD, weight: 800, align: 'center', color: col, glow: 22 });
    let msg = '', sub = '';
    if (g.phase === 'prep') { msg = `GET READY: ${NAME[g.target].toUpperCase()}`; sub = 'relax your hand'; }
    else if (g.phase === 'go') { msg = `CURL your ${NAME[g.target].toUpperCase()}`; sub = g.breaks ? `breaks ${g.breaks} / ${MAX_BREAKS}` : 'only this finger'; }
    else if (g.phase === 'hold') { msg = 'HOLD STEADY'; sub = `${Math.max(0, NEED - g.held).toFixed(1)} s to go   ·   breaks ${g.breaks} / ${MAX_BREAKS}`; }
    else if (g.phase === 'between') { msg = 'RELAX'; sub = 'next round when you are fully relaxed'; }
    text(ctx, msg, cx, 392, { size: 30, font: FONT_HEAD, weight: 800, align: 'center', color: col, glow: 8 });
    text(ctx, sub, cx, 424, { size: 20, align: 'center', color: MUTED });
    if (g.phase === 'hold') {
      const ontarget = input.finger === g.target;
      text(ctx, ontarget ? 'ON TARGET' : 'drifting...', cx, 100, { size: 20, font: FONT_HEAD, align: 'center', color: ontarget ? MINT : AMBER });
    }
    drawFloats(ctx, g.floats, now);
    drawPads(ctx, input, 484, { [g.target]: g.phase === 'go' || g.phase === 'prep' });
    readiness(ctx, input, 28, 496);
  };

  g.result = (now) => {
    const stab = g.results.length ? g.results.reduce((s, r) => s + r.stability, 0) / g.results.length : 0;
    const okN = g.results.filter((r) => r.ok).length;
    return {
      score: g.score, max: order.length * 200, percent: (g.score / (order.length * 200)) * 100, durationS: Math.max(1, now),
      lines: [['Rounds completed', `${okN} / ${order.length}`], ['Average steadiness', Math.round(stab * 100) + '%'], ['Total breaks', g.results.reduce((s, r) => s + r.breaks, 0)]],
    };
  };
  return g;
}
void INK; void H; void panel; void bar; void CYAN;
