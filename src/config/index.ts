// All configuration comes from environment variables, read once at startup.
import { config as loadDotenv } from "dotenv";

export interface Config {
  /** Panel basic-auth username; also the SSH user. */
  panelUsername: string;
  /** Panel basic-auth password; also the SSH password and 9router's dashboard password. */
  panelPassword: string;
  panelPort: number;
  /** Local-dev override for the Tailscale IP (e.g. 127.0.0.1). */
  bindAddress: string | undefined;
  tailscaleAuthKey: string | undefined;
  /** "username:password" for the HTTP proxy. */
  proxyCredentials: string | undefined;
}

export function loadConfig(env?: NodeJS.ProcessEnv): Config {
  const result = loadDotenv({ quiet: true });
  if (result.error) {
    // Ignore missing .env; other errors are still problematic in practice
  }
  const environment = env ?? process.env;
  const { PANEL_USERNAME, PANEL_PASSWORD } = environment;
  if (!PANEL_USERNAME || !PANEL_PASSWORD)
    throw new Error("PANEL_USERNAME and PANEL_PASSWORD must be set");

  const panelPort = Number(environment.PANEL_PORT || 3000);
  if (!Number.isInteger(panelPort) || panelPort < 1 || panelPort > 65535)
    throw new Error(
      `PANEL_PORT is not a valid port: ${environment.PANEL_PORT}`,
    );

  return {
    panelUsername: PANEL_USERNAME,
    panelPassword: PANEL_PASSWORD,
    panelPort,
    bindAddress: environment.BIND_ADDRESS || undefined,
    tailscaleAuthKey: environment.TAILSCALE_AUTHKEY || undefined,
    proxyCredentials: environment.PROXY_CREDENTIALS || undefined,
  };
}

// Never hand the panel's own secrets to a third-party app it spawns.
export const SECRET_ENV_VARS = [
  "PANEL_USERNAME",
  "PANEL_PASSWORD",
  "TAILSCALE_AUTHKEY",
  "PROXY_CREDENTIALS",
  "BIND_ADDRESS",
] as const;
