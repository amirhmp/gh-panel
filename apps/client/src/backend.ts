// Calls into the Rust side (src-tauri/src/lib.rs).
import { invoke } from "@tauri-apps/api/core";
import type { Settings, TailscaleInfo } from "./types";

const msg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

export const loadSettings = (): Promise<Settings> => invoke("load_settings");
export const saveSettings = (settings: Settings): Promise<void> =>
  invoke<void>("save_settings", { settings }).catch((e) => {
    throw new Error(msg(e));
  });

export const tailscaleStatus = (hostname: string): Promise<TailscaleInfo> =>
  invoke("tailscale_status", { hostname });

/** ip: send this computer's traffic through that exit node; null: stop. */
export const setExitNode = (ip: string | null): Promise<void> =>
  invoke<void>("set_exit_node", { ip }).catch((e) => {
    throw new Error(msg(e));
  });

export const openExternal = (url: string): Promise<void> =>
  invoke("open_external", { url });

export interface PanelTarget {
  host: string;
  port: number;
  username: string;
  password: string;
}

export async function panel<T>(
  target: PanelTarget,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
): Promise<T> {
  let res: { status: number; body: unknown };
  try {
    res = await invoke("panel_request", {
      req: { ...target, method, path, body: body ?? null },
    });
  } catch (e) {
    throw new Error(msg(e));
  }
  if (res.status < 200 || res.status >= 300) {
    const err = (res.body as { error?: string } | null)?.error;
    throw new Error(
      res.status === 401
        ? "panel login refused: check the panel username / password"
        : err || `panel answered ${res.status}`,
    );
  }
  return res.body as T;
}
