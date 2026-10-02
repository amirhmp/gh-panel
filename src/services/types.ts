import type { ServiceStatus } from "../shared/types";

export interface StartOptions {
  /** Only the proxy uses it (?port=8080). */
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
}

export const isControllable = (s: Service): boolean => s.controllable !== false;
