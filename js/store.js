// store.js - keeps your history (this browser) and sends a small summary of each game to Firebase.

const KEY = 'ikm_history_v1';

export function loadHistory() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}

export function saveHistory(entry) {
  const h = loadHistory();
  h.push(entry);
  while (h.length > 200) h.shift();
  try { localStorage.setItem(KEY, JSON.stringify(h)); } catch (e) { /* storage full or blocked */ }
  return h;
}

export function clearHistory() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

export function bestScores() {
  const best = {};
  for (const h of loadHistory()) {
    if (h.game && typeof h.score === 'number') best[h.game] = Math.max(best[h.game] || 0, h.score);
  }
  return best;
}

// Best effort: failing (offline, rules) never disturbs the game.
export async function pushSession(rtdb, deviceId, entry) {
  const body = {
    ts: entry.ts, game: String(entry.game).slice(0, 32), score: Math.round(entry.score || 0),
    summary: JSON.stringify({ overall: entry.overall, cats: entry.cats, stats: entry.stats || null }).slice(0, 8000),
  };
  const key = `${entry.ts}-${Math.random().toString(36).slice(2, 7)}`;
  try { await rtdb.put(`sessions/${deviceId}/${key}`, body, 5000); return true; } catch (e) { return false; }
}
