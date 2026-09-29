import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import fs from "node:fs";
import { bindAddress, services } from "./services.js";

const panelHtml = fs.readFileSync(new URL("./panel.html", import.meta.url), "utf8");

const { PANEL_USERNAME, PANEL_PASSWORD, PANEL_PORT = 3000 } = process.env;
if (!PANEL_USERNAME || !PANEL_PASSWORD)
  throw new Error("PANEL_USERNAME and PANEL_PASSWORD must be set");

const app = new Hono();
app.use(basicAuth({ username: PANEL_USERNAME, password: PANEL_PASSWORD }));

// Services with `controllable: false` are shown read-only (no start/stop/restart).
const isControllable = (s) => s.controllable !== false;

app.get("/api/services", async (c) => {
  const entries = await Promise.all(
    Object.entries(services).map(async ([n, s]) => [
      n,
      { ...(await s.status()), controllable: isControllable(s) },
    ]),
  );
  return c.json(Object.fromEntries(entries));
});

// POST /api/services/:name/(start|stop|restart)?port=1234
app.post("/api/services/:name/:action", async (c) => {
  const { name, action } = c.req.param();
  const s = services[name];
  if (!s || !["start", "stop", "restart"].includes(action))
    return c.json({ error: "not found" }, 404);
  if (!isControllable(s))
    return c.json({ error: `${name} cannot be controlled from the panel` }, 403);
  try {
    if (action !== "start") await s.stop();
    if (action !== "stop") await s.start(c.req.query());
    return c.json({ ...(await s.status()), controllable: true });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// Stops the controllable services and exits; the workflow's last step is
// `npm start`, so the job finishes as soon as this process ends.
let shuttingDown = false;
async function shutdown() {
  console.log("Shutdown requested from the panel");
  for (const [name, s] of Object.entries(services)) {
    if (!isControllable(s)) continue;
    try {
      await Promise.race([s.stop(), new Promise((r) => setTimeout(r, 5000))]);
    } catch (e) {
      console.error(`[${name}] failed to stop:`, e.message);
    }
  }
  process.exit(0);
}

app.post("/api/shutdown", (c) => {
  if (!shuttingDown) {
    shuttingDown = true;
    setTimeout(shutdown, 300); // let the response go out first
  }
  return c.json({ ok: true });
});

app.get("/", (c) => c.html(panelHtml));

// Everything listens on the Tailscale IP only, so Tailscale must come up first.
// If it fails we exit (failing the workflow) rather than expose the panel.
async function main() {
  if (!process.env.BIND_ADDRESS) {
    await services.tailscale.start();
    console.log("[tailscale] started:", (await services.tailscale.status()).info);
  }
  const host = await bindAddress();
  serve({ fetch: app.fetch, port: Number(PANEL_PORT), hostname: host }, async () => {
    console.log(`Panel listening on http://${host}:${PANEL_PORT}`);
    for (const [name, s] of Object.entries(services)) {
      if (!s.autostart) continue;
      try {
        await s.start();
        console.log(`[${name}] started:`, (await s.status()).info);
      } catch (e) {
        console.error(`[${name}] failed to start:`, e.message);
      }
    }
  });
}

main().catch((e) => {
  console.error("Startup failed:", e.message);
  process.exit(1);
});
