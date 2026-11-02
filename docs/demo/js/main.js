// Dash entry point: boot, navigation, overview and global shortcuts.

import { api, isDemo } from './api.js';
import { app, load, onChange, render, commit } from './state.js';
import { linksView, linkCollection, linkToolbar, editLink, openBulk, openApps, openCategories, visibleLinks } from './links.js';
import { homeView, favouriteDevices, loadConfig, syncPolling, homeCount } from './home.js';
import { clockPanel, tickClocks, greeting, tasksPanel } from './widgets.js';
import { openSettings, wireSettings, applyUpdate } from './settings.js';
import { $, h, clear, toast } from './util.js';

// ------------------------------------------------------------ routing

function parseHash() {
  const [type, id] = location.hash.replace(/^#/, '').split('/');
  if (type === 'category' && app.state?.categories.some(c => c.id === id)) return { type, id };
  if (['all', 'favourites', 'recent', 'home', 'cameras'].includes(type)) return { type, id: null };
  return { type: 'overview', id: null };
}

function go(hash) {
  if (location.hash === '#' + hash) return;
  location.hash = hash;
}

window.addEventListener('hashchange', () => {
  app.view = parseHash();
  document.body.classList.remove('menu-open');
  render();
  $('#main').focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
});

// ------------------------------------------------------------ sidebar

function navItem(hash, icon, label, count, active) {
  return h('a', { class: 'navitem' + (active ? ' active' : ''), href: '#' + hash, 'aria-current': active ? 'page' : null },
    h('b', {}, icon), h('span', {}, label), count !== undefined && count !== null ? h('span', { class: 'nav-count' }, count) : null);
}

function renderSidebar() {
  const { state, view, home } = app;
  const is = (type, id = null) => view.type === type && view.id === id;
  clear($('#mainNav'),
    navItem('overview', '⌂', 'Overview', null, is('overview')),
    navItem('all', '▦', 'All links', state.links.length, is('all')),
    navItem('favourites', '★', 'Favourites', state.links.filter(l => l.pinned).length, is('favourites')),
    navItem('recent', '◷', 'Recent', null, is('recent')));
  const cameras = home.entities.filter(e => e.domain === 'camera' && !state.home.hidden.includes(e.id)).length;
  clear($('#homeNav'),
    navItem('home', '💡', 'Devices', home.config.configured ? homeCount() || null : null, is('home')),
    navItem('cameras', '◉', 'Cameras', home.config.configured ? cameras || null : null, is('cameras')),
    !home.config.configured ? h('button', { class: 'sidebar-add', onclick: () => openSettings('home') }, 'Connect Home Assistant', h('span', {}, '→')) : null);
  clear($('#categoryNav'), state.categories.map(c =>
    navItem('category/' + c.id, c.icon, c.name, state.links.filter(l => l.category === c.id).length, is('category', c.id))));
}

// ------------------------------------------------------------ overview

function overviewView() {
  const s = app.state;
  const pinned = visibleLinks().filter(l => l.pinned);
  const rest = app.search ? visibleLinks().filter(l => !l.pinned) : [];
  const quick = h('div', { class: 'quick' },
    h('button', { class: 'quick-card', onclick: () => editLink() }, h('b', {}, '+'), h('span', {}, 'Add a link')),
    h('button', { class: 'quick-card', onclick: () => openBulk() }, h('b', {}, '⇪'), h('span', {}, 'Import bookmarks')),
    h('button', { class: 'quick-card', onclick: () => openApps() }, h('b', {}, '▣'), h('span', {}, 'Add server apps')),
    h('button', { class: 'quick-card', onclick: () => app.home.config.configured ? go('home') : openSettings('home') },
      h('b', {}, '⌂'), h('span', {}, app.home.config.configured ? 'Smart home' : 'Connect smart home')));

  return h('div', { class: 'overview' },
    h('div', { class: 'overview-main' },
      h('section', { class: 'hero' },
        h('div', { class: 'hero-copy' },
          h('div', { class: 'eyebrow' }, s.settings.name.toUpperCase()),
          h('h1', {}, greeting(s.settings.timezone) + '.'),
          h('p', { class: 'dim' }, `${s.links.length} links · ${s.categories.length} categories` +
            (app.home.config.configured ? ` · ${homeCount()} smart devices` : '')),
          quick),
        clockPanel()),
      favouriteDevices(),
      h('section', { class: 'panel-block' },
        h('div', { class: 'block-head' }, h('h2', {}, app.search ? '⌕ Search results' : '★ Favourites'), h('div', { class: 'row' }, ...linkToolbar().slice(1, 2)), h('a', { href: '#all', class: 'dim' }, 'All links →')),
        linkCollection([...pinned, ...rest], { groupTv: false }) ||
          h('p', { class: 'dim' }, app.search ? 'No links match your search.' : 'Pin links with ☆ to keep them here.')),
      !app.search ? s.categories.map(c => {
        const links = s.links.filter(l => l.category === c.id && !l.pinned);
        return links.length ? h('section', { class: 'panel-block' },
          h('div', { class: 'block-head' }, h('h2', {}, c.icon + ' ' + c.name), h('a', { href: '#category/' + c.id, class: 'dim' }, `${links.length} →`)),
          linkCollection(links.slice(0, 24), { groupTv: false })) : null;
      }) : null),
    h('aside', { class: 'overview-side' }, tasksPanel()));
}

// ------------------------------------------------------------ render

function renderView() {
  const { type } = app.view;
  const view = type === 'overview' ? overviewView()
    : type === 'home' || type === 'cameras' ? homeView()
    : linksView();
  clear($('#view'), view);
}

function applyTheme() {
  const s = app.state.settings;
  document.body.dataset.theme = s.theme;
  document.body.dataset.background = s.background;
  document.documentElement.style.setProperty('--accent', s.accent);
  $('#topName').textContent = s.name.toUpperCase();
  document.title = `${s.name} · Dash`;
}

onChange(() => {
  if (!app.state) return;
  // Keep focus on the search box while typing.
  const active = document.activeElement;
  const keep = active && active.id && $('#view').contains(active) ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
  applyTheme();
  renderSidebar();
  renderView();
  syncPolling();
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) { el.focus(); try { el.setSelectionRange(keep.start, keep.end); } catch { /* not a text field */ } }
  }
});

