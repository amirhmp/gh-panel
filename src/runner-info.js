import net from "node:net";

// Public IP + approximate location of this runner, as seen from the internet.
// It must be looked up from the runner itself (not the browser): the panel is
// reached through Tailscale, so the browser's IP is not the runner's.
// Providers are tried in order; the last one only knows the IP.

const TIMEOUT_MS = 5000;
const CACHE_MS = 10 * 60 * 1000; // a runner's public IP does not change while it runs

const countryNames = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();
const countryName = (code) => {
  try {
    return (code && countryNames?.of(code)) || "";
  } catch {
    return "";
  }
};

const PROVIDERS = [
  {
    name: "ipinfo.io",
    url: "https://ipinfo.io/json",
    parse: (d) => ({
      ip: d.ip,
      city: d.city,
      region: d.region,
      countryCode: d.country,
      org: d.org,
      timezone: d.timezone,
      loc: d.loc,
    }),
  },
  {
    name: "ipwho.is",
    url: "https://ipwho.is/",
    parse: (d) => {
      if (d.success === false) throw new Error(d.message || "lookup failed");
      return {
        ip: d.ip,
        city: d.city,
        region: d.region,
        countryCode: d.country_code,
        org: d.connection?.org || d.connection?.isp,
        timezone: d.timezone?.id,
        loc: d.latitude != null ? `${d.latitude},${d.longitude}` : "",
      };
    },
  },
  {
    name: "ipify.org",
    url: "https://api.ipify.org?format=json",
    parse: (d) => ({ ip: d.ip }),
  },
];

const str = (v) => (typeof v === "string" ? v.trim() : "");

async function lookup(provider) {
  const r = await fetch(provider.url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const raw = provider.parse(await r.json());
  if (!net.isIP(raw.ip)) throw new Error("no valid IP in response");

  const countryCode = str(raw.countryCode).toUpperCase();
  const loc = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(str(raw.loc)) ? str(raw.loc) : "";
  return {
    ip: raw.ip,
    city: str(raw.city),
    region: str(raw.region),
    country: countryName(countryCode) || countryCode,
    countryCode,
    org: str(raw.org),
    timezone: str(raw.timezone),
    loc,
    source: provider.name,
    fetchedAt: new Date().toISOString(),
  };
}

let cached = null;
let cachedAt = 0;
let inflight = null;

// Returns the cached result unless it is older than 10 minutes or `refresh` is set.
export function getRunnerInfo({ refresh = false } = {}) {
  if (!refresh && cached && Date.now() - cachedAt < CACHE_MS)
    return Promise.resolve(cached);
  inflight ??= (async () => {
    const errors = [];
    for (const p of PROVIDERS) {
      try {
        cached = await lookup(p);
        cachedAt = Date.now();
        return cached;
      } catch (e) {
        errors.push(`${p.name}: ${e.message}`);
      }
    }
    // Keep showing the last known value if every provider is down.
    if (cached) return cached;
    throw new Error(`could not determine the public IP (${errors.join("; ")})`);
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
