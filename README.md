# GH Panel

A Hono control panel running on a GitHub Actions Ubuntu runner. It manages services:

| Service     | What it does                                                     |
|-------------|------------------------------------------------------------------|
| `tailscale` | Joins your tailnet so you can reach the runner (status only, not controllable from the panel) |
| `ssh`       | OpenSSH server on port **22**, bound to the Tailscale IP only; log in with the panel username/password |
| `proxy`     | HTTP/HTTPS proxy (npm [`proxy`](https://github.com/TooTallNate/proxy-agents/tree/main/packages/proxy)) on port **3128**, bound to the Tailscale IP only |

Tailscale starts first, then the panel (port **3000**), then `ssh` and `proxy`. The panel, `ssh` and `proxy` listen on the **Tailscale IP only**, so nothing is reachable from outside your tailnet. If Tailscale fails to come up, the panel exits and the workflow fails instead of exposing anything.

Once running, use the panel to stop/start/restart `ssh` and `proxy`. The **Shut down** button stops them and ends the workflow.

## GitHub secrets (Settings → Secrets and variables → Actions)

| Secret              | Sample value               | Notes                                  |
|---------------------|----------------------------|----------------------------------------|
| `PANEL_USERNAME`    | `admin`                    | Panel basic-auth username, also the SSH user (must be a valid Linux username: lowercase letters, digits, `_`, `-`) |
| `PANEL_PASSWORD`    | `S3cret-Panel-Pass`        | Panel basic-auth password, also the SSH password (use a strong one) |
| `TAILSCALE_AUTHKEY` | `tskey-auth-xxxxxxxx`      | Reusable/ephemeral key from Tailscale  |
| `PROXY_CREDENTIALS` | `proxyuser:S3cret-Proxy-Pass` | Format `username:password`          |

## Usage

1. Add the secrets, then run **Actions → Ubuntu Panel → Run workflow**.
2. Read the Tailscale IP from the job log (`[tailscale] started: 100.x.y.z`) or in your Tailscale admin console.
3. From a device on your tailnet:
   - Panel: `http://100.x.y.z:3000` (log in with `PANEL_USERNAME` / `PANEL_PASSWORD`)
   - Proxy: `curl -x http://proxyuser:S3cret-Proxy-Pass@100.x.y.z:3128 https://ifconfig.me`
   - SSH: `ssh admin@100.x.y.z` (password = `PANEL_PASSWORD`; the user is in the `sudo` group and `sudo` asks for the same password)

## API

- `GET  /api/services`
- `POST /api/services/:name/(start|stop|restart)` — the proxy also accepts `?port=8080`; `tailscale` returns 403
- `POST /api/shutdown` — stops the services and exits, which ends the workflow run

## Network & SSH security notes

- The panel (3000), sshd (22) and proxy (3128) listen on the Tailscale IP only (never the runner's public IP), so only devices on your tailnet can reach them. Restrict who can reach those ports with Tailscale ACLs.
- Credentials are still required on top of that (panel basic auth, proxy auth, SSH password).
- Password login is weaker than Tailscale SSH (which uses your Tailscale identity, no password). Use a long, unique `PANEL_PASSWORD`. Root login is disabled, only `PANEL_USERNAME` may log in, and `MaxAuthTries` is 3.
- Tailscale SSH (`--ssh`) is not enabled: it would intercept port 22 on the tailnet IP and bypass the password.
- Use an *ephemeral* Tailscale auth key so the runner disappears from your admin console after shutdown.

## Project layout

- `src/index.js` — Hono server, API, startup/shutdown
- `src/services.js` — service definitions (tailscale, ssh, proxy)
- `src/panel.html` — the panel UI (HTML, CSS and JS in one file)

## Adding a service

Add an entry to `src/services.js` with `status()`, `start()`, `stop()` (and optional `autostart: true`; `controllable: false` hides the panel buttons).

## Local run

Without Tailscale, set `BIND_ADDRESS` to listen on a local address instead. The `tailscale` step is skipped and the `ssh` service is disabled in this mode.

```
BIND_ADDRESS=127.0.0.1 PANEL_USERNAME=admin PANEL_PASSWORD=pass PROXY_CREDENTIALS=u:p npm start
```
