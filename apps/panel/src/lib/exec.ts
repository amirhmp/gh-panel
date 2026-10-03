import { execFile, spawn } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";

/** execFile as a promise: resolves with { stdout, stderr }, rejects on non-zero exit. */
export const run = promisify(execFile);

/** Run a command (optionally feeding stdin) and resolve with its stdout. */
export function exec(
  cmd: string,
  args: string[],
  input?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += String(d)));
    p.stderr.on("data", (d) => (err += String(d)));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0
        ? resolve(out)
        : reject(new Error(err.trim() || `${cmd} exited with code ${code}`)),
    );
    p.stdin.end(input);
  });
}

export const canConnect = (host: string, port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const s = net.connect(port, host);
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
  });

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
