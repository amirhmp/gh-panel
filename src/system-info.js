import fs from "node:fs";
import os from "node:os";

// Live facts about the VM: uptime, clock and network traffic since boot.
// Traffic comes from the kernel's per-interface counters (/proc/net/dev), which
// start at 0 when the VM boots. Linux only; `traffic` is null elsewhere.

// Interface that holds the default route (the one that reaches the internet).
function defaultInterface() {
  try {
    const rows = fs.readFileSync("/proc/net/route", "utf8").trim().split("\n").slice(1);
    let best = null;
    for (const row of rows) {
      const [iface, dest, , flags, , , metric] = row.split(/\s+/);
      if (dest !== "00000000" || !(parseInt(flags, 16) & 2)) continue; // default route, UP
      if (!best || Number(metric) < best.metric) best = { iface, metric: Number(metric) };
    }
    return best?.iface ?? null;
  } catch {
    return null;
  }
}

function readCounters() {
  const out = {};
  const lines = fs.readFileSync("/proc/net/dev", "utf8").split("\n").slice(2);
  for (const line of lines) {
    const m = /^\s*([^:\s]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const f = m[2].trim().split(/\s+/).map(Number);
    out[m[1]] = { rx: f[0], tx: f[8] };
  }
  return out;
}

// Per-interface traffic since boot (loopback and idle interfaces left out).
// The internet-facing interface (default route, else eth0) is listed first and
// flagged `main`; the rest follow by total traffic. `total` sums every listed
// interface, so traffic that crosses a virtual interface (tailscale0, docker0,
// veth*) and eth0 is counted in both rows.
function traffic() {
  try {
    const all = readCounters();
    const mainName = defaultInterface() ?? (all.eth0 ? "eth0" : null);
    const interfaces = Object.entries(all)
      .filter(([name, c]) => name !== "lo" && (c.rx + c.tx > 0 || name === mainName))
      .map(([name, c]) => ({ name, rx: c.rx, tx: c.tx, main: name === mainName }))
      .sort((a, b) => b.main - a.main || b.rx + b.tx - (a.rx + a.tx));
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

export function getSystemInfo() {
  return {
    serverTime: Date.now(),
    uptimeSeconds: os.uptime(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    traffic: traffic(),
  };
}
