// Smart home: devices from Home Assistant (lights, Google Cast/Nest media,
// Aqara and other cameras, climate, switches, sensors) with live controls.

import { api, cameraUrl } from './api.js';
import { app, commit, render } from './state.js';
import { $, h, toast, openDialog, debounce } from './util.js';

const POLL_MS = 5000;

export const FILTERS = [
  ['all', 'All', '◈'],
  ['light', 'Lights', '💡'],
  ['camera', 'Cameras', '◉'],
  ['media_player', 'Speakers & TVs', '♫'],
  ['climate', 'Climate', '🌡'],
  ['switch', 'Switches', '⏻'],
  ['sensor', 'Sensors', '◔'],
  ['scene', 'Scenes', '✦'],
];
const FILTER_DOMAINS = {
  switch: ['switch', 'input_boolean', 'fan', 'cover', 'vacuum', 'lock'],
  sensor: ['sensor', 'binary_sensor'],
  scene: ['scene', 'script', 'button'],
};
const ICONS = {
  light: '💡', switch: '⏻', input_boolean: '⏻', fan: '✲', media_player: '♫', camera: '◉', climate: '🌡',
  cover: '▤', vacuum: '◍', scene: '✦', script: '▷', button: '◎', lock: '🔒', binary_sensor: '◌', sensor: '◔',
};
const SWATCHES = [[255, 180, 107], [255, 255, 255], [255, 80, 60], [255, 170, 40], [80, 220, 120], [60, 160, 255], [170, 90, 255], [255, 90, 200]];

let filter = 'all';
let pollTimer = null;
let cameraTimer = null;

// -------------------------------------------------------------- data

export async function loadConfig() {
  try { app.home.config = await api('home/config'); } catch { app.home.config = { configured: false }; }
}

export async function refresh({ quiet = false } = {}) {
  if (!app.home.config.configured || app.home.loading) return;
  app.home.loading = true;
  try {
    const data = await api('home/entities');
    const before = app.home.entities.map(e => e.id).join();
    const hadError = app.home.error;
    app.home.entities = data.entities;
    app.home.error = '';
    app.home.updated = Date.now();
    // Same devices as before: patch changed tiles in place so sliders, menus and
    // camera images are not disturbed. Otherwise redraw the view.
    if (!hadError && before && before === data.entities.map(e => e.id).join()) patchTiles();
    else render();
  } catch (error) {
    const changed = app.home.error !== error.message;
    app.home.error = error.message;
    if (!quiet) toast(error.message, 'error');
    if (changed) render();
  } finally {
    app.home.loading = false;
  }
}

const rendered = new WeakMap(); // tile element -> JSON of the entity it shows

function patchTiles() {
  const byId = new Map(app.home.entities.map(e => [e.id, e]));
  document.querySelectorAll('[data-entity]').forEach(tile => {
    const e = byId.get(tile.dataset.entity);
    if (!e || rendered.get(tile) === JSON.stringify(e) || tile.contains(document.activeElement) || tile.matches(':active')) return;
    tile.replaceWith(deviceTile(e));
  });
  refreshSummaries();
  const stamp = document.getElementById('homeUpdated');
  if (stamp) stamp.textContent = `Live from Home Assistant · updated ${new Date(app.home.updated).toLocaleTimeString('en-GB')}`;
}

