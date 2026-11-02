# Changelog

## [2.2.0] - 2026-11-02

- Removed the Tasks panel. The overview now uses the full width, and every category shows all of its links.
- New status chips (Mushroom style) on the overview and Smart home page: lights on (tap to switch them all off), average temperature and humidity, thermostat, what's playing, motion and open doors/windows.
- New room cards on the Smart home page: temperature, humidity, lights on and media for each room, with one switch for all the room's lights. Tap a room to jump to its devices.
- Quick actions moved into a compact button row under the greeting.
- Existing tasks and notes stay in your data file and backups. Installs automatically.

## [2.1.0] - 2026-11-02

- Dash now installs new releases automatically. It checks GitHub every hour, backs up your data, updates, and rolls back by itself if the new version fails to start. Turn this off in Settings → Updates.
- With automatic updates off, a banner tells you when an update is ready, with an **Update now** button.
- Open Dash pages reload themselves after an update, so you always see the latest version.
- Removed the Notes panel from the overview. Existing notes stay in your backups and data file.
- No image rebuild is required; use the in-app updater (this is the last time you need to click it).

## [2.0.0] - 2026-11-01

- Rebuilt Dash from the ground up with clean, readable code: modular JavaScript, a rewritten stylesheet and a tidier Python server. Same LAN-only Docker setup and no extra dependencies.
- New **Smart home** section powered by Home Assistant: lights with brightness, warmth and colour; Google Nest speakers, Nest Hubs and Chromecasts with play/pause, skip, volume and source; Nest and other thermostats; switches, plugs, fans, blinds, vacuums, scenes, scripts and sensors, grouped by room.
- New **Cameras** view: live-refreshing snapshots of Aqara and other Home Assistant cameras, plus a full-screen live view.
- Pin any device with ★ to show it on your overview; hide devices you never use.
- Your Home Assistant token stays on the server (`data/homeassistant.json`, owner-only), is never sent to the browser and is not included in exports. Only a fixed list of safe actions can be sent; locks and alarms are read-only.
- New overview with greeting, quick actions, favourite devices, favourite links and every category at a glance.
- “Add server apps” now covers your whole homelab: Plex, Sonarr, Radarr, Prowlarr, Bazarr, qBittorrent, Seerr, Tautulli, Home Assistant, Portainer, Glances, HomeLabStats, Pulse, ROMM, PDFDing, Windows 11, Plex Burner and more, with editable ports.
- Search covers links and devices. Configurable world clocks. Categories can be renamed, re-iconed, reordered and deleted (links move to another category).
- Mobile layout with a slide-out menu.
- Existing links, notes, tasks, settings and backups carry over unchanged. No image rebuild is required; use the in-app updater.

## [1.1.0] - 2026-10-29

- Bulk-add links by pasting URLs, named pipe-separated lists, CSV/TSV or Markdown links.
- Import multiple Windows Internet Shortcut (.url), Mac .webloc, text list and browser bookmark HTML files.
- Review and select links before import, with URL validation, duplicate detection, default categories and optional favourites.
- Create categories from imported lists and back up the dashboard before appending links.
- New compact default with smaller link cards, a dense table/list view and a TV launcher with horizontal category shelves.
- Switch layouts directly from the dashboard or Settings; saved layout works across devices.
- TV layout supports arrow-key navigation between focused links, preview artwork and fullscreen.
- Existing links, notes, backups and settings remain compatible. No image rebuild is required; use the in-app updater.

## [1.0.0] - 2026-10-28

- First release of Dash, a personal LAN dashboard by bhxuk.
- HomeLabStats-inspired navy panels, cyan accents, sidebar navigation and responsive layouts.
- UK clock and date, additional world clocks, search, categories, favourites, frequent and recent links.
- Link editing, custom icons and colours, preview images and optional embedded previews.
- Homelab starter pack with editable server address and app shortcuts.
- Drag-and-drop ordering, keyboard-friendly move controls, light/dark themes and backgrounds.
- Quick notes, a task list, JSON export/import and automatic backup before imports and updates.
- Persistent server storage with conflict detection between tabs and same-origin write protection.
- Docker Compose deployment without Docker socket access, plus release checks and one-click updates.
- Release validation, pre-update backup and automatic code rollback on failed startup.
- GitHub Pages landing page, interactive demo, CI, container publishing and versioned releases.
