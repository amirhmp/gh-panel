import { execFile } from "node:child_process";
import http from "node:http";
import { promisify } from "node:util";
import { createProxy } from "proxy";

const run = promisify(execFile);
const tailscale = (...args) => run("sudo", ["tailscale", ...args]);

let proxy;

// Each service: status() -> {running, info}, start(opts), stop().
// To add a new service, add one more entry here.
export const services = {
  tailscale: {
    autostart: true,
    async status() {
      try {
        const { stdout } = await tailscale("status", "--json");
        const s = JSON.parse(stdout);
        return {
          running: s.BackendState === "Running",
          info: s.Self?.TailscaleIPs?.join(", ") || s.BackendState,
        };
      } catch {
        return { running: false, info: "unavailable" };
      }
    },
    start: () =>
      tailscale(
        "up",
        `--authkey=${process.env.TAILSCALE_AUTHKEY}`,
        "--hostname=github-ubuntu",
        "--ssh",
      ),
    stop: () => tailscale("down"),
  },

  proxy: {
    autostart: true,
    async status() {
      const on = !!proxy?.listening;
      return { running: on, info: on ? `port ${proxy.address().port}` : "" };
    },
    start: ({ port = 3128 } = {}) =>
      new Promise((resolve, reject) => {
        if (proxy?.listening) return resolve();
        const creds = process.env.PROXY_CREDENTIALS;
        if (!creds) return reject(new Error("PROXY_CREDENTIALS is not set"));
        const expected = "Basic " + Buffer.from(creds).toString("base64");
        proxy = createProxy(http.createServer());
        proxy.authenticate = (req) =>
          req.headers["proxy-authorization"] === expected;
        proxy.once("error", reject).listen(Number(port), "0.0.0.0", resolve);
      }),
    stop: () =>
      new Promise((resolve) => {
        if (!proxy?.listening) return resolve();
        proxy.close(resolve);
        proxy.closeAllConnections();
      }),
  },
};
