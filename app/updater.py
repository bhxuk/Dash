"""Release-based updates of the mounted checkout, with a supervised rollback."""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

REPO = 'https://github.com/bhxuk/Dash.git'

def version_tuple(value):
    if not re.fullmatch(r'v?\d+\.\d+\.\d+', value):
        raise ValueError('Invalid release version')
    return tuple(map(int, value.lstrip('v').split('.')))

class Updater:
    def __init__(self, root, store):
        self.root, self.store = Path(root), store
        self.current = (self.root / 'app/VERSION').read_text().strip()
        self.lock = threading.Lock()
        self.state, self.latest, self.error, self.checked = 'idle', None, None, None
        self.notes, self.log = '', []

    def git(self, *args, timeout=120):
        result = subprocess.run(['git', '-c', f'safe.directory={self.root}', '-C', str(self.root), *args],
                                text=True, capture_output=True, timeout=timeout)
        if result.returncode:
            raise RuntimeError((result.stderr or result.stdout).strip()[-800:])
        return result.stdout.strip()

    def capability(self):
        if os.getenv('INSTALL_METHOD') != 'docker' or not os.getenv('DASH_SUPERVISED'):
            return False, 'Install with the supplied Docker Compose file to enable one-click updates.'
        if not (self.root / '.git').is_dir() or not shutil.which('git'):
            return False, 'The Git checkout must be mounted at /app.'
        return True, ''

    def status(self):
        ok, reason = self.capability()
        available = self.latest is not None and version_tuple(self.latest) > version_tuple(self.current)
        try:
            recovery = json.loads((self.store.root / 'update-result.json').read_text())
        except (OSError, ValueError):
            recovery = None
        return dict(current=self.current, latest=self.latest, available=available, canUpdate=ok, reason=reason,
                    state=self.state, error=self.error, checked=self.checked, notes=self.notes, log=self.log[-100:], recovery=recovery)

    def check(self):
        if not self.lock.acquire(blocking=False):
            return self.status()
        try:
            request = urllib.request.Request('https://api.github.com/repos/bhxuk/Dash/releases/latest',
                headers={'User-Agent': 'bhxuk-Dash', 'Accept': 'application/vnd.github+json'})
            with urllib.request.urlopen(request, timeout=12) as response:
                data = json.loads(response.read(1024 * 1024))
            tag = data['tag_name']
            version_tuple(tag)
            self.latest = tag.lstrip('v')
            self.notes = str(data.get('body', ''))[:30000]
            self.error = None
        except Exception as exc:
            self.error = f'Could not check GitHub releases: {exc}'
        finally:
            self.checked = time.time()
            self.lock.release()
        return self.status()

    def start(self):
        ok, reason = self.capability()
        if not ok:
            self.error = reason
            return False
        if not self.lock.acquire(blocking=False):
            return False
        if not self.latest or version_tuple(self.latest) <= version_tuple(self.current):
            self.error = 'Check for a newer release first.'
            self.lock.release()
            return False
        self.state, self.error, self.log = 'updating', None, []
        threading.Thread(target=self._run, daemon=True).start()
        return True

    def _run(self):
        pending = self.store.root / 'update-pending.json'
        try:
            if self.git('remote', 'get-url', 'origin').removesuffix('.git').rstrip('/') != REPO.removesuffix('.git'):
                raise RuntimeError('The update remote must be https://github.com/bhxuk/Dash.git')
            if self.git('status', '--porcelain', '--untracked-files=normal'):
                raise RuntimeError('Local source changes found. Back them up and commit or stash them before updating.')
            self.log.append('Fetching the published release…')
            tag = 'v' + self.latest
            self.git('fetch', '--no-tags', 'origin', f'refs/tags/{tag}:refs/tags/{tag}', timeout=180)
            target = self.git('rev-parse', f'{tag}^{{commit}}')
            before = self.git('rev-parse', 'HEAD')
            self.git('merge-base', '--is-ancestor', before, target)
            self.log.append('Validating the release before changing your install…')
            with tempfile.TemporaryDirectory() as directory:
                self.git('worktree', 'add', '--detach', directory, target)
                try:
                    actual = (Path(directory) / 'app/VERSION').read_text().strip()
                    if actual != self.latest:
                        raise RuntimeError('Release tag and app version do not match')
                    result = subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', 'tests'], cwd=directory,
                        capture_output=True, text=True, timeout=90)
                    if result.returncode:
                        raise RuntimeError('Release self-tests failed; installed code was left unchanged.')
                finally:
                    self.git('worktree', 'remove', '--force', directory)
            backup = self.store.backup()
            pending.write_text(json.dumps({'before': before, 'target': target, 'version': self.latest, 'backup': backup}))
            self.log.append(f'Dashboard backed up to backups/{backup}')
            self.git('merge', '--ff-only', target)
            self.state = 'restarting'
            self.log.append('Restarting. The supervisor will restore the previous code if the health check fails.')
            time.sleep(1.5)
            os._exit(3)
        except Exception as exc:
            pending.unlink(missing_ok=True)
            self.error, self.state = str(exc), 'error'
            self.log.append(self.error)
        finally:
            self.lock.release()
