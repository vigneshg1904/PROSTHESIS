// main.js - the app: loader -> landing -> trial list -> instructions -> play -> report
import { CONFIG } from './config.js';
import { $, $$, sleep, sfx, clamp, FINGER_COLOR, shuffle } from './util.js';
import { Rtdb } from './rtdb.js';
import { DeviceLink, loadModel } from './device.js';
import { FINGERS } from './dsp.js';
import { startBackground } from './fx.js';
import { Hand3D } from './hand3d.js';
import { Metrics, buildReport, insights } from './metrics.js';
import { renderReport } from './report.js';
import { loadHistory, saveHistory, clearHistory, bestScores, pushSession } from './store.js';
import * as piano from './games/piano.js';
import * as pickplace from './games/pickplace.js';
import * as holdsteady from './games/holdsteady.js';
import * as sequence from './games/sequence.js';
import * as relax from './games/relax.js';
import { W as SW, H as SH, NAME, LETTER } from './games/common.js';

const GAMES = [piano, pickplace, holdsteady, sequence, relax];
const app = {
  cfg: CONFIG, rtdb: new Rtdb(CONFIG.dbUrl), link: null, modelInfo: null, screen: 'loader', metrics: new Metrics(),
  calibrated: false, selected: null, option: null, runner: null, hands: {}, lastReport: null, dev: CONFIG.dev,
  cloudOk: null,
};
window.__IKM = CONFIG.dev ? app : undefined;

/* ======================================================= screens + wipe transition */
function show(name) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === name));
  app.screen = name;
  $('#topbar').classList.toggle('hidden', name === 'loader');
  document.body.classList.toggle('booting', name === 'loader');
  $('#homeBtn').classList.toggle('hidden', name === 'landing');
  window.scrollTo(0, 0);
  startHands();
}
async function go(name) {
  const w = $('#wipe');
  w.classList.remove('run'); void w.offsetWidth; w.classList.add('run');
  await sleep(430);
  show(name);
  await sleep(560);
  w.classList.remove('run');
}

/* ======================================================= 3D hands */
function makeHand(id, opts) {
  const cv = document.getElementById(id);
  if (!cv) return null;
  const h = new Hand3D(cv, opts);
  app.hands[id] = h;
  return h;
}
function startHands() {
  const want = { landing: ['heroHand'], menu: ['menuHand'], play: ['playHand'] }[app.screen] || [];
  for (const [id, h] of Object.entries(app.hands)) { if (want.includes(id)) { h.resize(); h.start(); } else h.stop(); }
}
function feedHands(out) {
  for (const h of Object.values(app.hands)) h.setCurl(out.curl);
}

/* ======================================================= device status UI */
function statusText() {
  const s = app.link ? app.link.status : 'offline';
  return {
    offline: ['off', 'NPG OFFLINE', app.cloudOk === false ? 'No connection to the cloud database. Check your internet.' : 'Power on your NPG. It joins your Wi-Fi and the status turns green.'],
    waiting: ['wait', 'WAITING FOR NPG', 'Connected to the cloud. Switch on the NPG and make sure it is on Wi-Fi.'],
    online: ['on', 'NPG ONLINE', 'Receiving your signals live. Do a Hand check, then pick a trial.'],
  }[s];
}
function updateStatusUI() {
  const [cls, label, note] = statusText();
  const chip = $('#devChip');
  chip.className = 'chip ' + cls; chip.querySelector('span').textContent = label;
  const big = $('#devBig'); big.className = 'dev-big ' + cls; big.querySelector('span').textContent = label;
  $('#devNote').textContent = note;
  const online = app.link && app.link.status === 'online';
  $('#handCheckBtn').disabled = !online;
  $$('.gcard').forEach((c) => { c.classList.toggle('locked', !online); c.classList.toggle('ready', online); c.querySelector('.lock').textContent = online ? 'READY' : 'NPG OFFLINE'; });
  updateBegin();
}
function updateMeters(out, meta) {
  for (let c = 0; c < 3; c++) {
    const row = $('#mt' + c).closest('.meter-row');
    const lvl = out.rms[c] / Math.max(app.link.pipe.thr[c], 1e-9);
    $('#mt' + c).style.width = clamp((lvl / 8) * 100, 2, 100) + '%';
    $('#mc' + c).textContent = meta.clip[c] ? 'CLIP' : lvl.toFixed(1) + '×';
    row.classList.toggle('clip', !!meta.clip[c]);
  }
}

