import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

const UUID = /^[0-9a-f-]{36}$/;

/** Files live at <UPLOAD_DIR>/<userId>/<documentId><ext>; names are never user-controlled. */
export function storagePathFor(userId: string, documentId: string, ext: string): string {
  if (!UUID.test(userId) || !UUID.test(documentId) || !/^\.[a-z0-9]{1,8}$/.test(ext)) throw new Error("Invalid storage key.");
  return path.join(userId, `${documentId}${ext}`);
}

function resolve(rel: string): string {
  const full = path.resolve(env.uploadDir, rel);
  if (!full.startsWith(env.uploadDir + path.sep)) throw new Error("Path escapes the upload directory.");
  return full;
}

export async function saveFile(rel: string, data: Buffer) {
  const full = resolve(rel);
  await fs.mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
  await fs.writeFile(full, data, { mode: 0o600 });
}

export const readFile = (rel: string) => fs.readFile(resolve(rel));
export const removeFile = (rel: string) => fs.rm(resolve(rel), { force: true });

export async function removeUserFiles(userId: string) {
  if (!UUID.test(userId)) throw new Error("Invalid user id.");
  await fs.rm(path.join(env.uploadDir, userId), { recursive: true, force: true });
}


/** Read-only streams for authenticated exports; never follow a symlink. */
export async function openStoredFile(rel: string) {
  const handle = await fs.open(resolve(rel), constants.O_RDONLY | constants.O_NOFOLLOW);
  return handle.createReadStream({ autoClose: true });
}
export const statStoredFile = (rel: string) => fs.lstat(resolve(rel));
