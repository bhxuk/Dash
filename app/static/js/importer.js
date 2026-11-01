// Pure link-list parser shared by the browser and Node tests.
// Imported shortcuts are treated as data only; nothing in them is ever executed.

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function entities(text) {
  return String(text).replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi, (match, num, name) => {
    if (!num) return NAMED_ENTITIES[name.toLowerCase()];
    const code = num[0].toLowerCase() === 'x' ? parseInt(num.slice(1), 16) : Number(num);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** Decode file bytes, honouring UTF-16 byte-order marks used by Windows shortcuts. */
export function decode(bytes) {
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le'
    : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8';
  return new TextDecoder(encoding).decode(bytes);
}

/** Normalise a URL, accepting only http(s) without embedded credentials. */
export function canonical(value) {
  const url = new URL(String(value).trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || /[\x00-\x20]/.test(value)) {
    throw new Error('Only complete HTTP/HTTPS website URLs without credentials are supported.');
  }
  return url.href;
}

/** Split one delimited line, supporting "quoted, values" and "" escapes. */
function cells(line, delimiter) {
  const out = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i++; } else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      out.push(current.trim());
      current = '';
    } else current += c;
  }
  if (quoted) throw new Error('Unclosed quote in delimited row.');
  out.push(current.trim());
  return out;
}

const URL_HEADERS = ['url', 'link', 'address', 'website'];

/** Parse pasted text or a file's contents into raw rows {name,url,category,description,source}. */
export function parse(text, filename = 'pasted links') {
  text = String(text).replace(/^﻿/, '');
  const rows = [];
  const add = (name, url, category = '', description = '') => rows.push({
    name: String(name || '').trim(), url: String(url || '').trim(),
    category: String(category || '').trim(), description: String(description || '').trim(), source: filename,
  });

  if (/\.lnk$/i.test(filename)) {
    return [{ name: filename, url: '', source: filename,
      error: 'Windows .lnk files launch programs and cannot be imported as web links. Use Internet Shortcut (.url) files instead.' }];
  }
  // Windows Internet Shortcut
  if (/\[InternetShortcut\]/i.test(text) || /\.url$/i.test(filename)) {
    const match = text.match(/^\s*URL\s*=\s*(.+)$/im);
    add(filename.replace(/\.url$/i, ''), match?.[1] || '');
    return rows;
  }
  // macOS .webloc property list
  if (/\.webloc$/i.test(filename) || /<key>\s*URL\s*<\/key>/i.test(text)) {
    const match = text.match(/<key>\s*URL\s*<\/key>\s*<string>([\s\S]*?)<\/string>/i);
    add(filename.replace(/\.webloc$/i, ''), entities(match?.[1] || ''));
    return rows;
  }
  // Browser bookmark export or any HTML with links
  if (/<a\b[^>]*href\s*=/i.test(text)) {
    for (const m of text.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      add(entities(m[2].replace(/<[^>]*>/g, '')), entities(m[1]));
    }
    return rows;
  }

  const delimitedFile = /\.(csv|tsv)$/i.test(filename);
  let header = null;
  for (const original of text.split(/\r?\n/)) {
    let line = original.trim();
    if (!line || /^\s*(#|;|\/\/)/.test(line)) continue;
    line = line.replace(/^[-*•]\s+|^\d+[.)]\s+/, '');

    const markdown = line.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)(?:\s*(?:\||-)\s*(.*))?$/i);
    if (markdown) { add(markdown[1], markdown[2], markdown[3]); continue; }

    // A bare URL can contain commas or pipes in its query string.
    if (!header && !delimitedFile && /^https?:\/\/\S+$/i.test(line) && !line.includes(' | ')) { add('', line); continue; }

    const delimiter = line.includes('\t') ? '\t' : line.includes('|') ? '|' : line.includes(',') ? ',' : null;
    try {
      const row = delimiter ? cells(line, delimiter) : [line];
      if (delimiter === '|') {
        if (row[0] === '') row.shift();
        if (row.at(-1) === '') row.pop();
      }
      if (row.every(c => /^:?-+:?$/.test(c))) continue; // Markdown table divider
      const lower = row.map(c => c.toLowerCase());
      if (lower.some(c => URL_HEADERS.includes(c))) { header = lower; continue; }
      if (header && row.length > 1) {
        const get = names => row[header.findIndex(c => names.includes(c))] || '';
        add(get(['name', 'title']), get(URL_HEADERS), get(['category', 'folder', 'group']), get(['description', 'notes']));
        continue;
      }
      const index = row.findIndex(c => /^https?:\/\//i.test(c));
      if (index === 0) add(row[1] || '', row[0], row[2] || '', row[3] || '');
      else if (index > 0) add(row[0], row[index], row[index + 1] || '', row[index + 2] || '');
      else {
        const match = line.match(/^(.*?)\s+(https?:\/\/\S+)$/i);
        if (match) add(match[1].replace(/\s*[-:]\s*$/, ''), match[2]);
        else add('', line);
      }
    } catch (error) {
      rows.push({ name: line.slice(0, 80), url: '', error: error.message, source: filename });
    }
  }
  return rows;
}

/** Validate parsed rows and mark duplicates against existing links and each other. */
export function review(rows, existing = []) {
  const seen = new Set(existing.map(link => { try { return canonical(link.url); } catch { return link.url; } }));
  return rows.map(row => {
    const item = { ...row, category: row.category || '', description: row.description || '', selected: false };
    try {
      if (item.error) throw new Error(item.error);
      item.url = canonical(item.url);
      item.name = item.name || new URL(item.url).hostname;
      if (item.name.length > 80 || item.category.length > 40 || item.description.length > 500 || item.url.length > 2048) {
        throw new Error('Name, category, description or URL exceeds the supported length.');
      }
      if (seen.has(item.url)) {
        item.status = 'duplicate';
        item.error = 'Already saved or repeated in this import.';
      } else {
        item.status = 'ready';
        item.selected = true;
        seen.add(item.url);
      }
    } catch (error) {
      item.status = 'invalid';
      item.error = error.message;
    }
    return item;
  });
}
