// mock_rtdb.mjs - a tiny local stand-in for Firebase Realtime Database + a static file server.
// Lets you test the whole website (and the simulated NPG) with NO internet and NO Firebase.
//
//   node dev/mock_rtdb.mjs                (serves the site on http://localhost:8787 and the database on /db)
//   open  http://localhost:8787/?dev=1&db=http://localhost:8787/db
//   python tools/sim_device.py --db http://localhost:8787/db
//
// Supported: GET/PUT/PATCH/POST/DELETE on /db/<path>.json , ?print=silent , and the streaming (SSE) protocol.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(opt('port', 8787));
const ROOT = path.resolve(opt('root', path.join(__dirname, '..')));

let tree = null;
const watchers = new Set();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain', '.md': 'text/plain' };

const parts = (p) => p.split('/').filter(Boolean);
function getAt(p) {
  let cur = tree;
  for (const k of parts(p)) { if (cur === null || typeof cur !== 'object' || !(k in cur)) return null; cur = cur[k]; }
  return cur === undefined ? null : cur;
}
function setAt(p, val) {
  const ks = parts(p);
  if (!ks.length) { tree = val; return; }
  if (tree === null || typeof tree !== 'object') tree = {};
  let cur = tree;
  for (let i = 0; i < ks.length - 1; i++) { if (cur[ks[i]] === null || typeof cur[ks[i]] !== 'object' || cur[ks[i]] === undefined) cur[ks[i]] = {}; cur = cur[ks[i]]; }
  const last = ks[ks.length - 1];
  if (val === null) delete cur[last]; else cur[last] = val;
}
function notify(changed) {
  for (const w of watchers) {
    if (changed.startsWith(w.path) || w.path.startsWith(changed)) {
      w.res.write(`event: put\ndata: ${JSON.stringify({ path: '/', data: getAt(w.path) })}\n\n`);
    }
  }
}
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,PUT,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
let pushCounter = 0;
const pushId = () => '-M' + Date.now().toString(36) + (pushCounter++).toString(36).padStart(3, '0');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

  if (url.pathname.startsWith('/db/') && url.pathname.endsWith('.json')) {
    const p = url.pathname.slice(4, -5);
    if (req.method === 'GET' && (req.headers.accept || '').includes('text/event-stream')) {
      res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const w = { path: p, res };
      watchers.add(w);
      res.write(`event: put\ndata: ${JSON.stringify({ path: '/', data: getAt(p) })}\n\n`);
      const ka = setInterval(() => res.write('event: keep-alive\ndata: null\n\n'), 15000);
      req.on('close', () => { watchers.delete(w); clearInterval(ka); });
      return;
    }
    if (req.method === 'GET') { res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); return res.end(JSON.stringify(getAt(p))); }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', () => {
      let data = null;
      try { data = body ? JSON.parse(body) : null; } catch (e) { res.writeHead(400, cors); return res.end('{"error":"bad json"}'); }
      let reply = data;
      if (req.method === 'PUT') setAt(p, data);
      else if (req.method === 'PATCH') { const cur = getAt(p) || {}; setAt(p, { ...(typeof cur === 'object' ? cur : {}), ...data }); }
      else if (req.method === 'POST') { const id = pushId(); setAt(p + '/' + id, data); reply = { name: id }; }
      else if (req.method === 'DELETE') { setAt(p, null); reply = null; }
      notify(p);
      if (url.searchParams.get('print') === 'silent') { res.writeHead(204, cors); return res.end(); }
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
    return;
  }

  // static files
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
});
server.listen(PORT, () => console.log(`mock Firebase + site on http://localhost:${PORT}  (database at /db, site root ${ROOT})`));
