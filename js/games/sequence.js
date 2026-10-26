// Game 4 - MEMORY SEQUENCE: watch the fingers light up, then repeat the order. Each level adds one finger.
import { W, H, FINGERS, LETTER, NAME, FINGER_COLOR, FONT_HEAD, INK, MUTED, MINT, RED, AMBER, CYAN, text, panel, readiness, hudTop, drawPads, drawFloats, floatText } from './common.js';

const START = 2, MAXLEN = 7, LIVES = 3, SHOW_ON = 0.7, SHOW_GAP = 0.35, STEP_LIMIT = 10, PAUSE = 1.4;

export const meta = {
  id: 'sequence',
  title: 'Memory Sequence',
  tag: 'Coordinating',
  icon: '<svg viewBox="0 0 48 48"><circle cx="10" cy="24" r="5"/><circle cx="24" cy="12" r="5"/><circle cx="38" cy="24" r="5"/><circle cx="24" cy="36" r="5"/><path d="M14 21l6-6M28 15l6 6M34 28l-7 6"/></svg>',
  blurb: 'Remember the order, then play it back finger by finger.',
  objective: 'Watch the fingers light up in a pattern. When it says YOUR TURN, repeat the same order. Every success adds one more finger.',
  steps: [
    'Watch carefully: each finger lights up and plays a note.',
    'At YOUR TURN, curl the fingers in the same order, one at a time, relaxing between each.',
    'A wrong finger or waiting too long costs a life (three lives).',
    'Reach a sequence of seven fingers to win.',
  ],
  scoring: '50 points per finger in every completed level.',
  trains: 'Coordinating: chaining different fingers in order, the skill behind multi-step grips.',
  duration: 'about 2 minutes',
  options: null,
};

