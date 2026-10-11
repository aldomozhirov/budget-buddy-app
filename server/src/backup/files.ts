import { randomBytes } from 'node:crypto';
import {
  copyFile,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/** Daily copies kept (BKP-1). */
export const dailyLimit = 14;
/** Monthly copies kept (BKP-1). */
export const monthlyLimit = 12;
/** Local time of the nightly backup, `HH:MM` (BKP-1). */
export const backupTime = '03:30';

const dailyPattern = /^budget-buddy-(\d{4}-\d{2}-\d{2})\.sqlite$/u;
// A temporary file and the side files SQLite may have made beside it.
const tempPattern = /^\..+\.tmp-[0-9a-f]+(-wal|-shm|-journal)?$/u;

/** The folders inside `BACKUP_DIR` that the nightly job writes. */
export interface BackupFolders {
  daily: string;
  monthly: string;
  images: string;
}

/** Where the daily, monthly and image copies live under `backupDir`. */
export function backupFolders(backupDir: string): BackupFolders {
  return {
    daily: join(backupDir, 'daily'),
    monthly: join(backupDir, 'monthly'),
    images: join(backupDir, 'images'),
  };
}

/** File name of the daily copy for a local date, `YYYY-MM-DD`. */
export function backupFileName(date: string): string {
  return `budget-buddy-${date}.sqlite`;
}

/**
 * Lists the finished copies of a folder, newest date first. Temporary files,
 * a pre-migration copy and anything else that is not named like a copy are
 * left out, so nothing but a copy is ever counted or pruned.
 */
export async function listCopies(folder: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(folder);
  } catch (error) {
    // A folder that is missing, or a file in its place, holds no copies.
    if (isMissing(error) || isCode(error, 'ENOTDIR')) return [];
    throw error;
  }
  return names
    .filter((name) => dailyPattern.test(name))
    .sort()
    .reverse();
}

/** The local date, `YYYY-MM-DD`, in a copy's file name. */
export function copyDate(name: string): string | undefined {
  return dailyPattern.exec(name)?.[1];
}

/**
 * Deletes every copy beyond the `keep` newest of a folder and returns the
 * names removed. Call it only after a new copy is in place, so a failing
 * night never shrinks the set of good copies.
 */
export async function pruneCopies(
  folder: string,
  keep: number,
): Promise<string[]> {
  const surplus = (await listCopies(folder)).slice(keep);
  for (const name of surplus) await rm(join(folder, name), { force: true });
  return surplus;
}

/** A temporary name beside `target`, which the final rename replaces. */
export function temporaryPath(target: string): string {
  const suffix = randomBytes(6).toString('hex');
  return join(dirname(target), `.${basename(target)}.tmp-${suffix}`);
}

/**
 * Removes leftovers of a run that was cut off, in the given folders and the
 * folders below them: temporary files and the side files of a temporary copy.
 */
export async function removeStaleTemporaries(
  folders: readonly string[],
): Promise<void> {
  for (const folder of folders) {
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await removeStaleTemporaries([path]);
      else if (tempPattern.test(entry.name)) await rm(path, { force: true });
    }
  }
}

/** Forces a written file to disk before it is renamed into place. */
export async function syncFile(path: string): Promise<void> {
  const handle = await open(path, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Copies `source` to `target` through a temporary name and a rename, so the
 * target is either the old file or the whole new one, never half of it.
 */
export async function copyAtomically(
  source: string,
  target: string,
): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = temporaryPath(target);
  try {
    await copyFile(source, temporary);
    await syncFile(temporary);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Copies the files of `source` that `destination` lacks, or has at another
 * size, keeping their relative paths. Nothing is ever removed from the
 * destination, since a backup must outlive what it copied. A missing source
 * folder is an empty one.
 * @returns How many files were copied.
 */
export async function copyNewFiles(
  source: string,
  destination: string,
): Promise<number> {
  let entries;
  try {
    entries = await readdir(source, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return 0;
    throw error;
  }
  let copied = 0;
  for (const entry of entries) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) {
      copied += await copyNewFiles(from, to);
    } else if (entry.isFile() && !tempPattern.test(entry.name)) {
      const size = (await stat(from)).size;
      const existing = await stat(to).catch(() => undefined);
      if (existing?.size === size) continue;
      await copyAtomically(from, to);
      copied += 1;
    }
  }
  return copied;
}

/** Whether an error says that a file or folder does not exist. */
export function isMissing(error: unknown): boolean {
  return isCode(error, 'ENOENT');
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
