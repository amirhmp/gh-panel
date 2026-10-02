// Pure formatting helpers (no DOM, no state).

const pad = (n: number): string => String(n).padStart(2, "0");

/** 5583457484 -> "5.20 GiB". */
export function fmtBytes(n: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i ? n.toFixed(n < 10 ? 2 : 1) : n} ${units[i]}`;
}

/** 11525 -> "03:12:05"; with days: "1d 03:12:05". */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86400);
  const hms = [
    Math.floor((s % 86400) / 3600),
    Math.floor((s % 3600) / 60),
    s % 60,
  ].map(pad);
  return (days ? `${days}d ` : "") + hms.join(":");
}

/** A timestamp in the server's timezone: "2026-10-01 14:00:14 UTC". */
export function fmtTime(ms: number, timezone: string): string {
  try {
    return `${new Date(ms).toLocaleString("sv-SE", { timeZone: timezone })} ${timezone}`;
  } catch {
    return new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC";
  }
}

/** "US" -> flag emoji; "" for anything that is not a 2-letter code. */
export function flag(countryCode: string): string {
  return /^[A-Z]{2}$/.test(countryCode)
    ? String.fromCodePoint(
        ...[...countryCode].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
      )
    : "";
}

export const isHttpUrl = (s: string): boolean => /^https?:\/\//.test(s);

/** OpenStreetMap link for a "lat,lon" string. */
export function mapUrl(loc: string): string {
  const [lat, lon] = loc.split(",");
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=9/${lat}/${lon}`;
}
