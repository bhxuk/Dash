// Links: rendering in four layouts, the editor, categories, bulk import and
// the homelab app presets.

import { api, isDemo } from './api.js';
import { app, commit, COLORS, COLOR_NAMES, categoryName, render } from './state.js';
import { parse, review, decode } from './importer.js';
import { $, $$, h, clear, uid, toast, openDialog, confirmDialog, ago, hostOf, initials } from './util.js';

// name, port, path, icon, description, scheme
export const HOMELAB_APPS = [
  ['Plex', 32400, '/web', '▶', 'Movies, TV and music.'],
  ['Sonarr', 8989, '', 'S', 'TV series.'],
  ['Radarr', 7878, '', 'R', 'Movies.'],
  ['Prowlarr', 9696, '', 'P', 'Indexers.'],
  ['Bazarr', 6767, '', 'B', 'Subtitles.'],
  ['qBittorrent', 8080, '', 'qB', 'Downloads.'],
  ['Seerr', 5055, '', 'SE', 'Discover and request media.'],
  ['Tautulli', 8181, '', 'T', 'Plex stats and history.'],
  ['Home Assistant', 8123, '', '⌂', 'Smart home.'],
  ['Portainer', 9443, '', 'PT', 'Docker containers.', 'https'],
  ['Glances', 61208, '', 'G', 'Live system monitor.'],
  ['HomeLabStats', 8090, '', '>_', 'Your server at a glance.'],
  ['Pulse', 7655, '', 'PU', 'Monitoring.'],
  ['ROMM', 54001, '', 'RM', 'Retro game library.'],
  ['PDFDing', 49312, '', 'PD', 'PDF library.'],
  ['Windows 11', 4444, '', '⊞', 'Windows VM in the browser.'],
  ['Plex Burner', 9000, '', 'PB', 'Plex tools.'],
  ['Jellyfin', 8096, '', 'J', 'Media server.'],
  ['Overseerr', 5055, '', 'O', 'Media requests.'],
  ['Pi-hole', 80, '/admin', 'π', 'Network ad blocking.'],
  ['Uptime Kuma', 3001, '', 'UK', 'Uptime monitoring.'],
  ['Nextcloud', 443, '', 'NC', 'Files and calendars.', 'https'],
  ['Immich', 2283, '', 'IM', 'Photos and videos.'],
  ['Router', 80, '', '⌁', 'Your home router.'],
];

// ---------------------------------------------------------------- queries

export function visibleLinks() {
  const { state, view, search, sort } = app;
  let links = state.links;
  if (view.type === 'category') links = links.filter(l => l.category === view.id);
  if (view.type === 'favourites') links = links.filter(l => l.pinned);
  if (view.type === 'recent') links = links.filter(l => l.lastVisited).sort((a, b) => b.lastVisited - a.lastVisited).slice(0, 30);
  if (search) {
    const q = search.toLowerCase();
    links = links.filter(l => [l.name, l.url, l.description, categoryName(l.category)].join(' ').toLowerCase().includes(q));
  }
  if (view.type !== 'recent') {
    if (sort === 'name') links = [...links].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'frequent') links = [...links].sort((a, b) => b.visits - a.visits);
    if (sort === 'recent') links = [...links].sort((a, b) => b.lastVisited - a.lastVisited);
  }
  return links;
}

// --------------------------------------------------------------- opening

export function openLink(link, event) {
  // Let the browser follow the real <a href>; just record the visit.
  link.visits += 1;
  link.lastVisited = Date.now();
  api('visit', 'POST', { id: link.id }).catch(() => {});
  if (event?.currentTarget?.tagName !== 'A') window.open(link.url, '_blank', 'noopener,noreferrer');
}

function linkIcon(link, size = '') {
  const style = { '--c': link.color };
  if (link.image) return h('span', { class: 'link-icon has-image ' + size, style }, h('img', { src: link.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }));
  return h('span', { class: 'link-icon ' + size, style }, link.icon || initials(link.name));
}

function linkActions(link) {
  return h('span', { class: 'link-actions' },
    h('button', { class: 'iconbtn small' + (link.pinned ? ' on' : ''), title: link.pinned ? 'Unpin' : 'Pin to favourites', 'aria-label': 'Pin ' + link.name,
      onclick: () => commit(s => { s.links.find(l => l.id === link.id).pinned = !link.pinned; }) }, link.pinned ? '★' : '☆'),
    h('button', { class: 'iconbtn small', title: 'Preview', 'aria-label': 'Preview ' + link.name, onclick: () => preview(link) }, '◉'),
    h('button', { class: 'iconbtn small', title: 'Edit', 'aria-label': 'Edit ' + link.name, onclick: () => editLink(link) }, '✎'));
}

