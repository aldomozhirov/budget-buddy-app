import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import webpush from 'web-push';
import { z } from 'zod';

/** The key pair that identifies this server to push services (NTF-2). */
export type VapidKeys = {
  /** URL-safe base64 of the uncompressed P-256 public key; sent to browsers. */
  publicKey: string;
  /** URL-safe base64 private key; never leaves the server or the logs. */
  privateKey: string;
};

const keyFileName = 'vapid.json';
const base64Url = (bytes: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/u)
    .length(Math.ceil((bytes * 4) / 3));
const vapidFileSchema = z.object({
  publicKey: base64Url(65),
  privateKey: base64Url(32),
});

/**
 * Reads the VAPID keys from `<keysDir>/vapid.json`, creating the file on the
 * first start. The folder is made private to the server's user (0700) and the
 * file readable only by it (0600), also when they already existed with looser
 * permissions.
 * @throws When the file exists but is not a valid key pair. It is never
 * replaced silently, since new keys would orphan every subscription.
 */
export async function loadOrCreateVapidKeys(
  keysDir: string,
): Promise<VapidKeys> {
  await mkdir(keysDir, { recursive: true, mode: 0o700 });
  await chmod(keysDir, 0o700);
  const path = join(keysDir, keyFileName);
  try {
    // `wx` fails when the file exists, so concurrent starts cannot overwrite.
    await writeFile(path, JSON.stringify(webpush.generateVAPIDKeys()), {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'EEXIST'
    )
      throw error;
  }
  await chmod(path, 0o600);
  const parsed = vapidFileSchema.safeParse(
    await readFile(path, 'utf8').then(
      (text) => JSON.parse(text) as unknown,
      () => null,
    ),
  );
  // The message names the file, never its content.
  if (!parsed.success)
    throw new Error(`${path} is not a valid VAPID key pair.`);
  return parsed.data;
}
