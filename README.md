<div align="center">

# `▦` Dash

**Your links. Your apps. Your everyday launchpad.**

A modern personal dashboard for your local network. Save your favourite sites, organise your homelab,
check the time, jot down a note and get on with your day. Inspired by [HomeLabStats](https://github.com/bhxuk/HomeLabStats).

[**Website**](https://bhxuk.github.io/Dash/) · [**Interactive demo**](https://bhxuk.github.io/Dash/demo/) ·
[Install](#install) · [Releases](https://github.com/bhxuk/Dash/releases) · [Changelog](CHANGELOG.md)

![Dash dashboard](docs/img/dashboard.jpg)

</div>

## Features

| Area | What you get |
|---|---|
| Dashboard | Dark navy panels, cyan accents, a sidebar, responsive cards and a light theme |
| Clock & date | UK date formatting, configurable main time zone, optional seconds, New York / UTC / Tokyo clocks |
| Links & apps | Add, edit, delete, pin, categorise and search your own shortcuts |
| Organisation | Custom order, drag and drop, keyboard move buttons, alphabetical / frequent / recent sorting |
| Previews | Details panel, your own preview image URL and an optional sandboxed live website preview |
| Homelab starter | Editable server address and presets for Plex, Sonarr, Radarr, Prowlarr, Bazarr, qBittorrent, Seerr, HomeLabStats, ROMM and Portainer |
| Everyday extras | Quick notes with an explicit Save button, and a small task list |
| Appearance | Dark/light theme, six accent colours, three backgrounds and compact cards |
| Data | Server-side JSON storage, export/import, snapshots and conflict detection across browser tabs |
| Updates | Published-release checks, changelog, one-click update, pre-update validation and backup, automatic code rollback if startup fails |

**No login. No cloud account. No Docker socket. No frontend build step.**
One Python service with no third-party Python packages. Links and settings live in `./data/dashboard.json`, outside the source tree tracked by Git.

## Install

Requires Linux, Docker Engine with Compose v2, and Git. Run these commands as the user who owns your Docker projects:

```bash
git clone https://github.com/bhxuk/Dash.git
cd Dash
bash install.sh
```

The installer creates `data/` and a `.env` file, sets the checkout owner's UID/GID, detects the server's LAN IP and builds/starts the container. Check the printed LAN address. Open **http://<your-server-ip>:8088** using that address.

### Manual Docker Compose setup

```bash
git clone https://github.com/bhxuk/Dash.git
cd Dash
mkdir -p data
cp .env.example .env
nano .env
# Set LAN_IP to this server's LAN address.
# Set PUID and PGID to the results of id -u and id -g.
docker compose up -d --build
```

Open `http://<LAN_IP>:8088`. Dash binds to the specific LAN address configured in `.env`. Without a `.env` file it defaults to loopback only. No port forwarding, Funnel or public reverse proxy is needed.

The container runs as the configured UID/GID. Your checkout and data folder must be writable by that user. The source is mounted at `/app` so updates can be applied without mounting Docker's socket.

### First run

1. Choose **Add link** for your websites, or **Bring your homelab together** for app presets.
2. Set the app server IP, choose the apps you use and add them. Ports are editable defaults, not auto-discovered services.
3. Use **Manage categories** to create and rename groups. A category must be empty before deletion.
4. Click a link name to open it immediately. Click **◉** for details or **Live preview** to try embedding it.
5. Use **Settings & updates** for appearance, data exports and updates. Press `/` to focus search.

Most websites block embedded viewing or require cookies that do not work in frames. Dash always provides a direct Open website link. Preview images are optional URLs you supply; Dash does not capture screenshots, proxy private websites or copy their login sessions. Local HTTPS apps with self-signed certificates may need to be opened directly first.

Notes are saved by clicking **Save note**. Dash warns before leaving with unsaved note changes. If another browser has edited the dashboard, reload before saving; the existing data is protected from silent overwrites.

## Updates

Open **Settings & updates → Updates → Check for updates**. When a newer stable release is published, click **Update now**.

Dash fetches the exact release tag from `bhxuk/Dash`, checks that it is a fast-forward of your install, validates its version and runs its self-tests in a temporary Git worktree. It then creates a dashboard snapshot, fast-forwards the source and restarts the app. The immutable Docker supervisor waits up to 30 seconds for the new version's health endpoint. If startup fails, it restores the previous source commit and keeps your dashboard data. An update result is stored in `data/update-result.json`.

The UI reconnects automatically. An interrupted update's pending marker is processed on the next container start. Local source edits block automatic updates rather than being overwritten. Internet access to GitHub is required for checks and updates; the dashboard itself works on an offline LAN.

The supervisor and Python base image are deliberately outside in-app source updates. If a release changes either, run the full manual rebuild described in its release notes:

```bash
git pull --ff-only
docker compose up -d --build
```

A versioned image is also built to `ghcr.io/bhxuk/dash` by GitHub Actions. Compose builds locally by default so installation does not depend on registry package visibility.

## Backups & recovery

- **Export backup** downloads all dashboard content as JSON.
- **Import backup** validates a Dash JSON export and makes a server snapshot before replacing the dashboard.
- **Create snapshot** writes a timestamped file to `data/backups/`. Copy snapshots off the server for an independent backup.
- Imports and updates create additional snapshots automatically. Snapshots are retained until you remove them.
- To restore a server snapshot, download/copy that JSON file and use **Import backup**. Alternatively stop Dash, copy the snapshot to `data/dashboard.json`, preserve its ownership, and start Dash again.
- Deleting a container does not delete `./data`. Deleting the data folder does.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `LAN_IP` | `127.0.0.1` without `.env` | Host address Docker publishes on; set to the server LAN IP |
| `DASH_PORT` | `8088` | Host port; internal container port stays 8088 |
| `PUID`, `PGID` | `1000` | User/group owning the checkout and data |
| `DASH_HOSTNAMES` | empty | Optional local DNS names, comma-separated, e.g. `dash.home.arpa` |
| `TZ` | `Europe/London` | Container timezone |

The main dashboard clock timezone is configured in the UI. Changes are shared across devices using this dashboard.

## LAN access

No authentication is enabled, as requested. Everyone who can reach Dash on your trusted LAN can edit it and trigger updates. The service accepts RFC1918, loopback, link-local and IPv6 ULA clients, and checks Host/Origin on writes to reduce cross-site requests and DNS rebinding. It does not trust forwarded IP headers. These checks do not replace network isolation: do not expose the service through a public proxy or forward its port.

No remote access or Tailscale routing is configured. Dash launches web app URLs; it does not install or control desktop programs. The dashboard runs without Docker socket access, host PID mode or privileged containers.

## Troubleshooting

```bash
docker compose ps
docker compose logs --tail=100 dash
docker compose restart dash
```

- **Cannot open it:** verify `LAN_IP` belongs to the server, check the host firewall allows your LAN to reach `DASH_PORT`, then inspect Compose logs.
- **Permission denied:** match `PUID`/`PGID` to the checkout owner and ensure `data/` is writable. Recreate with `docker compose up -d`.
- **Host not allowed:** use the LAN IP, a `.local` name, or add your local DNS name to `DASH_HOSTNAMES` and recreate the container.
- **Port in use:** change `DASH_PORT` in `.env`, then recreate the container.
- **Update refused:** run `git status`. Back up and commit or stash source edits, then retry. `.env` and `data/` are ignored by Git.
- **Bad dashboard JSON:** Dash does not silently reset it. Stop the container and restore a known-good snapshot.

## Development & publishing

```bash
python3 -m unittest discover -s tests -v
DATA_DIR=./data PORT=8088 python3 -m app.main
python3 scripts/build_pages.py
```

The app backend is in `app/`, frontend in `app/static/`, and Docker supervisor in `scripts/`. The public demo reuses the exact frontend with browser-local storage and sample data. It never connects to your server.

Every release must bump `app/VERSION` and add a matching `CHANGELOG.md` entry. CI tests the API and storage, checks frontend syntax and builds Docker. Successful main builds publish a release, a container image and the Pages site. The initial Pages setup may need **Settings → Pages → Source: GitHub Actions** if repository administration is unavailable to the workflow. Code commits are attributed to **bhxuk**; generated deployments and releases are handled by GitHub Actions.

## Licence

[MIT](LICENSE). Created by [bhxuk](https://github.com/bhxuk). Visual direction inspired by HomeLabStats.
