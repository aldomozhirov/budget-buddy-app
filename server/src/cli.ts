/**
 * Maintenance commands for the host, run inside the container:
 *
 *   docker compose exec app node server/dist/cli.js reset-password
 *
 * `reset-password` sets a new family password when nobody is signed in to
 * change it in Settings (UI-AUTH-4). The password is typed at a hidden
 * prompt, or piped on standard input; it is never taken from the command
 * line and never printed. The database is `DATA_DIR/budget-buddy.sqlite`.
 */
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Writable } from 'node:stream';
import {
  CliError,
  passwordProblem,
  resetFamilyPassword,
} from './cli/resetPassword.js';
import {
  PromptCancelled,
  readSecret,
  type PromptInput,
} from './cli/secretPrompt.js';

/** What a command talks to, so tests can supply their own. */
export type CliIo = {
  input: PromptInput;
  output: Writable;
  errors: Writable;
  env: NodeJS.ProcessEnv;
};

const usage = `Usage: node server/dist/cli.js reset-password

Sets a new family password. Every device is signed out, and all Face ID
passkeys and notification subscriptions are deleted. Type the password at the
prompt, or pipe it in; it is not accepted as an argument.
`;

/**
 * Runs one command.
 * @param args The command line after the script name.
 * @returns The exit status: 0 on success, 1 on failure, 2 on bad usage.
 */
export async function runCli(args: string[], io: CliIo): Promise<number> {
  const [command, ...rest] = args;
  if (command === '-h' || command === '--help') {
    io.output.write(usage);
    return 0;
  }
  if (command !== 'reset-password' || rest.length > 0) {
    io.errors.write(
      rest.length > 0
        ? 'reset-password takes no arguments: the password is typed at the prompt, never given on the command line.\n\n'
        : '',
    );
    io.errors.write(usage);
    return 2;
  }
  const databasePath = join(io.env.DATA_DIR ?? '/data', 'budget-buddy.sqlite');
  try {
    io.output.write(
      'Reset the family password. Every device will be signed out and ask for\nthe new password; Face ID and notifications are turned off everywhere.\n',
    );
    const password = await readSecret(
      'New family password: ',
      io.input,
      io.output,
    );
    const problem = passwordProblem(password);
    if (problem) throw new CliError(problem);
    if (io.input.isTTY) {
      const again = await readSecret('Repeat it: ', io.input, io.output);
      if (again !== password) throw new CliError('The passwords do not match.');
    }
    const counts = await resetFamilyPassword(databasePath, password);
    io.output.write(
      `The family password was changed. ${counts.sessions} signed-in device(s) were signed out, ${counts.passkeys} Face ID passkey(s) and ${counts.pushSubscriptions} notification subscription(s) were deleted.\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof PromptCancelled) {
      io.errors.write('Cancelled. Nothing was changed.\n');
    } else if (error instanceof CliError) {
      io.errors.write(`${error.message}\nNothing was changed.\n`);
    } else {
      io.errors.write(
        `The reset failed: ${error instanceof Error ? error.message : 'unknown error'}\nNothing was changed.\n`,
      );
    }
    return 1;
  }
}

const [, entry, ...args] = process.argv;
// Compared as real file URLs, so a symlinked path still starts the command.
if (
  entry !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(entry)).href
) {
  process.exitCode = await runCli(args, {
    input: process.stdin,
    output: process.stdout,
    errors: process.stderr,
    env: process.env,
  });
}