/* ======================================================= boot / loader */
const bootLine = (txt, ok = true, tag = 'OK') => {
  const li = document.createElement('li');
  li.className = ok ? '' : 'bad';
  li.innerHTML = `${txt} <b>[${tag}]</b>`;
  $('#bootLog').appendChild(li);
};
function setProgress(p) {
  p = clamp(p, 0, 100);
  $('#loadPct').textContent = Math.round(p);
  $('#ecgFill').style.strokeDashoffset = String(520 * (1 - p / 100));
}
async function boot() {
  const t0 = performance.now();
  let prog = 0;
  const tick = setInterval(() => { prog = Math.min(prog + 0.7, 92); setProgress(Math.max(parseFloat($('#loadPct').textContent) || 0, prog * 0.6)); }, 40);
  makeHand('heroHand'); makeHand('menuHand'); makeHand('playHand', { labels: true });
  startBackground($('#bg'));
  bootLine('powering signal chain');
  try { await Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), sleep(1800)]); } catch (e) { /* fonts optional */ }
  setProgress(30);
  // cloud reachability
  let reach = false;
  try { await app.rtdb.get(`devices/${CONFIG.deviceId}/info`, 4000); reach = true; } catch (e) { reach = false; }
  app.cloudOk = reach;
  bootLine('probing cloud link', reach, reach ? 'OK' : 'OFFLINE');
  setProgress(55);
  // model
  try {
    app.modelInfo = await loadModel(app.rtdb, CONFIG.deviceId, () => {});
  } catch (e) {
    app.modelInfo = null;
  }
  if (!app.modelInfo) { bootLine('loading detection model', false, 'MISSING'); }
  else bootLine(`loading detection model (${app.modelInfo.demo ? 'DEMO' : 'yours'})`, true, app.modelInfo.source.toUpperCase());
  setProgress(80);
  if (app.modelInfo) {
    app.link = new DeviceLink({ dbUrl: CONFIG.dbUrl, deviceId: CONFIG.deviceId, pipeline: CONFIG.pipeline }, app.modelInfo.model);
    app.link.onStatus = onStatus;
    app.link.onFrame = onFrame;
    app.link.onEvent = onDevEvent;
    app.link.start();
  }
  bootLine('starting hand renderer');
  buildMenu();
  initUi();
  setProgress(100);
  clearInterval(tick);
  const wait = Math.max(0, 3300 - (performance.now() - t0));
  await sleep(wait);
  await go('landing');
}

/* ======================================================= device callbacks */
let lastUi = 0;
function onStatus() {
  updateStatusUI();
  if (app.runner) app.runner.onStatus();
}
function onFrame(out, meta) {
  feedHands(out);
  const now = performance.now();
  if (now - lastUi > 120) {
    lastUi = now;
    if (app.screen === 'menu') updateMeters(out, meta);
    if (app.screen === 'play') updateReadout(out);
  }
}
function onDevEvent(ev) { if (app.runner) app.runner.onEvent(ev); }
function updateReadout(out) {
  const lab = $('#roLabel');
  const rest = out.label === 'REST';
  lab.textContent = rest ? (out.readyIn > 0.04 ? `REST · ${out.readyIn.toFixed(1)}s` : 'REST · ready') : out.label;
  lab.classList.toggle('rest', rest);
  $('#roConf').style.width = clamp(out.conf * 100, 0, 100) + '%';
  $('#roSub').textContent = rest ? 'hand relaxed' : `finger ${LETTER[out.label] || ''} · ${Math.round(out.conf * 100)}% sure`;
}

