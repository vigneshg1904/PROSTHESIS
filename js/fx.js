// fx.js - the living background: circuit traces that draw themselves, signal pulses and a scrolling ECG line.

export function startBackground(canvas) {
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let W = 0, H = 0, dpr = 1, cell = 30, cols = 0, rows = 0;
  let trails, tracers = [], raf = null, last = 0, running = true;
  const COLORS = ['25,227,255', '61,255,181', '120,170,255'];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = canvas.width = Math.floor(innerWidth * dpr);
    H = canvas.height = Math.floor(innerHeight * dpr);
    canvas.style.width = innerWidth + 'px';
    canvas.style.height = innerHeight + 'px';
    cell = Math.round(30 * dpr);
    cols = Math.ceil(W / cell); rows = Math.ceil(H / cell);
    trails = document.createElement('canvas');
    trails.width = W; trails.height = H;
    tracers = [];
    const n = Math.min(46, Math.round((cols * rows) / 38));
    for (let i = 0; i < n; i++) tracers.push(spawn());
  }
  function spawn() {
    return {
      x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows),
      dir: Math.floor(Math.random() * 4), life: 30 + Math.floor(Math.random() * 90),
      col: COLORS[Math.floor(Math.random() * COLORS.length)], wait: 0,
    };
  }
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];

  function stepTracers(tc) {
    tc.lineCap = 'round';
    for (let i = 0; i < tracers.length; i++) {
      const t = tracers[i];
      if (t.wait-- > 0) continue;
      t.wait = 2;
      const px = t.x * cell, py = t.y * cell;
      if (Math.random() < 0.18) t.dir = (t.dir + (Math.random() < 0.5 ? 1 : 3)) % 4;
      t.x += DX[t.dir]; t.y += DY[t.dir];
      if (t.x < 0 || t.y < 0 || t.x >= cols || t.y >= rows || --t.life <= 0) {
        // end of a trace: drop a solder pad
        tc.fillStyle = `rgba(${t.col},0.9)`;
        tc.beginPath(); tc.arc(px, py, 3 * dpr, 0, Math.PI * 2); tc.fill();
        tracers[i] = spawn();
        continue;
      }
      tc.strokeStyle = `rgba(${t.col},0.75)`;
      tc.lineWidth = 1.4 * dpr;
      tc.beginPath(); tc.moveTo(px, py); tc.lineTo(t.x * cell, t.y * cell); tc.stroke();
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!running || now - last < 55) return;       // ~18 fps is plenty for a background
    last = now;
    const tc = trails.getContext('2d');
    tc.globalCompositeOperation = 'destination-out';
    tc.fillStyle = 'rgba(0,0,0,0.035)';
    tc.fillRect(0, 0, W, H);
    tc.globalCompositeOperation = 'source-over';
    stepTracers(tc);
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(trails, 0, 0);
    ctx.globalAlpha = 1;
    // scrolling ECG along the lower part of the screen
    const t = now / 1000;
    const base = H * 0.88, amp = 26 * dpr;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 4 * dpr) {
      const u = ((x / dpr) / 340 - t * 0.35) % 1;
      const v = u < 0 ? u + 1 : u;
      let y = 0;
      if (v > 0.30 && v < 0.34) y = -0.22 * Math.sin(((v - 0.30) / 0.04) * Math.PI);
      else if (v > 0.40 && v < 0.43) y = 0.18 * ((v - 0.40) / 0.03);
      else if (v >= 0.43 && v < 0.47) y = 0.18 - 1.3 * ((v - 0.43) / 0.04);
      else if (v >= 0.47 && v < 0.51) y = -1.12 + 1.5 * ((v - 0.47) / 0.04);
      else if (v >= 0.51 && v < 0.55) y = 0.38 * (1 - (v - 0.51) / 0.04);
      else if (v > 0.65 && v < 0.78) y = -0.28 * Math.sin(((v - 0.65) / 0.13) * Math.PI);
      const py = base + y * amp;
      if (x === 0) ctx.moveTo(x, py); else ctx.lineTo(x, py);
    }
    ctx.strokeStyle = 'rgba(61,255,181,0.35)';
    ctx.lineWidth = 1.6 * dpr;
    ctx.shadowColor = 'rgba(61,255,181,0.7)'; ctx.shadowBlur = 10 * dpr;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  resize();
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { running = !document.hidden; });
  if (!reduce) raf = requestAnimationFrame(frame);
  else { ctx.clearRect(0, 0, W, H); }
  return { stop() { if (raf) cancelAnimationFrame(raf); raf = null; window.removeEventListener('resize', resize); } };
}
