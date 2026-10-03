// URL paths of the panel's HTTP API: the server mounts its routes on these, the
// browser UI and the desktop client call them.
import type { ServiceAction } from "./types";

const seg = encodeURIComponent;

export const API = {
  base: "/api",
  services: "/api/services",
  system: "/api/system",
  runner: "/api/runner",
  shutdown: "/api/shutdown",
  /** POST /api/services/:name/(start|stop|restart) */
  action: (name: string, action: ServiceAction) =>
    `/api/services/${seg(name)}/${action}`,
  /** POST /api/services/:name/install */
  install: (name: string) => `/api/services/${seg(name)}/install`,
  /** PUT /api/services/:name/toggles/:key  with { enabled } */
  toggle: (name: string, key: string) =>
    `/api/services/${seg(name)}/toggles/${seg(key)}`,
  /** GET / POST /api/services/:name/config */
  config: (name: string) => `/api/services/${seg(name)}/config`,
} as const;
