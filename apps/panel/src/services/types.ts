import type { ServiceStatus } from "@gh-panel/shared";

export interface StartOptions {
  /** Only the proxy and socks services use it (?port=8080). */
  port?: string | number;
}

export interface ExportedConfig {
  filename: string;
  data: Buffer;
}

/**
 * Contract of a managed service. To add one: implement this interface, then
 * register the instance in `createServices()` (src/services/index.ts).
 */
export interface Service {
  /** false: shown read-only in the panel and refused by the API (default true). */
  readonly controllable?: boolean;
  /** true: started automatically once the panel is listening. */
  readonly autostart?: boolean;

  status(): Promise<ServiceStatus>;
  start(opts?: StartOptions): Promise<void>;
  stop(): Promise<void>;

  /** Optional pair: adds Export/Import buttons and the /config routes. */
  exportConfig?(): Promise<ExportedConfig>;
  importConfig?(blob: Buffer): Promise<void>;

  /**
   * Optional: switches one of the `toggles` that `status()` returns (adds the
   * on/off buttons and PUT /api/services/:name/toggles/:key). Works even when
   * `controllable` is false.
   */
  setToggle?(key: string, enabled: boolean): Promise<void>;

  /**
   * Optional pair: the service is not installed by the workflow but from the
   * panel (POST /api/services/:name/install). Until `isInstalled()` is true the
   * card only shows an install button and the API refuses start/restart/config.
   * `isInstalled()` runs on every poll, so keep it cheap; `install()` may take
   * a while and must be idempotent.
   */
  isInstalled?(): Promise<boolean>;
  install?(): Promise<void>;
}

export type InstallableService = Service &
  Required<Pick<Service, "isInstalled" | "install">>;

export const isControllable = (s: Service): boolean => s.controllable !== false;

export const isInstallable = (s: Service): s is InstallableService =>
  typeof s.isInstalled === "function" && typeof s.install === "function";

/** Services that need no install count as installed. */
export const checkInstalled = async (s: Service): Promise<boolean> =>
  !isInstallable(s) || s.isInstalled();
