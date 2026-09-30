import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createProxy } from "proxy";
import { ConfigError, restoreConfig, seal, snapshotConfig, unseal } from "./router9-config.js";

const run = promisify(execFile);
const tailscale = (...args) => run("sudo", ["tailscale", ...args]);

// Tailscale IPv4 of this runner. The panel, proxy and ssh all listen on it only,
// so nothing is reachable from outside the tailnet.
export async function tailscaleIp() {
  let out = "";
  try {
    out = (await tailscale("ip", "-4")).stdout;
  } catch {}
  const ip = out.trim().split("\n")[0];
  if (!ip) throw new Error("tailscale is not running (no Tailscale IP)");
  return ip;
}

// Address the panel and proxy listen on. BIND_ADDRESS (e.g. 127.0.0.1)
// overrides the Tailscale IP for local development.
export const bindAddress = async () =>
  process.env.BIND_ADDRESS || tailscaleIp();

// Run a command (optionally feeding stdin) and resolve with its stdout.
const exec = (cmd, args, input) =>
  new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(err.trim() || `${cmd} exited with code ${code}`)),
    );
    p.stdin.end(input);
  });

const canConnect = (host, port) =>
  new Promise((resolve) => {
    const s = net.connect(port, host);
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });

let proxy;
let sshd;
let sshInfo = "";

const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const SSHD_CONFIG = path.join(os.tmpdir(), "panel-sshd_config");
const sshdRunning = () => !!sshd && sshd.exitCode === null;

// 9router (npm `9router`, installed globally). Run straight from its bundled
// Next.js server instead of the CLI, which is interactive and self-updating.
const ROUTER9_PORT = 20128;
const ROUTER9_DATA = path.join(os.tmpdir(), "panel-9router");
const ROUTER9_DB = path.join(ROUTER9_DATA, "db", "data.sqlite");
const ROUTER9_JWT_SECRET = crypto.randomBytes(32).toString("hex"); // sessions survive service restarts
// Never hand the panel's own secrets to a third-party app.
const ROUTER9_HIDDEN_ENV = [
  "PANEL_USERNAME",
  "PANEL_PASSWORD",
  "TAILSCALE_AUTHKEY",
  "PROXY_CREDENTIALS",
  "BIND_ADDRESS",
];
let router9;
let router9Url = ""; // set once it accepts connections

const router9Running = () => !!router9 && router9.exitCode === null;

async function router9ServerFile() {
  let root = "";
  try {
    root = (await run("npm", ["root", "-g"])).stdout.trim();
  } catch {}
  const dir = path.join(root, "9router", "app");
  for (const f of ["custom-server.js", "server.js"]) {
    if (root && fs.existsSync(path.join(dir, f))) return { dir, file: path.join(dir, f) };
  }
  throw new Error("9router is not installed (npm install -g 9router)");
}

const fileStamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

