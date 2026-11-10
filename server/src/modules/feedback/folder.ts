import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** A report's files, ready to be written into its folder. */
export type ReportFiles = {
  /** The report's `clientId`, which names its folder. */
  id: string;
  /** Contents of `report.json`. */
  report: unknown;
  /** The attached picture and its file name, if there is one. */
  screenshot: { name: string; data: Buffer } | null;
};

/** Where readers move a report they have dealt with (spec 8, O2). */
const archiveFolder = 'archive';

/** The server's work area; readers ignore names starting with a dot. */
const workFolder = '.tmp';

/**
 * Writes a report as `<feedbackDir>/<id>/` (spec 8, Design 1). The files are
 * written under `.tmp/` and the folder is renamed into place, so a folder
 * named `<id>` is always complete. A report whose folder exists already,
 * also under `archive/`, is a duplicate and nothing is written.
 * @returns `created` for a new report, `duplicate` for one written before.
 * @throws When the folder cannot be written; no `.tmp` folder is left.
 */
export async function writeReportFolder(
  feedbackDir: string,
  files: ReportFiles,
): Promise<'created' | 'duplicate'> {
  const target = join(feedbackDir, files.id);
  if (
    (await exists(target)) ||
    (await exists(join(feedbackDir, archiveFolder, files.id)))
  ) {
    return 'duplicate';
  }

  const workDir = join(feedbackDir, workFolder);
  // Made on the first report, not at start (spec 8, Design 2).
  await mkdir(workDir, { recursive: true });
  const draft = join(workDir, `${files.id}-${randomBytes(6).toString('hex')}`);
  try {
    await mkdir(draft);
    await writeFile(
      join(draft, 'report.json'),
      `${JSON.stringify(files.report, null, 2)}\n`,
      { flag: 'wx' },
    );
    if (files.screenshot) {
      await writeFile(join(draft, files.screenshot.name), files.screenshot.data, {
        flag: 'wx',
      });
    }
    try {
      await rename(draft, target);
    } catch (error) {
      // Another request for the same report renamed its folder first: a
      // rename onto a folder that holds files fails.
      if (await exists(join(target, 'report.json'))) {
        await rm(draft, { recursive: true, force: true });
        return 'duplicate';
      }
      throw error;
    }
    return 'created';
  } catch (error) {
    await rm(draft, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