/* ======================================================= menu */
function buildMenu() {
  const grid = $('#gameGrid');
  grid.innerHTML = '';
  const best = bestScores();
  GAMES.forEach((g, i) => {
    const m = g.meta;
    const b = document.createElement('button');
    b.className = 'gcard locked';
    b.style.animationDelay = i * 80 + 'ms';
    b.dataset.id = m.id;
    b.innerHTML = `<span class="lock">NPG OFFLINE</span><div class="gi">${m.icon}</div><h3>${m.title}</h3><div class="gtag">${m.tag}</div><p>${m.blurb}</p>
      <div class="gmeta"><span>${m.duration}</span><span>${best[m.id] != null ? 'best ' + best[m.id] : 'not played'}</span></div>`;
    b.onclick = () => { sfx.unlock(); sfx.click(); openInstructions(g); };
    grid.appendChild(b);
  });
  $('#devId').textContent = 'device ' + CONFIG.deviceId;
  updateStatusUI();
  refreshModelBadge();
}
function refreshModelBadge() {
  const mi = app.modelInfo;
  $('#modelBadge').textContent = !mi ? 'model: none' : mi.demo ? 'model: DEMO (simulator)' : `model: yours (${mi.source})`;
}

/* ======================================================= instructions */
function openInstructions(g) {
  app.selected = g; app.option = g.meta.options ? g.meta.options[0].id : null;
  const m = g.meta;
  $('#insIcon').innerHTML = m.icon; $('#insTag').textContent = m.tag; $('#insTitle').textContent = m.title;
  $('#insObjective').textContent = m.objective;
  $('#insSteps').innerHTML = m.steps.map((s) => `<li>${s}</li>`).join('');
  $('#insScoring').textContent = m.scoring; $('#insTrains').textContent = m.trains;
  $('#insDur').textContent = 'Duration: ' + m.duration;
  $('#fmap').innerHTML = FINGERS.map((f) => `<div style="border-color:${FINGER_COLOR[f]};color:${FINGER_COLOR[f]}"><b>${LETTER[f]}</b><span>${NAME[f]}</span></div>`).join('');
  const opts = $('#insOptions');
  if (m.options) {
    opts.innerHTML = '<h4>Choose</h4>' + m.options.map((o, i) => `<label class="${i ? '' : 'sel'}"><input type="radio" name="opt" value="${o.id}" ${i ? '' : 'checked'}> ${o.label}</label>`).join('');
    $$('input[name=opt]', opts).forEach((r) => r.onchange = () => { app.option = r.value; $$('label', opts).forEach((l) => l.classList.toggle('sel', l.querySelector('input').checked)); });
  } else opts.innerHTML = '';
  updateBegin();
  go('instructions');
}
function updateBegin() {
  const online = app.link && app.link.status === 'online';
  const b = $('#beginBtn');
  if (!b) return;
  b.disabled = !online || !app.selected;
  $('#beginNote').textContent = online ? 'Hand relaxed on the table, palm up. Ready when you are.' : 'NPG offline: you can read the instructions, but the trial starts when your NPG is online.';
}