// ------------------------------------------------------------ boot

function wireGlobal() {
  $('#search').addEventListener('input', e => {
    app.search = e.target.value.trim();
    if (app.search && !['overview', 'all', 'home', 'cameras', 'category', 'favourites'].includes(app.view.type)) go('all');
    render();
  });
  $('#themeToggle').onclick = () => commit(s => { s.settings.theme = s.settings.theme === 'dark' ? 'light' : 'dark'; });
  $('#openSettings').onclick = () => openSettings();
  $('#addCategory').onclick = () => openCategories();
  $('#menuToggle').onclick = () => document.body.classList.toggle('menu-open');
  document.addEventListener('dash:settings', e => openSettings(e.detail));
  document.addEventListener('visibilitychange', syncPolling);
  document.addEventListener('keydown', e => {
    const typing = e.target.closest('input, textarea, select, [contenteditable]');
    if (e.key === '/' && !typing) { e.preventDefault(); $('#search').focus(); }
    if (e.key === 'Escape' && e.target.id === 'search') { e.target.value = ''; app.search = ''; render(); }
    if (e.key === 'n' && !typing && !e.ctrlKey && !e.metaKey && !document.querySelector('dialog[open]')) { e.preventDefault(); editLink(); }
  });
  // Arrow keys move between TV launcher tiles.
  document.addEventListener('keydown', e => {
    const tile = e.target.closest?.('.tv-tile');
    if (!tile || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const tiles = [...document.querySelectorAll('.tv-tile')];
    const rows = [...document.querySelectorAll('.tv-row')];
    const rowEl = tile.closest('.tv-row');
    if (e.key === 'ArrowLeft') tile.previousElementSibling?.focus();
    if (e.key === 'ArrowRight') tile.nextElementSibling?.focus();
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const index = [...rowEl.children].indexOf(tile);
      const next = rows[rows.indexOf(rowEl) + (e.key === 'ArrowUp' ? -1 : 1)];
      (next?.children[Math.min(index, next.children.length - 1)] || tiles[0]).focus();
    }
    tile.parentElement && document.activeElement.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  setInterval(tickClocks, 1000);
}

// ------------------------------------------------------------ updates

/**
 * Every minute: reload when the server is running a newer version (for example
 * after an automatic update), and show a banner when an update is ready.
 */
async function watchForUpdates() {
  if (isDemo) return;
  const banner = $('#updateBanner');
  try {
    const health = await api('health');
    if (app.version && health.version !== app.version) {
      clear(banner, `Dash updated to ${health.version}. Reloading…`);
      banner.hidden = false;
      setTimeout(() => location.reload(), 1500);
      return;
    }
    const status = await api('updates');
    if (status.state === 'updating' || status.state === 'restarting') {
      clear(banner, `Installing Dash ${status.latest}… this page will reload by itself.`);
    } else if (status.available && status.canUpdate && !status.auto) {
      clear(banner, `Dash ${status.latest} is ready to install. `,
        h('button', { class: 'btn small primary', onclick: () => applyUpdate() }, 'Update now'),
        h('button', { class: 'btn small', onclick: () => openSettings('updates') }, 'What’s new'));
    } else {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
  } catch {
    /* server restarting; try again next minute */
  }
}

async function boot() {
  if (isDemo) $('#demoBanner').hidden = false;
  wireGlobal();
  wireSettings();
  try {
    const [health] = await Promise.all([api('health'), loadConfig(), load()]);
    app.version = health.version;
    $('#version').textContent = health.version;
    app.view = parseHash();
    render();
    watchForUpdates();
    setInterval(watchForUpdates, 60 * 1000);
  } catch (error) {
    clear($('#view'), h('div', { class: 'empty' }, h('b', {}, 'Dash could not load your dashboard.'), h('p', {}, error.message),
      h('button', { class: 'btn primary', onclick: () => location.reload() }, 'Try again')));
    $('#connection').textContent = 'OFFLINE';
    $('#connectionPill').classList.add('bad');
    toast(error.message, 'error');
  }
}

boot();
