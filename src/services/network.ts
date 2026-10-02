import type { Config } from "../config";
import { run } from "../lib/exec";

export const tailscale = (...args: string[]) =>
  run("sudo", ["tailscale", ...args]);

/** The parts of `tailscale status --json` that the panel reads. */
export interface TailscalePeer {
  HostName?: string;
  DNSName?: string;
  TailscaleIPs?: string[];
  Online?: boolean;
  /** Recent traffic with this peer. */
  Active?: boolean;
  /** Direct UDP endpoint of the peer; empty while traffic goes through a relay. */
  CurAddr?: string;
  /** DERP relay (region code) in use or preferred. */
  Relay?: string;
}

export interface TailscaleStatusJson {
  BackendState?: string;
  Self?: TailscalePeer;
  Peer?: Record<string, TailscalePeer>;
}

// Several services ask for the status in the same poll: share one call.
const STATUS_TTL_MS = 3000;
let statusCache:
  { at: number; value: Promise<TailscaleStatusJson> } | undefined;

export function tailscaleStatus(): Promise<TailscaleStatusJson> {
  if (statusCache && Date.now() - statusCache.at < STATUS_TTL_MS)
    return statusCache.value;
  const value = tailscale("status", "--json").then(
    (r) => JSON.parse(r.stdout) as TailscaleStatusJson,
  );
  statusCache = { at: Date.now(), value };
  value.catch(() => {
    if (statusCache?.value === value) statusCache = undefined;
  });
  return value;
}

/** Call after changing Tailscale settings so the next status is fresh. */
export const invalidateTailscaleStatus = (): void => {
  statusCache = undefined;
};

/** MagicDNS name of this runner ("github-ubuntu.tail1234.ts.net"), or "" if unknown. */
export const tailscaleDnsName = (self: TailscalePeer | undefined): string =>
  (self?.DNSName ?? "").replace(/\.$/, "");

// Tailscale IPv4 of this runner. The panel, proxy and ssh all listen on it only,
// so nothing is reachable from outside the tailnet.
export async function tailscaleIp(): Promise<string> {
  let out = "";
  try {
    out = (await tailscale("ip", "-4")).stdout;
  } catch {}
  const ip = out.trim().split("\n")[0];
  if (!ip) throw new Error("tailscale is not running (no Tailscale IP)");
  return ip;
}

// Address the panel and proxy listen on. BIND_ADDRESS (e.g. 127.0.0.1)
// overrides the Tailscale IP for local development.
export const bindAddress = (config: Config): Promise<string> =>
  config.bindAddress ? Promise.resolve(config.bindAddress) : tailscaleIp();

// What the panel shows to people instead of the bind IP: the MagicDNS name of
// the runner (falls back to the IP, and to BIND_ADDRESS in local mode).
export async function displayHost(config: Config): Promise<string> {
  if (config.bindAddress) return config.bindAddress;
  try {
    const name = tailscaleDnsName((await tailscaleStatus()).Self);
    if (name) return name;
  } catch {}
  return tailscaleIp();
}
