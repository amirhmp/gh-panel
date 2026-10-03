import fs from "node:fs";
import os from "node:os";
import type { InterfaceTraffic, SystemInfo, Traffic } from "@gh-panel/shared";

// Live facts about the VM: uptime, clock and network traffic since boot.
// Traffic comes from the kernel's per-interface counters (/proc/net/dev), which
// start at 0 when the VM boots. Linux only; `traffic` is null elsewhere.

// Interface that holds the default route (the one that reaches the internet).
function defaultInterface(): string | null {
  try {
    const rows = fs
      .readFileSync("/proc/net/route", "utf8")
      .trim()
      .split("\n")
      .slice(1);
    let best: { iface: string; metric: number } | null = null;
    for (const row of rows) {
      const [iface, dest, , flags, , , metric] = row.split(/\s+/);
      if (!iface || dest !== "00000000" || !(parseInt(flags ?? "0", 16) & 2))
        continue; // default route, UP
      if (!best || Number(metric) < best.metric)
        best = { iface, metric: Number(metric) };
    }
    return best?.iface ?? null;
  } catch {
    return null;
  }
}

function readCounters(): Record<string, { rx: number; tx: number }> {
  const out: Record<string, { rx: number; tx: number }> = {};
  const lines = fs.readFileSync("/proc/net/dev", "utf8").split("\n").slice(2);
  for (const line of lines) {
    const m = /^\s*([^:\s]+):\s*(.*)$/.exec(line);
    if (!m?.[1]) continue;
    const f = (m[2] ?? "").trim().split(/\s+/).map(Number);
    out[m[1]] = { rx: f[0] ?? 0, tx: f[8] ?? 0 };
  }
  return out;
}

// Per-interface traffic since boot (loopback and idle interfaces left out).
// The internet-facing interface (default route, else eth0) is listed first and
// flagged `main`; the rest follow by total traffic. `total` sums every listed
// interface, so traffic that crosses a virtual interface (tailscale0, docker0,
// veth*) and eth0 is counted in both rows.
function traffic(): Traffic | null {
  try {
    const all = readCounters();
    const mainName = defaultInterface() ?? (all.eth0 ? "eth0" : null);
    const interfaces: InterfaceTraffic[] = Object.entries(all)
      .filter(
        ([name, c]) => name !== "lo" && (c.rx + c.tx > 0 || name === mainName),
      )
      .map(([name, c]) => ({
        name,
        rx: c.rx,
        tx: c.tx,
        main: name === mainName,
      }))
      .sort(
        (a, b) =>
          Number(b.main) - Number(a.main) || b.rx + b.tx - (a.rx + a.tx),
      );
    if (!interfaces.length) return null;
    const total = interfaces.reduce(
      (t, i) => ({ rx: t.rx + i.rx, tx: t.tx + i.tx }),
      { rx: 0, tx: 0 },
    );
    return { interfaces, total };
  } catch {
    return null;
  }
}

export function getSystemInfo(): SystemInfo {
  return {
    serverTime: Date.now(),
    uptimeSeconds: os.uptime(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    traffic: traffic(),
  };
}
