import { useEffect, useRef, useState } from "hono/jsx/dom";

/**
 * Calls `fn` now and then every `ms` while `enabled`. Always runs the latest
 * `fn`, so it may close over state without being re-subscribed.
 */
export function usePoll(
  fn: () => void | Promise<void>,
  ms: number,
  enabled = true,
): void {
  const latest = useRef(fn);
  latest.current = fn;

  useEffect(() => {
    if (!enabled) return;
    void latest.current();
    const id = setInterval(() => void latest.current(), ms);
    return () => clearInterval(id);
  }, [ms, enabled]);
}

/** Re-renders the component every second and returns the current time (ms). */
export function useClock(): number {
  const [, setTicks] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTicks((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return Date.now();
}
