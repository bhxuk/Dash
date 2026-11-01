"""Home Assistant bridge tests against a local fake Home Assistant."""
import http.client
import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from app.homeassistant import HomeAssistant, HomeAssistantError
from app.main import Handler, Server
from app.store import Store
from app.updater import Updater

TOKEN = 'test-token-' + 'x' * 30
STATES = [
    {'entity_id': 'light.lamp', 'state': 'on', 'attributes': {'friendly_name': 'Lamp', 'brightness': 128, 'supported_color_modes': ['hs'], 'access_token': 'secret'}},
    {'entity_id': 'camera.front_door', 'state': 'idle', 'attributes': {'friendly_name': 'Front door', 'entity_picture': '/api/camera_proxy/camera.front_door?token=secret'}},
    {'entity_id': 'media_player.nest_audio', 'state': 'playing', 'attributes': {'friendly_name': 'Nest Audio', 'volume_level': 0.4}},
    {'entity_id': 'sensor.temperature', 'state': '21.5', 'attributes': {'device_class': 'temperature', 'unit_of_measurement': '°C'}},
    {'entity_id': 'sensor.uptime', 'state': '100', 'attributes': {'device_class': 'duration'}},
    {'entity_id': 'automation.morning', 'state': 'on', 'attributes': {}},
    {'entity_id': 'switch.config_flag', 'state': 'on', 'attributes': {'entity_category': 'config'}},
]


class FakeHA(BaseHTTPRequestHandler):
    calls = []

    def log_message(self, *args):
        pass

    def send(self, code, body, kind='application/json'):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def authorised(self):
        if self.headers.get('Authorization') != 'Bearer ' + TOKEN:
            self.send(401, {'message': 'Unauthorized'})
            return False
        return True

    def do_GET(self):
        if not self.authorised():
            return
        if self.path == '/api/config':
            return self.send(200, {'version': '2026.10.0', 'location_name': 'Home'})
        if self.path == '/api/states':
            return self.send(200, STATES)
        if self.path.startswith('/api/states/'):
            entity = self.path.rsplit('/', 1)[1]
            state = next((s for s in STATES if s['entity_id'] == entity), None)
            return self.send(200, state) if state else self.send(404, {})
        if self.path == '/api/camera_proxy/camera.front_door':
            return self.send(200, b'\xff\xd8JPEGDATA', 'image/jpeg')
        if self.path == '/api/camera_proxy_stream/camera.front_door':
            self.send_response(200)
            self.send_header('Content-Type', 'multipart/x-mixed-replace; boundary=frame')
            self.end_headers()
            for _ in range(3):
                self.wfile.write(b'--frame\r\nContent-Type: image/jpeg\r\n\r\n\xff\xd8FRAME\r\n')
            return
        self.send(404, {})

    def do_POST(self):
        if not self.authorised():
            return
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        FakeHA.calls.append((self.path, body))
        if self.path == '/api/template':
            return self.send(200, b'[["light.lamp", "Living room"], ["camera.front_door", ""]]', 'text/plain')
        if self.path.startswith('/api/services/'):
            return self.send(200, [])
        self.send(404, {})


class HomeAssistantTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ha = ThreadingHTTPServer(('127.0.0.1', 0), FakeHA)
        threading.Thread(target=cls.ha.serve_forever, daemon=True).start()
        cls.ha_url = f'http://127.0.0.1:{cls.ha.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.ha.shutdown()
        cls.ha.server_close()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        FakeHA.calls = []
        self.home = HomeAssistant(self.temp.name)

    def connect(self):
        return self.home.configure({'url': self.ha_url + '/', 'token': TOKEN})

    def test_configure_stores_token_privately(self):
        result = self.connect()
        self.assertEqual(result['version'], '2026.10.0')
        self.assertNotIn('token', json.dumps(result))
        self.assertNotIn(TOKEN, json.dumps(self.home.public_config()))
        path = Path(self.temp.name) / 'homeassistant.json'
        self.assertEqual(oct(path.stat().st_mode & 0o777), '0o600')
        # A fresh instance (container restart) reloads it; the URL can change without re-entering the token.
        again = HomeAssistant(self.temp.name)
        self.assertTrue(again.public_config()['configured'])
        again.configure({'url': self.ha_url})
        self.assertEqual(json.loads(path.read_text())['token'], TOKEN)
        again.configure({'disconnect': True})
        self.assertFalse(path.exists())

    def test_bad_token_and_url_are_rejected_without_saving(self):
        with self.assertRaises(HomeAssistantError):
            self.home.configure({'url': self.ha_url, 'token': 'wrong-token-' + 'y' * 30})
        for url in ['ftp://x', 'http://user:pw@host:8123', 'not a url', 'http://host:8123/?a=1']:
            with self.assertRaises(ValueError):
                self.home.configure({'url': url, 'token': TOKEN})
        with self.assertRaises(ValueError):
            self.home.configure({'url': self.ha_url, 'token': 'short'})
        self.assertFalse((Path(self.temp.name) / 'homeassistant.json').exists())

    def test_entities_are_filtered_and_stripped(self):
        self.connect()
        entities = self.home.entities()['entities']
        ids = [e['id'] for e in entities]
        self.assertEqual(ids, ['light.lamp', 'media_player.nest_audio', 'camera.front_door', 'sensor.temperature'])
        lamp = entities[0]
        self.assertEqual(lamp['area'], 'Living room')
        self.assertNotIn('access_token', lamp['attributes'])
        self.assertNotIn('secret', json.dumps(entities))

    def test_actions_are_allow_listed_and_validated(self):
        self.connect()
        self.home.act({'entity': 'light.lamp', 'action': 'turn_on', 'data': {'brightness_pct': 40, 'rgb_color': [255, 0, 10]}})
        self.assertEqual(FakeHA.calls[-1], ('/api/services/light/turn_on', {'entity_id': 'light.lamp', 'brightness_pct': 40, 'rgb_color': [255, 0, 10]}))
        self.home.act({'entity': 'media_player.nest_audio', 'action': 'volume_set', 'data': {'volume_level': 0.25}})
        self.assertEqual(FakeHA.calls[-1][0], '/api/services/media_player/volume_set')
        bad = [
            {'entity': 'light.lamp', 'action': 'turn_on', 'data': {'brightness_pct': 400}},
            {'entity': 'light.lamp', 'action': 'turn_on', 'data': {'transition': 2}},
            {'entity': 'light.lamp', 'action': 'delete'},
            {'entity': 'lock.front', 'action': 'unlock'},
            {'entity': 'homeassistant.restart', 'action': 'toggle'},
            {'entity': '../api/config', 'action': 'toggle'},
            {'entity': 'media_player.nest_audio', 'action': 'volume_set', 'data': {'volume_level': True}},
        ]
        before = len(FakeHA.calls)
        for raw in bad:
            with self.assertRaises(ValueError, msg=raw):
                self.home.act(raw)
        self.assertEqual(len(FakeHA.calls), before)

    def test_not_configured_is_a_clear_error(self):
        with self.assertRaises(HomeAssistantError):
            self.home.entities()


class HomeHttpTests(unittest.TestCase):
    """The same bridge through Dash's HTTP API, including camera proxying."""

    @classmethod
    def setUpClass(cls):
        cls.ha = ThreadingHTTPServer(('127.0.0.1', 0), FakeHA)
        threading.Thread(target=cls.ha.serve_forever, daemon=True).start()
        cls.temp = tempfile.TemporaryDirectory()
        cls.server = Server(('127.0.0.1', 0), Handler)
        cls.server.store = Store(cls.temp.name)
        cls.server.home = HomeAssistant(cls.temp.name)
        cls.server.updater = Updater(Path(__file__).resolve().parents[1], cls.server.store)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        for s in (cls.server, cls.ha):
            s.shutdown()
            s.server_close()
        cls.temp.cleanup()

    def request(self, path, method='GET', body=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        conn.request(method, path, json.dumps(body) if body is not None else None, {'Content-Type': 'application/json'})
        r = conn.getresponse()
        result = r.status, r.read(), r.getheader('Content-Type')
        conn.close()
        return result

    def test_flow(self):
        code, data, _ = self.request('/api/home/entities')
        self.assertEqual(code, 502)
        self.assertIn('not connected', json.loads(data)['error'])
        code, data, _ = self.request('/api/home/config', 'PUT', {'url': f'http://127.0.0.1:{self.ha.server_port}', 'token': TOKEN})
        self.assertEqual(code, 200, data)
        code, data, _ = self.request('/api/home/config')
        self.assertTrue(json.loads(data)['configured'])
        self.assertNotIn(TOKEN.encode(), data)
        code, data, _ = self.request('/api/home/entities')
        self.assertEqual(len(json.loads(data)['entities']), 4)
        code, data, _ = self.request('/api/home/action', 'POST', {'entity': 'light.lamp', 'action': 'toggle'})
        self.assertEqual(json.loads(data)['id'], 'light.lamp')
        code, data, _ = self.request('/api/home/action', 'POST', {'entity': 'light.lamp', 'action': 'explode'})
        self.assertEqual(code, 400)
        code, data, kind = self.request('/api/home/camera/camera.front_door')
        self.assertEqual((code, kind, data), (200, 'image/jpeg', b'\xff\xd8JPEGDATA'))
        code, data, kind = self.request('/api/home/camera/camera.front_door?stream=1')
        self.assertEqual(code, 200)
        self.assertTrue(kind.startswith('multipart/x-mixed-replace'))
        self.assertEqual(data.count(b'FRAME'), 3)
        self.assertEqual(self.request('/api/home/camera/light.lamp')[0], 400)
        # Exports never include the token.
        self.assertNotIn(TOKEN.encode(), self.request('/api/export')[1])


if __name__ == '__main__':
    unittest.main()
