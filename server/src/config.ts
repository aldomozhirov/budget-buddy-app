import { join } from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  APP_ORIGIN: z.url().default('http://127.0.0.1:5173'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATA_DIR: z.string().min(1).optional(),
  BACKUP_DIR: z.string().min(1).optional(),
  RATES_FEED: z.string().min(1).default('fixture'),
});

/** Environment settings normalized for the API process and its SQLite files. */
export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  appOrigin: string;
  host: string;
  port: number;
  dataDir: string;
  backupDir: string;
  databasePath: string;
  ratesFeed: string;
};

/**
 * Validates environment variables once at startup and resolves the database path.
 * The data and backup directories default to the production mount points; local
 * development can override them through `.env`.
 * @param env Environment values to validate (defaults to `process.env`).
 * @returns Validated settings with `databasePath` derived from `dataDir`.
 * @throws A Zod error when any provided value is invalid.
 */
export function parseConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);
  const dataDir = parsed.DATA_DIR ?? '/data';
  const backupDir = parsed.BACKUP_DIR ?? '/backups';

  return {
    nodeEnv: parsed.NODE_ENV,
    appOrigin: parsed.APP_ORIGIN,
    host: parsed.HOST,
    port: parsed.PORT,
    dataDir,
    backupDir,
    databasePath: join(dataDir, 'budget-buddy.sqlite'),
    ratesFeed: parsed.RATES_FEED,
  };
}
