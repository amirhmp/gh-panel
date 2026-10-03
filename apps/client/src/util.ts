import { useEffect, useRef, useState } from "preact/hooks";

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export const errorText = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

/** Calls fn now and then every `ms` while `enabled`. Always calls the latest fn. */
export function useInterval(fn: () => void, ms: number, enabled = true): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!enabled) return;
    ref.current();
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms, enabled]);
}

/** Current time in ms, re-rendered every second while `enabled`. */
export function useNow(enabled: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
