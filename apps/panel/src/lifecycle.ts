import type { Config } from "./config";
import { errorMessage } from "./lib/errors";
import type { Services } from "./services";
import { bindAddress, tailscaleIp } from "./services/network";
import { isControllable, type Service } from "./services/types";
import { getRunnerInfo } from "./system/runner";

/**
 * Everything listens on the Tailscale IP only, so Tailscale must come up first.
 * If it fails this throws (the process exits, failing the workflow) rather than
 * exposing the panel. Returns the address to listen on.
 */
export async function bringUpNetwork(
  config: Config,
  services: Services,
): Promise<string> {
  if (!config.bindAddress) {
    await services.tailscale.start();
    const { info } = await services.tailscale.status();
    console.log(`[tailscale] started: ${info} (${await tailscaleIp()})`);
  }
  return bindAddress(config);
}

/** Runs once the panel is listening: log the public IP, start the `autostart` services. */
export async function onListening(
  services: Record<string, Service>,
): Promise<void> {
  getRunnerInfo()
    .then((r) => {
      const place = [r.city, r.country].filter(Boolean).join(", ");
      console.log(`[runner] public IP: ${r.ip}${place ? ` (${place})` : ""}`);
    })
    .catch((e) => console.error("[runner]", errorMessage(e)));

  for (const [name, s] of Object.entries(services)) {
    if (!s.autostart) continue;
    try {
      await s.start();
      console.log(`[${name}] started:`, (await s.status()).info);
    } catch (e) {
      console.error(`[${name}] failed to start:`, errorMessage(e));
    }
  }
}

/**
 * Returns a function that stops the controllable services and exits; the
 * workflow's last step is `npm start`, so the job finishes as soon as this
 * process ends. Safe to call more than once.
 */
export function createShutdown(services: Record<string, Service>): () => void {
  let requested = false;

  async function shutdown(): Promise<never> {
    console.log("Shutdown requested from the panel");
    for (const [name, s] of Object.entries(services)) {
      if (!isControllable(s)) continue;
      try {
        await Promise.race([s.stop(), new Promise((r) => setTimeout(r, 5000))]);
      } catch (e) {
        console.error(`[${name}] failed to stop:`, errorMessage(e));
      }
    }
    process.exit(0);
  }

  return () => {
    if (requested) return;
    requested = true;
    setTimeout(shutdown, 300); // let the HTTP response go out first
  };
}
