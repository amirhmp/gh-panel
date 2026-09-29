# GH Panel

A Hono control panel running on a GitHub Actions Ubuntu runner. It manages services:

| Service     | What it does                                                     |
|-------------|------------------------------------------------------------------|
| `tailscale` | Joins your tailnet (with Tailscale SSH enabled) so you can reach the runner |
| `proxy`     | HTTP/HTTPS proxy (npm [`proxy`](https://github.com/TooTallNate/proxy-agents/tree/main/packages/proxy)) on port **3128** |

Both start automatically when the workflow starts; use the panel to stop/start/restart them.

## GitHub secrets (Settings → Secrets and variables → Actions)

| Secret              | Sample value               | Notes                                  |
|---------------------|----------------------------|----------------------------------------|
| `PANEL_USERNAME`    | `admin`                    | Panel basic-auth username              |
| `PANEL_PASSWORD`    | `S3cret-Panel-Pass`        | Panel basic-auth password              |
| `TAILSCALE_AUTHKEY` | `tskey-auth-xxxxxxxx`      | Reusable/ephemeral key from Tailscale  |
| `PROXY_CREDENTIALS` | `proxyuser:S3cret-Proxy-Pass` | Format `username:password`          |

## Usage

1. Add the secrets, then run **Actions → Ubuntu Panel → Run workflow**.
2. Read the Tailscale IP from the job log (`[tailscale] started: 100.x.y.z`) or in your Tailscale admin console.
3. From a device on your tailnet:
   - Panel: `http://100.x.y.z:3000` (log in with `PANEL_USERNAME` / `PANEL_PASSWORD`)
   - Proxy: `curl -x http://proxyuser:S3cret-Proxy-Pass@100.x.y.z:3128 https://ifconfig.me`
   - SSH: `ssh runner@100.x.y.z` (Tailscale SSH)

## API

- `GET  /api/services`
- `POST /api/services/:name/(start|stop|restart)` — the proxy also accepts `?port=8080`

## Adding a service

Add an entry to `src/services.js` with `status()`, `start()`, `stop()` (and optional `autostart: true`).

## Local run

```
PANEL_USERNAME=admin PANEL_PASSWORD=pass PROXY_CREDENTIALS=u:p npm start
```
