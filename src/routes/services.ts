import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HttpError } from "../lib/errors";
import { findService, type ServiceRegistry } from "../services";
import {
  checkInstalled,
  isControllable,
  isInstallable,
  type Service,
} from "../services/types";
import {
  SERVICE_ACTIONS,
  type ServiceAction,
  type ServicesResponse,
  type ServiceView,
} from "../shared/types";

const MAX_CONFIG_BYTES = 25 * 1024 * 1024;

const isServiceAction = (v: string): v is ServiceAction =>
  (SERVICE_ACTIONS as readonly string[]).includes(v);

/** Mounted at /api/services. Errors are thrown as HttpError and rendered by app.onError. */
export function servicesRoutes(services: ServiceRegistry) {
  const app = new Hono();
  let configBusy = false;
  /** Names of the services whose install() is running right now. */
  const installing = new Set<string>();

  // Services with `controllable: false` are shown read-only (no start/stop/restart);
  // services with exportConfig() get Export/Import buttons in the panel;
  // services with install() show only an install button until they are installed.
  const toView = async (name: string, s: Service): Promise<ServiceView> => ({
    ...(await s.status()),
    controllable: isControllable(s),
    configurable: typeof s.exportConfig === "function",
    installable: isInstallable(s),
    installed: await checkInstalled(s),
    installing: installing.has(name),
  });

  const requireInstalled = async (name: string, s: Service) => {
    if (!(await checkInstalled(s)))
      throw new HttpError(`${name} is not installed: install it first`, 409);
  };

  app.get("/", async (c) => {
    const entries = await Promise.all(
      Object.entries(services).map(
        async ([name, s]) => [name, await toView(name, s)] as const,
      ),
    );
    return c.json(Object.fromEntries(entries) satisfies ServicesResponse);
  });

  // Save/load a service's configuration (encrypted with PANEL_PASSWORD).
  // Registered before /:name/:action so "config" is not read as an action.
  app.get("/:name/config", async (c) => {
    const name = c.req.param("name");
    const s = findService(services, name);
    if (!s?.exportConfig) throw new HttpError("not found", 404);
    await requireInstalled(name, s);
    const { filename, data } = await s.exportConfig();
    return c.body(new Uint8Array(data), 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    });
  });

  app.post(
    "/:name/config",
    bodyLimit({
      maxSize: MAX_CONFIG_BYTES,
      onError: (c) => c.json({ error: "config file is too large" }, 413),
    }),
    async (c) => {
      const name = c.req.param("name");
      const s = findService(services, name);
      if (!s?.importConfig) throw new HttpError("not found", 404);
      await requireInstalled(name, s);
      if (configBusy) throw new HttpError("another import is in progress", 409);
      configBusy = true;
      try {
        const body = Buffer.from(await c.req.arrayBuffer());
        if (!body.length) throw new HttpError("empty file", 400);
        await s.importConfig(body);
        return c.json(await toView(name, s));
      } finally {
        configBusy = false;
      }
    },
  );

  // POST /api/services/:name/install: installs the service on demand. The
  // request stays open until it is done (apt / npm can take a minute); other
  // pollers see `installing: true` meanwhile. Registered before /:name/:action.
  app.post("/:name/install", async (c) => {
    const name = c.req.param("name");
    const s = findService(services, name);
    if (!s || !isInstallable(s)) throw new HttpError("not found", 404);
    if (installing.has(name))
      throw new HttpError(`${name} is already being installed`, 409);
    installing.add(name);
    try {
      console.log(`[${name}] installing...`);
      await s.install();
      console.log(`[${name}] installed`);
    } finally {
      installing.delete(name);
    }
    return c.json(await toView(name, s));
  });

  // PUT /api/services/:name/toggles/:key  {"enabled": true|false}
  // Switches an option that the service lists in `toggles` (e.g. tailscale's exit node).
  app.put("/:name/toggles/:key", async (c) => {
    const { name, key } = c.req.param();
    const s = findService(services, name);
    if (!s?.setToggle) throw new HttpError("not found", 404);
    await requireInstalled(name, s);
    const body = (await c.req.json().catch(() => null)) as {
      enabled?: unknown;
    } | null;
    if (typeof body?.enabled !== "boolean")
      throw new HttpError('body must be {"enabled": true|false}', 400);
    const offered = (await s.status()).toggles ?? [];
    if (!offered.some((t) => t.key === key))
      throw new HttpError(`option ${key} is not available`, 404);
    await s.setToggle(key, body.enabled);
    return c.json(await toView(name, s));
  });

  // POST /api/services/:name/(start|stop|restart)?port=1234
  app.post("/:name/:action", async (c) => {
    const { name, action } = c.req.param();
    const s = findService(services, name);
    if (!s || !isServiceAction(action)) throw new HttpError("not found", 404);
    if (!isControllable(s))
      throw new HttpError(`${name} cannot be controlled from the panel`, 403);
    if (installing.has(name))
      throw new HttpError(`${name} is being installed`, 409);
    if (action !== "stop") await requireInstalled(name, s);
    if (action !== "start") await s.stop();
    if (action !== "stop") await s.start(c.req.query());
    return c.json(await toView(name, s));
  });

  return app;
}
