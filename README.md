# GH Panel

A TypeScript [Hono](https://hono.dev) control panel running on a GitHub Actions Ubuntu runner. It manages services:

| Service     | What it does                                                                                                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tailscale` | Joins your tailnet so you can reach the runner. Its card shows the runner's name and IP, whether traffic to your devices is **direct or relayed** (DERP), and an **exit node** switch (start/stop are not available in the panel)  |
| `ssh`       | OpenSSH server on port **22**, bound to the Tailscale IP only; log in with the panel username/password. **Not installed and off by default**: install it, then start it from the panel                                             |
| `proxy`     | HTTP/HTTPS proxy (npm [`proxy`](https://github.com/TooTallNate/proxy-agents/tree/main/packages/proxy)) on port **3128**, bound to the Tailscale IP only                                                                            |
| `socks`     | SOCKS5 proxy (own implementation, `src/services/socks.ts`) on port **1080**, bound to the Tailscale IP only. CONNECT only, username/password auth with the same `PROXY_CREDENTIALS`, host names resolved on the runner (`socks5h`) |
| `9router`   | [9router](https://github.com/decolua/9router) AI gateway (dashboard + OpenAI-compatible API) on port **20128**, bound to the Tailscale IP only. **Not installed and off by default**: install it, then start it from the panel     |

Tailscale starts first, then the panel (port **3000**), then `proxy` and `socks`. `ssh` and `9router` are not installed by the workflow: press **install** on their cards (the panel runs `apt-get install openssh-server` / `npm install -g 9router@latest`), then **start**. The panel, `ssh`, `proxy`, `socks` and `9router` listen on the **Tailscale IP only**, so nothing is reachable from outside your tailnet. If Tailscale fails to come up, the panel exits and the workflow fails instead of exposing anything.

The top of the panel is a single **Server** card with: the runner's public IP and approximate location (city, region, country, map link) and provider, the server time and timezone, a live **uptime** timer (how long the VM has been on) with its boot time, a table of the **network traffic since boot per interface** (received / sent / total; `eth0` is listed first and highlighted, with a total row), and the **Shut down & end workflow** button. The IP is looked up by the server, so it is the runner's IP (the one the proxy exits from), not your own; the location is the data center's, not a precise address. Traffic comes from the kernel counters in `/proc/net/dev`, so it includes the runner's own setup downloads (apt, npm, Tailscale). The total row sums all listed interfaces, so traffic that crosses a virtual interface (e.g. `tailscale0`) and `eth0` is counted in both; the `eth0` row is the real internet traffic. The IP is also printed in the job log as `[runner] public IP: ...`.

Once running, use the panel to install `ssh` and `9router` (one **install** button per card; start, stop, restart and config buttons appear once installed) and to start/stop/restart `ssh`, `proxy`, `socks` and `9router`. The **Shut down** button (in the Server card) stops them and ends the workflow.

## GitHub secrets (Settings → Secrets and variables → Actions)

| Secret              | Sample value                  | Notes                                                                                                              |
| ------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `PANEL_USERNAME`    | `admin`                       | Panel basic-auth username, also the SSH user (must be a valid Linux username: lowercase letters, digits, `_`, `-`) |
| `PANEL_PASSWORD`    | `S3cret-Panel-Pass`           | Panel basic-auth password, also the SSH password (use a strong one)                                                |
| `TAILSCALE_AUTHKEY` | `tskey-auth-xxxxxxxx`         | Reusable/ephemeral key from Tailscale                                                                              |
| `PROXY_CREDENTIALS` | `proxyuser:S3cret-Proxy-Pass` | Format `username:password`                                                                                         |

No extra secrets are needed for 9router: its dashboard password is `PANEL_PASSWORD`.

Optional **variable** (same page, **Variables** tab): `TAILSCALE_HOSTNAME`, the machine name of the runner in your tailnet. Default: `github-ubuntu` (letters, digits and `-`, max 63 characters). The panel shows the runner by its MagicDNS name (`<name>.<tailnet>.ts.net`) instead of its IP, e.g. `http://github-ubuntu.tail1234.ts.net:20128/dashboard` on the 9router card.

## Usage

1. Add the secrets, then run **Actions → Ubuntu Panel → Run workflow**.
2. Read the runner's name and Tailscale IP from the job log (`[tailscale] started: github-ubuntu.tail1234.ts.net (100.x.y.z)`) or in your Tailscale admin console.
3. From a device on your tailnet:
   - Panel: `http://100.x.y.z:3000` (log in with `PANEL_USERNAME` / `PANEL_PASSWORD`)
   - Proxy: `curl -x http://proxyuser:S3cret-Proxy-Pass@100.x.y.z:3128 https://ifconfig.me`
   - SOCKS5: `curl -x socks5h://proxyuser:S3cret-Proxy-Pass@100.x.y.z:1080 https://ifconfig.me` (use `socks5h`, not `socks5`, so DNS is resolved on the runner)
   - SSH (press **install**, then **start**, on the `ssh` card first): `ssh admin@100.x.y.z` (password = `PANEL_PASSWORD`; the user is in the `sudo` group and `sudo` asks for the same password)

## 9router

9router is not part of the workflow: press **install** on its card in the panel (it runs `npm install -g 9router@latest`, so always the latest release), then **start**. Once it is running, then open `http://100.x.y.z:20128/dashboard` (log in with `PANEL_PASSWORD`) to add provider API keys, combos and client API keys. Point your tools at `http://100.x.y.z:20128/v1`; `/v1` requires an API key created in the dashboard.

The runner is ephemeral, so its configuration disappears when the workflow ends. Use the card's buttons to keep it:

- **export config** downloads a `9router-config-<timestamp>.ghp9r` file with your provider keys, OAuth tokens, combos, API keys and settings. Usage/request logs are not included. The file is encrypted (AES-256-GCM, key derived from `PANEL_PASSWORD`), so it is only useful to someone who knows the panel password.
- **import config** uploads such a file and replaces the current 9router config. If 9router is running it is restarted automatically. After an import the dashboard password is always `PANEL_PASSWORD`, whatever password was set when the file was exported.

Export works while 9router is running, but only once it has been started at least once. A file can only be imported if it was exported with the same `PANEL_PASSWORD`.

## API

- `GET  /api/services`
- `GET  /api/system` — server time, timezone, uptime and network traffic since boot
- `GET  /api/runner` — the runner's public IP and approximate location (`?refresh=1` forces a new lookup)
- `PUT /api/services/:name/toggles/:key` with `{"enabled": true|false}` — switches an option listed in the service's `toggles` (tailscale: `exit-node`)
- `POST /api/services/:name/install` — installs `ssh` (apt) or `9router` (npm) on demand and answers when done; 404 for services that need no install
- `POST /api/services/:name/(start|stop|restart)` — `proxy` and `socks` also accept `?port=8080`; `tailscale` returns 403; a service that is not installed yet returns 409
- `GET  /api/services/9router/config` — download the encrypted 9router config
- `POST /api/services/9router/config` — upload one (`Content-Type: application/octet-stream`, max 25 MB)
- `POST /api/shutdown` — stops the services and exits, which ends the workflow run

## Network & SSH security notes

- The panel (3000), sshd (22), proxy (3128) and socks (1080) listen on the Tailscale IP only (never the runner's public IP), so only devices on your tailnet can reach them. Restrict who can reach those ports with Tailscale ACLs.
- Credentials are still required on top of that (panel basic auth, proxy and SOCKS auth, SSH password).
- Password login is weaker than Tailscale SSH (which uses your Tailscale identity, no password). Use a long, unique `PANEL_PASSWORD`. Root login is disabled, only `PANEL_USERNAME` may log in, and `MaxAuthTries` is 3.
- Tailscale SSH (`--ssh`) is not enabled: it would intercept port 22 on the tailnet IP and bypass the password.
- Use an _ephemeral_ Tailscale auth key so the runner disappears from your admin console after shutdown.

## Architecture

The server is split into layers that only depend downwards: **routes** (HTTP) call the **services** and **system** modules (what actually manages the VM), and the **UI** is a separate browser app that only shares _types_ with the server.

```mermaid
flowchart TB
  subgraph Browser["Browser (on your tailnet)"]
    UI["UI app<br/>Hono JSX DOM<br/>src/ui/client"]
  end

  subgraph Server["Panel server (Node + Hono) - src/"]
    APP["app.ts<br/>basic auth, static assets, error handling"]
    subgraph Routes["routes/ - HTTP layer"]
      RP["pages.tsx<br/>GET /"]
      RS["services.ts<br/>/api/services"]
      RV["server.ts<br/>/api/system, /api/runner, /api/shutdown"]
    end
    subgraph Domain["Domain layer"]
      SV["services/<br/>tailscale, ssh, proxy, socks, 9router"]
      SY["system/<br/>info.ts, runner.ts"]
    end
    LC["lifecycle.ts<br/>startup order, shutdown"]
  end

  subgraph Host["Runner (Ubuntu VM)"]
    TS["tailscale CLI"]
    SSHD["sshd"]
    PX["HTTP proxy"]
    SK["SOCKS5 proxy"]
    R9["9router process"]
    PROC["/proc/net/dev, os.uptime"]
  end
  NET["ipinfo.io / ipwho.is / ipify.org"]

  UI -->|"HTTP + JSON"| APP
  APP --> RP
  APP --> RS
  APP --> RV
  RS --> SV
  RV --> SY
  RV --> LC
  LC --> SV
  SV --> TS
  SV --> SSHD
  SV --> PX
  SV --> R9
  SY --> PROC
  SY --> NET
```

Source layout and who may import whom (arrows are imports):

```mermaid
flowchart LR
  index["index.ts"] --> app["app.ts"]
  index --> lifecycle["lifecycle.ts"]
  index --> config["config.ts"]
  index --> servicesReg["services/index.ts<br/>registry"]
  app --> routes["routes/*"]
  routes --> servicesReg
  routes --> system["system/*"]
  routes --> layout["ui/Layout.tsx"]
  lifecycle --> servicesReg
  lifecycle --> system
  servicesReg --> impls["services/*.ts<br/>one class per service"]
  impls --> lib["lib/*<br/>exec, errors"]
  routes --> shared["shared/types.ts"]
  system --> shared
  client["ui/client/*<br/>browser app"] --> shared
  styles["ui/styles/*.css"] -.->|"bundled to styles.css"| layout
  client -.->|"bundled to app.js"| layout
```

Startup order. Tailscale must come up first because the panel itself listens on the Tailscale IP; if it fails the process exits and the workflow fails instead of exposing anything:

```mermaid
sequenceDiagram
  autonumber
  participant I as index.ts
  participant L as lifecycle.ts
  participant T as TailscaleService
  participant H as Hono server
  participant S as autostart services

  I->>I: loadConfig() and createServices()
  I->>L: bringUpNetwork()
  alt BIND_ADDRESS not set
    L->>T: start() (tailscale up)
    T-->>L: Tailscale IP
  else local development
    L-->>I: use BIND_ADDRESS
  end
  L-->>I: address to listen on
  I->>H: serve(app) on that address only
  H-->>I: listening
  I->>L: onListening()
  L->>L: log the public IP (async)
  L->>S: start() each service with autostart (proxy, socks)
```

How the browser talks to the server (the UI is a client-rendered Hono JSX app that polls the JSON API):

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser (App.tsx)
  participant A as app.ts
  participant R as routes/services.ts
  participant S as Service (proxy, ssh, ...)

  B->>A: GET / (basic auth)
  A-->>B: HTML shell (Layout.tsx)
  B->>A: GET /assets/app.js and styles.css
  loop every 5 seconds
    B->>R: GET /api/services
    R->>S: status()
    S-->>R: running, info
    R-->>B: services JSON
  end
  B->>R: POST /api/services/proxy/restart
  R->>S: stop() then start()
  S-->>R: done
  R-->>B: updated service view
  Note over B: the list is re-rendered and only changed DOM nodes are touched
```

Build and deploy. `tsc` only type-checks; esbuild produces `dist/`, which is generated and gitignored:

```mermaid
flowchart LR
  subgraph Source["Source (git)"]
    TS["src/**/*.ts, *.tsx"]
    CSS["src/ui/styles/*.css"]
  end
  subgraph Build["npm run build (esbuild)"]
    B1["server bundle"]
    B2["browser bundle"]
    B3["css bundle"]
  end
  subgraph Dist["dist/ (gitignored)"]
    D1["server.js"]
    D2["public/app.js"]
    D3["public/styles.css"]
  end
  TS --> B1 --> D1
  TS --> B2 --> D2
  CSS --> B3 --> D3
  subgraph CI["GitHub Actions job"]
    S1["npm ci"] --> S2["npm run build"] --> S3["npm prune --omit=dev"] --> S4["npm start<br/>node dist/server.js"]
  end
  Build -.-> S2
  D1 -.-> S4
```

## Project layout

```
src/
  index.ts              entry point: config, services, app, listen
  app.ts                composes the HTTP app: basic auth, static assets, routes, error handler
  config.ts             environment variables, read once
  lifecycle.ts          startup order (Tailscale first), autostart, shutdown
  routes/               HTTP layer, no business logic
    pages.tsx             GET /  (server-rendered shell)
    services.ts           /api/services: list, start/stop/restart, config export/import
    server.ts             /api/system, /api/runner, /api/shutdown
  services/             one class per managed service
    types.ts              the Service interface
    index.ts              registry: add new services here
    network.ts            tailscaleStatus(), tailscaleIp(), bindAddress(), displayHost()
    tailscale.ts  ssh.ts  proxy.ts  socks.ts
    router9/              9router service + config export/import (AES-GCM, SQLite)
  system/               facts about the VM
    info.ts               uptime, server time, per-interface traffic (/proc/net/dev)
    runner.ts             public IP + geolocation (ipinfo.io, ipwho.is, ipify.org; cached 10 min)
  shared/types.ts       API contracts, imported by both server and browser
  lib/                  exec helpers, HttpError
  ui/
    Layout.tsx            server-rendered HTML shell (hono/jsx)
    client/               browser app (hono/jsx/dom), bundled to dist/public/app.js
      components/           ServerCard, TrafficTable, ShutdownZone, ServicesSection, ServiceCard, Toast
      api.ts hooks.ts format.ts toast.ts download.ts main.tsx App.tsx
    styles/               CSS split by concern, bundled to dist/public/styles.css
scripts/
  build.ts              esbuild build (server, browser app, CSS)
  zip.ts                bundles the project via git ls-files
```

## Adding a service

1. Create `src/services/<name>.ts` with a class implementing `Service` (`src/services/types.ts`): `status()`, `start()`, `stop()`, and optionally `autostart`, `controllable: false` (hides the panel buttons), `exportConfig()` / `importConfig(buffer)` (adds Export/Import buttons), `isInstalled()` / `install()` (the card shows only an install button until installed), or `setToggle()` (on/off options returned in `status().toggles`; `status().details` adds label/value rows to the card).
2. Register an instance in `createServices()` in `src/services/index.ts`.

The API, the panel and the startup/shutdown logic pick it up from the registry; no other file changes.

## Development

Needs Node >= 22.13. TypeScript is compiled by [esbuild](https://esbuild.github.io); `tsc` is only used to type-check.

| Command               | What it does                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `npm ci`              | Install dependencies (including the dev toolchain)                                                     |
| `npm run build`       | Build `dist/` (server, browser app, CSS)                                                               |
| `npm start`           | Run the built server (`node dist/server.js`); build first. Uses real environment variables, not `.env` |
| `npm run dev:server`  | Server from source, restarted on change (`tsx watch`), reads `.env`                                    |
| `npm run dev:ui`      | Rebuilds the browser app and CSS on change (refresh the browser to see it)                             |
| `npm run start:local` | Production-like local run: the built `dist/` with `.env` loaded                                        |
| `npm run typecheck`   | Type-check the server and the browser app                                                              |
| `npm run zip`         | Create `project.zip` from the files git does not ignore                                                |

## Local run

Local development needs no Tailscale and no GitHub. Setting `BIND_ADDRESS` puts the panel in local mode: the `tailscale` step is skipped, `ssh` refuses to start (no users created, no sshd), and everything listens on that address.

```
cp .env.example .env     # then adjust the values
npm ci
npm run dev              # open http://127.0.0.1:3000
```

`.env` is gitignored and is loaded by `npm run dev` and `npm run start:local` only; on a runner the same variables come from repository secrets. Restart `npm run dev` after editing `.env`.

| Variable                            | Local value    | Purpose                                                        |
| ----------------------------------- | -------------- | -------------------------------------------------------------- |
| `BIND_ADDRESS`                      | `127.0.0.1`    | Listen here instead of the Tailscale IP (enables local mode)   |
| `PANEL_PORT`                        | `3000`         | Panel port                                                     |
| `PANEL_USERNAME` / `PANEL_PASSWORD` | any            | Panel login (also SSH and the 9router dashboard)               |
| `PROXY_CREDENTIALS`                 | `proxy:secret` | `username:password` for the proxy (3128) and socks (1080)      |
| `TAILSCALE_AUTHKEY`                 | not needed     | Only used on a real runner                                     |
| `TAILSCALE_HOSTNAME`                | not needed     | Optional machine name in the tailnet (default `github-ubuntu`) |

Notes for local mode: the traffic table only appears on Linux (it reads `/proc/net/dev`; use WSL or Docker on Windows), the shutdown button really exits the server (restart `npm run dev`), and the `tailscale` card shows "unavailable" (no Tailscale). `ssh` refuses to install, `9router` installs with its **install** button (`npm install -g`).
