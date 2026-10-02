import type { Config } from "../config";
import { ProxyService } from "./proxy";
import { Router9Service } from "./router9";
import { SshService } from "./ssh";
import { TailscaleService } from "./tailscale";
import type { Service } from "./types";

/**
 * Every managed service, in display order (also the order they autostart in).
 * To add one: implement `Service` and add it here. The panel, the API and the
 * startup/shutdown logic pick it up from this registry.
 */
export function createServices(config: Config) {
  return {
    tailscale: new TailscaleService(config),
    ssh: new SshService(config),
    proxy: new ProxyService(config),
    "9router": new Router9Service(config),
  } satisfies Record<string, Service>;
}

export type Services = ReturnType<typeof createServices>;
export type ServiceRegistry = Readonly<Record<string, Service>>;

/** Own-property lookup, so a URL like /api/services/constructor is a 404. */
export const findService = (
  services: ServiceRegistry,
  name: string,
): Service | undefined =>
  Object.hasOwn(services, name) ? services[name] : undefined;
