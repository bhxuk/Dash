// Settings dialog: appearance, Home Assistant connection, backups and updates.

import { api, isDemo } from './api.js';
import { app, commit, load, COLORS, COLOR_NAMES, render } from './state.js';
import { loadConfig, refresh, syncPolling } from './home.js';
import { $, $$, h, clear, toast, openDialog, confirmDialog, download } from './util.js';

const ZONES = ['Europe/London', 'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome', 'Europe/Athens',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto', 'America/Sao_Paulo',
  'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Singapore', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Seoul',
  'Australia/Sydney', 'Pacific/Auckland', 'Africa/Lagos', 'Africa/Johannesburg', 'UTC'];

let updateTimer = null;

export function openSettings(tab = 'appearance') {
  const dialog = $('#settingsDialog');
  fillAppearance();
  fillHome();
  showTab(tab);
  openDialog(dialog);
}

function showTab(tab) {
  $$('#settingsTabs button').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  });
  $$('#settingsDialog [data-panel]').forEach(p => { p.hidden = p.dataset.panel !== tab; });
  if (tab === 'updates') loadUpdates();
}

export function wireSettings() {
  $$('#settingsTabs button').forEach(b => { b.onclick = () => showTab(b.dataset.tab); });
  clear($('#zones'), ZONES.map(z => h('option', { value: z })));
  $('#appearanceForm').onsubmit = saveAppearance;
  $('#haForm').onsubmit = saveHome;
  $('#haDisconnect').onclick = disconnectHome;
  $('#exportData').onclick = exportData;
  $('#importData').onclick = () => $('#importFile').click();
  $('#importFile').onchange = importData;
  $('#snapshotData').onclick = async () => {
    try { toast('Snapshot saved: ' + (await api('backup', 'POST', {})).filename); } catch (e) { toast(e.message, 'error'); }
  };
  $('#checkUpdates').onclick = checkUpdates;
  $('#applyUpdate').onclick = applyUpdate;
  $('#autoUpdate').onchange = e => {
    const on = e.target.checked;
    commit(s => { s.settings.autoUpdate = on; }, on ? 'Updates will install automatically' : 'Automatic updates off. Dash will tell you when one is ready.');
  };
}

// ------------------------------------------------------------ appearance

function fillAppearance() {
  const form = $('#appearanceForm');
  const s = app.state.settings;
  clear(form.accent, COLORS.map((c, i) => h('option', { value: c }, COLOR_NAMES[i])));
  for (const key of ['name', 'theme', 'background', 'accent', 'layout', 'timezone']) form[key].value = s[key];
  form.clocks.value = s.clocks.join(', ');
  form.seconds.checked = s.seconds;
}

function validZone(zone) {
  try { new Intl.DateTimeFormat('en-GB', { timeZone: zone }); return true; } catch { return false; }
}

function saveAppearance(event) {
  event.preventDefault();
  const form = event.target;
  const clocks = form.clocks.value.split(',').map(z => z.trim()).filter(Boolean);
  const bad = [form.timezone.value.trim(), ...clocks].find(z => !validZone(z));
  if (bad) return toast(`“${bad}” is not a time zone. Try one like Europe/London.`, 'error');
  if (clocks.length > 4) return toast('Use up to four world clocks.', 'error');
  commit(s => Object.assign(s.settings, {
    name: form.name.value.trim() || 'My dashboard', theme: form.theme.value, background: form.background.value,
    accent: form.accent.value, layout: form.layout.value, compact: form.layout.value === 'compact',
    timezone: form.timezone.value.trim(), clocks, seconds: form.seconds.checked,
  }), 'Appearance saved');
}

// ------------------------------------------------------------ smart home

function fillHome() {
  const form = $('#haForm');
  const config = app.home.config;
  form.url.value = config.url || (isDemo ? 'http://homeassistant.local:8123' : `http://${location.hostname}:8123`);
  form.token.value = '';
  form.token.required = !config.configured;
  form.verifyTls.checked = config.verifyTls !== false;
  form.cameraInterval.value = String(app.state.home.cameraInterval);
  if (!form.cameraInterval.value) form.cameraInterval.value = '10';
  $('#haDisconnect').hidden = !config.configured;
  $('#haStatus').textContent = config.configured ? `Connected to ${config.url}` : 'Not connected';
}

