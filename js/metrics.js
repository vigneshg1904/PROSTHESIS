// metrics.js - collects what happens in the games and turns it into a "prosthesis-readiness" report.
//
// Framework: the four control areas of the Assessment of Capacity for Myoelectric Control (ACMC) -
// gripping, holding, releasing, coordinating. The games are NOT the clinical test; they measure the same
// kinds of control skills from your finger patterns. Scores are indicative training feedback, not a diagnosis.

import { clamp, median, mean } from './util.js';

export const FINGER_LIST = ['THUMB', 'INDEX', 'MIDDLE', 'RING', 'LITTLE'];

export class Metrics {
  constructor() {
    this.trials = [];     // committed trials (finished games only)
    this.games = [];      // one summary per finished game
    this.run = null;
  }
  begin(gameId) { this.run = { gameId, trials: [], t0: Date.now() }; return this.run; }
  log(entry) { if (this.run) this.run.trials.push({ game: this.run.gameId, ...entry, t: Date.now() }); }
  commit(summary) {
    if (!this.run) return;
    this.trials.push(...this.run.trials);
    this.games.push({ ...summary, id: this.run.gameId, t: Date.now(), durationS: summary.durationS ?? (Date.now() - this.run.t0) / 1000 });
    this.run = null;
  }
  abort() { this.run = null; }
  clear() { this.trials = []; this.games = []; this.run = null; }
}

const pct = (a, b) => (b > 0 ? (100 * a) / b : null);
const avg = (arr) => { const v = arr.filter((x) => x != null && Number.isFinite(x)); return v.length ? mean(v) : null; };

export function buildReport(trials, games) {
  const act = trials.filter((t) => t.kind === 'activation');
  const actOk = act.filter((t) => t.ok);
  const accuracy = pct(actOk.length, act.length);
  const rt = actOk.map((t) => t.rtMs).filter((v) => typeof v === 'number');
  const medRt = median(rt);
  const latencyScore = medRt == null ? null : clamp(100 - (medRt - 1000) / 30, 0, 100);   // 1.0 s -> 100, 4.0 s -> 0

  // ---- per finger: accuracy + where mistakes went (individuation)
  const perFinger = {};
  const confusion = {};
  for (const f of FINGER_LIST) { perFinger[f] = { attempts: 0, correct: 0, accuracy: null, rtMs: null, leaks: {} }; confusion[f] = {}; }
  for (const t of act) {
    const pf = perFinger[t.target];
    if (!pf) continue;
    pf.attempts++;
    if (t.ok) pf.correct++;
    else {
      const d = t.detected || 'none';
      pf.leaks[d] = (pf.leaks[d] || 0) + 1;
    }
    const d = t.detected || 'none';
    confusion[t.target][d] = (confusion[t.target][d] || 0) + 1;
  }
  for (const f of FINGER_LIST) {
    const pf = perFinger[f];
    pf.accuracy = pct(pf.correct, pf.attempts);
    pf.rtMs = median(act.filter((t) => t.target === f && t.ok && typeof t.rtMs === 'number').map((t) => t.rtMs));
  }
  const tested = FINGER_LIST.filter((f) => perFinger[f].attempts > 0);
  const individuation = accuracy;   // share of prompts answered with exactly the right (isolated) finger

  // ---- holding
  const holds = trials.filter((t) => t.kind === 'hold');
  const holdStability = avg(holds.map((t) => (typeof t.stability === 'number' ? t.stability * 100 : null)));
  const holdSuccess = holds.length ? pct(holds.filter((t) => t.ok).length, holds.length) : null;
  const carries = trials.filter((t) => t.kind === 'carry');
  const carrySuccess = carries.length ? pct(carries.filter((t) => t.ok).length, carries.length) : null;
  const holdingScore = avg([holdStability, holdSuccess, carrySuccess]);

  // ---- releasing
  const rel = trials.filter((t) => t.kind === 'release' && typeof t.latencyMs === 'number');
  const medRel = median(rel.map((t) => t.latencyMs));
  const releaseScore = medRel == null ? null : clamp(100 - (medRel - 800) / 22, 0, 100);   // 0.8 s -> 100, 3.0 s -> 0
  const falseActs = trials.filter((t) => t.kind === 'false_activation').length;
  const minutes = games.reduce((s, g) => s + (g.durationS || 0), 0) / 60;
  const falseRate = minutes > 0 ? falseActs / minutes : null;
  const calmScore = falseRate == null ? null : clamp(100 - falseRate * 25, 0, 100);     // 4 per minute -> 0
  const releasingScore = avg([releaseScore, calmScore]);

  // ---- coordinating
  const seq = trials.filter((t) => t.kind === 'sequence');
  const seqBest = seq.length ? Math.max(...seq.filter((t) => t.ok).map((t) => t.level), 0) : null;
  const seqScore = seq.length ? clamp(((seqBest || 0) / 7) * 100, 0, 100) : null;
  const piano = games.filter((g) => g.id === 'piano');
  const pianoScore = piano.length ? Math.max(...piano.map((g) => g.percent ?? 0)) : null;
  const coordinatingScore = avg([seqScore, pianoScore, individuation]);

  // ---- gripping
  let grippingScore = null;
  if (accuracy != null && latencyScore != null) grippingScore = 0.6 * accuracy + 0.4 * latencyScore;
  else grippingScore = accuracy ?? latencyScore;

  const categories = {
    gripping: grippingScore, holding: holdingScore, releasing: releasingScore, coordinating: coordinatingScore,
  };
  const assessed = Object.values(categories).filter((v) => v != null);
  const overall = assessed.length ? mean(assessed) : null;

  // ---- fatigue: did hold strength fall during the session?
  const strengths = trials.filter((t) => typeof t.strength === 'number').map((t) => t.strength);
  let fatigue = null;
  if (strengths.length >= 6) {
    const k = Math.floor(strengths.length / 3);
    const first = mean(strengths.slice(0, k)), last = mean(strengths.slice(-k));
    fatigue = first > 0 ? clamp((first - last) / first, -1, 1) : null;
  }

  const band = overall == null ? null : overall >= 85 ? 'Excellent' : overall >= 70 ? 'Good' : overall >= 50 ? 'Developing' : 'Needs training';

  return {
    generated: Date.now(), overall, band, provisional: assessed.length < 3, categories,
    accuracy, medianLatencyMs: medRt, latencyScore, medianReleaseMs: medRel, falseActivations: falseActs, falseRatePerMin: falseRate,
    holdStability, holdSuccess, carrySuccess, sequenceBest: seqBest, pianoPercent: pianoScore,
    perFinger, confusion, testedFingers: tested, fatigue,
    counts: { activations: act.length, holds: holds.length, releases: rel.length, games: games.length },
  };
}

