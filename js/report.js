// report.js - draws the prosthesis-readiness report from the numbers produced by metrics.js
import { FINGER_COLOR, fmtMs, fmtDate, clamp } from './util.js';
import { FINGER_LIST, CATEGORY_INFO } from './metrics.js';

const NAME = { THUMB: 'Thumb', INDEX: 'Index', MIDDLE: 'Middle', RING: 'Ring', LITTLE: 'Little' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const score = (v) => (v == null ? '–' : Math.round(v));
const bandColor = (v) => (v == null ? '#6b8ba3' : v >= 85 ? '#3dffb5' : v >= 70 ? '#19e3ff' : v >= 50 ? '#ffc233' : '#ff3d71');

export const REFERENCES = [
  ['Assessment of Capacity for Myoelectric Control (ACMC)', 'Observer-rated assessment of how well a person controls a myoelectric hand; its items are grouped into gripping, holding, releasing and coordinating (Örebro University).'],
  ['Southampton Hand Assessment Procedure (SHAP)', 'Timed hand-function test of abstract objects and daily-living tasks, scored against an able-bodied reference of 100.'],
  ['Box and Block Test', 'Counts how many blocks a person can move from one compartment to another in 60 seconds (gross manual dexterity). The Pick & Place trial follows this idea.'],
  ['Target Achievement Control (TAC) test', 'Virtual test: move a virtual hand to a target posture and hold it for a set time. The Hold Steady trial follows this idea.'],
];

export function renderReport(root, rep, ins, ctx) {
  const { history = [], games = [], deviceId = '', modelDemo = false } = ctx;
  const cats = rep.categories;
  root.innerHTML = `
    <div class="rep-head">
      <div>
        <div class="eyebrow">PROSTHESIS READINESS REPORT</div>
        <h2>Finger control analysis</h2>
        <div class="muted">${esc(fmtDate(rep.generated))} · device ${esc(deviceId)} · ${rep.counts.games} trial${rep.counts.games === 1 ? '' : 's'} played${rep.provisional ? ' · <b class="warn">provisional (fewer than 3 control areas assessed)</b>' : ''}${modelDemo ? ' · <b class="warn">DEMO model (simulator)</b>' : ''}</div>
      </div>
      <div class="rep-actions no-print">
        <button class="btn ghost" id="repJson">Download data (JSON)</button>
        <button class="btn ghost" id="repPrint">Print / Save as PDF</button>
      </div>
    </div>

    <div class="rep-top">
      <div class="gauge card">
        <canvas id="gaugeCv" width="260" height="260"></canvas>
        <div class="gauge-text"><div class="big" style="color:${bandColor(rep.overall)}">${score(rep.overall)}</div><div class="small">/ 100</div><div class="band" style="color:${bandColor(rep.overall)}">${esc(rep.band || 'Not enough data')}</div></div>
      </div>
      <div class="card radar"><canvas id="radarCv" width="420" height="300"></canvas></div>
    </div>

    <div class="cat-grid">
      ${['gripping', 'holding', 'releasing', 'coordinating'].map((k) => `
        <div class="card cat">
          <div class="cat-top"><span>${CATEGORY_INFO[k].label}</span><b style="color:${bandColor(cats[k])}">${score(cats[k])}</b></div>
          <div class="meter"><i style="width:${cats[k] == null ? 0 : clamp(cats[k], 0, 100)}%;background:${bandColor(cats[k])}"></i></div>
          <p>${CATEGORY_INFO[k].blurb}${cats[k] == null ? ' <em>Not assessed yet.</em>' : ''}</p>
        </div>`).join('')}
    </div>

    <div class="two-col">
      <div class="card">
        <h3>What your finger patterns show</h3>
        <ul class="list">${ins.findings.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        <h3>Next steps</h3>
        <ul class="list next">${ins.next.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
      </div>
      <div class="card">
        <h3>Key measurements</h3>
        <table class="tbl">
          <tr><td>Correct isolated finger</td><td>${rep.accuracy == null ? '–' : Math.round(rep.accuracy) + '%'}</td></tr>
          <tr><td>Median response time</td><td>${fmtMs(rep.medianLatencyMs)}</td></tr>
          <tr><td>Hold steadiness</td><td>${rep.holdStability == null ? '–' : Math.round(rep.holdStability) + '%'}</td></tr>
          <tr><td>Carry success</td><td>${rep.carrySuccess == null ? '–' : Math.round(rep.carrySuccess) + '%'}</td></tr>
          <tr><td>Median release time</td><td>${fmtMs(rep.medianReleaseMs)}</td></tr>
          <tr><td>Unintended activations</td><td>${rep.falseActivations}${rep.falseRatePerMin != null ? ' (' + rep.falseRatePerMin.toFixed(1) + ' / min)' : ''}</td></tr>
          <tr><td>Longest remembered sequence</td><td>${rep.sequenceBest == null ? '–' : rep.sequenceBest + ' fingers'}</td></tr>
          <tr><td>Signal strength change</td><td>${rep.fatigue == null ? '–' : (rep.fatigue > 0 ? '−' : '+') + Math.abs(Math.round(rep.fatigue * 100)) + '% over session'}</td></tr>
        </table>
      </div>
    </div>

    <div class="card">
      <h3>Finger by finger</h3>
      <div class="two-col tight">
        <table class="tbl wide">
          <tr><th>Finger</th><th>Tries</th><th>Correct</th><th>Median time</th><th>Most often read as</th></tr>
          ${FINGER_LIST.map((f) => {
            const p = rep.perFinger[f];
            const leak = Object.entries(p.leaks).sort((a, b) => b[1] - a[1])[0];
            return `<tr><td><i class="dot" style="background:${FINGER_COLOR[f]}"></i>${NAME[f]}</td><td>${p.attempts}</td>
              <td>${p.accuracy == null ? '–' : `<div class="mini"><i style="width:${p.accuracy}%;background:${bandColor(p.accuracy)}"></i></div> ${Math.round(p.accuracy)}%`}</td>
              <td>${fmtMs(p.rtMs)}</td><td>${leak ? (leak[0] === 'none' ? 'no movement' : NAME[leak[0]] || leak[0]) + ' ×' + leak[1] : '–'}</td></tr>`;
          }).join('')}
        </table>
        <div><canvas id="confCv" width="420" height="300"></canvas><div class="muted tiny">Rows: finger you were asked to use. Columns: what was detected. A bright diagonal means clean, isolated fingers.</div></div>
      </div>
    </div>

    <div class="two-col">
      <div class="card"><h3>Trials played</h3>
        <table class="tbl wide"><tr><th>Trial</th><th>Score</th><th>Result</th></tr>
        ${games.map((g) => `<tr><td>${esc(g.title || g.id)}</td><td>${Math.round(g.score)}</td><td>${(g.lines || []).slice(0, 2).map((l) => esc(l[0]) + ': ' + esc(l[1])).join(' · ')}</td></tr>`).join('') || '<tr><td colspan="3">none yet</td></tr>'}
        </table></div>
      <div class="card"><h3>Progress over your sessions</h3><canvas id="trendCv" width="420" height="220"></canvas>
        <div class="muted tiny">${history.length ? history.length + ' saved result' + (history.length === 1 ? '' : 's') + ' on this device.' : 'Your progress will appear here after a few games.'}</div></div>
    </div>

    <div class="card refs">
      <h3>How this relates to clinical prosthesis assessment</h3>
      <p>The four control areas above (gripping, holding, releasing, coordinating) are the same areas used by the ACMC, which clinicians use to rate how well someone controls a myoelectric hand. The trials here borrow ideas from standard tests, but they are <b>not</b> those tests.</p>
      <ul class="list">${REFERENCES.map((r) => `<li><b>${esc(r[0])}.</b> ${esc(r[1])}</li>`).join('')}</ul>
      <p class="disclaimer"><b>Important:</b> this is a training and research prototype, not a medical device. Scores are indicative feedback from your own finger patterns (including about 1 s of the system's own detection delay) and are not a diagnosis or a clinical assessment. Talk to a prosthetist or occupational therapist about real prosthesis decisions.</p>
    </div>`;

  drawGauge(root.querySelector('#gaugeCv'), rep.overall);
  drawRadar(root.querySelector('#radarCv'), cats);
  drawConfusion(root.querySelector('#confCv'), rep.confusion);
  drawTrend(root.querySelector('#trendCv'), history);
  const j = root.querySelector('#repJson');
  if (j) j.onclick = () => {
    const blob = new Blob([JSON.stringify({ report: rep, insights: ins, games }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `ikm-report-${Date.now()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const p = root.querySelector('#repPrint');
  if (p) p.onclick = () => window.print();
}

function prep(cv) { const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height); return c; }

function drawGauge(cv, v) {
  if (!cv) return;
  const c = prep(cv), cx = cv.width / 2, cy = cv.height / 2;
  c.lineWidth = 18; c.lineCap = 'round';
  c.strokeStyle = 'rgba(25,227,255,0.12)'; c.beginPath(); c.arc(cx, cy, 104, Math.PI * 0.75, Math.PI * 2.25); c.stroke();
  if (v != null) {
    c.strokeStyle = bandColor(v); c.shadowColor = bandColor(v); c.shadowBlur = 16;
    c.beginPath(); c.arc(cx, cy, 104, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * clamp(v / 100, 0, 1)); c.stroke();
  }
}

function drawRadar(cv, cats) {
  if (!cv) return;
  const c = prep(cv), cx = cv.width / 2, cy = cv.height / 2 + 6, R = 100;
  const keys = ['gripping', 'holding', 'releasing', 'coordinating'];
  c.strokeStyle = 'rgba(25,227,255,0.25)'; c.lineWidth = 1;
  for (let ring = 1; ring <= 4; ring++) {
    c.beginPath();
    keys.forEach((k, i) => { const a = -Math.PI / 2 + (i * Math.PI * 2) / 4; const x = cx + Math.cos(a) * R * (ring / 4), y = cy + Math.sin(a) * R * (ring / 4); i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.closePath(); c.stroke();
  }
  keys.forEach((k, i) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 4;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); c.stroke();
    c.fillStyle = '#d9f4ff'; c.font = '600 15px Rajdhani, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(CATEGORY_INFO[k].label, cx + Math.cos(a) * (R + 30), cy + Math.sin(a) * (R + 22));
  });
  c.beginPath();
  keys.forEach((k, i) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 4, r = R * clamp((cats[k] ?? 0) / 100, 0, 1);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  });
  c.closePath();
  c.fillStyle = 'rgba(25,227,255,0.22)'; c.fill();
  c.strokeStyle = '#19e3ff'; c.lineWidth = 2.5; c.shadowColor = '#19e3ff'; c.shadowBlur = 12; c.stroke();
}

function drawConfusion(cv, conf) {
  if (!cv) return;
  const c = prep(cv);
  const cols = [...FINGER_LIST, 'none'];
  const x0 = 78, y0 = 34, cw = 54, ch = 40;
  c.font = '600 13px Rajdhani, sans-serif'; c.textBaseline = 'middle';
  cols.forEach((k, j) => { c.fillStyle = '#6b8ba3'; c.textAlign = 'center'; c.fillText(k === 'none' ? 'none' : NAME[k], x0 + j * cw + cw / 2, y0 - 14); });
  FINGER_LIST.forEach((f, i) => {
    const row = conf[f] || {};
    const total = Object.values(row).reduce((s, v) => s + v, 0);
    c.fillStyle = FINGER_COLOR[f]; c.textAlign = 'right'; c.fillText(NAME[f], x0 - 10, y0 + i * ch + ch / 2);
    cols.forEach((k, j) => {
      const v = row[k] || 0, frac = total ? v / total : 0;
      c.fillStyle = `rgba(${k === f ? '61,255,181' : '255,61,113'},${total ? 0.1 + 0.8 * frac : 0.05})`;
      c.fillRect(x0 + j * cw + 2, y0 + i * ch + 2, cw - 4, ch - 4);
      if (v) { c.fillStyle = '#04101a'; c.fillStyle = '#e8fbff'; c.textAlign = 'center'; c.fillText(String(v), x0 + j * cw + cw / 2, y0 + i * ch + ch / 2); }
    });
  });
}

function drawTrend(cv, history) {
  if (!cv) return;
  const c = prep(cv);
  const pts = history.filter((h) => typeof h.overall === 'number').slice(-24);
  const x0 = 34, y0 = 16, w = cv.width - 54, h = cv.height - 44;
  c.strokeStyle = 'rgba(25,227,255,0.15)'; c.lineWidth = 1; c.fillStyle = '#6b8ba3'; c.font = '12px Rajdhani, sans-serif'; c.textAlign = 'right';
  [0, 50, 100].forEach((v) => { const y = y0 + h - (v / 100) * h; c.beginPath(); c.moveTo(x0, y); c.lineTo(x0 + w, y); c.stroke(); c.fillText(String(v), x0 - 6, y + 4); });
  if (pts.length < 2) { c.fillStyle = '#6b8ba3'; c.textAlign = 'center'; c.font = '15px Rajdhani, sans-serif'; c.fillText(pts.length ? 'one result saved - play more to see a trend' : 'no saved results yet', x0 + w / 2, y0 + h / 2); return; }
  c.beginPath();
  pts.forEach((p, i) => { const x = x0 + (i / (pts.length - 1)) * w, y = y0 + h - (clamp(p.overall, 0, 100) / 100) * h; i ? c.lineTo(x, y) : c.moveTo(x, y); });
  c.strokeStyle = '#3dffb5'; c.lineWidth = 2.5; c.shadowColor = '#3dffb5'; c.shadowBlur = 10; c.stroke(); c.shadowBlur = 0;
  pts.forEach((p, i) => { const x = x0 + (i / (pts.length - 1)) * w, y = y0 + h - (clamp(p.overall, 0, 100) / 100) * h; c.fillStyle = '#04101a'; c.strokeStyle = '#3dffb5'; c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill(); c.stroke(); });
}
