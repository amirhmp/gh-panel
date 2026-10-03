// A tiny store for the one toast on screen. Any module can call toast();
// <Toast /> subscribes to it with useSyncExternalStore.
import { ApiError, errorText } from "./api";

export type ToastKind = "error" | "info";

export interface ToastState {
  text: string;
  kind: ToastKind;
  visible: boolean;
}

const VISIBLE_MS = 4000;

let state: ToastState = { text: "", kind: "error", visible: false };
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(next: ToastState): void {
  state = next;
  listeners.forEach((l) => l());
}

export function toast(text: string, kind: ToastKind = "error"): void {
  set({ text, kind, visible: true });
  clearTimeout(timer);
  timer = setTimeout(() => set({ ...state, visible: false }), VISIBLE_MS);
}

/** Server errors are shown as they are; anything else (network, ...) is prefixed. */
export function toastError(e: unknown): void {
  toast(e instanceof ApiError ? e.message : `Request failed: ${errorText(e)}`);
}

export const getToast = (): ToastState => state;

export function subscribeToast(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
