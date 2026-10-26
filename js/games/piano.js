// Game 1 - FINGER PIANO: notes fall in five lanes, curl the matching finger as a note reaches the line.
import { W, H, FINGERS, LETTER, FINGER_COLOR, FONT_HEAD, INK, MUTED, MINT, RED, AMBER, CYAN, roundRect, text, panel, readiness, hudTop, drawPads, drawFloats, floatText } from './common.js';

const CODE = { T: 'THUMB', I: 'INDEX', M: 'MIDDLE', R: 'RING', L: 'LITTLE' };
// Both tunes are public domain. Pitches C D E F G are mapped to Thumb Index Middle Ring Little.
const SONGS = {
  mary: { title: 'Mary Had a Little Lamb', notes: 'MITIMMMIIIMLL' },
  ode: { title: 'Ode to Joy', notes: 'MMRLLRMITTIMMII' },
};
const LEAD = 2.8, GAP = 3.2, FALL = 2.4, BEFORE = 0.9, AFTER = 1.7, LAT = 0.5;   // LAT: your signal needs about half a second to be recognised
const LINE_Y = 372, TOP_Y = 84;

export const meta = {
  id: 'piano',
  title: 'Finger Piano',
  tag: 'Coordinating  ·  Individuation',
  icon: '<svg viewBox="0 0 48 48"><rect x="5" y="9" width="38" height="30" rx="4"/><path d="M13 9v30M21 9v30M29 9v30M37 9v30"/><rect x="10" y="9" width="6" height="17" fill="currentColor" stroke="none"/><rect x="26" y="9" width="6" height="17" fill="currentColor" stroke="none"/></svg>',
  blurb: 'Play a tune by curling the right finger at the right moment.',
  objective: 'Notes fall down five lanes, one per finger. When a note reaches the glowing line, curl that finger, then relax before the next one.',
  steps: [
    'Thumb, Index, Middle, Ring, Little are the five lanes from left to right.',
    'Curl ONLY the finger of the lane the note is in. Other fingers should stay straight.',
    'You can curl from a moment before the note arrives until a moment after. Timing is adjusted for the half second your signal needs to be recognised: curl as the note touches the line.',
    'Relax your whole hand between notes. The next finger registers about one second after you relax.',
  ],
  scoring: 'Perfect 100, Good 70, Late/early 40. Wrong finger or no response scores 0.',
  trains: 'Gripping and Coordinating: choosing one finger out of five, on time.',
  duration: 'about 1 minute',
  options: [
    { id: 'mary', label: 'Easy · Mary Had a Little Lamb (13 notes)' },
    { id: 'ode', label: 'Normal · Ode to Joy (15 notes)' },
  ],
};