// Each service: status() -> {running, info}, start(opts), stop().
// Set `controllable: false` to hide the start/stop/restart controls.
// Optional `exportConfig() -> {filename, data}` and `importConfig(buffer)` add
// Export/Import buttons to the panel card.
// To add a new service, add one more entry here.
export const services = {
  tailscale: {
    // No `autostart`: index.js brings it up first, because the panel itself
    // listens on the Tailscale IP.
    controllable: false,
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
    // Plain OpenSSH (see `ssh` below) is used instead of Tailscale SSH, so no --ssh.
    async start() {
      const key = process.env.TAILSCALE_AUTHKEY;
      if (!key) throw new Error("TAILSCALE_AUTHKEY is not set");
      await tailscale("up", `--authkey=${key}`, "--hostname=github-ubuntu");
    },
    stop: () => tailscale("down"),
  },

  // OpenSSH server that logs in with the panel username/password.
  // Listens on the Tailscale IP only, so it is not reachable from the internet.
  // Off by default (no `autostart`); enable it from the panel.
  ssh: {
    async status() {
      const on = sshdRunning();
      return { running: on, info: on ? sshInfo : "" };
    },
    async start() {
      if (sshdRunning()) return;
      if (process.env.BIND_ADDRESS)
        throw new Error("ssh is disabled in local mode (BIND_ADDRESS is set)");
      const { PANEL_USERNAME: user, PANEL_PASSWORD: pass } = process.env;
      if (!USERNAME_RE.test(user ?? ""))
        throw new Error(
          "PANEL_USERNAME must be a valid Linux username (lowercase letters, digits, _ and -) to be used for SSH",
        );
      if (!pass || /[\r\n]/.test(pass))
        throw new Error("PANEL_PASSWORD is empty or contains a newline");

      const ip = await tailscaleIp();

      // Create (or update) the account: same name/password as the panel.
      // In the `sudo` group; sudo asks for this same password.
      const exists = await exec("id", ["-u", user]).then(() => true, () => false);
      if (exists) await exec("sudo", ["usermod", "-aG", "sudo", user]);
      else
        await exec("sudo", [
          "useradd", "-m", "-N", "-g", "users", "-s", "/bin/bash", "-G", "sudo", user,
        ]);
      await exec("sudo", ["chpasswd"], `${user}:${pass}\n`);

      await exec("sudo", ["ssh-keygen", "-A"]); // create host keys if missing
      await exec("sudo", ["mkdir", "-p", "/run/sshd"]);
      fs.writeFileSync(
        SSHD_CONFIG,
        [
          `ListenAddress ${ip}`,
          "Port 22",
          "PasswordAuthentication yes",
          "KbdInteractiveAuthentication no",
          "PubkeyAuthentication yes",
          "PermitRootLogin no",
          "PermitEmptyPasswords no",
          `AllowUsers ${user}`,
          "MaxAuthTries 3",
          "LoginGraceTime 30",
          "UsePAM yes",
          "X11Forwarding no",
          "PidFile /run/panel-sshd.pid",
          "Subsystem sftp internal-sftp",
          "",
        ].join("\n"),
      );
      await exec("sudo", ["/usr/sbin/sshd", "-t", "-f", SSHD_CONFIG]);

      let stderr = "";
      sshd = spawn("sudo", ["/usr/sbin/sshd", "-D", "-e", "-f", SSHD_CONFIG]);
      sshd.stderr.on("data", (d) => (stderr += d));
      for (let i = 0; i < 20; i++) {
        if (!sshdRunning())
          throw new Error(`sshd exited: ${stderr.trim() || "unknown error"}`);
        if (await canConnect(ip, 22)) {
          sshInfo = `ssh ${user}@${ip}`;
          return;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      sshd.kill("SIGTERM");
      throw new Error(`sshd did not start listening on ${ip}:22`);
    },
    stop: () =>
      new Promise((resolve) => {
        if (!sshdRunning()) return resolve();
        // sudo relays SIGTERM to sshd; fall back to pkill if it lingers.
        const t = setTimeout(
          () => exec("sudo", ["pkill", "-f", SSHD_CONFIG]).catch(() => {}),
          3000,
        );
        sshd.once("exit", () => (clearTimeout(t), resolve()));
        sshd.kill("SIGTERM");
      }),
  },

  proxy: {
    autostart: true,
    async status() {
      const on = !!proxy?.listening;
      const { address, port } = on ? proxy.address() : {};
      return { running: on, info: on ? `${address}:${port}` : "" };
    },
    async start({ port = 3128 } = {}) {
      if (proxy?.listening) return;
      const creds = process.env.PROXY_CREDENTIALS;
      if (!creds) throw new Error("PROXY_CREDENTIALS is not set");
      const host = await bindAddress();
      const expected = "Basic " + Buffer.from(creds).toString("base64");
      const p = createProxy(http.createServer());
      p.authenticate = (req) => req.headers["proxy-authorization"] === expected;
      await new Promise((resolve, reject) =>
        p.once("error", reject).listen(Number(port), host, resolve),
      );
      proxy = p;
    },
    stop: () =>
      new Promise((resolve) => {
        if (!proxy?.listening) return resolve();
        proxy.close(resolve);
        proxy.closeAllConnections();
      }),
  },

  // AI gateway (dashboard + OpenAI-compatible API) on the Tailscale IP, port 20128.
  // Off by default (no `autostart`); enable it from the panel. The dashboard
  // password is PANEL_PASSWORD. Config can be exported/imported from the panel.
  "9router": {
    async status() {
      const on = router9Running();
      return { running: on, info: on ? router9Url || "starting..." : "" };
    },
    async start() {
      if (router9Running()) return;
      const pass = process.env.PANEL_PASSWORD;
      if (!pass) throw new Error("PANEL_PASSWORD is not set");
      const host = await bindAddress();
      const server = await router9ServerFile();
      fs.mkdirSync(ROUTER9_DATA, { recursive: true });

      const env = { ...process.env };
      for (const k of ROUTER9_HIDDEN_ENV) delete env[k];
      Object.assign(env, {
        PORT: String(ROUTER9_PORT),
        HOSTNAME: host,
        DATA_DIR: ROUTER9_DATA,
        INITIAL_PASSWORD: pass,
        JWT_SECRET: ROUTER9_JWT_SECRET,
        REQUIRE_API_KEY: "true",
        NEXT_TELEMETRY_DISABLED: "1",
      });

      let tail = "";
      const p = spawn(
        process.execPath,
        ["--dns-result-order=ipv4first", server.file],
        { cwd: server.dir, env },
      );
      const keep = (d) => (tail = (tail + d).slice(-2000));
      p.stdout.on("data", keep);
      p.stderr.on("data", keep);
      p.on("exit", () => {
        if (router9 === p) router9Url = "";
      });
      router9 = p;
      router9Url = "";

      for (let i = 0; i < 120; i++) {
        if (!router9Running())
          throw new Error(`9router exited: ${tail.trim().split("\n").pop() || "unknown error"}`);
        if (await canConnect(host, ROUTER9_PORT)) {
          router9Url = `http://${host}:${ROUTER9_PORT}/dashboard`;
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      p.kill("SIGKILL");
      throw new Error(`9router did not start listening on ${host}:${ROUTER9_PORT}`);
    },
    stop: () =>
      new Promise((resolve) => {
        if (!router9Running()) return resolve();
        const p = router9;
        const t = setTimeout(() => p.kill("SIGKILL"), 5000);
        p.once("exit", () => (clearTimeout(t), resolve()));
        p.kill("SIGTERM");
      }),

    // Provider keys, combos and settings, encrypted with PANEL_PASSWORD.
    async exportConfig() {
      if (!fs.existsSync(ROUTER9_DB))
        throw new ConfigError("Nothing to export yet: start 9router once first", 409);
      const data = seal(await snapshotConfig(ROUTER9_DB), process.env.PANEL_PASSWORD);
      return { filename: `9router-config-${fileStamp()}.ghp9r`, data };
    },
    async importConfig(blob) {
      const self = services["9router"];
      const wasRunning = router9Running();
      const sqlite = unseal(blob, process.env.PANEL_PASSWORD);
      await restoreConfig(ROUTER9_DB, sqlite, () => self.stop());
      if (wasRunning) {
        try {
          await self.start();
        } catch (e) {
          throw new Error(`Config imported, but 9router failed to start: ${e.message}`);
        }
      }
    },
  },
};
