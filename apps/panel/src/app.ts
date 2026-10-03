import { serveStatic } from "@hono/node-server/serve-static";
import { API } from "@gh-panel/shared";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { HTTPException } from "hono/http-exception";
import type { Config } from "./config";
import { HttpError } from "./lib/errors";
import { pageRoutes } from "./routes/pages";
import { serverRoutes } from "./routes/server";
import { servicesRoutes } from "./routes/services";
import type { ServiceRegistry } from "./services";

/** Built browser assets (scripts/build.ts), relative to the working directory. */
const ASSETS_DIR = "./dist/public";

export interface AppDeps {
  config: Config;
  services: ServiceRegistry;
  shutdown: () => void;
}

/** Composes the HTTP layer: auth, static assets, page, API routes, error handling. */
export function createApp({ config, services, shutdown }: AppDeps) {
  const app = new Hono();

  // Everything, assets included, sits behind basic auth.
  app.use(
    basicAuth({
      username: config.panelUsername,
      password: config.panelPassword,
    }),
  );

  app.use("/assets/*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-cache");
  });
  app.use(
    "/assets/*",
    serveStatic({
      root: ASSETS_DIR,
      rewriteRequestPath: (p) => p.replace(/^\/assets/, ""),
    }),
  );

  app.route("/", pageRoutes());
  app.route(API.services, servicesRoutes(services));
  app.route(API.base, serverRoutes({ shutdown }));

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse(); // e.g. 401 from basicAuth
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500)
      console.error(`[api] ${c.req.method} ${c.req.path}:`, err.message);
    return c.json({ error: err.message }, status);
  });

  return app;
}
