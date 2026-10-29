"""Dash LAN web service. Run with python -m app.main."""
import ipaddress
import json
import mimetypes
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from app.store import Store, Conflict
from app.updater import Updater

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / 'app' / 'static'
VERSION = (ROOT / 'app' / 'VERSION').read_text().strip()
NETWORKS = [ipaddress.ip_network(x) for x in ('127.0.0.0/8', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16', '::1/128', 'fc00::/7', 'fe80::/10')]

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
    return host and (private_ip(host) or host == 'localhost' or host.endswith('.local') or host in extra)

class Handler(BaseHTTPRequestHandler):
    server_version = 'Dash'

    def reply(self, code, body, kind='application/json; charset=utf-8', headers=None):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False, allow_nan=False).encode() if kind.startswith('application/json') else body.encode()
        self.send_response(code)
        self.send_header('Content-Type', kind)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store' if self.path.startswith('/api/') else 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'SAMEORIGIN')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: http: data:; frame-src https: http:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
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
            if (origin and origin not in ('http://' + host, 'https://' + host)) or self.headers.get('Sec-Fetch-Site') == 'cross-site':
                self.reply(403, {'error': 'Cross-origin request blocked'})
                return False
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                self.reply(415, {'error': 'application/json required'})
                return False
        return True

    def do_GET(self):
        if not self.permitted():
            return
        path = urlsplit(self.path).path
        if path == '/api/health':
            return self.reply(200, {'status': 'ok', 'version': VERSION})
        if path in ('/api/state', '/api/export'):
            headers = {'Content-Disposition': 'attachment; filename="dash-backup.json"'} if path.endswith('export') else None
            return self.reply(200, self.server.store.read(), headers=headers)
        if path == '/api/updates':
            return self.reply(200, self.server.updater.status())
        if path == '/api/changelog':
            return self.reply(200, {'text': (ROOT / 'CHANGELOG.md').read_text()})
        if path.startswith('/api/'):
            return self.reply(404, {'error': 'Not found'})
        file = (STATIC / ('index.html' if path == '/' else path.lstrip('/'))).resolve()
        if not file.is_relative_to(STATIC.resolve()) or not file.is_file():
            return self.reply(404, {'error': 'Not found'})
        return self.reply(200, file.read_bytes(), mimetypes.guess_type(str(file))[0] or 'application/octet-stream')

    def do_PUT(self):
        self.mutate()

    def do_POST(self):
        self.mutate()

    def mutate(self):
        if not self.permitted(mutation=True):
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size < 0 or size > 4 * 1024 * 1024:
                return self.reply(413, {'error': 'Maximum request size is 4 MB'})
            raw = json.loads(self.rfile.read(size), parse_constant=lambda x: (_ for _ in ()).throw(ValueError('Invalid number')))
            if not isinstance(raw, dict):
                raise ValueError('Expected a JSON object')
            path = urlsplit(self.path).path
            if path == '/api/state' and self.command == 'PUT':
                return self.reply(200, self.server.store.save(raw))
            if path == '/api/visit' and self.command == 'POST':
                return self.reply(200, self.server.store.visit(raw.get('id')))
            if path == '/api/backup' and self.command == 'POST':
                return self.reply(200, {'filename': self.server.store.backup()})
            if path == '/api/updates/check' and self.command == 'POST':
                return self.reply(200, self.server.updater.check())
            if path == '/api/updates/apply' and self.command == 'POST':
                started = self.server.updater.start()
                return self.reply(202 if started else 409, self.server.updater.status())
            return self.reply(404, {'error': 'Not found'})
        except Conflict as exc:
            return self.reply(409, {'error': str(exc)})
        except (ValueError, TypeError, KeyError, OverflowError) as exc:
            return self.reply(400, {'error': str(exc) or 'Invalid request'})
        except Exception:
            self.log_error('Failed to persist request')
            return self.reply(500, {'error': 'Could not complete request. Check server logs and storage permissions.'})

    def log_message(self, fmt, *args):
        print(fmt % args, flush=True)

class Server(ThreadingHTTPServer):
    daemon_threads = True
    def get_request(self):
        sock, address = super().get_request()
        sock.settimeout(15)
        return sock, address

def run():
    store = Store(os.getenv('DATA_DIR', './data'))
    server = Server((os.getenv('BIND', '0.0.0.0'), int(os.getenv('PORT', '8088'))), Handler)
    server.store = store
    server.updater = Updater(ROOT, store)
    print(f'Dash {VERSION} on port {server.server_port}', flush=True)
    server.serve_forever()

if __name__ == '__main__':
    run()
