// Small DOM and formatting helpers shared by every module.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export const uid = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

/**
 * Create an element. `attrs` keys starting with "on" become event listeners,
 * `class` sets className, `dataset` is merged, everything else is an attribute.
 * Children may be strings, nodes, arrays or falsy (skipped). Text is never parsed as HTML.
 */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

let toastTimer;
export function toast(message, kind = 'info') {
  const el = $('#toast');
  el.textContent = message;
  el.dataset.kind = kind;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), kind === 'error' ? 6000 : 3000);
}

export function debounce(fn, wait) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function ago(ms) {
  if (!ms) return 'Never';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function hostOf(url) {
  try { return new URL(url).host; } catch { return url; }
}

export function initials(name) {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '◈';
  return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
}

/** Open a <dialog>, wiring every [data-close] button inside it. */
export function openDialog(dialog) {
  if (!dialog.dataset.wired) {
    dialog.dataset.wired = '1';
    dialog.addEventListener('click', event => {
      if (event.target.closest('[data-close]') || event.target === dialog) dialog.close();
    });
  }
  if (!dialog.open) dialog.showModal();
  return dialog;
}

/** Promise-based confirmation using the shared confirm dialog. */
export function confirmDialog(message, action = 'Confirm', danger = true) {
  const dialog = $('#confirmDialog');
  $('#confirmText', dialog).textContent = message;
  const ok = $('#confirmOk', dialog);
  ok.textContent = action;
  ok.className = 'btn ' + (danger ? 'danger' : 'primary');
  openDialog(dialog);
  return new Promise(resolve => {
    const done = value => { dialog.removeEventListener('close', onClose); ok.onclick = null; resolve(value); };
    const onClose = () => done(false);
    dialog.addEventListener('close', onClose);
    ok.onclick = () => { dialog.removeEventListener('close', onClose); dialog.close(); done(true); };
  });
}

export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
