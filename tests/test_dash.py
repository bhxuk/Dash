import copy
import http.client
import importlib.util
import json
import os
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from app.store import Store, Conflict, initial, validate
from app.main import Server, Handler, private_ip, allowed_host, VERSION
from app.updater import Updater, version_tuple

class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(self.temp.name)

    def test_persistence_conflict_and_visit_merge(self):
        state = self.store.read()
        stale = copy.deepcopy(state)
        link = state['links'][0]
        self.store.visit(link['id'])
        state['notes'] = 'Important notes\nwith another line'
        saved = self.store.save(state)
        self.assertEqual(saved['links'][0]['visits'], 1)
        self.assertEqual(Store(self.temp.name).read()['notes'], state['notes'])
        with self.assertRaises(Conflict):
            self.store.save(stale)

    def test_backup_and_import_round_trip(self):
        original = self.store.read()
        name = self.store.backup()
        self.assertEqual(json.loads((Path(self.temp.name) / 'backups' / name).read_text()), original)
        original['categories'].append({'id': 'new-category', 'name': 'Servers', 'icon': '▣'})
        original['links'][0].update(category='new-category', url='http://192.168.1.100:32400/web')
        saved = self.store.save(original)
        self.assertEqual(saved['links'][0]['category'], 'new-category')
        self.assertEqual(validate(saved)['links'][0]['url'], 'http://192.168.1.100:32400/web')

    def test_invalid_import_does_not_change_data(self):
        original = self.store.path.read_bytes()
        for url in ['javascript:alert(1)', 'file:///etc/passwd', 'https://u:p@example.com', '//example.com', 'https://example.com:bad']:
            bad = self.store.read()
            bad['links'][0]['url'] = url
            with self.assertRaises(ValueError):
                self.store.save(bad)
            self.assertEqual(self.store.path.read_bytes(), original)
        bad = self.store.read()
        bad['links'][0]['category'] = 'missing'
        with self.assertRaises(ValueError):
            validate(bad)
        bad = self.store.read()
        bad['categories'].append(bad['categories'][0])
        with self.assertRaises(ValueError):
            validate(bad)

    def test_corrupt_storage_is_not_replaced(self):
        self.store.path.write_text('broken')
        with self.assertRaises(ValueError):
            Store(self.temp.name)
        self.assertEqual(self.store.path.read_text(), 'broken')

