"""Immutable Docker supervisor. Source updates never replace this running file."""
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

root = Path('/app')
data = Path(os.getenv('DATA_DIR', '/data'))
child = None
stopping = False

def stop(signum, frame):
    global stopping
    stopping = True
    if child and child.poll() is None:
        child.terminate()

signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)

def healthy(version):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{os.getenv("PORT", "8088")}/api/health', timeout=1) as r:
            return json.load(r)['version'] == version
    except Exception:
        return False

def rollback(pending):
    result = subprocess.run(['git', '-c', 'safe.directory=/app', '-C', '/app', 'reset', '--hard', pending['before']],
                            capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('Automatic rollback failed. Run git reset --hard ' + pending['before'] + ' in the checkout.')
    # The app's data format is backwards compatible. Keep the user's latest data;
    # a pre-update JSON backup is also available for manual import if required.
    (data / 'update-result.json').write_text(json.dumps({'status': 'rolled_back', 'version': pending['version'],
        'message': 'New release failed its health check. Previous code restored; your links were preserved.', 'backup': pending['backup']}))

if __name__ == '__main__':
    data.mkdir(parents=True, exist_ok=True)
    os.environ['DASH_SUPERVISED'] = '1'
    while not stopping:
        marker = data / 'update-pending.json'
        pending = json.loads(marker.read_text()) if marker.exists() else None
        child = subprocess.Popen([sys.executable, '-m', 'app.main'], cwd=root)
        if pending:
            deadline = time.monotonic() + 30
            success = False
            while not stopping and time.monotonic() < deadline and child.poll() is None:
                if healthy(pending['version']):
                    success = True
                    break
                time.sleep(.5)
            if stopping:
                break
            if success:
                (data / 'update-result.json').write_text(json.dumps({'status': 'updated', 'version': pending['version'], 'backup': pending['backup']}))
            else:
                if child.poll() is None:
                    child.terminate()
                child.wait(timeout=10)
                rollback(pending)
            marker.unlink(missing_ok=True)
            if not success:
                continue
        code = child.wait()
        if stopping:
            break
        # Code 3 is the intentional handover from the in-app updater.
        if code != 3:
            sys.exit(code or 1)
    if child and child.poll() is None:
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
