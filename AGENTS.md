# Dash maintenance

- This is bhxuk's personal LAN-only Docker dashboard. Keep authentication disabled unless requested.
- Preserve the HomeLabStats-inspired navy/cyan visual system and public demo.
- Code commits must use bhxuk as author and committer: `41471820+bhxuk@users.noreply.github.com`. Do not add AI co-author trailers.
- Every app release bumps `app/VERSION` and includes a corresponding `CHANGELOG.md` entry.
- Run `python3 -m unittest discover -s tests -v`, `node --check` on each `app/static/js/*.js`, `node --test tests/importer.test.mjs`, and `bash -n install.sh` before publishing.
- Rebuild the demo with `python3 scripts/build_pages.py` after frontend, seed or changelog changes.
- Preserve `.env`, `data/dashboard.json` and backups. Never commit real personal links, secrets or runtime data.
- Keep persistent data backwards compatible so code rollback can preserve current user data.
- One-click updates depend on the immutable Docker supervisor and a mounted Git checkout. Supervisor, Dockerfile or runtime changes require a manual image rebuild and a release-note instruction.
- Use GitHub Actions to test and publish the website, container and release. Check the workflow result; never claim a deployment succeeded without evidence.
- Smart home control goes through Home Assistant only. Keep the token in `data/homeassistant.json`, never in dashboard exports or browser responses, and keep the service allow-list in `app/homeassistant.py` narrow (no locks, alarms or arbitrary services).