class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.server = Server(('127.0.0.1', 0), Handler)
        cls.server.store = Store(cls.temp.name)
        cls.server.updater = Updater(Path(__file__).resolve().parents[1], cls.server.store)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.temp.cleanup()

    def request(self, path, method='GET', body=None, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        h = {'Content-Type': 'application/json'}
        h.update(headers or {})
        conn.request(method, path, json.dumps(body) if body is not None else None, h)
        r = conn.getresponse()
        data, code, response_headers = r.read(), r.status, dict(r.getheaders())
        conn.close()
        return code, data, response_headers

    def test_api_lifecycle_and_export(self):
        code, data, headers = self.request('/api/state')
        self.assertEqual(code, 200)
        state = json.loads(data)
        state['notes'] = 'Saved via the API'
        code, saved, _ = self.request('/api/state', 'PUT', state)
        self.assertEqual(code, 200)
        code, _, _ = self.request('/api/state', 'PUT', state)
        self.assertEqual(code, 409)
        code, data, h = self.request('/api/export')
        self.assertEqual(json.loads(data)['notes'], 'Saved via the API')
        self.assertIn('attachment', h['Content-Disposition'])
        code, _, _ = self.request('/api/backup', 'POST', {})
        self.assertEqual(code, 200)

    def test_browser_security_and_path_traversal(self):
        code, _, _ = self.request('/api/state', 'PUT', {}, {'Origin': 'https://evil.example'})
        self.assertEqual(code, 403)
        code, _, _ = self.request('/api/state', 'PUT', {}, {'Content-Type':'text/plain'})
        self.assertEqual(code, 415)
        code, _, _ = self.request('/', headers={'Host': 'evil.example'})
        self.assertEqual(code, 403)
        code, _, _ = self.request('/../../app/main.py')
        self.assertEqual(code, 404)
        code, _, _ = self.request('/api/visit', 'POST', {'id':'missing'})
        self.assertEqual(code, 400)
        code, _, _ = self.request('/api/state', 'PUT', None, {'Content-Length': '9999999'})
        self.assertEqual(code, 413)

    def test_static_and_version(self):
        code, html, h = self.request('/')
        self.assertEqual(code, 200)
        self.assertIn(b'id="clock"', html)
        self.assertIn("script-src 'self'", h['Content-Security-Policy'])
        for path in ['/app.css', '/app.js', '/icon.svg', '/api/changelog', '/api/updates', '/api/health']:
            self.assertEqual(self.request(path)[0], 200, path)
        self.assertEqual(json.loads(self.request('/api/health')[1])['version'], VERSION)

    def test_network_boundaries(self):
        for host in ['127.0.0.1','192.168.1.100','10.1.2.3','172.18.0.2','::1','fd00::1']:
            self.assertTrue(private_ip(host), host)
        for host in ['8.8.8.8','1.1.1.1','100.64.0.1','not-an-ip']:
            self.assertFalse(private_ip(host), host)
        self.assertTrue(allowed_host('bhxuk.local'))
        self.assertFalse(allowed_host('attacker.example'))

class UpdateTests(unittest.TestCase):
    def test_only_semantic_release_versions(self):
        self.assertGreater(version_tuple('v1.10.0'), version_tuple('1.9.0'))
        for value in ['main','v1.0.0; rm -rf /','1.0','../v1.0.0']:
            with self.assertRaises(ValueError):
                version_tuple(value)

    def test_update_disabled_without_supervisor(self):
        with tempfile.TemporaryDirectory() as folder:
            store = Store(folder)
            updater = Updater(Path(__file__).resolve().parents[1], store)
            with patch.dict(os.environ, {'INSTALL_METHOD':'manual', 'DASH_SUPERVISED':''}):
                self.assertFalse(updater.start())
                self.assertIn('Docker', updater.status()['error'])

    def test_failed_validation_preserves_checkout(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            def git(*args):
                return subprocess.check_output(['git', '-C', str(root), *args], stderr=subprocess.DEVNULL).decode().strip()
            git('init', '-b', 'main')
            git('config', 'user.name', 'Test')
            git('config', 'user.email', 'test@example.invalid')
            (root/'app').mkdir()
            (root/'app/VERSION').write_text('1.0.0')
            git('add', '.')
            git('commit', '-m', 'initial')
            before=git('rev-parse','HEAD')
            git('remote', 'add', 'origin', 'https://github.com/bhxuk/Dash.git')
            store=Store(root/'data')
            updater=Updater(root,store)
            updater.latest='1.1.0'
            updater.lock.acquire()
            # Fetch fails before merge. Network-free test of the failure path.
            original_git=updater.git
            def fail_fetch(*args, **kwargs):
                if args[0]=='status':return ''
                if args[0]=='fetch':raise RuntimeError('offline')
                return original_git(*args,**kwargs)
            updater.git=fail_fetch
            updater._run()
            self.assertEqual(updater.state, 'error')
            self.assertEqual(git('rev-parse','HEAD'),before)
            self.assertFalse((store.root/'update-pending.json').exists())

    def test_supervisor_rolls_code_back_and_keeps_dashboard(self):
        path=Path(__file__).resolve().parents[1]/'scripts/supervisor.py'
        spec=importlib.util.spec_from_file_location('supervisor_test',path)
        mod=importlib.util.module_from_spec(spec)
        # Imports must not alter the test runner's signal handlers.
        with patch('signal.signal'):
            spec.loader.exec_module(mod)
        with tempfile.TemporaryDirectory() as folder:
            mod.data=Path(folder)
            saved=mod.data/'dashboard.json'
            saved.write_text('{"notes":"keep this"}')
            pending={'before':'abc123','version':'1.1.0','backup':'snapshot.json'}
            with patch.object(mod.subprocess,'run') as run:
                run.return_value.returncode=0
                mod.rollback(pending)
                self.assertEqual(run.call_args.args[0][-3:],['reset','--hard','abc123'])
            self.assertEqual(saved.read_text(),'{"notes":"keep this"}')
            self.assertEqual(json.loads((mod.data/'update-result.json').read_text())['status'],'rolled_back')

if __name__ == '__main__':
    unittest.main()
