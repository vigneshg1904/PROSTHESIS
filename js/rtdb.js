// rtdb.js - minimal Firebase Realtime Database client (REST + server-sent events).
// No SDK, no CDN: the whole site works from plain static files.

export class Rtdb {
  constructor(baseUrl) {
    this.base = baseUrl.replace(/\/+$/, '');
  }
  url(path, params = {}) {
    const p = String(path).replace(/^\/+|\/+$/g, '');
    const q = new URLSearchParams(params).toString();
    return `${this.base}/${p}.json${q ? '?' + q : ''}`;
  }
  async get(path, timeoutMs = 5000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(this.url(path), { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }
  async put(path, data, timeoutMs = 6000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch(this.url(path, { print: 'silent' }), {
        method: 'PUT', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' }, signal: ctl.signal,
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return true;
    } finally {
      clearTimeout(t);
    }
  }
  // Live stream of one node. Calls onData(value) with the node's FULL current value after every change.
  stream(path, { onData, onOpen, onError }) {
    let cache = null;
    let es = null;
    let closed = false;
    const setPath = (root, p, val) => {
      const parts = p.split('/').filter(Boolean);
      if (!parts.length) return val;
      root = root && typeof root === 'object' ? root : {};
      let cur = root;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      const last = parts[parts.length - 1];
      if (val === null) delete cur[last];
      else cur[last] = val;
      return root;
    };
    const open = () => {
      if (closed) return;
      es = new EventSource(this.url(path));
      es.onopen = () => onOpen && onOpen();
      es.onerror = () => { if (onError) onError(es.readyState === 2 ? 'closed' : 'reconnecting'); };
      es.addEventListener('put', (ev) => {
        try {
          const m = JSON.parse(ev.data);
          cache = setPath(cache, m.path, m.data);
          if (m.path === '/') cache = m.data;
          onData(cache);
        } catch (e) { /* ignore malformed event */ }
      });
      es.addEventListener('patch', (ev) => {
        try {
          const m = JSON.parse(ev.data);
          for (const k of Object.keys(m.data || {})) cache = setPath(cache, (m.path === '/' ? '' : m.path) + '/' + k, m.data[k]);
          onData(cache);
        } catch (e) { /* ignore */ }
      });
      es.addEventListener('cancel', () => { if (onError) onError('cancelled'); });
      es.addEventListener('auth_revoked', () => { if (onError) onError('auth'); });
    };
    open();
    return {
      close() { closed = true; if (es) es.close(); },
      reopen() { if (es) es.close(); open(); },
      get readyState() { return es ? es.readyState : 2; },
    };
  }
}
