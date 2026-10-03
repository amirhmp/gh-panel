import net from "node:net";
import { timingSafeEqual } from "node:crypto";
import type { Config } from "../config";
import { DEFAULT_PORTS, type ServiceStatus } from "@gh-panel/shared";
import { bindAddress, displayHost } from "./network";
import type { Service, StartOptions } from "./types";

const HANDSHAKE_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 15_000;

// RFC 1928 reply codes used below.
const REP = {
  ok: 0x00,
  failure: 0x01,
  netUnreachable: 0x03,
  hostUnreachable: 0x04,
  refused: 0x05,
  cmdNotSupported: 0x07,
  addrNotSupported: 0x08,
} as const;

class SocksError extends Error {}

/** Buffers socket data so the handshake can `await read(n)` exact byte counts. */
class Reader {
  #buf = Buffer.alloc(0);
  #wait:
    | { n: number; resolve: (b: Buffer) => void; reject: (e: Error) => void }
    | undefined;
  #error: Error | undefined;

  constructor(socket: net.Socket) {
    socket.on("data", (d: Buffer) => {
      this.#buf = Buffer.concat([this.#buf, d]);
      this.#flush();
    });
    const fail = () => {
      this.#error = new SocksError("connection closed");
      this.#wait?.reject(this.#error);
      this.#wait = undefined;
    };
    socket.once("close", fail);
    socket.on("error", fail);
    // Hold the stream until the handshake is done, then hand the rest on.
  }

  #flush() {
    const w = this.#wait;
    if (!w || this.#buf.length < w.n) return;
    this.#wait = undefined;
    const out = this.#buf.subarray(0, w.n);
    this.#buf = this.#buf.subarray(w.n);
    w.resolve(out);
  }

  read(n: number): Promise<Buffer> {
    if (this.#error) return Promise.reject(this.#error);
    return new Promise((resolve, reject) => {
      this.#wait = { n, resolve, reject };
      this.#flush();
    });
  }

  /** Bytes the client sent after the request (pipelined data). */
  take(): Buffer {
    const rest = this.#buf;
    this.#buf = Buffer.alloc(0);
    return rest;
  }
}

const safeEqual = (a: Buffer, b: Buffer): boolean =>
  a.length === b.length && timingSafeEqual(a, b);

const reply = (code: number, bound?: net.Socket): Buffer => {
  const addr = bound?.localAddress;
  const port = bound?.localPort ?? 0;
  const head =
    addr && net.isIPv4(addr)
      ? Buffer.concat([
          Buffer.from([5, code, 0, 1]),
          Buffer.from(addr.split(".").map(Number)),
        ])
      : Buffer.from([5, code, 0, 1, 0, 0, 0, 0]);
  const tail = Buffer.alloc(2);
  tail.writeUInt16BE(port);
  return Buffer.concat([head, tail]);
};

function errorCode(err: NodeJS.ErrnoException): number {
  switch (err.code) {
    case "ECONNREFUSED":
      return REP.refused;
    case "ENETUNREACH":
      return REP.netUnreachable;
    case "EHOSTUNREACH":
    case "ENOTFOUND":
    case "EAI_AGAIN":
    case "ETIMEDOUT":
      return REP.hostUnreachable;
    default:
      return REP.failure;
  }
}

function parseIPv6(b: Buffer): string {
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(b.readUInt16BE(i).toString(16));
  return groups.join(":");
}

/**
 * SOCKS5 proxy (RFC 1928) on the Tailscale IP (default port 1080). Supports
 * the CONNECT command only, with mandatory username/password authentication
 * (RFC 1929) using the same PROXY_CREDENTIALS as the HTTP proxy. Host names
 * are resolved on the runner (socks5h behaviour).
 */
export class SocksService implements Service {
  readonly autostart = true;
  readonly #config: Config;
  #server: net.Server | undefined;
  readonly #sockets = new Set<net.Socket>();

  constructor(config: Config) {
    this.#config = config;
  }

  async status(): Promise<ServiceStatus> {
    const addr = this.#server?.listening ? this.#server.address() : null;
    return addr && typeof addr === "object"
      ? {
          running: true,
          info: `${await displayHost(this.#config)}:${addr.port}`,
        }
      : { running: false, info: "" };
  }

