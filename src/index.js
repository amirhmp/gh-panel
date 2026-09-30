import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { bodyLimit } from "hono/body-limit";
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

// Services with exportConfig() get Export/Import buttons in the panel.
const view = async (s) => ({
  ...(await s.status()),
  controllable: isControllable(s),
  configurable: typeof s.exportConfig === "function",
});

app.get("/api/services", async (c) => {
  const entries = await Promise.all(
    Object.entries(services).map(async ([n, s]) => [n, await view(s)]),
  );
  return c.json(Object.fromEntries(entries));
});

// Save/load a service's configuration (encrypted with PANEL_PASSWORD).
// Registered before the /:action route below so "config" is not read as an action.
const MAX_CONFIG_BYTES = 25 * 1024 * 1024;
let configBusy = false;

app.get("/api/services/:name/config", async (c) => {
  const s = services[c.req.param("name")];
  if (!s?.exportConfig) return c.json({ error: "not found" }, 404);
  try {
    const { filename, data } = await s.exportConfig();
    return c.body(data, 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    });
  } catch (e) {
    return c.json({ error: e.message }, e.status ?? 500);
  }
});

app.post(
  "/api/services/:name/config",
  bodyLimit({
    maxSize: MAX_CONFIG_BYTES,
    onError: (c) => c.json({ error: "config file is too large" }, 413),
  }),
  async (c) => {
    const s = services[c.req.param("name")];
    if (!s?.importConfig) return c.json({ error: "not found" }, 404);
    if (configBusy) return c.json({ error: "another import is in progress" }, 409);
    configBusy = true;
    try {
      const body = Buffer.from(await c.req.arrayBuffer());
      if (!body.length) return c.json({ error: "empty file" }, 400);
      await s.importConfig(body);
      return c.json(await view(s));
    } catch (e) {
      return c.json({ error: e.message }, e.status ?? 500);
    } finally {
      configBusy = false;
    }
  },
);

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
    return c.json(await view(s));
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
