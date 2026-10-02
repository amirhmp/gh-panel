import type { Config } from "../config";
import type { ServiceStatus } from "../shared/types";
import { tailscale } from "./network";
import type { Service } from "./types";

interface TailscaleStatusJson {
  BackendState?: string;
  Self?: { TailscaleIPs?: string[] };
}

/**
 * Joins the tailnet. Read-only in the panel (`controllable: false`) and without
 * `autostart`: src/lifecycle.ts brings it up first, because the panel itself
 * listens on the Tailscale IP.
 */
export class TailscaleService implements Service {
  readonly controllable = false;
  readonly #config: Config;

  constructor(config: Config) {
    this.#config = config;
  }

  async status(): Promise<ServiceStatus> {
    try {
      const { stdout } = await tailscale("status", "--json");
      const s = JSON.parse(stdout) as TailscaleStatusJson;
      return {
        running: s.BackendState === "Running",
        info: s.Self?.TailscaleIPs?.join(", ") || s.BackendState || "",
      };
    } catch {
      return { running: false, info: "unavailable" };
    }
  }

  // Plain OpenSSH (see SshService) is used instead of Tailscale SSH, so no --ssh.
  async start(): Promise<void> {
    const key = this.#config.tailscaleAuthKey;
    if (!key) throw new Error("TAILSCALE_AUTHKEY is not set");
    await tailscale("up", `--authkey=${key}`, "--hostname=github-ubuntu");
  }

  async stop(): Promise<void> {
    await tailscale("down");
  }
}