async function saveHome(event) {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button.primary');
  const interval = Number(form.cameraInterval.value);
  button.disabled = true;
  $('#haStatus').textContent = 'Testing connection…';
  try {
    const result = await api('home/config', 'PUT', { url: form.url.value.trim(), token: form.token.value.trim(), verifyTls: form.verifyTls.checked });
    app.home.config = result;
    $('#haStatus').textContent = `Connected${result.location ? ' to ' + result.location : ''}${result.version ? ' · Home Assistant ' + result.version : ''}`;
    form.token.value = '';
    form.token.required = false;
    $('#haDisconnect').hidden = false;
    toast('Home Assistant connected');
    if (interval !== app.state.home.cameraInterval) await commit(s => { s.home.cameraInterval = interval; });
    app.home.entities = [];
    app.home.error = '';
    await refresh();
    syncPolling();
  } catch (error) {
    $('#haStatus').textContent = error.message;
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function disconnectHome() {
  if (!await confirmDialog('Disconnect Home Assistant? Your favourites are kept and the saved token is deleted.', 'Disconnect')) return;
  try {
    await api('home/config', 'PUT', { disconnect: true });
    await loadConfig();
    app.home.entities = [];
    fillHome();
    syncPolling();
    render();
    toast('Home Assistant disconnected');
  } catch (error) { toast(error.message, 'error'); }
}

// ------------------------------------------------------------ data

async function exportData() {
  try {
    const data = await api('export');
    download(`dash-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
  } catch (error) { toast(error.message, 'error'); }
}

async function importData(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('That file is not a Dash backup.', 'error'); }
  if (data?.schema !== 1) return toast('That file is not a Dash backup.', 'error');
  if (!await confirmDialog('Replace this dashboard with the backup? A snapshot of the current one is saved first.', 'Replace dashboard')) return;
  try {
    if (!isDemo) await api('backup', 'POST', {});
    await api('state', 'PUT', { ...data, revision: app.state.revision });
    await load();
    toast('Backup imported');
  } catch (error) { toast(error.message, 'error'); }
}

// ------------------------------------------------------------ updates

async function loadUpdates() {
  try {
    const [status, log] = await Promise.all([api('updates'), api('changelog')]);
    $('#changelog').textContent = log.text;
    showUpdate(status);
  } catch (error) { $('#updateMessage').textContent = error.message; }
}

function showUpdate(s) {
  $('#autoUpdate').checked = app.state.settings.autoUpdate !== false;
  $('#installedVersion').textContent = s.current;
  $('#latestVersion').textContent = s.latest || '—';
  const message = $('#updateMessage');
  const recovery = s.recovery?.status === 'rolled_back' ? ' The last update failed and was rolled back; your data was kept.' : '';
  if (s.state === 'updating' || s.state === 'restarting') message.textContent = 'Updating… Dash will reconnect by itself.';
  else if (s.error) message.textContent = s.error;
  else if (s.available) message.textContent = `Dash ${s.latest} is available.` + (s.canUpdate ? '' : ' ' + s.reason);
  else if (s.latest) message.textContent = 'You are on the latest version.' + recovery;
  else message.textContent = 'Check GitHub for a published release.' + recovery;
  $('#applyUpdate').hidden = !(s.available && s.canUpdate && s.state !== 'updating');
  const log = $('#updateLog');
  log.hidden = !s.log?.length;
  log.textContent = (s.log || []).join('\n');
}

async function checkUpdates() {
  const button = $('#checkUpdates');
  button.disabled = true;
  try { showUpdate(await api('updates/check', 'POST', {})); } catch (error) { toast(error.message, 'error'); } finally { button.disabled = false; }
}

export async function applyUpdate() {
  if (!await confirmDialog('Install the update now? Dash snapshots your data, restarts and rolls back automatically if anything fails.', 'Update now', false)) return;
  try { showUpdate(await api('updates/apply', 'POST', {})); } catch (error) { toast(error.message, 'error'); return; }
  watchUpdate();
}

/** Poll until the server comes back on a new version, then reload the page. */
export function watchUpdate() {
  clearInterval(updateTimer);
  updateTimer = setInterval(async () => {
    try {
      const health = await api('health');
      const status = await api('updates');
      if (health.version !== app.version || status.state === 'error' || status.recovery) {
        showUpdate(status);
        if (health.version !== app.version) { clearInterval(updateTimer); toast(`Updated to Dash ${health.version}. Reloading…`); setTimeout(() => location.reload(), 1500); }
        if (status.state === 'error') clearInterval(updateTimer);
      }
    } catch { /* restarting */ }
  }, 2000);
}
