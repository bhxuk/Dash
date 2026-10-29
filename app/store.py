"""Validated, atomic on-disk dashboard storage. No external dependencies."""
import copy
import json
import os
import re
import threading
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

COLORS = ['#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#60a5fa']

def web_url(value, optional=False):
    if optional and not value:
        return ''
    if not isinstance(value, str) or len(value) > 2048:
        raise ValueError('URL is too long')
    try:
        p = urlsplit(value)
        if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password or any(ord(c) < 33 for c in value):
            raise ValueError()
        _ = p.port
    except ValueError:
        raise ValueError('Use a complete http:// or https:// URL without credentials') from None
    return value

def text(value, limit=200):
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError(f'Text must be at most {limit} characters')
    return value.strip()

def validate(raw):
    if not isinstance(raw, dict) or raw.get('schema') != 1:
        raise ValueError('Not a Dash backup (schema 1 required)')
    cats, links = raw.get('categories'), raw.get('links')
    if not isinstance(cats, list) or not 1 <= len(cats) <= 50 or not isinstance(links, list) or len(links) > 2000:
        raise ValueError('Use 1–50 categories and no more than 2,000 links')
    ids, categories = set(), []
    def ident(value):
        value = text(value, 64)
        if not re.fullmatch(r'[a-zA-Z0-9_-]+', value) or value in ids:
            raise ValueError('Each item needs a unique identifier')
        ids.add(value)
        return value
    for c in cats:
        if not isinstance(c, dict):
            raise ValueError('Invalid category')
        name = text(c.get('name'), 40)
        if not name:
            raise ValueError('Category name is required')
        categories.append({'id': ident(c.get('id')), 'name': name, 'icon': text(c.get('icon', '◈'), 8)})
    category_ids = {c['id'] for c in categories}
    clean_links = []
    for link in links:
        if not isinstance(link, dict) or link.get('category') not in category_ids:
            raise ValueError('Every link must belong to an existing category')
        name = text(link.get('name'), 80)
        if not name:
            raise ValueError('Link name is required')
        color = link.get('color', COLORS[0])
        if color not in COLORS:
            raise ValueError('Choose one of the available colours')
        clean_links.append({'id': ident(link.get('id')), 'name': name, 'url': web_url(link.get('url')),
            'description': text(link.get('description', ''), 500), 'category': link['category'],
            'icon': text(link.get('icon', ''), 8), 'image': web_url(link.get('image', ''), optional=True),
            'color': color, 'pinned': bool(link.get('pinned', False)),
            'visits': max(0, min(int(link.get('visits', 0)), 1000000000)),
            'lastVisited': max(0, min(float(link.get('lastVisited', 0)), 1e13))})
    s = raw.get('settings', {})
    if not isinstance(s, dict):
        raise ValueError('Invalid settings')
    zone = text(s.get('timezone', 'Europe/London'), 80)
    try:
        ZoneInfo(zone)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError('Unknown time zone') from None
    if s.get('theme', 'dark') not in ('dark', 'light') or s.get('background', 'aurora') not in ('aurora', 'plain', 'grid'):
        raise ValueError('Invalid theme or background')
    layout = s.get('layout', 'compact')
    if layout not in ('cards', 'compact', 'table', 'tv'):
        raise ValueError('Choose cards, compact, table or TV layout')
    notes = text(raw.get('notes', ''), 20000)
    tasks = raw.get('tasks', [])
    if not isinstance(tasks, list) or len(tasks) > 100:
        raise ValueError('Use no more than 100 tasks')
    clean_tasks = []
    for task in tasks:
        if not isinstance(task, dict):
            raise ValueError('Invalid task')
        clean_tasks.append({'id': ident(task.get('id')), 'text': text(task.get('text'), 200), 'done': bool(task.get('done'))})
    return {'schema': 1, 'categories': categories, 'links': clean_links, 'notes': notes, 'tasks': clean_tasks,
            'settings': {'name': text(s.get('name', 'My dashboard'), 60), 'timezone': zone,
                'theme': s.get('theme', 'dark'), 'background': s.get('background', 'aurora'),
                'accent': s.get('accent') if s.get('accent') in COLORS else COLORS[0],
                'layout': layout, 'compact': layout == 'compact', 'seconds': bool(s.get('seconds', False))}}

def initial():
    categories = [{'id': 'everyday', 'name': 'Everyday', 'icon': '◈'}, {'id': 'homelab', 'name': 'Homelab', 'icon': '▣'},
                  {'id': 'work', 'name': 'Work', 'icon': '▤'}, {'id': 'tools', 'name': 'Tools', 'icon': '⌘'}]
    items = [('GitHub', 'https://github.com/bhxuk', 'Your repositories and projects.', 'everyday', 'GH', True),
             ('YouTube', 'https://www.youtube.com', 'Watch something worth your time.', 'everyday', '▶', True),
             ('Outlook', 'https://outlook.office.com', 'Email, calendar and the daily essentials.', 'work', 'O', True),
             ('Notion', 'https://www.notion.so', 'Notes, projects and a place for your ideas.', 'work', 'N', False),
             ('CyberChef', 'https://gchq.github.io/CyberChef/', 'Encode, decode and transform data.', 'tools', '⌘', False),
             ('Regex101', 'https://regex101.com', 'Build and test regular expressions.', 'tools', '.*', False)]
    links = [dict(id=uuid.uuid4().hex, name=n, url=u, description=d, category=c, icon=i, pinned=p, color=COLORS[k % 6])
             for k, (n,u,d,c,i,p) in enumerate(items)]
    return validate({'schema': 1, 'categories': categories, 'links': links, 'settings': {}, 'notes': '', 'tasks': []})

class Conflict(Exception):
    pass

class Store:
    def __init__(self, directory):
        self.root = Path(directory)
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / 'dashboard.json'
        self.lock = threading.RLock()
        if not self.path.exists():
            self._write(dict(initial(), revision=1))
        # Fail clearly on corrupt storage, never silently replace user data.
        validate(self.read())

    def _write(self, state):
        temp = self.path.with_suffix('.tmp')
        with temp.open('w') as f:
            json.dump(state, f, ensure_ascii=False, allow_nan=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, self.path)

    def read(self):
        with self.lock:
            return json.loads(self.path.read_text())

    def save(self, raw):
        clean = validate(raw)
        with self.lock:
            current = self.read()
            if raw.get('revision') != current['revision']:
                raise Conflict('Dashboard changed in another tab. Reload to get the latest version.')
            # Keep visit counters recorded while the editor was open.
            by_id = {x['id']: x for x in current['links']}
            for item in clean['links']:
                if item['id'] in by_id:
                    old = by_id[item['id']]
                    item['visits'] = max(item['visits'], old['visits'])
                    item['lastVisited'] = max(item['lastVisited'], old['lastVisited'])
            clean['revision'] = current['revision'] + 1
            self._write(clean)
            return clean

    def visit(self, link_id):
        with self.lock:
            state = self.read()
            link = next((x for x in state['links'] if x['id'] == link_id), None)
            if not link:
                raise ValueError('Link not found')
            link['visits'] += 1
            link['lastVisited'] = time.time() * 1000
            self._write(state)
            return {'visits': link['visits'], 'lastVisited': link['lastVisited']}

    def backup(self):
        with self.lock:
            folder = self.root / 'backups'
            folder.mkdir(exist_ok=True)
            name = time.strftime('dashboard-%Y%m%d-%H%M%S-') + uuid.uuid4().hex[:6] + '.json'
            path = folder / name
            path.write_text(self.path.read_text())
            return name