/* ======================================================= game runner */
class Runner {
  constructor(game, option) {
    this.game = game; this.option = option;
    this.cv = $('#stage'); this.ctx = this.cv.getContext('2d');
    this.ov = $('#overlay');
    this.phase = 'prep';       // prep | count | play | paused | done
    this.clock = 0; this.last = performance.now(); this.raf = null; this.manualPause = false;
    this.inst = null; this.disconnected = false; this.countStart = 0; this.restSince = null; this.calibStart = null;
    this.rng = Math.random;
    this.host = {
      log: (e) => app.metrics.log(e), sfx, rng: () => this.rng(),
      setTargets: (t) => { const h = app.hands.playHand; if (h) h.setTargets(t); },
    };
  }
  start() {
    app.metrics.begin(this.game.meta.id);
    this.phase = 'prep';
    this.showPrep();
    this.loop();
  }
  input() {
    const o = app.link.latest;
    const finger = FINGERS.includes(o.label) ? o.label : null;
    return { label: o.label, finger, isRest: o.label === 'REST', readyIn: o.readyIn, conf: o.conf, activity: o.activity || 0, online: app.link.status === 'online' };
  }
  setOverlay(html) { this.ov.innerHTML = html; this.ov.classList.remove('hidden'); }
  clearOverlay() { this.ov.classList.add('hidden'); this.ov.innerHTML = ''; }
  showPrep() {
    this.setOverlay(`<h2>RELAX YOUR HAND</h2><p id="prepMsg">Rest your forearm, palm up, fingers loose. Keep still...</p><div class="meter" style="width:260px"><i id="prepBar"></i></div>`);
    this.restSince = null; this.calibStart = null;
  }
  loop() {
    this.raf = requestAnimationFrame(() => this.loop());
    const nowMs = performance.now();
    let dt = Math.min(0.1, (nowMs - this.last) / 1000);
    this.last = nowMs;
    if (!app.link) return;
    const inp = this.input();
    const online = app.link.status === 'online';
    if (this.phase === 'prep') this.stepPrep(inp, dt, nowMs);
    else if (this.phase === 'count') this.stepCount(nowMs);
    else if (this.phase === 'play') {
      if (!online) { this.pause('lost'); }
      else {
        this.clock += dt;
        this.game.update(this.clock, inp, dt);
        if (this.game.done) { this.finish(); return; }
      }
    } else if (this.phase === 'paused') {
      if (this.disconnected && online && inp.isRest && inp.readyIn <= 0.05) {
        if (this.restSince === null) this.restSince = nowMs;
        if (nowMs - this.restSince > 1200) { this.disconnected = false; this.resume(); }
      } else this.restSince = null;
    }
    this.draw(inp);
  }
  stepPrep(inp, dt, nowMs) {
    const online = app.link.status === 'online';
    const msg = $('#prepMsg'), bar = $('#prepBar');
    if (!online) { if (msg) msg.textContent = 'Waiting for the NPG signal...'; this.restSince = null; return; }
    const calm = inp.isRest && inp.readyIn <= 0.05 && app.link.latest.ready;
    if (!calm) { this.restSince = null; this.calibStart = null; if (msg) msg.textContent = app.link.latest.ready ? 'Relax your whole hand and keep still...' : 'Warming up the filters...'; if (bar) bar.style.width = '0%'; return; }
    if (this.restSince === null) this.restSince = nowMs;
    const need = app.calibrated ? 1200 : 3600;
    if (!app.calibrated && this.calibStart === null && nowMs - this.restSince > 600) { app.link.pipe.startCalibration(); this.calibStart = nowMs; }
    const prog = clamp((nowMs - this.restSince) / need, 0, 1);
    if (bar) bar.style.width = prog * 100 + '%';
    if (msg) msg.textContent = app.calibrated ? 'Good. Hold still...' : 'Learning your resting signal... hold still';
    if (nowMs - this.restSince >= need) {
      if (!app.calibrated) { app.link.pipe.finishCalibration(); app.calibrated = true; }
      this.phase = 'count'; this.countStart = nowMs;
    }
  }
  stepCount(nowMs) {
    const n = 3 - Math.floor((nowMs - this.countStart) / 900);
    if (n !== this.lastCount) {
      this.lastCount = n;
      if (n > 0) { this.setOverlay(`<p>${this.game.meta.title}</p><div class="big-num">${n}</div>`); sfx.tick(); }
      else { this.clearOverlay(); sfx.go(); this.phase = 'play'; this.clock = 0; this.last = performance.now(); this.lastCount = null; }
    }
  }
  onEvent(ev) {
    if (this.phase !== 'play') return;
    this.game.onEvent(ev, this.clock);
  }
  onStatus() {
    if (this.phase === 'play' && app.link.status !== 'online') this.pause('lost');
  }
  pause(why) {
    if (this.phase !== 'play') return;
    this.phase = 'paused';
    this.disconnected = why === 'lost';
    this.restSince = null;
    if (why === 'lost') this.setOverlay(`<h2>SIGNAL LOST</h2><p>The NPG stopped sending data. The trial is paused and resumes by itself once it reconnects and your hand is relaxed.</p><div class="btns"><button class="btn danger" id="ovQuit">Quit to list</button></div>`);
    else this.setOverlay(`<h2>PAUSED</h2><p>Relax your hand, then press Resume.</p><div class="btns"><button class="btn primary" id="ovResume">Resume</button><button class="btn danger" id="ovQuit">Quit to list</button></div>`);
    const r = $('#ovResume'); if (r) r.onclick = () => this.resume();
    const q = $('#ovQuit'); if (q) q.onclick = () => endRun(true);
    $('#pauseBtn').textContent = 'Resume';
  }
  resume() {
    if (this.phase !== 'paused') return;
    this.clearOverlay();
    this.phase = 'count'; this.countStart = performance.now(); this.lastCount = null; this.manualPause = false;
    $('#pauseBtn').textContent = 'Pause';
  }
  togglePause() {
    if (this.phase === 'play') { this.manualPause = true; this.pause('manual'); }
    else if (this.phase === 'paused' && !this.disconnected) this.resume();
  }
  draw(inp) {
    const c = this.ctx;
    c.clearRect(0, 0, SW, SH);
    if (this.phase === 'play' || this.phase === 'paused' || this.phase === 'done') this.game.draw(c, inp, this.clock);
    else { c.fillStyle = 'rgba(0,0,0,0)'; c.fillRect(0, 0, SW, SH); }
  }
  finish() {
    this.phase = 'done';
    const res = this.game.result(this.clock);
    app.hands.playHand && app.hands.playHand.setTargets([]);
    app.metrics.commit({ title: this.game.meta.title, score: res.score, percent: res.percent, durationS: res.durationS, lines: res.lines });
    const rep = buildReport(app.metrics.trials, app.metrics.games);
    app.lastReport = rep;
    const entry = { ts: Date.now(), game: this.game.meta.id, score: res.score, overall: rep.overall, cats: rep.categories, stats: { percent: res.percent } };
    saveHistory(entry);
    pushSession(app.rtdb, CONFIG.deviceId, entry);
    sfx.win();
    const lines = res.lines.map((l) => `<div><span>${l[0]}</span><b>${l[1]}</b></div>`).join('');
    this.setOverlay(`<div class="card res-card"><div class="eyebrow">TRIAL COMPLETE · ${this.game.meta.title.toUpperCase()}</div><div class="res-score">${Math.round(res.score)}</div>
      <div class="res-lines">${lines}</div>
      <div class="btns"><button class="btn primary" id="resReport">View health report</button><button class="btn ghost" id="resAgain">Play again</button><button class="btn ghost" id="resHome">Choose another trial</button></div></div>`);
    $('#resReport').onclick = () => { endRun(false); openReport(); };
    $('#resAgain').onclick = () => { const g = this.game, o = this.option; endRun(false); startGame(g, o); };
    $('#resHome').onclick = () => endRun(true);
    buildMenu();
  }
  stop() { cancelAnimationFrame(this.raf); this.raf = null; this.host.setTargets([]); }
}
function startGame(g, option) {
  if (!app.link || app.link.status !== 'online') return;
  sfx.unlock();
  if (app.runner) { app.runner.stop(); app.runner = null; }
  const r = new Runner(g, option);
  r.game = g.create(r.host, option);
  r.game.meta = g.meta;
  app.runner = r;
  $('#pauseBtn').textContent = 'Pause';
  go('play').then(() => { if (app.runner === r) r.start(); });
}
function endRun(toMenu) {
  const r = app.runner;
  if (r) {
    if (r.phase !== 'done') app.metrics.abort();
    r.stop(); app.runner = null;
  }
  $('#overlay').classList.add('hidden');
  if (toMenu) go('menu');
}

