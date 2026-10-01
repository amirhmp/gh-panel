# CLAUDE.md

Project memory for GH Panel: a small Hono control panel that runs on a GitHub Actions Ubuntu runner and manages services (Tailscale, SSH, HTTP proxy, 9router). See `README.md` for user-facing setup and secrets.

## Layout

- `src/index.js`: Hono app (basic auth, JSON API, serves the page), startup and shutdown.
- `src/services.js`: service definitions (`tailscale`, `ssh`, `proxy`, `9router`) plus `tailscaleIp()` / `bindAddress()`.
- `src/runner-info.js`: `getRunnerInfo({ refresh })` looks up the runner's public IP and geolocation (ipinfo.io, then ipwho.is, then ipify.org for IP only), caches for 10 min, dedupes concurrent calls. Served by `GET /api/runner` and shown in the "Server" card at the top of `panel.html`, which also holds uptime, server time, the traffic table and the shutdown button (there is no separate danger zone).
- `src/system-info.js`: `getSystemInfo()` returns server time, timezone, `os.uptime()` and `traffic` since boot, read from `/proc/net/dev`: `{ interfaces: [{ name, rx, tx, main }], total }`. Loopback and idle interfaces are left out; the internet-facing interface (default route, else `eth0`) is first and has `main: true` (the UI highlights it), the rest are sorted by traffic. `total` sums every listed interface, so bytes that cross both a virtual interface (`tailscale0`, `docker0`, `veth*`) and `eth0` are counted twice; the panel says so. `traffic` is `null` off Linux. Served by `GET /api/system` (uncached, polled every 5 s). The page ticks uptime and server time every second between polls.
- `src/router9-config.js`: 9router config export/import (AES-256-GCM seal/unseal, SQLite snapshot and restore via `node:sqlite`).
- `src/panel.html`: the whole UI (HTML, CSS and JS in one file, no build step). Read once at startup.
- `.github/workflows/panel.yml`: installs Tailscale, openssh-server and 9router (`npm install -g 9router@latest --ignore-scripts`), then runs `npm start` as the **last** step.
- `zip.js`: bundles the project with Bun via `git ls-files`. `TODO.txt` is gitignored, so it is not included by it.
- `TODO.txt`: personal task list, gitignored. Keep it updated (`[x]` when done, short notes underneath).

Stack: Node >=22.13 (`node:sqlite`), ESM (`"type": "module"`), `hono`, `@hono/node-server`, `proxy`. No test suite, no linter, no TypeScript.

## Commands

- Run on a runner: `npm start` (needs `PANEL_USERNAME`, `PANEL_PASSWORD`, `TAILSCALE_AUTHKEY`, `PROXY_CREDENTIALS`).
- Run locally: `BIND_ADDRESS=127.0.0.1 PANEL_USERNAME=admin PANEL_PASSWORD=pass PROXY_CREDENTIALS=u:p npm start`.
- Syntax check: `node --check src/index.js && node --check src/services.js`.

## Design rules (keep these true)

