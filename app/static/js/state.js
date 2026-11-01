// Shared application state and the save queue.
// Every change goes through `commit`, which applies it locally, then saves the
// whole dashboard with its revision so edits from another tab are never lost.

import { api } from './api.js';
import { toast } from './util.js';

export const COLORS = ['#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#60a5fa'];
export const COLOR_NAMES = ['Cyan', 'Violet', 'Mint', 'Amber', 'Pink', 'Blue'];

export const app = {
  state: null,          // dashboard.json as returned by the server
  version: '',
  view: { type: 'overview', id: null },
  search: '',
  sort: 'custom',
  home: { config: { configured: false }, entities: [], error: '', loading: false, updated: 0 },
};

const listeners = new Set();
export const onChange = fn => listeners.add(fn);
export const render = () => listeners.forEach(fn => fn());

let queue = Promise.resolve();

export async function load() {
  app.state = await api('state');
  render();
}

/**
 * Apply `mutate(state)` and persist. Resolves true when saved.
 * On a conflict the latest server copy is loaded and the change is reported.
 */
let pending = 0;

export function commit(mutate, success) {
  mutate(app.state);
  render();
  pending++;
  const job = queue.then(async () => {
    try {
      const saved = await api('state', 'PUT', app.state);
      // Later edits are already applied locally; only adopt the new revision for them.
      if (pending > 1) app.state.revision = saved.revision;
      else app.state = saved;
      setSaveState('Saved to your server');
      if (success) toast(success);
      return true;
    } catch (error) {
      toast(error.message, 'error');
      if (error.status === 409 || error.status === 400) {
        try { app.state = await api('state'); } catch { /* keep local copy */ }
      }
      setSaveState('Not saved', true);
      return false;
    } finally {
      pending--;
      render();
    }
  });
  queue = job.catch(() => {});
  return job;
}

export function setSaveState(text, bad = false) {
  const el = document.getElementById('saveState');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('bad', bad);
}

export const categoryName = id => app.state.categories.find(c => c.id === id)?.name || 'Uncategorised';