function anchor(link, cls, ...children) {
  return h('a', { class: cls, href: link.url, target: '_blank', rel: 'noopener noreferrer', onclick: e => openLink(link, e) }, ...children);
}

function card(link, draggable) {
  const el = h('article', { class: 'link-card', style: { '--c': link.color }, dataset: { id: link.id }, draggable: draggable ? 'true' : null },
    anchor(link, 'link-main', linkIcon(link),
      h('span', { class: 'link-text' }, h('b', {}, link.name), h('small', {}, link.description || hostOf(link.url)))),
    linkActions(link));
  if (draggable) wireDrag(el);
  return el;
}

function row(link) {
  return h('tr', {},
    h('td', {}, anchor(link, 'table-link', linkIcon(link, 'sm'), h('b', {}, link.name))),
    h('td', { class: 'dim mono' }, hostOf(link.url)),
    h('td', {}, categoryName(link.category)),
    h('td', { class: 'dim' }, ago(link.lastVisited)),
    h('td', { class: 'right' }, linkActions(link)));
}

function tvTile(link) {
  return anchor(link, 'tv-tile', link.image ? h('img', { src: link.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : null,
    h('span', { class: 'tv-icon', style: { '--c': link.color } }, link.icon || initials(link.name)),
    h('b', {}, link.name));
}

/** Render a set of links in the configured layout. */
export function linkCollection(links, { groupTv = true, draggable = false } = {}) {
  const layout = app.state.settings.layout;
  if (!links.length) return null;
  if (layout === 'table') {
    return h('div', { class: 'table-wrap' }, h('table', { class: 'link-table' },
      h('thead', {}, h('tr', {}, ['Name', 'Address', 'Category', 'Opened', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, links.map(row))));
  }
  if (layout === 'tv') {
    const groups = groupTv
      ? app.state.categories.map(c => [c, links.filter(l => l.category === c.id)]).filter(([, ls]) => ls.length)
      : [[null, links]];
    return h('div', { class: 'tv' }, groups.map(([cat, ls]) => h('section', { class: 'tv-shelf' },
      cat && h('h3', {}, cat.icon + ' ' + cat.name), h('div', { class: 'tv-row' }, ls.map(tvTile)))));
  }
  return h('div', { class: 'link-grid ' + layout }, links.map(l => card(l, draggable)));
}

// ------------------------------------------------------------ drag reorder

let dragged = null;
function wireDrag(el) {
  el.addEventListener('dragstart', e => { dragged = el.dataset.id; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
  el.addEventListener('dragend', () => { dragged = null; el.classList.remove('dragging'); });
  el.addEventListener('dragover', e => { if (dragged && dragged !== el.dataset.id) { e.preventDefault(); el.classList.add('drop'); } });
  el.addEventListener('dragleave', () => el.classList.remove('drop'));
  el.addEventListener('drop', e => {
    e.preventDefault();
    el.classList.remove('drop');
    const from = dragged, to = el.dataset.id;
    if (!from || from === to) return;
    commit(s => {
      const moving = s.links.find(l => l.id === from);
      const target = s.links.find(l => l.id === to);
      s.links.splice(s.links.indexOf(moving), 1);
      s.links.splice(s.links.indexOf(target), 0, moving);
      if (app.view.type === 'category') moving.category = target.category;
    });
  });
}

// ------------------------------------------------------------- the view

export function linksView() {
  const { view, state } = app;
  const titles = { all: ['ALL LINKS', 'Everything you saved'], favourites: ['FAVOURITES', 'Your pinned links'], recent: ['RECENT', 'Recently opened'] };
  const cat = view.type === 'category' ? state.categories.find(c => c.id === view.id) : null;
  const [eyebrow, title] = cat ? ['CATEGORY', cat.icon + ' ' + cat.name] : titles[view.type];
  const links = visibleLinks();
  const draggable = app.sort === 'custom' && !app.search && view.type !== 'recent';
  return h('section', { class: 'view links-view' },
    h('div', { class: 'view-head' },
      h('div', {}, h('div', { class: 'eyebrow' }, eyebrow), h('h1', {}, title), h('p', { class: 'dim' }, `${links.length} link${links.length === 1 ? '' : 's'}`)),
      h('div', { class: 'row' }, ...linkToolbar())),
    linkCollection(links, { groupTv: view.type !== 'category', draggable }) || emptyLinks());
}

export function linkToolbar() {
  const sort = h('select', { 'aria-label': 'Sort links', onchange: e => { app.sort = e.target.value; render(); } },
    [['custom', 'Custom order'], ['name', 'A–Z'], ['frequent', 'Most opened'], ['recent', 'Recently opened']]
      .map(([v, t]) => h('option', { value: v, selected: app.sort === v }, t)));
  const layout = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Layout' },
    [['compact', '▦', 'Compact'], ['cards', '▢', 'Cards'], ['table', '☰', 'List'], ['tv', '▭', 'TV']].map(([v, icon, label]) =>
      h('button', { class: app.state.settings.layout === v ? 'active' : '', title: label, 'aria-label': label + ' layout',
        onclick: () => commit(s => { s.settings.layout = v; s.settings.compact = v === 'compact'; }) }, icon)));
  return [sort, layout,
    h('button', { class: 'btn', onclick: () => openBulk() }, '⇪ Import'),
    h('button', { class: 'btn primary', onclick: () => editLink() }, '+ Add link')];
}

function emptyLinks() {
  if (app.search) return h('div', { class: 'empty' }, h('b', {}, 'No links match your search.'), h('p', {}, 'Try another word, or clear the search box.'));
  return h('div', { class: 'empty' }, h('b', {}, 'Nothing here yet.'),
    h('p', {}, 'Add a link, import your browser bookmarks or add your server apps in one go.'),
    h('div', { class: 'row center' },
      h('button', { class: 'btn primary', onclick: () => editLink() }, '+ Add link'),
      h('button', { class: 'btn', onclick: () => openBulk() }, '⇪ Import bookmarks'),
      h('button', { class: 'btn', onclick: () => openApps() }, '▣ Add server apps')));
}

// ---------------------------------------------------------------- editor

function categoryOptions(select, selected) {
  clear(select, app.state.categories.map(c => h('option', { value: c.id }, c.icon + ' ' + c.name)));
  select.value = selected || app.state.categories[0].id;
}

export function editLink(link = null) {
  const dialog = $('#linkDialog');
  const form = $('#linkForm');
  form.reset();
  $('#linkTitle').textContent = link ? 'Edit link' : 'Add a link';
  categoryOptions(form.category, link?.category || (app.view.type === 'category' ? app.view.id : null));
  clear(form.color, COLORS.map((c, i) => h('option', { value: c }, COLOR_NAMES[i])));
  form.color.value = link?.color || COLORS[app.state.links.length % COLORS.length];
  for (const key of ['name', 'url', 'description', 'icon', 'image']) form[key].value = link?.[key] || '';
  form.pinned.checked = link ? link.pinned : app.view.type === 'favourites';
  $('#deleteLink').hidden = !link;
  $('#deleteLink').onclick = async () => {
    if (!await confirmDialog(`Delete “${link.name}”?`, 'Delete link')) return;
    dialog.close();
    commit(s => { s.links = s.links.filter(l => l.id !== link.id); }, 'Link deleted');
  };
  form.onsubmit = event => {
    event.preventDefault();
    const values = Object.fromEntries(['name', 'url', 'description', 'icon', 'image', 'category', 'color'].map(k => [k, form[k].value.trim()]));
    try {
      for (const key of ['url', 'image']) {
        if (!values[key] && key === 'image') continue;
        const u = new URL(values[key]);
        if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error();
      }
    } catch {
      toast('Use a full address starting with http:// or https://', 'error');
      return;
    }
    if (!link && app.state.links.length >= 2000) return toast('Dash holds up to 2,000 links.', 'error');
    dialog.close();
    commit(s => {
      const existing = link && s.links.find(l => l.id === link.id);
      if (existing) Object.assign(existing, values, { pinned: form.pinned.checked });
      else s.links.push({ id: uid(), ...values, pinned: form.pinned.checked, visits: 0, lastVisited: 0 });
    }, link ? 'Link updated' : 'Link added');
  };
  openDialog(dialog);
  form.name.focus();
}

export function preview(link) {
  $('#previewTitle').textContent = link.name;
  $('#previewOpen').href = link.url;
  $('#previewFrame').src = link.url;
  const dialog = openDialog($('#previewDialog'));
  dialog.addEventListener('close', () => { $('#previewFrame').src = 'about:blank'; }, { once: true });
}

// ------------------------------------------------------------ categories

export function openCategories() {
  const dialog = $('#categoryDialog');
  const draw = () => {
    const cats = app.state.categories;
    clear($('#categoryList'), cats.map((c, i) => {
      const count = app.state.links.filter(l => l.category === c.id).length;
      const icon = h('input', { value: c.icon, maxlength: 8, class: 'icon-input', 'aria-label': 'Icon for ' + c.name });
      const name = h('input', { value: c.name, maxlength: 40, 'aria-label': 'Name for ' + c.name });
      const save = () => {
        const n = name.value.trim();
        if (!n || (n === c.name && icon.value === c.icon)) return;
        commit(s => Object.assign(s.categories.find(x => x.id === c.id), { name: n, icon: icon.value.trim() || '◈' }));
      };
      icon.onchange = save;
      name.onchange = save;
      const move = d => commit(s => { const [x] = s.categories.splice(i, 1); s.categories.splice(i + d, 0, x); }).then(draw);
      return h('div', { class: 'category-row' }, icon, name, h('span', { class: 'dim mono' }, count),
        h('button', { class: 'iconbtn small', disabled: i === 0, 'aria-label': 'Move up', onclick: () => move(-1) }, '↑'),
        h('button', { class: 'iconbtn small', disabled: i === cats.length - 1, 'aria-label': 'Move down', onclick: () => move(1) }, '↓'),
        h('button', { class: 'iconbtn small danger', disabled: cats.length === 1, 'aria-label': 'Delete ' + c.name, onclick: () => removeCategory(c, count).then(draw) }, '✕'));
    }));
  };
  $('#categoryForm').onsubmit = event => {
    event.preventDefault();
    const form = event.target;
    const name = form.name.value.trim();
    if (!name) return;
    if (app.state.categories.length >= 50) return toast('Dash holds up to 50 categories.', 'error');
    commit(s => { s.categories.push({ id: uid(), name, icon: form.icon.value.trim() || '◈' }); }, 'Category added').then(draw);
    form.reset();
  };
  draw();
  openDialog(dialog);
}

async function removeCategory(cat, count) {
  const others = app.state.categories.filter(c => c.id !== cat.id);
  const target = others[0];
  const message = count
    ? `Delete “${cat.name}” and move its ${count} link${count === 1 ? '' : 's'} to “${target.name}”?`
    : `Delete the empty category “${cat.name}”?`;
  if (!await confirmDialog(message, 'Delete category')) return;
  if (app.view.type === 'category' && app.view.id === cat.id) app.view = { type: 'all' };
  await commit(s => {
    s.links.forEach(l => { if (l.category === cat.id) l.category = target.id; });
    s.categories = s.categories.filter(c => c.id !== cat.id);
  }, 'Category deleted');
}

/** Find a category by name (case-insensitive) or create it. Returns its id. */
function ensureCategory(state, name, icon = '◈') {
  const found = state.categories.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  if (state.categories.length >= 50) return state.categories[0].id;
  const id = uid();
  state.categories.push({ id, name: name.slice(0, 40), icon });
  return id;
}

// ----------------------------------------------------------- bulk import

let bulkRows = [];

export function openBulk(text = '') {
  const dialog = $('#bulkDialog');
  bulkRows = [];
  $('#bulkText').value = text;
  categoryOptions($('#bulkCategory'), app.view.type === 'category' ? app.view.id : null);
  $('#bulkTable').hidden = $('#bulkSummary').hidden = true;
  $('#bulkApply').disabled = true;
  $('#bulkReview').onclick = () => showReview(parse($('#bulkText').value));
  $('#bulkChoose').onclick = () => $('#bulkFiles').click();
  $('#bulkFiles').onchange = async event => {
    const files = [...event.target.files];
    event.target.value = '';
    const total = files.reduce((n, f) => n + f.size, 0);
    if (total > 4 * 1024 * 1024) return toast('Choose up to 4 MB of files at a time.', 'error');
    const rows = [];
    for (const file of files) rows.push(...parse(decode(await file.arrayBuffer()), file.name));
    showReview(rows);
  };
  $('#bulkApply').onclick = applyBulk;
  openDialog(dialog);
}

function showReview(rows) {
  bulkRows = review(rows, app.state.links);
  const ready = bulkRows.filter(r => r.status === 'ready').length;
  const dupes = bulkRows.filter(r => r.status === 'duplicate').length;
  const bad = bulkRows.length - ready - dupes;
  const summary = $('#bulkSummary');
  summary.hidden = false;
  summary.textContent = bulkRows.length
    ? `${ready} ready to import · ${dupes} already saved · ${bad} could not be read`
    : 'No links found. Paste URLs or choose files.';
  const table = $('#bulkTable');
  table.hidden = !bulkRows.length;
  const update = () => { $('#bulkApply').disabled = !bulkRows.some(r => r.selected); };
  clear(table, h('table', { class: 'link-table' },
    h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'Name'), h('th', {}, 'URL'), h('th', {}, 'Category'), h('th', {}, 'Status'))),
    h('tbody', {}, bulkRows.map(r => h('tr', { class: r.status },
      h('td', {}, h('input', { type: 'checkbox', checked: r.selected, disabled: r.status !== 'ready', 'aria-label': 'Import ' + r.name,
        onchange: e => { r.selected = e.target.checked; update(); } })),
      h('td', {}, r.status === 'invalid' ? r.name : h('input', { value: r.name, maxlength: 80, 'aria-label': 'Name', onchange: e => { r.name = e.target.value.trim() || r.name; } })),
      h('td', { class: 'mono dim clip' }, r.url),
      h('td', {}, r.category || h('span', { class: 'dim' }, 'Default')),
      h('td', { class: 'status', title: r.error || '' }, r.status === 'ready' ? 'Ready' : r.status === 'duplicate' ? 'Duplicate' : r.error))))));
  update();
}

function applyBulk() {
  const chosen = bulkRows.filter(r => r.selected);
  if (app.state.links.length + chosen.length > 2000) return toast('That would go over 2,000 links. Import fewer at a time.', 'error');
  const fallback = $('#bulkCategory').value;
  const pinned = $('#bulkPinned').checked;
  $('#bulkDialog').close();
  if (!isDemo) api('backup', 'POST', {}).catch(() => {});
  commit(s => {
    chosen.forEach((r, i) => s.links.push({
      id: uid(), name: r.name, url: r.url, description: r.description.slice(0, 500),
      category: r.category ? ensureCategory(s, r.category) : fallback,
      icon: '', image: '', color: COLORS[(s.links.length + i) % COLORS.length], pinned, visits: 0, lastVisited: 0,
    }));
  }, `${chosen.length} link${chosen.length === 1 ? '' : 's'} imported`);
}

// ---------------------------------------------------------- homelab apps

export function openApps() {
  const dialog = $('#appsDialog');
  const form = $('#appsForm');
  const host = $('#appsHost');
  host.value = localStorage.getItem('dash-apps-host') || (isDemo ? 'server.local' : location.hostname);
  const homelab = app.state.categories.find(c => /homelab|server|apps/i.test(c.name));
  categoryOptions($('#appsCategory'), homelab?.id);
  const existing = new Set(app.state.links.map(l => l.name.toLowerCase()));
  clear($('#appsList'), HOMELAB_APPS.map(([name, port, path, icon, desc, scheme], i) => {
    const added = existing.has(name.toLowerCase());
    return h('label', { class: 'app-option' + (added ? ' added' : '') },
      h('input', { type: 'checkbox', name: 'app', value: i, checked: false, disabled: added }),
      h('span', { class: 'link-icon sm', style: { '--c': COLORS[i % COLORS.length] } }, icon),
      h('span', { class: 'app-text' }, h('b', {}, name), h('small', {}, added ? 'Already added' : desc)),
      h('input', { type: 'number', name: 'port' + i, value: port, min: 1, max: 65535, class: 'port', 'aria-label': name + ' port', disabled: added }));
  }));
  $('#appsAll').onclick = () => $$('input[name=app]:not(:disabled)', form).forEach(x => { x.checked = true; });
  form.onsubmit = event => {
    event.preventDefault();
    const server = host.value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const picked = $$('input[name=app]:checked', form).map(x => Number(x.value));
    if (!server || !picked.length) return toast('Enter the server address and tick at least one app.', 'error');
    try { new URL('http://' + server); } catch { return toast('That server address is not valid.', 'error'); }
    localStorage.setItem('dash-apps-host', server);
    const category = $('#appsCategory').value;
    dialog.close();
    commit(s => {
      for (const i of picked) {
        const [name, , path, icon, description, scheme = 'http'] = HOMELAB_APPS[i];
        const port = Number(form['port' + i].value) || HOMELAB_APPS[i][1];
        const portPart = (scheme === 'http' && port === 80) || (scheme === 'https' && port === 443) ? '' : ':' + port;
        s.links.push({ id: uid(), name, url: `${scheme}://${server}${portPart}${path}`, description, category, icon,
          image: '', color: COLORS[i % COLORS.length], pinned: false, visits: 0, lastVisited: 0 });
      }
    }, `${picked.length} app${picked.length === 1 ? '' : 's'} added`);
  };
  openDialog(dialog);
}
