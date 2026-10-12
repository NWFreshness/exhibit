// Agreement uploads + exported HTML. Vercel Blob in production; local-disk
// fallback for dev only (serverless filesystem is ephemeral).
// Contracts and district documents ONLY — enforced by the upload actions,
// never by this layer alone.

import { promises as fs } from "fs";
import path from "path";

const LOCAL_DIR = path.join(process.cwd(), "blob-local");

async function localPut(key: string, content: string | Buffer): Promise<{ key: string; url: string }> {
  const full = path.join(LOCAL_DIR, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
  return { key, url: `/blob-local/${key}` };
}

export async function putBlob(
  key: string,
  content: string | Buffer,
  contentType: string
): Promise<{ key: string; url: string }> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    // This SDK version has no private access, so the random suffix is what
    // keeps a contract from being guessed. Staff reach it via /agreements/file/[id].
    const res = await put(key, content, { access: "public", contentType, addRandomSuffix: true });
    return { key: res.pathname, url: res.url };
  }
  return localPut(key, content);
}

/** Where a stored file can be read from: a redirect URL in production, the
 *  bytes themselves on the dev local-disk fallback. Null when it is gone. */
export async function readBlob(key: string): Promise<{ url: string } | { bytes: Buffer } | null> {
  try {
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { head } = await import("@vercel/blob");
      return { url: (await head(key)).url };
    }
    const full = path.join(LOCAL_DIR, key);
    if (!full.startsWith(LOCAL_DIR + path.sep)) return null;
    return { bytes: await fs.readFile(full) };
  } catch {
    return null;
  }
}
