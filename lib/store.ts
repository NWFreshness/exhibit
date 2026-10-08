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
    const res = await put(key, content, { access: "public", contentType, addRandomSuffix: false });
    return { key, url: res.url };
  }
  return localPut(key, content);
}
