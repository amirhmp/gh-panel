import type { Config } from "../config";
import { exec } from "../lib/exec";
import { HttpError } from "../lib/errors";
import {
  EXIT_NODE_TOGGLE,
  type ServiceDetail,
  type ServiceStatus,
} from "@gh-panel/shared";
import {
  invalidateTailscaleStatus,
  tailscale,
  tailscaleDnsName,
  tailscaleStatus,
  type TailscalePeer,
  type TailscaleStatusJson,
} from "./network";
import type { Service } from "./types";

const EXIT_NODE = EXIT_NODE_TOGGLE;
const EXIT_ROUTES = ["0.0.0.0/0", "::/0"];
const MAX_PEER_ROWS = 6;

const peerName = (p: TailscalePeer): string =>
  p.HostName || p.DNSName?.split(".")[0] || "peer";

/**
 * Is traffic to the other devices direct (peer-to-peer UDP) or relayed (DERP)?
 * Looks at the peers with recent traffic; if there are none, at the online ones
 * (the path they used last), and says so.
 */
function connectionDetails(s: TailscaleStatusJson): ServiceDetail[] {
  const online = Object.values(s.Peer ?? {}).filter((p) => p.Online);
  const active = online.filter((p) => p.Active);
  const pool = (active.length ? active : online).filter(
    (p) => p.CurAddr || p.Relay,
  );

  const details: ServiceDetail[] = [];
  if (!pool.length) {
    details.push({
      label: "Connection",
      value: online.length ? "no path yet" : "no peers online",
    });
  } else {
    const relayed = pool.filter((p) => !p.CurAddr).length;
    const kind =
      relayed === 0
        ? "direct"
        : relayed === pool.length
          ? "relay"
          : "mixed (direct and relay)";
    details.push({
      label: "Connection",
      value: active.length ? kind : `${kind} (idle)`,
    });
    for (const p of pool.slice(0, MAX_PEER_ROWS))
      details.push({
        label: peerName(p),
        value: p.CurAddr ? "direct" : `relay (${p.Relay})`,
      });
  }
  if (s.Self?.Relay) details.push({ label: "Home relay", value: s.Self.Relay });
  return details;
}

/** Does this node advertise itself as an exit node? undefined: could not tell. */
async function exitNodeAdvertised(): Promise<boolean | undefined> {
  try {
    const { stdout } = await tailscale("debug", "prefs");
    const prefs = JSON.parse(stdout) as { AdvertiseRoutes?: string[] | null };
    const routes = prefs.AdvertiseRoutes ?? [];
    return EXIT_ROUTES.some((r) => routes.includes(r));
  } catch {
    return undefined;
  }
}

/**
 * Joins the tailnet. Start/stop are not available in the panel
 * (`controllable: false`) and there is no `autostart`: src/lifecycle.ts brings
 * it up first, because the panel itself listens on the Tailscale IP. The card
 * shows how traffic reaches the other devices (direct or relay) and has an
 * exit-node switch.
 */
export class TailscaleService implements Service {
  readonly controllable = false;
  readonly #config: Config;
  #exitNode = false; // last value we set; used only if the prefs cannot be read

  constructor(config: Config) {
    this.#config = config;
  }

  async status(): Promise<ServiceStatus> {
    try {
      const s = await tailscaleStatus();
      if (s.BackendState !== "Running")
        return { running: false, info: s.BackendState || "" };

      const ips = s.Self?.TailscaleIPs ?? [];
      const details: ServiceDetail[] = [];
      if (ips.length) details.push({ label: "IP", value: ips.join(", ") });
      details.push(...connectionDetails(s));

      const enabled = (await exitNodeAdvertised()) ?? this.#exitNode;
      return {
        running: true,
        info: tailscaleDnsName(s.Self) || ips.join(", "),
        details,
        toggles: [
          {
            key: EXIT_NODE,
            label: "Exit node",
            enabled,
            hint: enabled
              ? "Advertised. If it does not show up as an exit node on your devices, approve it in the Tailscale admin console (Machines, Edit route settings)."
              : "Lets devices on your tailnet send their internet traffic through this runner.",
          },
        ],
      };
    } catch {
      return { running: false, info: "unavailable" };
    }
  }

  // Plain OpenSSH (see SshService) is used instead of Tailscale SSH, so no --ssh.
  async start(): Promise<void> {
    const key = this.#config.tailscaleAuthKey;
    if (!key) throw new Error("TAILSCALE_AUTHKEY is not set");
    await tailscale(
      "up",
      `--authkey=${key}`,
      `--hostname=${this.#config.tailscaleHostname}`,
    );
    invalidateTailscaleStatus();
  }

  async stop(): Promise<void> {
    await tailscale("down");
    invalidateTailscaleStatus();
  }

  async setToggle(key: string, enabled: boolean): Promise<void> {
    if (key !== EXIT_NODE) throw new HttpError("unknown option", 404);
    if (this.#config.bindAddress)
      throw new HttpError(
        "tailscale is not running in local mode (BIND_ADDRESS is set)",
        409,
      );
    if (enabled) {
      // An exit node forwards packets: the kernel must allow it.
      await exec("sudo", ["sysctl", "-w", "net.ipv4.ip_forward=1"]);
      await exec("sudo", [
        "sysctl",
        "-w",
        "net.ipv6.conf.all.forwarding=1",
      ]).catch(
        () => {}, // IPv6 may be unavailable on the runner
      );
    }
    await tailscale("set", `--advertise-exit-node=${enabled}`);
    this.#exitNode = enabled;
    invalidateTailscaleStatus();
  }
}
