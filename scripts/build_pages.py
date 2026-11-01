"""Build the public demo from the same files used by the live Docker app."""
import json
import shutil
import sys
from pathlib import Path
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
from app.store import initial, COLORS

def build():
    demo = root / 'docs/demo'
    demo.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(demo / 'js', ignore_errors=True)
    shutil.copytree(root / 'app/static/js', demo / 'js')
    for name in ['app.css', 'icon.svg']:
        shutil.copyfile(root / 'app/static' / name, demo / name)
    html = (root / 'app/static/index.html').read_text().replace('<html lang="en">', '<html lang="en" data-demo="true">')
    (demo / 'index.html').write_text(html)
    shutil.copyfile(root / 'CHANGELOG.md', demo / 'CHANGELOG.md')
    seed = initial()
    # Stable IDs make rebuilding the demo reproducible.
    for i, link in enumerate(seed['links']):
        link['id'] = f'demo-link-{i}'
    seed['links'] += [
        {'id':'demo-plex','name':'Plex','url':'https://app.plex.tv','description':'Your movies, TV and music, ready to play.','category':'homelab','icon':'▶','color':COLORS[3],'pinned':True,'image':'','visits':24,'lastVisited':1793228400000},
        {'id':'demo-stats','name':'HomeLabStats','url':'https://bhxuk.github.io/HomeLabStats/demo/','description':'Your server, at a glance.','category':'homelab','icon':'>_','color':COLORS[0],'pinned':True,'image':'','visits':12,'lastVisited':1793224800000},
        {'id':'demo-sonarr','name':'Sonarr','url':'https://sonarr.tv','description':'Keep up with your favourite series.','category':'homelab','icon':'S','color':COLORS[4],'pinned':False,'image':'','visits':8,'lastVisited':1793221200000},
    ]
    seed['links'] = seed['links'][-3:] + seed['links'][:-3]
    seed['notes'] = 'A home for the things I use every day.\n\n→ Check the server backups\n→ Add a few more favourite links'
    seed['tasks'] = [{'id':'demo-task-1','text':'Make this space my own','done':False},{'id':'demo-task-2','text':'One place for all my apps','done':True}]
    seed['home']['favourites'] = ['camera.front_door', 'light.living_room_lamp', 'media_player.living_room_speaker', 'climate.thermostat']
    seed['revision'] = 1
    (demo / 'seed.json').write_text(json.dumps(seed, ensure_ascii=False, indent=2) + '\n')
    (root / 'docs/.nojekyll').touch()
    (root / 'docs/CHANGELOG.md').write_text((root / 'CHANGELOG.md').read_text())
    shutil.copyfile(root / 'app/static/icon.svg', root / 'docs/icon.svg')
    print('Built docs/demo from app/static')

if __name__ == '__main__':
    build()
