import fs from "node:fs";
import path from "node:path";
import { dataDir, loadEnv } from "./paths";

/**
 * Where uploaded and generated files live: a Cloud Storage bucket when GCS_BUCKET is set (hosted),
 * otherwise data/files/ on local disk (development and tests). Keys are relative paths such as
 * "resumes/3/<uuid>.pdf", and are what `resume.filePath` stores.
 *
 * On a GCE VM the bucket is reached as the VM's service account, so there is no key file.
 */
export interface FileStore {
  put(key: string, body: Uint8Array | string, contentType?: string): Promise<void>;
  /** The file's bytes, or null if there's no such file. */
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

/** Keys stay inside the store: no absolute paths, no "..", nothing a disk path could escape with. */
function checkKey(key: string): string {
  if (!key || key.startsWith("/") || key.split("/").some((part) => part === ".." || part === "." || part === "")) {
    throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
  }
  return key;
}

function diskStore(): FileStore {
  // Resolved per call, so a test that points DATA_DIR somewhere new is honoured.
  const file = (key: string) => path.join(dataDir(), "files", checkKey(key));
  return {
    async put(key, body) {
      fs.mkdirSync(path.dirname(file(key)), { recursive: true });
      fs.writeFileSync(file(key), body);
    },
    async get(key) {
      try {
        return fs.readFileSync(file(key));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async remove(key) {
      fs.rmSync(file(key), { force: true });
    },
  };
}

function gcsStore(bucketName: string): FileStore {
  // Loaded only when a bucket is configured, so local runs and tests never pull in the SDK.
  const bucket = import("@google-cloud/storage").then(({ Storage }) => new Storage().bucket(bucketName));
  return {
    async put(key, body, contentType) {
      await (await bucket).file(checkKey(key)).save(typeof body === "string" ? body : Buffer.from(body), { contentType, resumable: false });
    },
    async get(key) {
      try {
        const [bytes] = await (await bucket).file(checkKey(key)).download();
        return bytes;
      } catch (err) {
        if ((err as { code?: number }).code === 404) return null;
        throw err;
      }
    },
    async remove(key) {
      await (await bucket).file(checkKey(key)).delete({ ignoreNotFound: true });
    },
  };
}

let store: FileStore | undefined;

export function fileStore(): FileStore {
  if (store) return store;
  loadEnv();
  const bucket = process.env.GCS_BUCKET?.trim();
  store = bucket ? gcsStore(bucket) : diskStore();
  return store;
}
