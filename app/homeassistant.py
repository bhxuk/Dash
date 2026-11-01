"""Home Assistant bridge.

Dash never talks to smart devices directly. Aqara cameras and hubs, smart bulbs,
Google Nest speakers, Chromecasts and thermostats are all added to Home Assistant
first; Dash then reads their state and calls a short allow-list of services
through Home Assistant's REST API.

The long-lived access token is kept in ``data/homeassistant.json`` (mode 0600).
It is never returned to the browser and is not part of dashboard exports.
"""
import json
import os
import re
import ssl
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import quote, urlsplit

ENTITY_ID = re.compile(r'^[a-z0-9_]+\.[a-z0-9_]+$')
TOKEN_CHARS = re.compile(r'^[A-Za-z0-9._\-]+$')
MODE = re.compile(r'^[a-z0-9_]{1,40}$')

# Domains shown in Dash, in display order.
DOMAINS = ('light', 'switch', 'fan', 'media_player', 'camera', 'climate', 'cover',
           'vacuum', 'scene', 'script', 'button', 'input_boolean', 'lock',
           'binary_sensor', 'sensor')
SENSOR_CLASSES = {'temperature', 'humidity', 'battery', 'power', 'energy', 'illuminance',
                  'pm25', 'co2', 'carbon_dioxide', 'aqi'}
BINARY_CLASSES = {'motion', 'occupancy', 'door', 'window', 'opening', 'moisture', 'smoke',
                  'gas', 'presence', 'vibration', 'connectivity'}

# Attributes forwarded to the browser. Everything else (tokens, pictures, ids) stays here.
KEEP_ATTRS = ('friendly_name', 'brightness', 'color_mode', 'supported_color_modes', 'color_temp_kelvin',
              'min_color_temp_kelvin', 'max_color_temp_kelvin', 'rgb_color', 'hs_color',
              'volume_level', 'is_volume_muted', 'media_title', 'media_artist', 'media_album_name',
              'app_name', 'source', 'source_list', 'device_class', 'unit_of_measurement',
              'current_temperature', 'temperature', 'target_temp_low', 'target_temp_high',
              'hvac_modes', 'hvac_action', 'min_temp', 'max_temp', 'target_temp_step',
              'current_position', 'percentage', 'battery_level', 'supported_features', 'icon')