export function create(host) {
  const rnd = host.rng;
  const g = {
    done: false, score: 0, lives: LIVES, level: START, seq: [], phase: 'intro', t0: 0, showIdx: -1, k: 0, stepStart: 0,
    lit: null, floats: [], bestLevel: 0, correct: 0, wrong: 0, timeouts: 0, won: false,
  };
  const makeSeq = () => {
    const s = [];
    for (let i = 0; i < g.level; i++) {
      let f;
      do { f = FINGERS[Math.floor(rnd() * FINGERS.length)]; } while (i > 0 && f === s[i - 1]);   // never the same finger twice in a row
      s.push(f);
    }
    return s;
  };
  const begin = (now) => { g.seq = makeSeq(); g.phase = 'show'; g.t0 = now + 0.6; g.showIdx = -1; g.k = 0; g.lit = null; host.setTargets([]); };
  const toInput = (now) => { g.phase = 'input'; g.k = 0; g.stepStart = now; g.lit = null; };
  begin(0.5);

  const loseLife = (now, why) => {
    g.lives--; if (why === 'timeout') g.timeouts++; else g.wrong++;
    host.log({ kind: 'sequence', level: g.level, ok: false });
    host.sfx.bad(); floatText(g.floats, why === 'timeout' ? 'TOO SLOW' : 'WRONG ORDER', W / 2, 250, RED);
    if (g.lives <= 0) { g.done = true; return; }
    g.phase = 'retry'; g.t0 = now;
  };

  g.update = (now, input) => {
    if (g.phase === 'show') {
      const t = now - g.t0;
      if (t < 0) return;
      const idx = Math.floor(t / (SHOW_ON + SHOW_GAP));
      const within = t - idx * (SHOW_ON + SHOW_GAP);
      if (idx >= g.seq.length) {
        if (input.isRest && (input.readyIn || 0) <= 0.05) { g.phase = 'yourturn'; g.t0 = now; host.sfx.go(); }
        g.lit = null; host.setTargets([]);
        return;
      }
      if (within < SHOW_ON) {
        if (g.showIdx !== idx) { g.showIdx = idx; host.sfx.finger(g.seq[idx], 0.5); }
        g.lit = g.seq[idx]; host.setTargets([g.seq[idx]]);
      } else { g.lit = null; host.setTargets([]); }
    } else if (g.phase === 'yourturn') {
      if (now - g.t0 > 0.9) toInput(now);
    } else if (g.phase === 'input') {
      if (now - g.stepStart > STEP_LIMIT) loseLife(now, 'timeout');
    } else if (g.phase === 'levelup') {
      if (now - g.t0 > PAUSE) { if (g.won) g.done = true; else begin(now); }
    } else if (g.phase === 'retry') {
      if (now - g.t0 > PAUSE) begin(now);
    }
  };

  g.onEvent = (ev, now) => {
    if (ev.type === 'release' && g.phase === 'input') { g.stepStart = now; return; }
    if (ev.type !== 'activate' && ev.type !== 'switch') return;
    if (!FINGERS.includes(ev.finger)) return;
    if (g.phase !== 'input') { host.log({ kind: 'false_activation', finger: ev.finger }); return; }
    const want = g.seq[g.k];
    const rt = Math.round((now - g.stepStart) * 1000);
    if (ev.finger === want) {
      host.log({ kind: 'activation', target: want, detected: ev.finger, ok: true, rtMs: rt });
      host.sfx.finger(want); g.correct++; g.k++; g.stepStart = now;
      g.lit = want;
      if (g.k >= g.seq.length) {
        g.score += g.level * 50; g.bestLevel = g.level;
        host.log({ kind: 'sequence', level: g.level, ok: true });
        host.sfx.win(); floatText(g.floats, `LEVEL ${g.level} CLEARED`, W / 2, 250, MINT);
        g.level++;
        g.won = g.level > MAXLEN;
        g.phase = 'levelup'; g.t0 = now;
      }
    } else {
      host.log({ kind: 'activation', target: want, detected: ev.finger, ok: false, rtMs: rt });
      loseLife(now, 'wrong');
    }
  };

  g.draw = (ctx, input, now) => {
    hudTop(ctx, `LEVEL ${Math.min(g.level, MAXLEN)}`, `SCORE ${g.score}`);
    // lives
    for (let i = 0; i < LIVES; i++) {
      ctx.save();
      ctx.beginPath(); ctx.arc(W / 2 - 40 + i * 40, 36, 11, 0, Math.PI * 2);
      ctx.fillStyle = i < g.lives ? RED : 'rgba(255,61,113,0.15)'; ctx.shadowColor = RED; ctx.shadowBlur = i < g.lives ? 12 : 0; ctx.fill();
      ctx.restore();
    }
    // big pads in the middle
    const gap = 150, x0 = W / 2 - gap * 2, cy = 230;
    FINGERS.forEach((f, i) => {
      const x = x0 + i * gap, col = FINGER_COLOR[f];
      const lit = g.lit === f;
      const pressed = input.finger === f && g.phase === 'input';
      ctx.save();
      ctx.beginPath(); ctx.arc(x, cy, lit ? 62 : 52, 0, Math.PI * 2);
      ctx.fillStyle = lit ? col : pressed ? col + '99' : 'rgba(6,24,40,0.7)';
      ctx.shadowColor = col; ctx.shadowBlur = lit ? 40 : 0; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = col; ctx.stroke();
      ctx.restore();
      text(ctx, LETTER[f], x, cy + 14, { size: 42, font: FONT_HEAD, weight: 800, align: 'center', color: lit ? '#04101a' : col });
      text(ctx, NAME[f], x, cy + 92, { size: 16, color: MUTED, align: 'center' });
    });
    // progress dots
    const n = g.seq.length;
    for (let i = 0; i < n; i++) {
      const x = W / 2 - ((n - 1) * 28) / 2 + i * 28;
      ctx.save();
      ctx.beginPath(); ctx.arc(x, 360, 8, 0, Math.PI * 2);
      const done = g.phase === 'input' || g.phase === 'levelup' ? i < g.k : false;
      ctx.fillStyle = done ? MINT : 'rgba(25,227,255,0.18)'; ctx.shadowColor = MINT; ctx.shadowBlur = done ? 10 : 0; ctx.fill();
      ctx.restore();
    }
    let msg = '', sub = '';
    if (g.phase === 'show') { msg = 'WATCH'; sub = 'remember the order'; }
    else if (g.phase === 'yourturn') { msg = 'YOUR TURN'; sub = ''; }
    else if (g.phase === 'input') { msg = `${g.k + 1} of ${g.seq.length}`; sub = 'curl the next finger, then relax'; }
    else if (g.phase === 'levelup') { msg = g.won ? 'YOU WIN!' : 'NEXT LEVEL'; sub = ''; }
    else if (g.phase === 'retry') { msg = 'TRY AGAIN'; sub = 'a new sequence is coming'; }
    text(ctx, msg, W / 2, 408, { size: 34, font: FONT_HEAD, weight: 800, align: 'center', color: g.phase === 'yourturn' ? MINT : CYAN, glow: 10 });
    text(ctx, sub, W / 2, 438, { size: 20, align: 'center', color: MUTED });
    drawFloats(ctx, g.floats, now);
    readiness(ctx, input, 28, 488);
  };

  g.result = (now) => ({
    score: g.score, max: 50 * (START + 2 + 3 + 4 + 5 + 6 + 7 - 2), percent: Math.min(100, (g.bestLevel / MAXLEN) * 100), durationS: Math.max(1, now),
    lines: [['Longest sequence', g.bestLevel || '-'], ['Correct steps', g.correct], ['Wrong finger', g.wrong], ['Too slow', g.timeouts], ['Result', g.won ? 'Completed all levels' : 'Lives used up']],
  });
  return g;
}
void INK; void H; void panel; void AMBER; void drawPads;
