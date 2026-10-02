import http from "node:http";
import { createProxy, type ProxyServer } from "proxy";
import type { Config } from "../config";
import type { ServiceStatus } from "../shared/types";
import { bindAddress } from "./network";
import type { Service, StartOptions } from "./types";

/** HTTP/HTTPS proxy on the Tailscale IP (default port 3128), with basic auth. */
export class ProxyService implements Service {
  readonly autostart = true;
  readonly #config: Config;
  #server: ProxyServer | undefined;

  constructor(config: Config) {
    this.#config = config;
  }

  async status(): Promise<ServiceStatus> {
    const addr = this.#server?.listening ? this.#server.address() : null;
    return addr && typeof addr === "object"
      ? { running: true, info: `${addr.address}:${addr.port}` }
      : { running: false, info: "" };
  }

  async start({ port = 3128 }: StartOptions = {}): Promise<void> {
    if (this.#server?.listening) return;
    const creds = this.#config.proxyCredentials;
    if (!creds) throw new Error("PROXY_CREDENTIALS is not set");
    const host = await bindAddress(this.#config);
    const expected = "Basic " + Buffer.from(creds).toString("base64");
    const server = createProxy(http.createServer());
    server.authenticate = (req) =>
      req.headers["proxy-authorization"] === expected;
    await new Promise<void>((resolve, reject) =>
      server.once("error", reject).listen(Number(port), host, resolve),
    );
    this.#server = server;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      const server = this.#server;
      if (!server?.listening) return resolve();
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
}