// plain-language findings + next steps, derived only from the numbers above
export function insights(r) {
  const out = [];
  const rec = [];
  if (r.counts.activations === 0 && r.counts.holds === 0) return { findings: ['Play at least one game to generate findings.'], next: [] };
  if (r.accuracy != null) {
    out.push(`You answered ${Math.round(r.accuracy)}% of finger prompts with exactly the right, isolated finger.`);
    if (r.accuracy < 70) rec.push('Practise slow, single-finger curls: the system can only reward a finger it can tell apart from the others.');
  }
  const worst = r.testedFingers.filter((f) => r.perFinger[f].attempts >= 3).sort((a, b) => r.perFinger[a].accuracy - r.perFinger[b].accuracy)[0];
  if (worst && r.perFinger[worst].accuracy < 80) {
    const leaks = Object.entries(r.perFinger[worst].leaks).sort((a, b) => b[1] - a[1])[0];
    out.push(`${cap(worst)} was the hardest finger (${Math.round(r.perFinger[worst].accuracy)}%)` + (leaks ? `, most often read as ${leaks[0] === 'none' ? 'no movement' : cap(leaks[0])}.` : '.'));
    rec.push(`Give ${cap(worst)} extra practice, and check that electrode pair sits over its muscle.`);
  }
  if (r.medianLatencyMs != null) {
    out.push(`Median response time was ${(r.medianLatencyMs / 1000).toFixed(2)} s (this includes about 1 s of the system's own detection delay).`);
    if (r.medianLatencyMs > 2500) rec.push('Start each movement promptly at the cue; hesitation shows up directly in this number.');
  }
  if (r.holdStability != null) {
    out.push(`While holding a finger you stayed on target ${Math.round(r.holdStability)}% of the time.`);
    if (r.holdStability < 75) rec.push('Hold with steady, moderate effort rather than squeezing hard; wobble breaks the hold.');
  }
  if (r.medianReleaseMs != null) {
    out.push(`Median time to fully relax after a grip was ${(r.medianReleaseMs / 1000).toFixed(2)} s.`);
    if (r.medianReleaseMs > 2000) rec.push('Practise "letting go" completely: relax the whole forearm, not just the finger.');
  }
  if (r.falseActivations > 0) {
    out.push(`${r.falseActivations} unintended activation${r.falseActivations === 1 ? '' : 's'} happened while you meant to be relaxed.`);
    rec.push('Unintended activations are the main reason prostheses feel frustrating: keep practising the Relax trial.');
  }
  if (r.fatigue != null && r.fatigue > 0.2) {
    out.push(`Your signal strength dropped about ${Math.round(r.fatigue * 100)}% over the session, a sign of muscle fatigue.`);
    rec.push('Take a short break between trials, and keep sessions to about 15 minutes.');
  }
  if (!rec.length) rec.push('Great control. Keep your sessions regular: consistency over days is what builds reliable prosthesis control.');
  return { findings: out, next: rec };
}
const cap = (s) => s.charAt(0) + s.slice(1).toLowerCase();

export const CATEGORY_INFO = {
  gripping: { label: 'Gripping', blurb: 'Starting the right grip, promptly and on the right finger.' },
  holding: { label: 'Holding', blurb: 'Keeping a grip steady for as long as the task needs.' },
  releasing: { label: 'Releasing', blurb: 'Letting go fully and staying relaxed when no grip is wanted.' },
  coordinating: { label: 'Coordinating', blurb: 'Chaining different fingers in order and in time.' },
};
