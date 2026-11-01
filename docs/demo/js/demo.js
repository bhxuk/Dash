// In-browser backend for the public demo on GitHub Pages. Nothing leaves the browser.

const KEY = 'bhxuk-dash-demo-v2';
let state = null;
let devices = null;

const light = (id, name, area, on, extra = {}) => ({ id: 'light.' + id, domain: 'light', name, area, state: on ? 'on' : 'off', controllable: true,
  attributes: { brightness: on ? 180 : null, supported_color_modes: ['color_temp', 'hs'], color_temp_kelvin: 2700, min_color_temp_kelvin: 2000, max_color_temp_kelvin: 6500, ...extra } });

function seedDevices() {
  return [
    { id: 'camera.front_door', domain: 'camera', name: 'Front door (Aqara G4)', area: 'Outside', state: 'idle', attributes: {} },
    { id: 'camera.living_room', domain: 'camera', name: 'Living room (Aqara G3)', area: 'Living room', state: 'idle', attributes: {} },
    light('living_room_lamp', 'Lamp', 'Living room', true, { rgb_color: [255, 180, 107] }),
    light('living_room_ceiling', 'Ceiling', 'Living room', false),
    light('bedroom_bulb', 'Bedside bulb', 'Bedroom', true, { rgb_color: [170, 90, 255] }),
    light('kitchen_spots', 'Spotlights', 'Kitchen', false, { supported_color_modes: ['brightness'] }),
    { id: 'media_player.living_room_speaker', domain: 'media_player', name: 'Nest Audio', area: 'Living room', state: 'playing', controllable: true,
      attributes: { volume_level: 0.35, is_volume_muted: false, media_title: 'Midnight City', media_artist: 'M83', app_name: 'Spotify' } },
    { id: 'media_player.kitchen_display', domain: 'media_player', name: 'Nest Hub', area: 'Kitchen', state: 'off', controllable: true, attributes: { volume_level: 0.5 } },
    { id: 'media_player.tv_chromecast', domain: 'media_player', name: 'Chromecast with Google TV', area: 'Living room', state: 'paused', controllable: true,
      attributes: { volume_level: 0.2, media_title: 'Planet Earth III', app_name: 'BBC iPlayer' } },
    { id: 'climate.thermostat', domain: 'climate', name: 'Nest Thermostat', area: 'Hallway', state: 'heat', controllable: true,
      attributes: { current_temperature: 19.5, temperature: 20.5, hvac_modes: ['off', 'heat'], min_temp: 9, max_temp: 32, target_temp_step: 0.5 } },
    { id: 'switch.desk_plug', domain: 'switch', name: 'Desk plug', area: 'Office', state: 'on', controllable: true, attributes: {} },
    { id: 'sensor.living_room_temperature', domain: 'sensor', name: 'Temperature', area: 'Living room', state: '21.3', attributes: { device_class: 'temperature', unit_of_measurement: '°C' } },
    { id: 'binary_sensor.hall_motion', domain: 'binary_sensor', name: 'Hall motion', area: 'Hallway', state: 'off', attributes: { device_class: 'motion' } },
    { id: 'scene.movie_night', domain: 'scene', name: 'Movie night', area: '', state: 'scening', controllable: true, attributes: {} },
  ];
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify({ state, devices })); } catch { /* private mode */ }
}

async function init() {
  if (state) return;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved?.state?.schema === 1) ({ state, devices } = saved);
  } catch { /* ignore */ }
  if (!state) {
    state = await (await fetch('seed.json')).json();
    devices = seedDevices();
  }
}

function validUrl(value, optional) {
  if (optional && !value) return;
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('Use a complete http:// or https:// URL.');
}

