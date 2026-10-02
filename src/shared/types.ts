// Contracts of the HTTP API. Imported by both the server and the browser UI,
// so a change here is type-checked on both sides.

/** An extra "label: value" row shown on a service card. */
export interface ServiceDetail {
  label: string;
  value: string;
}

/** An on/off option of a service, switched from its card. */
export interface ServiceToggle {
  /** Stable id used in PUT /api/services/:name/toggles/:key. */
  key: string;
  label: string;
  enabled: boolean;
  hint?: string;
}

export interface ServiceStatus {
  running: boolean;
  info: string;
  details?: ServiceDetail[];
  toggles?: ServiceToggle[];
}

/** What GET /api/services returns for each service. */
export interface ServiceView extends ServiceStatus {
  /** false: shown read-only (no start/stop/restart). */
  controllable: boolean;
  /** true: has Export/Import config buttons. */
  configurable: boolean;
  /** true: the service is installed from the panel, on demand. */
  installable: boolean;
  /** false: not installed yet (only the install button is shown). Always true when not installable. */
  installed: boolean;
  /** An install is running right now. */
  installing: boolean;
}

export type ServicesResponse = Record<string, ServiceView>;

export const SERVICE_ACTIONS = ["start", "stop", "restart"] as const;
export type ServiceAction = (typeof SERVICE_ACTIONS)[number];

/** GET /api/runner: the runner's public IP and approximate location. */
export interface RunnerInfo {
  ip: string;
  city: string;
  region: string;
  country: string;
  countryCode: string;
  org: string;
  timezone: string;
  /** "lat,lon" or "" when unknown. */
  loc: string;
  /** Which lookup provider answered. */
  source: string;
  fetchedAt: string;
}

export interface InterfaceTraffic {
  name: string;
  rx: number;
  tx: number;
  /** The internet-facing interface (listed first, highlighted in the UI). */
  main: boolean;
}

export interface Traffic {
  interfaces: InterfaceTraffic[];
  total: { rx: number; tx: number };
}

/** GET /api/system: live facts about the VM. */
export interface SystemInfo {
  /** Server clock, ms since epoch. */
  serverTime: number;
  uptimeSeconds: number;
  /** IANA timezone of the server. */
  timezone: string;
  /** null when the counters are unavailable (not Linux). */
  traffic: Traffic | null;
}

export interface ApiError {
  error: string;
}