/* ======================================================= report */
function openReport() {
  const rep = buildReport(app.metrics.trials, app.metrics.games);
  app.lastReport = rep;
  renderReport($('#reportBody'), rep, insights(rep), {
    history: loadHistory(), games: app.metrics.games, deviceId: CONFIG.deviceId, modelDemo: !!(app.modelInfo && app.modelInfo.demo),
  });
  go('report');
}

/* ======================================================= setup modal + misc ui */
function initUi() {
  $('#startBtn').onclick = () => { sfx.unlock(); sfx.go(); go('menu'); };
  $('#homeBtn').onclick = () => { sfx.click(); if (app.runner) endRun(true); else go('menu'); };
  $('#insBack').onclick = () => go('menu');
  $('#repHome').onclick = () => go('menu');
  $('#reportBtn').onclick = () => openReport();
  $('#beginBtn').onclick = () => startGame(app.selected, app.option);
  $('#pauseBtn').onclick = () => app.runner && app.runner.togglePause();
  $('#quitBtn').onclick = () => endRun(true);
  $('#soundBtn').onclick = () => { sfx.muted = !sfx.muted; $('#soundBtn').classList.toggle('muted-on', sfx.muted); sfx.unlock(); };
  $('#handCheckBtn').onclick = () => handCheck();
  $('#setupBtn').onclick = openSetup;
  $('#setClose').onclick = () => $('#modal').classList.add('hidden');
  $('#setSave').onclick = saveSetup;
  $('#setClear').onclick = () => { clearHistory(); app.metrics.clear(); buildMenu(); $('#setClear').textContent = 'Cleared'; };
  $('#setFile').onchange = loadModelFile;
  window.addEventListener('resize', startHands);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!$('#modal').classList.contains('hidden')) $('#modal').classList.add('hidden'); else if (app.runner && app.runner.phase === 'play') app.runner.togglePause(); }
  });
  if (CONFIG.dev) initDev();
}
async function handCheck() {
  if (!app.link || app.link.status !== 'online') return;
  const btn = $('#handCheckBtn');
  btn.disabled = true;
  const pipe = app.link.pipe;
  pipe.startCalibration();
  for (let i = 4; i > 0; i--) { btn.textContent = `Relax... ${i}`; await sleep(1000); }
  const ok = pipe.finishCalibration();
  app.calibrated = ok || app.calibrated;
  btn.textContent = ok ? 'Hand check done ✓' : 'Not enough signal, retry';
  await sleep(1600);
  btn.textContent = 'Hand check (4 s)';
  updateStatusUI();
}
function openSetup() {
  $('#setDevice').value = CONFIG.deviceId;
  const mi = app.modelInfo;
  $('#setModel').textContent = !mi ? 'No model loaded.' : mi.demo ? 'DEMO model (for the simulator). Run tools/export_model_json.py --upload to use your own.' : `Your model (${mi.source})${mi.updated ? ', updated ' + new Date(mi.updated).toLocaleString() : ''}.`;
  $('#setConn').textContent = `Database: ${CONFIG.dbUrl.replace(/^https?:\/\//, '')} · cloud ${app.cloudOk ? 'reachable' : 'not reachable'} · status ${app.link ? app.link.status : 'n/a'}`;
  $('#setDev').checked = CONFIG.dev;
  $('#setDev').closest('.field').style.display = CONFIG.isLocal ? '' : 'none';
  $('#modal').classList.remove('hidden');
}
function saveSetup() {
  const id = $('#setDevice').value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'NPG01';
  try { localStorage.setItem('ikm_device', id); } catch (e) { /* ignore */ }
  const wantDev = $('#setDev').checked;
  const u = new URL(location.href);
  if (wantDev) u.searchParams.set('dev', '1'); else u.searchParams.delete('dev');
  if (id !== CONFIG.deviceId || wantDev !== CONFIG.dev) location.href = u.toString(); else $('#modal').classList.add('hidden');
}
async function loadModelFile(e) {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    const model = JSON.parse(await f.text());
    if (model.format !== 'ikm-model-1') throw new Error('not a model.json from export_model_json.py');
    app.modelInfo = { model, source: 'file', demo: !!model.demo, updated: Date.now() };
    app.link.setModel(model);
    refreshModelBadge(); openSetup();
  } catch (err) { $('#setModel').textContent = 'Could not load: ' + err.message; }
}