function act({ entity, action, data = {} }) {
  const d = devices.find(x => x.id === entity);
  if (!d) throw new Error('Device not found');
  const a = d.attributes;
  if (action === 'toggle') d.state = d.state === 'on' ? 'off' : 'on';
  if (action === 'turn_on') {
    d.state = d.domain === 'media_player' ? 'idle' : 'on';
    if (data.brightness_pct) a.brightness = Math.round(data.brightness_pct * 2.55);
    if (data.color_temp_kelvin) { a.color_temp_kelvin = data.color_temp_kelvin; a.rgb_color = data.color_temp_kelvin < 3500 ? [255, 180, 107] : [235, 240, 255]; }
    if (data.rgb_color) a.rgb_color = data.rgb_color;
    if (d.domain === 'light' && !a.brightness) a.brightness = 180;
  }
  if (action === 'turn_off') d.state = 'off';
  if (action === 'play_pause') d.state = d.state === 'playing' ? 'paused' : 'playing';
  if (action === 'volume_set') a.volume_level = data.volume_level;
  if (action === 'volume_mute') a.is_volume_muted = data.is_volume_muted;
  if (action === 'set_temperature') a.temperature = data.temperature;
  if (action === 'set_hvac_mode') d.state = data.hvac_mode;
  if (action === 'activate') devices.filter(x => x.domain === 'light').forEach(l => { l.state = l.area === 'Living room' ? 'on' : 'off'; l.attributes.brightness = 40; });
  persist();
  return structuredClone(d);
}

export async function demoApi(path, method, body) {
  await init();
  const clone = value => structuredClone(value);
  switch (`${method} ${path}`) {
    case 'GET health': return { status: 'ok', version: 'demo' };
    case 'GET state': case 'GET export': return clone(state);
    case 'PUT state': {
      if (body.revision !== state.revision) throw Object.assign(new Error('The demo changed in another tab. Reload to continue.'), { status: 409 });
      body.links.forEach(l => { validUrl(l.url); validUrl(l.image, true); });
      state = { ...clone(body), revision: state.revision + 1 };
      state.home ??= { favourites: [], hidden: [], cameraInterval: 10 };
      persist();
      return clone(state);
    }
    case 'POST visit': return {};
    case 'POST backup': return { filename: 'demo-snapshot.json' };
    case 'GET updates': case 'POST updates/check':
      return { current: 'demo', latest: null, available: false, canUpdate: false, reason: 'Updates are available when Dash runs on your server.', state: 'idle', log: [] };
    case 'POST updates/apply': throw new Error('Updates are available when Dash runs on your server.');
    case 'GET changelog': return { text: await (await fetch('CHANGELOG.md')).text() };
    case 'GET home/config': return { configured: true, url: 'https://www.home-assistant.io/', verifyTls: true };
    case 'PUT home/config': return { configured: true, url: body.url || 'https://www.home-assistant.io/', version: 'demo', location: 'Demo home' };
    case 'GET home/entities': return { entities: clone(devices), updated: Date.now() / 1000 };
    case 'POST home/action': return act(body);
    default: throw new Error('Not available in the demo.');
  }
}

/** A generated "camera" frame so the demo has something to show. */
export function demoCamera(entityId) {
  const time = new Date().toLocaleTimeString('en-GB');
  const outside = entityId.includes('front');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${outside ? '#1b3446' : '#2a2433'}"/><stop offset="1" stop-color="${outside ? '#0d1a12' : '#120f17'}"/></linearGradient></defs>
<rect width="640" height="360" fill="url(#g)"/>${outside
    ? '<rect x="250" y="90" width="140" height="230" fill="#24323d" stroke="#3b5162"/><circle cx="370" cy="210" r="6" fill="#c9a24a"/><rect y="320" width="640" height="40" fill="#18241c"/>'
    : '<rect x="60" y="210" width="300" height="90" rx="18" fill="#3a3046"/><rect x="430" y="110" width="150" height="90" fill="#0b0b10" stroke="#444"/><circle cx="520" cy="250" r="40" fill="#ffb46b" opacity=".25"/>'}
<text x="20" y="34" font-family="monospace" font-size="18" fill="#fff" opacity=".85">${outside ? 'FRONT DOOR' : 'LIVING ROOM'}  ${time}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
