import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir, loadEnv } from "./paths";

/**
 * Encryption at rest for mailbox credentials (Gmail refresh tokens, IMAP app passwords).
 * AES-256-GCM with SECRET_KEY from the environment. Local development without SECRET_KEY
 * gets a generated key file in the data directory; a hosted server must set the variable,
 * so a copied database alone can't reveal anyone's mailbox.
 */
const VERSION = "v1";

let cached: Buffer | null = null;

function keyFromEnv(raw: string): Buffer {
  const trimmed = raw.trim();
  // Accept 32 raw bytes as base64 or hex; anything else is stretched with SHA-256.
  for (const enc of ["base64", "hex"] as const) {
    const buf = Buffer.from(trimmed, enc);
    if (buf.length === 32 && buf.toString(enc).replace(/=+$/, "") === trimmed.replace(/=+$/, "")) return buf;
  }
  return crypto.createHash("sha256").update(trimmed).digest();
}

export function secretKey(): Buffer {
  if (cached) return cached;
  loadEnv();
  const env = process.env.SECRET_KEY;
  if (env) return (cached = keyFromEnv(env));
  if (process.env.NODE_ENV === "production") {
    throw new Error("Set SECRET_KEY (32 random bytes, base64) to store mailbox connections. Generate one with: openssl rand -base64 32");
  }
  const file = path.join(dataDir(), "secret.key");
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString("base64"), { mode: 0o600 });
  return (cached = keyFromEnv(fs.readFileSync(file, "utf8")));
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decryptSecret(sealed: string): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || body === undefined) throw new Error("Unreadable stored secret");
  const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}

/** Test hook: forget the cached key after changing SECRET_KEY. */
export function resetSecretKeyCache(): void {
  cached = null;
}
