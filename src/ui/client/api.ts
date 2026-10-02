// Typed wrappers around the panel's HTTP API (see src/routes on the server).
import type {
  ApiError as ApiErrorBody,
  RunnerInfo,
  ServiceAction,
  ServicesResponse,
  SystemInfo,
} from "../../shared/types";

/** The server answered with an error; the message is safe to show to the user. */
export class ApiError extends Error {}

export const errorText = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

async function failure(r: Response, fallback: string): Promise<ApiError> {
  let message = "";
  try {
    message = ((await r.json()) as Partial<ApiErrorBody>).error ?? "";
  } catch {}
  return new ApiError(message || fallback);
}

async function call(
  url: string,
  fallback: string,
  init?: RequestInit,
): Promise<Response> {
  const r = await fetch(url, init);
  if (!r.ok) throw await failure(r, fallback);
  return r;
}

const seg = encodeURIComponent;

export async function getServices(): Promise<ServicesResponse> {
  return (await call("/api/services", "Could not load services")).json();
}

export async function controlService(
  name: string,
  action: ServiceAction,
): Promise<void> {
  await call(`/api/services/${seg(name)}/${action}`, "Request failed", {
    method: "POST",
  });
}

export async function installService(name: string): Promise<void> {
  await call(`/api/services/${seg(name)}/install`, "Install failed", {
    method: "POST",
  });
}

export async function setServiceToggle(
  name: string,
  key: string,
  enabled: boolean,
): Promise<void> {
  await call(
    `/api/services/${seg(name)}/toggles/${seg(key)}`,
    "Change failed",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    },
  );
}

export async function exportServiceConfig(
  name: string,
): Promise<{ blob: Blob; filename: string }> {
  const r = await call(`/api/services/${seg(name)}/config`, "Export failed");
  const disposition = r.headers.get("content-disposition") ?? "";
  return {
    blob: await r.blob(),
    filename:
      /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${name}-config.bin`,
  };
}

export async function importServiceConfig(
  name: string,
  file: File,
): Promise<void> {
  await call(`/api/services/${seg(name)}/config`, "Import failed", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: await file.arrayBuffer(),
  });
}

export async function getRunner(refresh = false): Promise<RunnerInfo> {
  return (
    await call(`/api/runner${refresh ? "?refresh=1" : ""}`, "Could not load")
  ).json();
}

export async function getSystem(): Promise<SystemInfo> {
  return (await call("/api/system", "Could not load")).json();
}

export async function shutdown(): Promise<void> {
  await call("/api/shutdown", "Request failed", { method: "POST" });
}
