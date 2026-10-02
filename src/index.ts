import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { bringUpNetwork, createShutdown, onListening } from "./lifecycle";
import { createServices } from "./services";

async function main() {
  const config = loadConfig();
  const services = createServices(config);
  const app = createApp({
    config,
    services,
    shutdown: createShutdown(services),
  });

  const host = await bringUpNetwork(config, services);
  serve({ fetch: app.fetch, port: config.panelPort, hostname: host }, () => {
    console.log(`Panel listening on http://${host}:${config.panelPort}`);
    void onListening(services);
  });
}

main().catch((e) => {
  console.error("Startup failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
