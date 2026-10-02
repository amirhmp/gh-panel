import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SECRET_ENV_VARS, type Config } from "../../config";
import { canConnect, run, sleep } from "../../lib/exec";
import type { ServiceStatus } from "../../shared/types";
import { bindAddress } from "../network";
import type { ExportedConfig, Service } from "../types";
import {
  ConfigError,
  restoreConfig,
  seal,
  snapshotConfig,
  unseal,
} from "./config";

// 9router (npm `9router`, installed globally). Run straight from its bundled
// Next.js server instead of the CLI, which is interactive and self-updating.
const PORT = 20128;
const DATA_DIR = path.join(os.tmpdir(), "panel-9router");
const DB_FILE = path.join(DATA_DIR, "db", "data.sqlite");

const fileStamp = () =>
  new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

async function serverFile(): Promise<{ dir: string; file: string }> {
  let root = "";
  try {
    root = (await run("npm", ["root", "-g"])).stdout.trim();
  } catch {}
  const dir = path.join(root, "9router", "app");
  for (const f of ["custom-server.js", "server.js"]) {
    if (root && fs.existsSync(path.join(dir, f)))
      return { dir, file: path.join(dir, f) };
  }
  throw new Error("9router is not installed (npm install -g 9router)");
}

/**
 * AI gateway (dashboard + OpenAI-compatible API) on the Tailscale IP, port 20128.
 * Off by default (no `autostart`): enable it from the panel. The dashboard
 * password is PANEL_PASSWORD. Config can be exported/imported from the panel.
 */
export class Router9Service implements Service {
  readonly #config: Config;
  readonly #jwtSecret = crypto.randomBytes(32).toString("hex"); // sessions survive service restarts
  #proc: ChildProcessWithoutNullStreams | undefined;
  #url = ""; // set once it accepts connections

  constructor(config: Config) {
    this.#config = config;
  }

  #running(): boolean {
    return !!this.#proc && this.#proc.exitCode === null;
  }

  async status(): Promise<ServiceStatus> {
    const on = this.#running();
    return { running: on, info: on ? this.#url || "starting..." : "" };
  }

  async start(): Promise<void> {
    if (this.#running()) return;
    const host = await bindAddress(this.#config);
    const server = await serverFile();
    fs.mkdirSync(DATA_DIR, { recursive: true });

    const env = { ...process.env };
    for (const k of SECRET_ENV_VARS) delete env[k];
    Object.assign(env, {
      PORT: String(PORT),
      HOSTNAME: host,
      DATA_DIR,
      INITIAL_PASSWORD: this.#config.panelPassword,
      JWT_SECRET: this.#jwtSecret,
      REQUIRE_API_KEY: "true",
      NEXT_TELEMETRY_DISABLED: "1",
    });

    let tail = "";
    const p = spawn(
      process.execPath,
      ["--dns-result-order=ipv4first", server.file],
      {
        cwd: server.dir,
        env,
      },
    );
    const keep = (d: unknown) => (tail = (tail + String(d)).slice(-2000));
    p.stdout.on("data", keep);
    p.stderr.on("data", keep);
    p.on("exit", () => {
      if (this.#proc === p) this.#url = "";
    });
    this.#proc = p;
    this.#url = "";

    for (let i = 0; i < 120; i++) {
      if (!this.#running())
        throw new Error(
          `9router exited: ${tail.trim().split("\n").pop() || "unknown error"}`,
        );
      if (await canConnect(host, PORT)) {
        this.#url = `http://${host}:${PORT}/dashboard`;
        return;
      }
      await sleep(500);
    }
    p.kill("SIGKILL");
    throw new Error(`9router did not start listening on ${host}:${PORT}`);
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      const p = this.#proc;
      if (!p || !this.#running()) return resolve();
      const t = setTimeout(() => p.kill("SIGKILL"), 5000);
      p.once("exit", () => (clearTimeout(t), resolve()));
      p.kill("SIGTERM");
    });
  }

  // Provider keys, combos and settings, encrypted with PANEL_PASSWORD.
  async exportConfig(): Promise<ExportedConfig> {
    if (!fs.existsSync(DB_FILE))
      throw new ConfigError(
        "Nothing to export yet: start 9router once first",
        409,
      );
    const data = seal(
      await snapshotConfig(DB_FILE),
      this.#config.panelPassword,
    );
    return { filename: `9router-config-${fileStamp()}.ghp9r`, data };
  }

  async importConfig(blob: Buffer): Promise<void> {
    const wasRunning = this.#running();
    const sqlite = unseal(blob, this.#config.panelPassword);
    await restoreConfig(DB_FILE, sqlite, () => this.stop());
    if (wasRunning) {
      try {
        await this.start();
      } catch (e) {
        throw new Error(
          `Config imported, but 9router failed to start: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }
}