export function create(host, optionId) {
  const song = SONGS[optionId] || SONGS.mary;
  const notes = song.notes.split('').map((c, i) => ({ i, finger: CODE[c], arrive: LEAD + i * GAP, state: 'pending', offset: null }));
  const endAt = notes[notes.length - 1].arrive + AFTER + 1.2;
  const g = {
    done: false, score: 0, combo: 0, bestCombo: 0, floats: [], flash: {},
    stats: { hits: 0, perfect: 0, good: 0, ok: 0, wrong: 0, miss: 0, offsets: [] },
  };
  const maxScore = notes.length * 100;
  g.notes = notes;

  g.update = (now, input) => {
    for (const n of notes) {
      if (n.state === 'pending' && now > n.arrive + AFTER) {
        n.state = 'miss'; g.stats.miss++; g.combo = 0;
        host.log({ kind: 'activation', target: n.finger, detected: null, ok: false });
        host.sfx.bad(); floatText(g.floats, 'MISS', laneX(n.finger), LINE_Y - 20, RED);
      }
    }
    const upcoming = notes.find((n) => n.state === 'pending' && now >= n.arrive - 1.4);
    host.setTargets(upcoming ? [upcoming.finger] : []);
    if (now >= endAt) g.done = true;
  };

  g.onEvent = (ev, now) => {
    if ((ev.type !== 'activate' && ev.type !== 'switch') || !FINGERS.includes(ev.finger)) return;
    const n = notes.find((x) => x.state === 'pending' && now >= x.arrive - BEFORE && now <= x.arrive + AFTER);
    if (!n) { host.log({ kind: 'false_activation', finger: ev.finger }); return; }
    const off = now - n.arrive - LAT;
    if (ev.finger === n.finger) {
      n.state = 'hit'; n.offset = off;
      const a = Math.abs(off);
      const pts = a <= 0.6 ? 100 : a <= 1.2 ? 70 : 40;
      g.stats[a <= 0.6 ? 'perfect' : a <= 1.2 ? 'good' : 'ok']++;
      g.stats.hits++; g.stats.offsets.push(off * 1000);
      g.score += pts; g.combo++; g.bestCombo = Math.max(g.bestCombo, g.combo);
      g.flash[n.finger] = now;
      host.log({ kind: 'activation', target: n.finger, detected: ev.finger, ok: true, offsetMs: Math.round(off * 1000) });
      host.sfx.finger(n.finger); host.sfx.ok();
      floatText(g.floats, pts === 100 ? 'PERFECT' : pts === 70 ? 'GOOD' : 'OK', laneX(n.finger), LINE_Y - 20, pts === 100 ? MINT : pts === 70 ? CYAN : AMBER);
    } else {
      n.state = 'wrong'; g.stats.wrong++; g.combo = 0;
      host.log({ kind: 'activation', target: n.finger, detected: ev.finger, ok: false });
      host.sfx.bad(); floatText(g.floats, 'WRONG FINGER', laneX(n.finger), LINE_Y - 20, RED);
    }
  };

  const laneX = (f) => W / 2 + (FINGERS.indexOf(f) - 2) * 135;

  g.hud = (now) => ({ left: `SCORE ${g.score}`, right: g.combo > 1 ? `COMBO ×${g.combo}` : song.title });

  g.draw = (ctx, input, now) => {
    const h = hudTop; h(ctx, `SCORE ${g.score}`, g.combo > 1 ? `COMBO ×${g.combo}` : song.title);
    // lanes
    FINGERS.forEach((f) => {
      const x = laneX(f), col = FINGER_COLOR[f];
      ctx.save();
      roundRect(ctx, x - 62, TOP_Y, 124, LINE_Y - TOP_Y + 52, 14);
      ctx.fillStyle = 'rgba(6,24,40,0.55)'; ctx.fill();
      ctx.strokeStyle = col + '55'; ctx.lineWidth = 1.5; ctx.stroke();
      const fl = g.flash[f];
      if (fl !== undefined && now - fl < 0.4) { ctx.fillStyle = col; ctx.globalAlpha = 0.35 * (1 - (now - fl) / 0.4); ctx.fill(); }
      ctx.restore();
    });
    // hit zone + line
    ctx.save();
    const grad = ctx.createLinearGradient(0, LINE_Y - 80, 0, LINE_Y + 40);
    grad.addColorStop(0, 'rgba(25,227,255,0)'); grad.addColorStop(0.7, 'rgba(25,227,255,0.16)'); grad.addColorStop(1, 'rgba(25,227,255,0)');
    ctx.fillStyle = grad; ctx.fillRect(W / 2 - 340, LINE_Y - 80, 680, 120);
    ctx.strokeStyle = CYAN; ctx.shadowColor = CYAN; ctx.shadowBlur = 16; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(W / 2 - 340, LINE_Y); ctx.lineTo(W / 2 + 340, LINE_Y); ctx.stroke();
    ctx.restore();
    // notes
    for (const n of notes) {
      const dt = n.arrive - now;
      if (dt > FALL + 0.1 || dt < -AFTER) continue;
      let y = LINE_Y - (dt / FALL) * (LINE_Y - TOP_Y - 10);
      y = Math.min(y, LINE_Y + 40);
      const col = FINGER_COLOR[n.finger], x = laneX(n.finger);
      ctx.save();
      ctx.globalAlpha = n.state === 'pending' ? 1 : n.state === 'hit' ? Math.max(0, 1 - (now - (n.arrive + n.offset)) * 2.5) : 0.35;
      if (n.state === 'hit' && ctx.globalAlpha <= 0) { ctx.restore(); continue; }
      roundRect(ctx, x - 48, y - 18, 96, 36, 10);
      ctx.fillStyle = n.state === 'wrong' || n.state === 'miss' ? '#40222c' : col;
      ctx.shadowColor = col; ctx.shadowBlur = 16; ctx.fill();
      ctx.restore();
      text(ctx, LETTER[n.finger], x, y + 8, { size: 22, font: FONT_HEAD, weight: 800, align: 'center', color: '#04101a' });
    }
    drawFloats(ctx, g.floats, now);
    const nxt = notes.find((n) => n.state === 'pending');
    if (nxt) text(ctx, `Next: ${LETTER[nxt.finger]}`, 28, 70, { size: 18, color: MUTED });
    drawPads(ctx, input, 462, upcomingHl(now));
    readiness(ctx, input, W - 196, 480);
  };
  const upcomingHl = (now) => {
    const u = notes.find((n) => n.state === 'pending' && now >= n.arrive - 1.4);
    return u ? { [u.finger]: true } : {};
  };

  g.result = (now) => ({
    score: g.score, max: maxScore, percent: (g.score / maxScore) * 100, durationS: Math.max(1, now),
    lines: [
      ['Notes hit', `${g.stats.hits} / ${notes.length}`], ['Perfect', g.stats.perfect], ['Good', g.stats.good], ['Late / early', g.stats.ok],
      ['Wrong finger', g.stats.wrong], ['Missed', g.stats.miss], ['Best combo', g.bestCombo],
    ],
  });
  return g;
}
void INK; void panel;