/** Poll while a view that shows devices is open and the tab is visible. */
export function syncPolling() {
  const needs = app.home.config.configured && !document.hidden &&
    (['home', 'cameras'].includes(app.view.type) || (app.view.type === 'overview' && app.state.home.favourites.length));
  if (needs && !pollTimer) {
    refresh({ quiet: true });
    pollTimer = setInterval(() => refresh({ quiet: true }), POLL_MS);
  } else if (!needs && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  syncCameraRefresh();
}

function syncCameraRefresh() {
  clearInterval(cameraTimer);
  if (document.hidden) return;
  cameraTimer = setInterval(() => {
    document.querySelectorAll('img[data-camera]').forEach(img => { img.src = cameraUrl(img.dataset.camera); });
  }, (app.state.home.cameraInterval || 10) * 1000);
}

async function act(entity, action, data) {
  try {
    const updated = await api('home/action', 'POST', { entity: entity.id, action, data });
    const index = app.home.entities.findIndex(e => e.id === entity.id);
    if (index >= 0) app.home.entities[index] = { ...updated, area: updated.area || entity.area };
    document.querySelectorAll(`[data-entity="${CSS.escape(entity.id)}"]`).forEach(tile => tile.replaceWith(deviceTile(app.home.entities[index])));
    refreshSummaries();
  } catch (error) {
    toast(error.message, 'error');
  }
}

const isFavourite = id => app.state.home.favourites.includes(id);
const toggleFavourite = entity => commit(s => {
  const list = s.home.favourites;
  if (list.includes(entity.id)) list.splice(list.indexOf(entity.id), 1); else list.push(entity.id);
}, isFavourite(entity.id) ? `Removed ${entity.name} from overview` : `${entity.name} pinned to overview`);
const hide = entity => commit(s => { s.home.hidden.push(entity.id); s.home.favourites = s.home.favourites.filter(x => x !== entity.id); }, `${entity.name} hidden`);

// ------------------------------------------------------------ tiles

const on = e => ['on', 'playing', 'open', 'heat', 'cool', 'auto', 'heat_cool', 'cleaning', 'unlocked', 'home'].includes(e.state);
const unavailable = e => ['unavailable', 'unknown'].includes(e.state);

function stateLabel(e) {
  const a = e.attributes;
  if (unavailable(e)) return 'Unavailable';
  if (e.domain === 'light' && e.state === 'on' && a.brightness) return `On · ${Math.round(a.brightness / 2.55)}%`;
  if (e.domain === 'sensor') return `${e.state}${a.unit_of_measurement ? ' ' + a.unit_of_measurement : ''}`;
  if (e.domain === 'climate') return `${a.current_temperature ?? '–'}° · ${e.state.replace('_', ' ')}`;
  if (e.domain === 'media_player' && a.media_title) return [a.media_title, a.media_artist || a.app_name].filter(Boolean).join(' · ');
  if (e.domain === 'binary_sensor') return e.state === 'on' ? ({ motion: 'Motion', door: 'Open', window: 'Open', opening: 'Open', moisture: 'Wet', occupancy: 'Occupied', presence: 'Home' }[a.device_class] || 'On') : ({ motion: 'Clear', door: 'Closed', window: 'Closed', opening: 'Closed', moisture: 'Dry', presence: 'Away' }[a.device_class] || 'Off');
  if (['scene', 'script', 'button'].includes(e.domain)) return e.domain === 'scene' ? 'Scene' : e.domain === 'script' ? 'Script' : 'Button';
  return e.state.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

function slider({ label, min, max, step = 1, value, onchange, cls = '' }) {
  const output = h('output', {}, value);
  const input = h('input', { type: 'range', min, max, step, value, 'aria-label': label, class: cls,
    oninput: e => { output.textContent = e.target.value; }, onchange: e => onchange(Number(e.target.value)) });
  return h('label', { class: 'slider' }, h('span', {}, label), input, output);
}

function lightControls(e) {
  const a = e.attributes;
  const modes = a.supported_color_modes || [];
  const dimmable = modes.some(m => m !== 'onoff');
  const colour = modes.some(m => ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'].includes(m));
  const temp = modes.includes('color_temp');
  if (!dimmable || unavailable(e)) return null;
  return h('div', { class: 'controls' },
    slider({ label: 'Brightness', min: 1, max: 100, value: e.state === 'on' ? Math.max(1, Math.round((a.brightness || 0) / 2.55)) : 50,
      onchange: v => act(e, 'turn_on', { brightness_pct: v }) }),
    temp && slider({ label: 'Warmth', min: a.min_color_temp_kelvin || 2000, max: a.max_color_temp_kelvin || 6500, step: 50,
      value: a.color_temp_kelvin || 3000, cls: 'kelvin', onchange: v => act(e, 'turn_on', { color_temp_kelvin: v }) }),
    colour && h('div', { class: 'swatches' }, SWATCHES.map(rgb => h('button', { class: 'swatch', style: { background: `rgb(${rgb})` },
      'aria-label': 'Set colour', onclick: () => act(e, 'turn_on', { rgb_color: rgb }) }))));
}

function mediaControls(e) {
  const a = e.attributes;
  if (unavailable(e)) return null;
  const off = ['off', 'standby'].includes(e.state);
  const setVolume = debounce(v => act(e, 'volume_set', { volume_level: v / 100 }), 150);
  return h('div', { class: 'controls' },
    h('div', { class: 'media-buttons' },
      h('button', { class: 'iconbtn', 'aria-label': 'Previous', disabled: off, onclick: () => act(e, 'previous') }, '⏮'),
      h('button', { class: 'iconbtn big', 'aria-label': 'Play or pause', disabled: off, onclick: () => act(e, 'play_pause') }, e.state === 'playing' ? '⏸' : '▶'),
      h('button', { class: 'iconbtn', 'aria-label': 'Next', disabled: off, onclick: () => act(e, 'next') }, '⏭'),
      h('button', { class: 'iconbtn', 'aria-label': a.is_volume_muted ? 'Unmute' : 'Mute', onclick: () => act(e, 'volume_mute', { is_volume_muted: !a.is_volume_muted }) }, a.is_volume_muted ? '🔇' : '🔊'),
      h('button', { class: 'iconbtn', 'aria-label': off ? 'Turn on' : 'Turn off', onclick: () => act(e, off ? 'turn_on' : 'turn_off') }, '⏻')),
    a.volume_level !== undefined && slider({ label: 'Volume', min: 0, max: 100, value: Math.round(a.volume_level * 100), onchange: setVolume }),
    a.source_list?.length ? h('select', { 'aria-label': 'Source', onchange: ev => act(e, 'select_source', { source: ev.target.value }) },
      h('option', { value: '' }, a.source || 'Choose source…'), a.source_list.slice(0, 50).map(s => h('option', { value: s }, s))) : null);
}

function climateControls(e) {
  const a = e.attributes;
  if (unavailable(e) || a.temperature === undefined) return null;
  const step = a.target_temp_step || 0.5;
  const set = t => act(e, 'set_temperature', { temperature: Math.min(a.max_temp ?? 35, Math.max(a.min_temp ?? 5, t)) });
  return h('div', { class: 'controls' },
    h('div', { class: 'thermostat' },
      h('button', { class: 'iconbtn', 'aria-label': 'Cooler', onclick: () => set(a.temperature - step) }, '−'),
      h('b', {}, `${a.temperature}°`),
      h('button', { class: 'iconbtn', 'aria-label': 'Warmer', onclick: () => set(a.temperature + step) }, '+')),
    a.hvac_modes?.length ? h('select', { 'aria-label': 'Mode', onchange: ev => act(e, 'set_hvac_mode', { hvac_mode: ev.target.value }) },
      a.hvac_modes.map(m => h('option', { value: m, selected: m === e.state }, m.replace('_', ' ')))) : null);
}

function buttonsFor(e) {
  const b = (label, action) => h('button', { class: 'btn small', onclick: () => act(e, action) }, label);
  if (e.domain === 'cover') return h('div', { class: 'row' }, b('Open', 'open'), b('Stop', 'stop'), b('Close', 'close'));
  if (e.domain === 'vacuum') return h('div', { class: 'row' }, b('Start', 'start'), b('Pause', 'pause'), b('Dock', 'return_to_base'));
  return null;
}

const TOGGLEABLE = ['light', 'switch', 'input_boolean', 'fan'];
const RUNNABLE = { scene: 'activate', script: 'run', button: 'press' };

function cameraTile(e, star) {
  const img = h('img', { src: cameraUrl(e.id), alt: e.name + ' snapshot', loading: 'lazy', dataset: { camera: e.id },
    onerror: ev => { ev.target.closest('.camera-tile')?.classList.add('broken'); },
    onload: ev => { ev.target.closest('.camera-tile')?.classList.remove('broken'); } });
  return h('article', { class: 'device camera-tile', dataset: { entity: e.id } },
    h('button', { class: 'camera-frame', 'aria-label': 'Open live view of ' + e.name, onclick: () => openCamera(e) }, img,
      h('span', { class: 'camera-fallback' }, unavailable(e) ? 'Camera unavailable' : 'No snapshot yet'),
      h('span', { class: 'live-badge' }, h('i'), 'LIVE')),
    h('div', { class: 'device-foot' }, h('span', { class: 'device-text' }, h('b', {}, e.name), h('small', {}, e.area || stateLabel(e))), star));
}

export function deviceTile(e) {
  const tile = buildTile(e);
  rendered.set(tile, JSON.stringify(e));
  return tile;
}

function buildTile(e) {
  const star = h('button', { class: 'iconbtn small star' + (isFavourite(e.id) ? ' on' : ''), 'aria-label': (isFavourite(e.id) ? 'Unpin ' : 'Pin ') + e.name,
    title: isFavourite(e.id) ? 'Remove from overview' : 'Pin to overview', onclick: ev => { ev.stopPropagation(); toggleFavourite(e); } }, isFavourite(e.id) ? '★' : '☆');
  if (e.domain === 'camera') return cameraTile(e, star);

  const active = on(e);
  const colour = e.domain === 'light' && active && e.attributes.rgb_color ? `rgb(${e.attributes.rgb_color})` : null;
  const toggleable = TOGGLEABLE.includes(e.domain) && !unavailable(e);
  const runnable = RUNNABLE[e.domain];
  const head = h(toggleable || runnable ? 'button' : 'div', {
    class: 'device-head',
    'aria-pressed': toggleable ? String(active) : null,
    'aria-label': toggleable ? `${e.name}: turn ${active ? 'off' : 'on'}` : runnable ? `Run ${e.name}` : null,
    onclick: toggleable ? () => act(e, 'toggle') : runnable ? () => act(e, runnable) : null,
  },
    h('span', { class: 'device-icon', style: colour ? { '--glow': colour } : null }, ICONS[e.domain] || '◈'),
    h('span', { class: 'device-text' }, h('b', {}, e.name), h('small', {}, stateLabel(e))),
    toggleable && h('span', { class: 'switch' + (active ? ' on' : ''), 'aria-hidden': 'true' }));

  const controls = e.domain === 'light' ? (active ? lightControls(e) : null)
    : e.domain === 'media_player' ? mediaControls(e)
    : e.domain === 'climate' ? climateControls(e)
    : buttonsFor(e);

  return h('article', { class: `device d-${e.domain}` + (active ? ' active' : '') + (unavailable(e) ? ' unavailable' : ''), style: colour ? { '--glow': colour } : null, dataset: { entity: e.id } },
    head, controls,
    h('div', { class: 'device-menu' }, e.area ? h('span', { class: 'dim' }, e.area) : h('span'),
      h('span', {}, star, h('button', { class: 'iconbtn small', title: 'Hide from Dash', 'aria-label': 'Hide ' + e.name, onclick: () => hide(e) }, '⊘'))));
}

export function openCamera(e) {
  $('#cameraTitle').textContent = e.name;
  const img = $('#cameraLive');
  img.src = cameraUrl(e.id, { stream: true });
  const dialog = openDialog($('#cameraDialog'));
  dialog.addEventListener('close', () => { img.removeAttribute('src'); }, { once: true });
}

// ------------------------------------------------------------ views

function matching(entities) {
  const hidden = new Set(app.state.home.hidden);
  let list = entities.filter(e => !hidden.has(e.id));
  if (filter !== 'all') {
    const domains = FILTER_DOMAINS[filter] || [filter];
    list = list.filter(e => domains.includes(e.domain));
  }
  if (app.search) {
    const q = app.search.toLowerCase();
    list = list.filter(e => `${e.name} ${e.area} ${e.domain} ${e.id}`.toLowerCase().includes(q));
  }
  return list;
}

function connectPrompt() {
  return h('div', { class: 'connect' },
    h('div', { class: 'connect-art' }, '💡 ◉ ♫ 🌡'),
    h('h2', {}, 'Bring your smart home into Dash'),
    h('p', {}, 'Dash connects to Home Assistant, which already talks to Aqara cameras and hubs, Google Nest speakers and Chromecasts, and almost every smart bulb. Connect it once and control everything from here.'),
    h('ol', { class: 'steps' },
      h('li', {}, 'Add your devices to Home Assistant (Settings → Devices & services).'),
      h('li', {}, 'Create a long-lived access token in your Home Assistant profile → Security.'),
      h('li', {}, 'Paste your Home Assistant address and token into Dash.')),
    h('button', { class: 'btn primary', onclick: () => document.dispatchEvent(new CustomEvent('dash:settings', { detail: 'home' })) }, 'Connect Home Assistant'));
}

function statusLine() {
  const { error, updated } = app.home;
  if (error) return h('div', { class: 'notice bad' }, error, ' ', h('button', { class: 'btn small', onclick: () => refresh() }, 'Retry'));
  return h('p', { class: 'dim', id: 'homeUpdated' }, updated ? `Live from Home Assistant · updated ${new Date(updated).toLocaleTimeString('en-GB')}` : 'Loading your devices…');
}

export function homeView() {
  const cameras = app.view.type === 'cameras';
  const head = h('div', { class: 'view-head' },
    h('div', {}, h('div', { class: 'eyebrow' }, 'SMART HOME'), h('h1', {}, cameras ? 'Cameras' : 'Devices'), app.home.config.configured ? statusLine() : null),
    app.home.config.configured ? h('div', { class: 'row' },
      app.state.home.hidden.length ? h('button', { class: 'btn', onclick: () => commit(s => { s.home.hidden = []; }, 'Hidden devices restored') }, `Show ${app.state.home.hidden.length} hidden`) : null,
      h('button', { class: 'btn', onclick: () => refresh() }, '↻ Refresh'),
      h('a', { class: 'btn', href: app.home.config.url, target: '_blank', rel: 'noopener noreferrer' }, 'Home Assistant ↗')) : null);
  if (!app.home.config.configured) return h('section', { class: 'view' }, head, connectPrompt());

  if (cameras) {
    const list = matching(app.home.entities.filter(e => e.domain === 'camera'));
    return h('section', { class: 'view' }, head,
      list.length ? h('div', { class: 'camera-grid large' }, list.map(deviceTile))
        : h('div', { class: 'empty' }, h('b', {}, 'No cameras found in Home Assistant.'),
          h('p', {}, 'Add Aqara cameras with the HomeKit Device integration, or use Generic Camera with the camera’s RTSP address.')));
  }

  const chips = h('div', { class: 'chips', role: 'tablist' }, FILTERS.map(([id, label, icon]) => {
    const count = id === 'all' ? null : matchingCount(id);
    if (count === 0 && filter !== id) return null;
    return h('button', { class: 'chip' + (filter === id ? ' active' : ''), role: 'tab', 'aria-selected': String(filter === id),
      onclick: () => { filter = id; render(); } }, icon + ' ' + label, count !== null && h('span', { class: 'count' }, count));
  }));
  const list = matching(app.home.entities);
  const camerasList = list.filter(e => e.domain === 'camera');
  const others = list.filter(e => e.domain !== 'camera');
  const groups = new Map();
  for (const e of others) {
    const key = e.area || 'Other devices';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const sorted = [...groups].sort(([a], [b]) => (a === 'Other devices') - (b === 'Other devices') || a.localeCompare(b));
  return h('section', { class: 'view' }, head, statusChips(), filter === 'all' && !app.search ? roomCards() : null, chips,
    !list.length && app.home.updated ? h('div', { class: 'empty' }, h('b', {}, 'No matching devices.'), h('p', {}, 'Try another filter or clear the search.')) : null,
    camerasList.length ? h('section', { class: 'area' }, h('h3', {}, '◉ Cameras'), h('div', { class: 'camera-grid' }, camerasList.map(deviceTile))) : null,
    sorted.map(([area, items]) => h('section', { class: 'area', id: roomId(area) }, h('h3', {}, area, h('span', { class: 'count' }, items.length)),
      h('div', { class: 'device-grid' }, items.map(deviceTile)))));
}

function matchingCount(id) {
  const saved = filter;
  filter = id;
  const n = matching(app.home.entities).length;
  filter = saved;
  return n;
}

/** Pinned devices strip for the overview. */
export function favouriteDevices() {
  if (!app.home.config.configured || !app.state.home.favourites.length) return null;
  const byId = new Map(app.home.entities.map(e => [e.id, e]));
  const items = app.state.home.favourites.map(id => byId.get(id)).filter(Boolean);
  const cams = items.filter(e => e.domain === 'camera');
  const rest = items.filter(e => e.domain !== 'camera');
  return h('section', { class: 'panel-block' },
    h('div', { class: 'block-head' }, h('h2', {}, '⌂ Smart home'), h('a', { href: '#home', class: 'dim' }, 'All devices →')),
    app.home.error ? h('div', { class: 'notice bad' }, app.home.error) : null,
    !items.length && !app.home.error ? h('p', { class: 'dim' }, 'Loading your devices…') : null,
    cams.length ? h('div', { class: 'camera-grid' }, cams.map(deviceTile)) : null,
    rest.length ? h('div', { class: 'device-grid' }, rest.map(deviceTile)) : null);
}

export function homeCount() {
  return app.home.entities.filter(e => !app.state.home.hidden.includes(e.id)).length;
}


// ------------------------------------------------------------ summaries

const visible = () => app.home.entities.filter(e => !app.state.home.hidden.includes(e.id));
const lightsOn = list => list.filter(e => e.domain === 'light' && e.state === 'on');
const roomId = area => 'room-' + area.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function average(list, deviceClass) {
  const values = list.filter(e => e.domain === 'sensor' && e.attributes.device_class === deviceClass)
    .map(e => parseFloat(e.state)).filter(Number.isFinite);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/** Switch a group of lights on or off together, then redraw the summaries. */
async function setLights(lights, turnOn) {
  await Promise.all(lights.map(e => act(e, turnOn ? 'turn_on' : 'turn_off')));
  refreshSummaries();
}

function chip(icon, text, attrs = {}) {
  return h(attrs.onclick || attrs.href ? (attrs.href ? 'a' : 'button') : 'span', { class: 'status-chip', ...attrs }, h('b', {}, icon), text);
}

/** Mushroom-style status chips: lights on, temperature, humidity, media, motion and openings. */
export function statusChips() {
  if (!app.home.config.configured || !app.home.entities.length) return null;
  const all = visible();
  const on = lightsOn(all);
  const temp = average(all, 'temperature');
  const humidity = average(all, 'humidity');
  const playing = all.filter(e => e.domain === 'media_player' && e.state === 'playing');
  const motion = all.filter(e => e.domain === 'binary_sensor' && ['motion', 'occupancy', 'presence'].includes(e.attributes.device_class) && e.state === 'on');
  const open = all.filter(e => e.domain === 'binary_sensor' && ['door', 'window', 'opening'].includes(e.attributes.device_class) && e.state === 'on');
  const climate = all.find(e => e.domain === 'climate' && e.attributes.temperature !== undefined);
  return h('div', { class: 'status-chips', id: 'statusChips' },
    on.length
      ? chip('💡', `${on.length} light${on.length === 1 ? '' : 's'} on · turn off`, { onclick: () => setLights(on, false), title: on.map(e => e.name).join(', ') })
      : chip('💡', 'All lights off'),
    temp !== null ? chip('🌡', `${temp.toFixed(1)}°`) : null,
    humidity !== null ? chip('💧', `${Math.round(humidity)}%`) : null,
    climate ? chip('♨', `${climate.name} ${climate.attributes.temperature}° · ${climate.state.replace('_', ' ')}`) : null,
    ...playing.slice(0, 3).map(e => chip('♫', `${e.name}: ${e.attributes.media_title || 'playing'}`, { class: 'status-chip live' })),
    motion.length ? chip('◌', `Motion: ${motion.map(e => e.area || e.name).join(', ')}`, { class: 'status-chip warn' }) : null,
    open.length ? chip('🚪', `${open.length} open: ${open.map(e => e.name).join(', ')}`, { class: 'status-chip warn' }) : null);
}

const ROOM_ICONS = [[/bed|nursery|kid/, '🛏'], [/kitchen|dining/, '🍳'], [/living|lounge|sitting|family/, '🛋'], [/bath|shower|toilet|wc/, '🛁'],
  [/office|study|desk/, '💻'], [/garden|outside|yard|patio|porch|front|back/, '🌳'], [/hall|landing|stair|entr/, '🚪'], [/garage|drive/, '🚗'], [/laundry|utility/, '🧺']];
const roomIcon = area => ROOM_ICONS.find(([re]) => re.test(area.toLowerCase()))?.[1] || '⌂';

/** One card per room: climate readings, lights on, and a one-tap lights toggle. */
export function roomCards() {
  const rooms = new Map();
  for (const e of visible()) if (e.area) (rooms.get(e.area) || rooms.set(e.area, []).get(e.area)).push(e);
  if (!rooms.size) return null;
  return h('div', { class: 'room-grid', id: 'roomCards' }, [...rooms].sort(([a], [b]) => a.localeCompare(b)).map(([area, items]) => {
    const lights = items.filter(e => e.domain === 'light' && !unavailable(e));
    const on = lightsOn(lights);
    const temp = average(items, 'temperature');
    const humidity = average(items, 'humidity');
    const media = items.find(e => e.domain === 'media_player' && e.state === 'playing');
    return h('article', { class: 'room-card' + (on.length ? ' lit' : '') },
      h('a', { class: 'room-main', href: '#home', onclick: ev => { ev.preventDefault(); document.getElementById(roomId(area))?.scrollIntoView({ behavior: 'smooth' }); } },
        h('span', { class: 'room-icon' }, roomIcon(area)),
        h('span', { class: 'device-text' }, h('b', {}, area),
          h('small', {}, [temp !== null ? `${temp.toFixed(1)}°` : null, humidity !== null ? `${Math.round(humidity)}%` : null,
            lights.length ? `${on.length}/${lights.length} lights` : null, media ? '♫ playing' : null, `${items.length} device${items.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')))),
      lights.length ? h('button', { class: 'switch-btn', 'aria-label': `${on.length ? 'Turn off' : 'Turn on'} lights in ${area}`,
        onclick: () => setLights(on.length ? on : lights, !on.length) }, h('span', { class: 'switch' + (on.length ? ' on' : '') })) : null);
  }));
}

/** Redraw the chips and room cards in place after device changes. */
function refreshSummaries() {
  for (const [id, build] of [['statusChips', statusChips], ['roomCards', roomCards]]) {
    const el = document.getElementById(id);
    const busy = el?.contains(document.activeElement) && document.activeElement.matches('input, select, textarea');
    if (el && !busy) el.replaceWith(build() || h('span', { id }));
  }
}