/* ======================================================= developer tools (?dev=1) */
function initDev() {
  const p = $('#devpanel');
  p.classList.remove('hidden');
  const keys = ['REST', ...FINGERS];
  p.innerHTML = `<div>DEV · keys 0-5 · <button id="dvLocal">local inject</button> <button id="dvCloud">cloud sim label</button></div><div id="dvKeys"></div>`;
  $('#dvKeys').innerHTML = keys.map((k, i) => `<button data-k="${k}">${i}:${k}</button>`).join('');
  let mode = 'local';
  const set = (k) => {
    $$('#dvKeys button').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    if (mode === 'local') { if (!app.link.dev) app.link.devStart(); app.link.devSet(k); }
    else app.rtdb.put(`sim/${CONFIG.deviceId}/label`, k === 'REST' ? '' : k).catch(() => {});
  };
  $('#dvLocal').onclick = () => { mode = 'local'; app.link.devStart(); };
  $('#dvCloud').onclick = () => { mode = 'cloud'; app.link.devStop(); };
  $$('#dvKeys button').forEach((b) => (b.onclick = () => set(b.dataset.k)));
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const i = '012345'.indexOf(e.key);
    if (i >= 0) set(keys[i]);
  });
}

boot().catch((e) => {
  console.error(e);
  const li = document.createElement('li'); li.className = 'bad'; li.innerHTML = `startup error <b>[${String(e.message || e)}]</b>`; $('#bootLog').appendChild(li);
});
void shuffle;