  async start({
    port = DEFAULT_PORTS.socks,
  }: StartOptions = {}): Promise<void> {
    if (this.#server?.listening) return;
    const creds = this.#config.proxyCredentials;
    if (!creds) throw new Error("PROXY_CREDENTIALS is not set");
    const sep = creds.indexOf(":");
    if (sep < 1) throw new Error("PROXY_CREDENTIALS must be username:password");
    const user = Buffer.from(creds.slice(0, sep));
    const pass = Buffer.from(creds.slice(sep + 1));
    const host = await bindAddress(this.#config);

    const server = net.createServer((socket) => {
      this.#sockets.add(socket);
      socket.once("close", () => this.#sockets.delete(socket));
      this.#handle(socket, user, pass).catch(() => socket.destroy());
    });
    await new Promise<void>((resolve, reject) =>
      server.once("error", reject).listen(Number(port), host, resolve),
    );
    server.on("error", (e) => console.error("[socks]", e.message));
    this.#server = server;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      const server = this.#server;
      if (!server?.listening) return resolve();
      server.close(() => resolve());
      for (const s of this.#sockets) s.destroy();
    });
  }

  async #handle(socket: net.Socket, user: Buffer, pass: Buffer): Promise<void> {
    socket.setNoDelay(true);
    const timer = setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT_MS);
    const r = new Reader(socket);
    let upstream: net.Socket;
    try {
      // Method negotiation: only username/password (0x02) is accepted.
      const [ver, nmethods] = await r.read(2);
      if (ver !== 5) throw new SocksError("not SOCKS5");
      const methods = await r.read(nmethods ?? 0);
      if (!methods.includes(0x02)) {
        socket.end(Buffer.from([5, 0xff]));
        return;
      }
      socket.write(Buffer.from([5, 0x02]));

      // RFC 1929 sub-negotiation.
      const [subVer, ulen] = await r.read(2);
      if (subVer !== 1) throw new SocksError("bad auth version");
      const u = await r.read(ulen ?? 0);
      const [plen] = await r.read(1);
      const p = await r.read(plen ?? 0);
      // Evaluate both so timing does not reveal which half was wrong.
      const okUser = safeEqual(u, user);
      const okPass = safeEqual(p, pass);
      if (!(okUser && okPass)) {
        socket.end(Buffer.from([1, 1]));
        return;
      }
      socket.write(Buffer.from([1, 0]));

      // Request.
      const [v, cmd, , atyp] = await r.read(4);
      if (v !== 5) throw new SocksError("bad request");
      let dest: string;
      if (atyp === 1) dest = [...(await r.read(4))].join(".");
      else if (atyp === 3) {
        const [len] = await r.read(1);
        dest = (await r.read(len ?? 0)).toString("utf8");
      } else if (atyp === 4) dest = parseIPv6(await r.read(16));
      else {
        socket.end(reply(REP.addrNotSupported));
        return;
      }
      const destPort = (await r.read(2)).readUInt16BE();
      if (cmd !== 1) {
        socket.end(reply(REP.cmdNotSupported));
        return;
      }
      if (!dest || destPort === 0) {
        socket.end(reply(REP.failure));
        return;
      }

      upstream = await new Promise<net.Socket>((resolve, reject) => {
        const s = net.connect({ host: dest, port: destPort });
        s.setTimeout(CONNECT_TIMEOUT_MS, () =>
          s.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })),
        );
        s.once("connect", () => (s.setTimeout(0), resolve(s)));
        s.once("error", reject);
      }).catch((e: NodeJS.ErrnoException) => {
        socket.end(reply(errorCode(e)));
        throw e;
      });
    } finally {
      clearTimeout(timer);
    }

    // Tunnel established: from here on just pipe bytes both ways.
    this.#sockets.add(upstream);
    upstream.once("close", () => this.#sockets.delete(upstream));
    socket.removeAllListeners("data");
    socket.write(reply(REP.ok, upstream));
    const early = r.take();
    if (early.length) upstream.write(early);
    socket.pipe(upstream).pipe(socket);
    const close = () => (socket.destroy(), upstream.destroy());
    socket.on("error", close);
    upstream.on("error", close);
  }
}
