import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Config } from "../config";
import { canConnect, exec, sleep } from "../lib/exec";
import type { ServiceStatus } from "../shared/types";
import { tailscaleIp } from "./network";
import type { Service } from "./types";

const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const SSHD_BIN = "/usr/sbin/sshd";
const SSHD_CONFIG = path.join(os.tmpdir(), "panel-sshd_config");

// The panel runs its own sshd on the Tailscale IP, so the packaged one (which
// listens on every interface) must stay off, or port 22 is taken.
async function disableSystemSshd(): Promise<void> {
  for (const unit of ["ssh.socket", "ssh.service"])
    await exec("sudo", ["systemctl", "disable", "--now", unit]).catch(() => {});
}

/**
 * OpenSSH server that logs in with the panel username/password. Listens on the
 * Tailscale IP only, so it is not reachable from the internet. Not installed
 * and off by default (no `autostart`): install, then start it from the panel.
 */
export class SshService implements Service {
  readonly #config: Config;
  #sshd: ChildProcessWithoutNullStreams | undefined;
  #info = "";

  constructor(config: Config) {
    this.#config = config;
  }

  #running(): boolean {
    return !!this.#sshd && this.#sshd.exitCode === null;
  }

  async status(): Promise<ServiceStatus> {
    const on = this.#running();
    return { running: on, info: on ? this.#info : "" };
  }

  async isInstalled(): Promise<boolean> {
    return fs.existsSync(SSHD_BIN);
  }

  async install(): Promise<void> {
    if (this.#config.bindAddress)
      throw new Error("ssh is disabled in local mode (BIND_ADDRESS is set)");
    if (await this.isInstalled()) return;
    // RUNLEVEL=1 makes the package scripts skip starting the packaged sshd.
    const apt = [
      "env",
      "RUNLEVEL=1",
      "DEBIAN_FRONTEND=noninteractive",
      "apt-get",
      "-o",
      "DPkg::Lock::Timeout=120", // a fresh runner may still be running apt itself
      "-qq",
    ];
    await exec("sudo", [...apt, "update"]);
    await exec("sudo", [...apt, "install", "-y", "openssh-server"]);
    await disableSystemSshd();
  }

  async start(): Promise<void> {
    if (this.#running()) return;
    if (this.#config.bindAddress)
      throw new Error("ssh is disabled in local mode (BIND_ADDRESS is set)");
    if (!(await this.isInstalled()))
      throw new Error("ssh is not installed: press install first");
    const { panelUsername: user, panelPassword: pass } = this.#config;
    if (!USERNAME_RE.test(user))
      throw new Error(
        "PANEL_USERNAME must be a valid Linux username (lowercase letters, digits, _ and -) to be used for SSH",
      );
    if (!pass || /[\r\n]/.test(pass))
      throw new Error("PANEL_PASSWORD is empty or contains a newline");

    const ip = await tailscaleIp();

    // Create (or update) the account: same name/password as the panel.
    // In the `sudo` group; sudo asks for this same password.
    const exists = await exec("id", ["-u", user]).then(
      () => true,
      () => false,
    );
    if (exists) await exec("sudo", ["usermod", "-aG", "sudo", user]);
    else
      await exec("sudo", [
        "useradd",
        "-m",
        "-N",
        "-g",
        "users",
        "-s",
        "/bin/bash",
        "-G",
        "sudo",
        user,
      ]);
    await exec("sudo", ["chpasswd"], `${user}:${pass}\n`);

    await disableSystemSshd();
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
    await exec("sudo", [SSHD_BIN, "-t", "-f", SSHD_CONFIG]);

    let stderr = "";
    const sshd = spawn("sudo", [SSHD_BIN, "-D", "-e", "-f", SSHD_CONFIG]);
    this.#sshd = sshd;
    sshd.stderr.on("data", (d) => (stderr += String(d)));
    for (let i = 0; i < 20; i++) {
      if (!this.#running())
        throw new Error(`sshd exited: ${stderr.trim() || "unknown error"}`);
      if (await canConnect(ip, 22)) {
        this.#info = `ssh ${user}@${ip}`;
        return;
      }
      await sleep(250);
    }
    sshd.kill("SIGTERM");
    throw new Error(`sshd did not start listening on ${ip}:22`);
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      const sshd = this.#sshd;
      if (!sshd || !this.#running()) return resolve();
      // sudo relays SIGTERM to sshd; fall back to pkill if it lingers.
      const t = setTimeout(
        () => exec("sudo", ["pkill", "-f", SSHD_CONFIG]).catch(() => {}),
        3000,
      );
      sshd.once("exit", () => (clearTimeout(t), resolve()));
      sshd.kill("SIGTERM");
    });
  }
}
