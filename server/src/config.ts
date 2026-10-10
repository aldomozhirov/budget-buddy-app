import { join } from 'node:path';
import { z } from 'zod';
import { liveFeedHosts } from './rates/feeds/index.js';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  // One origin, or several separated by commas (e.g. localhost and Tailscale).
  APP_ORIGIN: z
    .string()
    .default('http://127.0.0.1:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url()).min(1)),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATA_DIR: z.string().min(1).optional(),
  BACKUP_DIR: z.string().min(1).optional(),
  // Unset means the real feeds in production and fixtures everywhere else.
  RATES_FEED: z.enum(['fixture', 'live']).optional(),
  // Hosts the rates client may call, separated by commas (SEC-8).
  RATES_ALLOWED_HOSTS: z
    .string()
    .default(liveFeedHosts.join(','))
    .transform((value) =>
      value
        .split(',')
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    ),
});

/** Environment settings normalized for the API process and its SQLite files. */
export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  /** Web origins allowed to make state-changing requests, without paths. */
  appOrigins: string[];
  host: string;
  port: number;
  dataDir: string;
  backupDir: string;
  databasePath: string;
  /** `live` calls the price feeds; `fixture` uses made-up rates. */
  ratesFeed: 'fixture' | 'live';
  /** Host names the rates HTTP client may call; all others are refused. */
  ratesAllowedHosts: string[];
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
    appOrigins: parsed.APP_ORIGIN.map((origin) => new URL(origin).origin),
    host: parsed.HOST,
    port: parsed.PORT,
    dataDir,
    backupDir,
    databasePath: join(dataDir, 'budget-buddy.sqlite'),
    ratesFeed:
      parsed.RATES_FEED ??
      (parsed.NODE_ENV === 'production' ? 'live' : 'fixture'),
    ratesAllowedHosts: parsed.RATES_ALLOWED_HOSTS,
  };
}
