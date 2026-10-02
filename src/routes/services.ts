import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HttpError } from "../lib/errors";
import { findService, type ServiceRegistry } from "../services";
import { isControllable, type Service } from "../services/types";
import {
  SERVICE_ACTIONS,
  type ServiceAction,
  type ServicesResponse,
  type ServiceView,
} from "../shared/types";

const MAX_CONFIG_BYTES = 25 * 1024 * 1024;

const isServiceAction = (v: string): v is ServiceAction =>
  (SERVICE_ACTIONS as readonly string[]).includes(v);

// Services with `controllable: false` are shown read-only (no start/stop/restart);
// services with exportConfig() get Export/Import buttons in the panel.
const toView = async (s: Service): Promise<ServiceView> => ({
  ...(await s.status()),
  controllable: isControllable(s),
  configurable: typeof s.exportConfig === "function",
});

/** Mounted at /api/services. Errors are thrown as HttpError and rendered by app.onError. */
export function servicesRoutes(services: ServiceRegistry) {
  const app = new Hono();
  let configBusy = false;

  app.get("/", async (c) => {
    const entries = await Promise.all(
      Object.entries(services).map(
        async ([name, s]) => [name, await toView(s)] as const,
      ),
    );
    return c.json(Object.fromEntries(entries) satisfies ServicesResponse);
  });

  // Save/load a service's configuration (encrypted with PANEL_PASSWORD).
  // Registered before /:name/:action so "config" is not read as an action.
  app.get("/:name/config", async (c) => {
    const s = findService(services, c.req.param("name"));
    if (!s?.exportConfig) throw new HttpError("not found", 404);
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
      const s = findService(services, c.req.param("name"));
      if (!s?.importConfig) throw new HttpError("not found", 404);
      if (configBusy) throw new HttpError("another import is in progress", 409);
      configBusy = true;
      try {
        const body = Buffer.from(await c.req.arrayBuffer());
        if (!body.length) throw new HttpError("empty file", 400);
        await s.importConfig(body);
        return c.json(await toView(s));
      } finally {
        configBusy = false;
      }
    },
  );

  // POST /api/services/:name/(start|stop|restart)?port=1234
  app.post("/:name/:action", async (c) => {
    const { name, action } = c.req.param();
    const s = findService(services, name);
    if (!s || !isServiceAction(action)) throw new HttpError("not found", 404);
    if (!isControllable(s))
      throw new HttpError(`${name} cannot be controlled from the panel`, 403);
    if (action !== "start") await s.stop();
    if (action !== "stop") await s.start(c.req.query());
    return c.json(await toView(s));
  });

  return app;
}
