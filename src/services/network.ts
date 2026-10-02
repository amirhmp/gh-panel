import type { Config } from "../config";
import { run } from "../lib/exec";

export const tailscale = (...args: string[]) =>
  run("sudo", ["tailscale", ...args]);

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