def _number(value, low, high, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
        raise ValueError(f'{name} must be between {low} and {high}')
    return value


def _rgb(value):
    if not isinstance(value, list) or len(value) != 3:
        raise ValueError('Colour must be three numbers')
    return [int(_number(v, 0, 255, 'Colour')) for v in value]


def _mode(value):
    if not isinstance(value, str) or not MODE.fullmatch(value):
        raise ValueError('Invalid mode')
    return value


def _source(value):
    if not isinstance(value, str) or not 0 < len(value) <= 120:
        raise ValueError('Invalid source')
    return value


# action -> (Home Assistant service, {data field: validator})
_TOGGLES = {'toggle': ('toggle', {}), 'turn_on': ('turn_on', {}), 'turn_off': ('turn_off', {})}
ACTIONS = {
    'light': {
        **_TOGGLES,
        'turn_on': ('turn_on', {
            'brightness_pct': lambda v: int(_number(v, 1, 100, 'Brightness')),
            'color_temp_kelvin': lambda v: int(_number(v, 1000, 10000, 'Colour temperature')),
            'rgb_color': _rgb,
        }),
    },
    'switch': _TOGGLES,
    'input_boolean': _TOGGLES,
    'fan': {**_TOGGLES, 'set_percentage': ('set_percentage', {'percentage': lambda v: int(_number(v, 0, 100, 'Speed'))})},
    'media_player': {
        'turn_on': ('turn_on', {}), 'turn_off': ('turn_off', {}),
        'play_pause': ('media_play_pause', {}), 'stop': ('media_stop', {}),
        'next': ('media_next_track', {}), 'previous': ('media_previous_track', {}),
        'volume_set': ('volume_set', {'volume_level': lambda v: round(float(_number(v, 0, 1, 'Volume')), 2)}),
        'volume_mute': ('volume_mute', {'is_volume_muted': lambda v: bool(v)}),
        'select_source': ('select_source', {'source': _source}),
    },
    'climate': {
        'turn_on': ('turn_on', {}), 'turn_off': ('turn_off', {}),
        'set_temperature': ('set_temperature', {'temperature': lambda v: float(_number(v, 4, 40, 'Temperature'))}),
        'set_hvac_mode': ('set_hvac_mode', {'hvac_mode': _mode}),
    },
    'cover': {'open': ('open_cover', {}), 'close': ('close_cover', {}), 'stop': ('stop_cover', {})},
    'vacuum': {'start': ('start', {}), 'pause': ('pause', {}), 'return_to_base': ('return_to_base', {})},
    'scene': {'activate': ('turn_on', {})},
    'script': {'run': ('turn_on', {})},
    'button': {'press': ('press', {})},
}

AREA_TEMPLATE = ('[{% for s in states %}{{ [s.entity_id, area_name(s.entity_id) or ""] | tojson }}'
                 '{% if not loop.last %},{% endif %}{% endfor %}]')


class HomeAssistantError(Exception):
    """A problem talking to Home Assistant, safe to show to the user."""


def clean_url(value):
    if not isinstance(value, str) or len(value) > 300:
        raise ValueError('Enter your Home Assistant address, e.g. http://192.168.0.10:8123')
    value = value.strip().rstrip('/')
    parts = urlsplit(value)
    if parts.scheme not in ('http', 'https') or not parts.hostname or parts.username or parts.password \
            or parts.query or parts.fragment:
        raise ValueError('Enter your Home Assistant address, e.g. http://192.168.0.10:8123')
    _ = parts.port  # raises for an invalid port
    return value


def summarise(state, area=''):
    """Reduce a Home Assistant state object to what the dashboard needs."""
    entity_id = state.get('entity_id', '')
    domain = entity_id.split('.', 1)[0]
    attrs = state.get('attributes') or {}
    return {
        'id': entity_id,
        'domain': domain,
        'name': str(attrs.get('friendly_name') or entity_id.split('.', 1)[-1].replace('_', ' ').title())[:120],
        'state': str(state.get('state', 'unknown'))[:120],
        'area': area[:80],
        'attributes': {k: attrs[k] for k in KEEP_ATTRS if k in attrs},
        'changed': state.get('last_changed', ''),
        'controllable': domain in ACTIONS,
    }


def wanted(state):
    entity_id = state.get('entity_id', '')
    domain = entity_id.split('.', 1)[0]
    if domain not in DOMAINS or not ENTITY_ID.fullmatch(entity_id):
        return False
    attrs = state.get('attributes') or {}
    if attrs.get('hidden') or attrs.get('entity_category') in ('config', 'diagnostic'):
        return False
    if domain == 'sensor':
        return attrs.get('device_class') in SENSOR_CLASSES
    if domain == 'binary_sensor':
        return attrs.get('device_class') in BINARY_CLASSES
    return True


class HomeAssistant:
    def __init__(self, data_dir):
        self.path = Path(data_dir) / 'homeassistant.json'
        self.lock = threading.Lock()
        self._areas, self._areas_at = {}, 0.0
        self.config = self._load()

    # ---- configuration -------------------------------------------------
    def _load(self):
        try:
            raw = json.loads(self.path.read_text())
            return {'url': clean_url(raw['url']), 'token': str(raw['token']), 'verify_tls': bool(raw.get('verify_tls', True))}
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def public_config(self):
        c = self.config
        return {'configured': bool(c), 'url': c['url'] if c else '', 'verifyTls': c['verify_tls'] if c else True}

    def configure(self, raw):
        """Validate, test and store a connection. Returns the HA version on success."""
        if raw.get('disconnect'):
            with self.lock:
                self.path.unlink(missing_ok=True)
                self.config, self._areas = None, {}
            return {'configured': False}
        url = clean_url(raw.get('url'))
        token = raw.get('token') or ''
        if not token and self.config:
            token = self.config['token']  # keep the stored token when only the URL changes
        if not isinstance(token, str) or not 20 <= len(token) <= 1000 or not TOKEN_CHARS.fullmatch(token):
            raise ValueError('Paste a Home Assistant long-lived access token (Profile → Security).')
        candidate = {'url': url, 'token': token, 'verify_tls': raw.get('verifyTls', True) is not False}
        info = self._request('GET', '/api/config', config=candidate)
        with self.lock:
            tmp = self.path.with_suffix('.tmp')
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, 'w') as f:
                json.dump(candidate, f)
            os.replace(tmp, self.path)
            self.config, self._areas_at = candidate, 0.0
        return {**self.public_config(), 'version': info.get('version', ''), 'location': info.get('location_name', '')}

    # ---- HTTP ----------------------------------------------------------
    def _open(self, method, path, body=None, config=None, timeout=10):
        config = config or self.config
        if not config:
            raise HomeAssistantError('Home Assistant is not connected yet. Open Smart home → Connect.')
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(config['url'] + path, data=data, method=method, headers={
            'Authorization': 'Bearer ' + config['token'], 'Content-Type': 'application/json',
            'User-Agent': 'bhxuk-Dash'})
        context = None
        if config['url'].startswith('https://') and not config['verify_tls']:
            context = ssl.create_default_context()
            context.check_hostname, context.verify_mode = False, ssl.CERT_NONE
        try:
            return urllib.request.urlopen(request, timeout=timeout, context=context)
        except urllib.error.HTTPError as exc:
            if exc.code == 401:
                raise HomeAssistantError('Home Assistant rejected the access token. Create a new long-lived token.') from None
            if exc.code == 404:
                raise HomeAssistantError('Not found in Home Assistant. The device may have been removed.') from None
            if exc.code == 400:
                raise HomeAssistantError('Home Assistant could not perform that action on this device.') from None
            raise HomeAssistantError(f'Home Assistant returned HTTP {exc.code}.') from None
        except (urllib.error.URLError, OSError) as exc:
            reason = getattr(exc, 'reason', exc)
            raise HomeAssistantError(f'Could not reach Home Assistant at {config["url"]} ({reason}).') from None

    def _request(self, method, path, body=None, config=None):
        with self._open(method, path, body, config) as response:
            raw = response.read(8 * 1024 * 1024)
        try:
            return json.loads(raw) if raw else {}
        except ValueError:
            raise HomeAssistantError('Home Assistant sent an unexpected response.') from None

    # ---- data ----------------------------------------------------------
    def _area_map(self):
        if time.time() - self._areas_at < 300:
            return self._areas
        try:
            with self._open('POST', '/api/template', {'template': AREA_TEMPLATE}) as response:
                pairs = json.loads(response.read(4 * 1024 * 1024))
            self._areas = {str(k): str(v) for k, v in pairs if v}
        except (HomeAssistantError, ValueError, TypeError):
            self._areas = {}  # areas are a nice-to-have
        self._areas_at = time.time()
        return self._areas

    def entities(self):
        states = self._request('GET', '/api/states')
        if not isinstance(states, list):
            raise HomeAssistantError('Home Assistant sent an unexpected response.')
        areas = self._area_map()
        items = [summarise(s, areas.get(s.get('entity_id'), '')) for s in states if isinstance(s, dict) and wanted(s)]
        order = {d: i for i, d in enumerate(DOMAINS)}
        items.sort(key=lambda e: (order[e['domain']], e['area'] or '~', e['name'].lower()))
        return {'entities': items, 'updated': time.time()}

    def act(self, raw):
        entity_id = raw.get('entity')
        if not isinstance(entity_id, str) or not ENTITY_ID.fullmatch(entity_id):
            raise ValueError('Invalid device')
        domain = entity_id.split('.', 1)[0]
        action = raw.get('action')
        if domain not in ACTIONS or action not in ACTIONS[domain]:
            raise ValueError('That action is not available for this device')
        service, fields = ACTIONS[domain][action]
        options = raw.get('data') or {}
        if not isinstance(options, dict) or set(options) - set(fields):
            raise ValueError('Unsupported option for this action')
        body = {'entity_id': entity_id, **{k: fields[k](v) for k, v in options.items()}}
        self._request('POST', f'/api/services/{domain}/{service}', body)
        state = self._request('GET', '/api/states/' + quote(entity_id))
        return summarise(state, self._areas.get(entity_id, ''))

    def camera(self, entity_id, stream=False):
        """Open a snapshot (JPEG) or MJPEG stream response from Home Assistant."""
        if not ENTITY_ID.fullmatch(entity_id) or not entity_id.startswith('camera.'):
            raise ValueError('Invalid camera')
        path = ('/api/camera_proxy_stream/' if stream else '/api/camera_proxy/') + quote(entity_id)
        return self._open('GET', path, timeout=20)
