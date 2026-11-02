// Overview widgets: greeting, clock and world clocks.

import { app } from './state.js';
import { h } from './util.js';

// ------------------------------------------------------------------ clock

function parts(zone, seconds) {
  const now = new Date();
  const time = now.toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', second: seconds ? '2-digit' : undefined });
  const date = now.toLocaleDateString('en-GB', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const hour = Number(now.toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', hour12: false }));
  return { time, date, hour };
}

export function greeting(zone) {
  const { hour } = parts(zone);
  return hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

const city = zone => zone === 'UTC' ? 'UTC' : zone.split('/').pop().replace(/_/g, ' ');

export function clockPanel() {
  const { timezone, seconds, clocks } = app.state.settings;
  const main = parts(timezone, seconds);
  return h('div', { class: 'clock-panel' },
    h('div', { class: 'clock', id: 'clock' }, main.time),
    h('div', { class: 'date', id: 'clockDate' }, main.date),
    h('div', { class: 'world' }, clocks.map(zone => h('div', {}, h('span', {}, city(zone).toUpperCase()), h('b', { dataset: { zone } }, parts(zone).time)))));
}

export function tickClocks() {
  if (!app.state) return;
  const { timezone, seconds } = app.state.settings;
  const clock = document.getElementById('clock');
  if (clock) {
    const p = parts(timezone, seconds);
    clock.textContent = p.time;
    document.getElementById('clockDate').textContent = p.date;
  }
  document.querySelectorAll('[data-zone]').forEach(el => { el.textContent = parts(el.dataset.zone).time; });
}
