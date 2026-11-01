"""Dash LAN web service. Run with ``python -m app.main``."""
import ipaddress
import json
import mimetypes
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from app.homeassistant import HomeAssistant, HomeAssistantError
from app.store import Conflict, Store
from app.updater import Updater

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / 'app' / 'static'
VERSION = (ROOT / 'app' / 'VERSION').read_text().strip()
MAX_BODY = 4 * 1024 * 1024
NETWORKS = [ipaddress.ip_network(x) for x in (
    '127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16',
    '::1/128', 'fc00::/7', 'fe80::/10')]
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data: blob:; "
       "frame-src https: http:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'")
mimetypes.add_type('text/javascript', '.js')


def private_ip(value):
    try:
        ip = ipaddress.ip_address(value)
        if getattr(ip, 'ipv4_mapped', None):
            ip = ip.ipv4_mapped
        return any(ip in n for n in NETWORKS)
    except ValueError:
        return False


def allowed_host(host):
    extra = {x.strip().lower() for x in os.getenv('DASH_HOSTNAMES', '').split(',') if x.strip()}
    return bool(host) and (private_ip(host) or host == 'localhost' or host.endswith('.local') or host in extra)


class Handler(BaseHTTPRequestHandler):
    server_version = 'Dash'

    # ---- responses -------------------------------------------------------
    def _headers(self, code, kind, length=None, extra=None):
        self.send_response(code)
        self.send_header('Content-Type', kind)
        if length is not None:
            self.send_header('Content-Length', str(length))
        self.send_header('Cache-Control', 'no-store' if self.path.startswith('/api/') else 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'SAMEORIGIN')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', CSP)
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()

    def reply(self, code, body, kind='application/json; charset=utf-8', headers=None):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
        self._headers(code, kind, len(body), headers)
        self.wfile.write(body)

    def permitted(self, mutation=False):
        if not private_ip(self.client_address[0]):
            self.reply(403, {'error': 'Dash is available on local networks only.'})
            return False
        host = self.headers.get('Host', '')
        try:
            if not allowed_host(urlsplit('http://' + host).hostname):
                raise ValueError()
        except ValueError:
            self.reply(403, {'error': 'Host not allowed. Use the server LAN IP or configure DASH_HOSTNAMES.'})
            return False
        if mutation:
            origin = self.headers.get('Origin')
            if (origin and origin not in ('http://' + host, 'https://' + host)) \
                    or self.headers.get('Sec-Fetch-Site') == 'cross-site':
                self.reply(403, {'error': 'Cross-origin request blocked'})
                return False
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                self.reply(415, {'error': 'application/json required'})
                return False
        return True

    # ---- GET -------------------------------------------------------------
    def do_GET(self):
        if not self.permitted():
            return
        url = urlsplit(self.path)
        path = url.path
        store, home = self.server.store, self.server.home
        try:
            if path == '/api/health':
                return self.reply(200, {'status': 'ok', 'version': VERSION})
            if path == '/api/state':
                return self.reply(200, store.read())
            if path == '/api/export':
                return self.reply(200, store.read(), headers={'Content-Disposition': 'attachment; filename="dash-backup.json"'})
            if path == '/api/updates':
                return self.reply(200, self.server.updater.status())
            if path == '/api/changelog':
                return self.reply(200, {'text': (ROOT / 'CHANGELOG.md').read_text()})
            if path == '/api/home/config':
                return self.reply(200, home.public_config())
            if path == '/api/home/entities':
                return self.reply(200, home.entities())
            if path.startswith('/api/home/camera/'):
                stream = parse_qs(url.query).get('stream') == ['1']
                return self.camera(unquote(path.rsplit('/', 1)[1]), stream)
        except HomeAssistantError as exc:
            return self.reply(502, {'error': str(exc)})
        except ValueError as exc:
            return self.reply(400, {'error': str(exc)})
        if path.startswith('/api/'):
            return self.reply(404, {'error': 'Not found'})
        return self.static(path)

    def static(self, path):
        file = (STATIC / ('index.html' if path == '/' else path.lstrip('/'))).resolve()
        if not file.is_relative_to(STATIC.resolve()) or not file.is_file():
            return self.reply(404, {'error': 'Not found'})
        return self.reply(200, file.read_bytes(), mimetypes.guess_type(str(file))[0] or 'application/octet-stream')

    def camera(self, entity_id, stream):
        response = self.server.home.camera(entity_id, stream)
        with response:
            kind = response.headers.get('Content-Type', '')
            if not kind.startswith(('image/', 'multipart/x-mixed-replace')):
                return self.reply(502, {'error': 'Camera did not return an image'})
            if not stream:
                body = response.read(15 * 1024 * 1024)
                return self.reply(200, body, kind)
            self._headers(200, kind)
            self.close_connection = True
            try:
                while chunk := response.read1(64 * 1024):
                    self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError, TimeoutError, OSError):
                pass  # the viewer closed the camera, or the camera went away

    # ---- writes ----------------------------------------------------------
    def do_PUT(self):
        self.mutate()

    def do_POST(self):
        self.mutate()

    def mutate(self):
        if not self.permitted(mutation=True):
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 0 or size > MAX_BODY:
                return self.reply(413, {'error': 'Maximum request size is 4 MB'})
            raw = json.loads(self.rfile.read(size) or b'{}',
                             parse_constant=lambda x: (_ for _ in ()).throw(ValueError('Invalid number')))
            if not isinstance(raw, dict):
                raise ValueError('Expected a JSON object')
            route = (self.command, urlsplit(self.path).path)
            store, home, updater = self.server.store, self.server.home, self.server.updater
            if route == ('PUT', '/api/state'):
                return self.reply(200, store.save(raw))
            if route == ('POST', '/api/visit'):
                return self.reply(200, store.visit(raw.get('id')))
            if route == ('POST', '/api/backup'):
                return self.reply(200, {'filename': store.backup()})
            if route == ('POST', '/api/updates/check'):
                return self.reply(200, updater.check())
            if route == ('POST', '/api/updates/apply'):
                started = updater.start()
                return self.reply(202 if started else 409, updater.status())
            if route == ('PUT', '/api/home/config'):
                return self.reply(200, home.configure(raw))
            if route == ('POST', '/api/home/action'):
                return self.reply(200, home.act(raw))
            return self.reply(404, {'error': 'Not found'})
        except Conflict as exc:
            return self.reply(409, {'error': str(exc)})
        except HomeAssistantError as exc:
            return self.reply(502, {'error': str(exc)})
        except (ValueError, TypeError, KeyError, OverflowError) as exc:
            return self.reply(400, {'error': str(exc) or 'Invalid request'})
        except Exception:
            self.log_error('Failed to complete %s %s', self.command, self.path)
            return self.reply(500, {'error': 'Could not complete request. Check server logs and storage permissions.'})

    def log_message(self, fmt, *args):
        print(fmt % args, flush=True)


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def get_request(self):
        sock, address = super().get_request()
        sock.settimeout(30)
        return sock, address


def run():
    data = os.getenv('DATA_DIR', './data')
    store = Store(data)
    server = Server((os.getenv('BIND', '0.0.0.0'), int(os.getenv('PORT', '8088'))), Handler)
    server.store = store
    server.home = HomeAssistant(data)
    server.updater = Updater(ROOT, store)
    print(f'Dash {VERSION} on port {server.server_port}', flush=True)
    server.serve_forever()


if __name__ == '__main__':
    run()
