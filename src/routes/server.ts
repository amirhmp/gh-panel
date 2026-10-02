import { Hono } from "hono";
import { errorMessage, HttpError } from "../lib/errors";
import { getSystemInfo } from "../system/info";
import { getRunnerInfo } from "../system/runner";

const NO_STORE = { "Cache-Control": "no-store" };

export interface ServerRoutesDeps {
  /** Stops the services and exits the process (ends the workflow run). */
  shutdown: () => void;
}

/** Mounted at /api: facts about the VM the panel runs on, and its shutdown. */
export function serverRoutes({ shutdown }: ServerRoutesDeps) {
  const app = new Hono();

  // Live VM facts: uptime, server time and network traffic since boot (cheap, uncached).
  app.get("/system", (c) => c.json(getSystemInfo(), 200, NO_STORE));

  // Public IP and approximate location of the runner (looked up server-side, cached).
  // ?refresh=1 forces a new lookup.
  app.get("/runner", async (c) => {
    try {
      const info = await getRunnerInfo({
        refresh: c.req.query("refresh") === "1",
      });
      return c.json(info, 200, NO_STORE);
    } catch (e) {
      throw new HttpError(errorMessage(e), 502);
    }
  });

  app.post("/shutdown", (c) => {
    shutdown();
    return c.json({ ok: true });
  });

  return app;
}
