// Overview widgets: clock and world clocks, and tasks.

import { app, commit } from './state.js';
import { h, uid, toast } from './util.js';

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

// ------------------------------------------------------------------ tasks

export function tasksPanel() {
  const tasks = app.state.tasks;
  const open = tasks.filter(t => !t.done).length;
  const input = h('input', { id: 'taskInput', maxlength: 200, placeholder: 'Add a task…', 'aria-label': 'New task', required: true });
  const form = h('form', { class: 'inline-form', onsubmit: e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (tasks.length >= 100) return toast('Dash holds up to 100 tasks. Clear some finished ones.', 'error');
    commit(s => { s.tasks.push({ id: uid(), text, done: false }); });
    document.getElementById('taskInput')?.focus();
  } }, input, h('button', { class: 'iconbtn', 'aria-label': 'Add task' }, '+'));
  return h('section', { class: 'panel-block side-block' },
    h('div', { class: 'block-head' }, h('h2', {}, '☑ Tasks'), h('span', { class: 'count' }, open)),
    h('ul', { class: 'tasks' }, tasks.map(t => h('li', { class: t.done ? 'done' : '' },
      h('label', {}, h('input', { type: 'checkbox', checked: t.done, onchange: () => commit(s => { s.tasks.find(x => x.id === t.id).done = !t.done; }) }), h('span', {}, t.text)),
      h('button', { class: 'iconbtn small', 'aria-label': 'Delete task', onclick: () => commit(s => { s.tasks = s.tasks.filter(x => x.id !== t.id); }) }, '✕')))),
    !tasks.length ? h('p', { class: 'hint' }, 'Nothing to do. Nice.') : null,
    form,
    tasks.some(t => t.done) ? h('button', { class: 'linkbtn', onclick: () => commit(s => { s.tasks = s.tasks.filter(x => !x.done); }) }, 'Clear finished') : null);
}
