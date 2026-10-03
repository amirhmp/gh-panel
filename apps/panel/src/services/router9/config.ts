// Save/load support for the 9router service.
//
// 9router keeps everything (provider API keys, OAuth tokens, combos, settings)
// in one SQLite file: <DATA_DIR>/db/data.sqlite. An export is that file
// (minus usage/request logs), gzipped and encrypted with a key derived from
// PANEL_PASSWORD, so a config file is useless without the panel password.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync, DatabaseSyncOptions } from "node:sqlite";
import zlib from "node:zlib";
import { HttpError } from "../../lib/errors";

// Error with an HTTP status, so the API can return 4xx for bad input.
export class ConfigError extends HttpError {
  constructor(message: string, status: 400 | 409 = 400) {
    super(message, status);
  }
}

const MAGIC = Buffer.from("GH9R\x01"); // file signature + format version
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const MAX_DB_BYTES = 200 * 1024 * 1024; // decompression-bomb guard

// Logs/statistics: not configuration, bulky and sensitive, so never exported.
const USAGE_TABLES = ["usageHistory", "usageDaily", "requestDetails"];
// A valid 9router database has at least these tables.
const REQUIRED_TABLES = ["_meta", "settings", "apiKeys", "providerConnections"];

const deriveKey = (password: string, salt: Buffer) =>
  crypto.scryptSync(password, salt, 32);

// gzip + AES-256-GCM. Layout: MAGIC | salt | iv | auth tag | ciphertext
export function seal(plain: Buffer, password: string): Buffer {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    deriveKey(password, salt),
    iv,
  );
  cipher.setAAD(MAGIC);
  const body = Buffer.concat([
    cipher.update(zlib.gzipSync(plain)),
    cipher.final(),
  ]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

export function unseal(blob: Buffer, password: string): Buffer {
  const headLen = MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN;
  if (blob.length <= headLen || !blob.subarray(0, MAGIC.length).equals(MAGIC))
    throw new ConfigError(
      "This is not a 9router config file exported from GH Panel",
    );
  let o = MAGIC.length;
  const salt = blob.subarray(o, (o += SALT_LEN));
  const iv = blob.subarray(o, (o += IV_LEN));
  const tag = blob.subarray(o, (o += TAG_LEN));
  let gz: Buffer;
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      deriveKey(password, salt),
      iv,
    );
    decipher.setAAD(MAGIC);
    decipher.setAuthTag(tag);
    gz = Buffer.concat([decipher.update(blob.subarray(o)), decipher.final()]);
  } catch {
    throw new ConfigError(
      "Could not decrypt the file: it was exported with a different PANEL_PASSWORD, or it is corrupted",
    );
  }
  try {
    return zlib.gunzipSync(gz, { maxOutputLength: MAX_DB_BYTES });
  } catch {
    throw new ConfigError("The config file is corrupted");
  }
}

// node:sqlite is built into Node 22; load it lazily so the panel itself never needs it.
async function openDb(
  file: string,
  opts?: DatabaseSyncOptions,
): Promise<DatabaseSync> {
  const { DatabaseSync } = await import("node:sqlite");
  return new DatabaseSync(file, { timeout: 5000, ...opts });
}

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "panel-9r-"));

// Consistent copy of the live database (safe while 9router is running),
// without the usage/request logs. Returns the SQLite file bytes.
export async function snapshotConfig(dbFile: string): Promise<Buffer> {
  const dir = tempDir();
  const out = path.join(dir, "config.sqlite");
  try {
    const src = await openDb(dbFile);
    try {
      src.exec(`VACUUM INTO '${out}'`);
    } finally {
      src.close();
    }
    const copy = await openDb(out);
    try {
      for (const t of USAGE_TABLES) {
        try {
          copy.exec(`DELETE FROM "${t}"`);
        } catch {} // table may not exist in other 9router versions
      }
      copy.exec("VACUUM");
    } finally {
      copy.close();
    }
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Validates `sqliteBytes`, makes PANEL_PASSWORD the dashboard password, then
// swaps it in as `dbFile`. Everything is checked on a temp copy first, and
// `beforeSwap` (stop 9router) only runs once the file is known to be good.
export async function restoreConfig(
  dbFile: string,
  sqliteBytes: Buffer,
  beforeSwap?: () => Promise<void>,
): Promise<void> {
  const dir = tempDir();
  const tmp = path.join(dir, "import.sqlite");
  try {
    fs.writeFileSync(tmp, sqliteBytes);
    const db = await openDb(tmp);
    try {
      let check: unknown;
      try {
        check = Object.values(db.prepare("PRAGMA quick_check").get() ?? {})[0];
      } catch {
        check = "not a database";
      }
      if (check !== "ok")
        throw new ConfigError(
          "The file does not contain a valid 9router database",
        );
      const tables = new Set(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((r) => r.name),
      );
      for (const t of REQUIRED_TABLES)
        if (!tables.has(t))
          throw new ConfigError(
            `Not a 9router database (missing table "${t}")`,
          );

      // 9router checks a stored password hash before INITIAL_PASSWORD. Drop the
      // imported hash so the panel password always works, and make sure login
      // is required and uses the password (not an SSO provider that won't exist here).
      for (const row of db.prepare("SELECT id, data FROM settings").all()) {
        let data: Record<string, unknown> = {};
        try {
          data =
            (JSON.parse(String(row.data)) as Record<string, unknown> | null) ??
            {};
        } catch {}
        delete data.password;
        data.requireLogin = true;
        data.authMode = "password";
        db.prepare("UPDATE settings SET data = ? WHERE id = ?").run(
          JSON.stringify(data),
          row.id as string | number,
        );
      }
      db.exec("PRAGMA journal_mode = DELETE"); // fold everything into the single file
    } finally {
      db.close();
    }

    await beforeSwap?.();
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    for (const suffix of ["", "-wal", "-shm"])
      fs.rmSync(dbFile + suffix, { force: true });
    fs.copyFileSync(tmp, dbFile);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