- **Tailnet only.** The panel (3000), sshd (22) and proxy (3128) bind to the Tailscale IP, never `0.0.0.0`. Use `bindAddress()` for panel/proxy and `tailscaleIp()` for ssh.
- **Startup order.** `index.js` starts Tailscale first (the panel itself listens on its IP), then serves, then runs each service with `autostart: true` (`proxy` only; `ssh` and `9router` are off until started from the panel). If Tailscale fails, exit with code 1 so the workflow fails; never fall back to all interfaces.
- **`BIND_ADDRESS`** overrides the bind IP for local dev only. In that mode Tailscale is skipped and `ssh` refuses to start, so a dev machine never gets users created or sshd started.
- **Service contract:** `status() -> { running, info }`, `start(opts)`, `stop()`, optional `autostart: true`, optional `controllable: false`, optional `exportConfig() -> { filename, data }` and `importConfig(buffer)` (they add Export/Import buttons and the `GET/POST /api/services/:name/config` routes, which are registered before the `/:action` route). To add a service, add one entry to `services`.
- **`tailscale` is read-only in the panel** (`controllable: false`): no buttons, and the API returns 403. It has no `autostart` because `index.js` starts it explicitly.
- **SSH is off by default** (no `autostart`). Nothing is created or started until you press **start** on its card in the panel.
- **SSH uses plain OpenSSH, not Tailscale SSH.** `tailscale up` must not get `--ssh`, which would intercept port 22 and bypass the password. The `ssh` service creates or updates a Linux user named `PANEL_USERNAME` with `PANEL_PASSWORD` (in the `sudo` group; sudo asks for the same password) and runs its own sshd (`/tmp/panel-sshd_config`, `AllowUsers` that user, no root login, `MaxAuthTries 3`). The workflow disables the system `ssh` service so port 22 is free. `PANEL_USERNAME` must be a valid Linux username.
- **9router is off by default** (no `autostart`). It is started from the panel by spawning its bundled Next.js server (`<npm root -g>/9router/app/custom-server.js`) directly with `process.execPath`, not the `9router` CLI (interactive menu, self-update, tray, detached children). Env: `PORT=20128`, `HOSTNAME=bindAddress()`, `DATA_DIR=<tmp>/panel-9router`, `INITIAL_PASSWORD=PANEL_PASSWORD`, random `JWT_SECRET` per panel process, `REQUIRE_API_KEY=true`. The panel's own secrets (`PANEL_*`, `TAILSCALE_AUTHKEY`, `PROXY_CREDENTIALS`, `BIND_ADDRESS`) are stripped from the child env. Next renames the process to `next-server`, so match on that (not the script path) when checking for leftovers. The workflow installs it with `--ignore-scripts` (its postinstall only pre-fetches optional SQLite engines; it runs on `node:sqlite`).
- **9router config = one SQLite file** (`<DATA_DIR>/db/data.sqlite`, WAL). Export uses `VACUUM INTO` (safe while running) and drops `usageHistory`, `usageDaily`, `requestDetails`; the blob is gzip + AES-256-GCM keyed from `PANEL_PASSWORD` (scrypt). Import validates and patches a temp copy first, and only then stops 9router and swaps the file. 9router checks a stored bcrypt `password` in `settings` before `INITIAL_PASSWORD`, so import deletes that key (and forces `requireLogin: true`, `authMode: "password"`) to keep `PANEL_PASSWORD` the dashboard password. If 9router changes its storage layout, update `router9-config.js` (`REQUIRED_TABLES`, `USAGE_TABLES`).
- **Public IP/location** is fetched server-side from the runner (the browser reaches the panel over Tailscale, so its own IP would be wrong). It is only served behind basic auth on the tailnet. Provider responses are validated (`net.isIP`, lat/lon regex) and everything shown in the UI goes through `esc()`. If every provider fails the API returns 502 and the card shows the error; the last known value is kept if one exists.
- **Shutdown** (`POST /api/shutdown`) stops the controllable services and calls `process.exit(0)`. The run ends only because `npm start` is the workflow's last step, so don't add steps after it.
- **Secrets** come from env vars only. Never log them or commit `.env`. Exported 9router configs contain provider keys, so they must always stay encrypted.
- **UI:** keep `panel.html` dependency-free. Escape any server-provided text before putting it in `innerHTML` (use the `esc()` helper).

## Testing without Tailscale

The sandbox or a dev machine usually has neither Tailscale nor sudo. To check bind behavior, run with `BIND_ADDRESS=127.0.0.2` and confirm requests to `127.0.0.1` are refused. Test 9router the same way: start it from the API, check `127.0.0.2:20128` answers and `127.0.0.1:20128` is refused, then round-trip `GET`/`POST /api/services/9router/config`. Test the proxy by chaining it to the panel (`curl -x http://u:p@127.0.0.2:3128 -u admin:pass http://127.0.0.2:3000/api/services`). The real `ssh` and `tailscale` paths can only be verified on an actual runner.