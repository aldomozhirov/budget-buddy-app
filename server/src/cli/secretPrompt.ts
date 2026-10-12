import type { Readable, Writable } from 'node:stream';

/** A terminal-like input: `setRawMode` exists only when it is a real TTY. */
export type PromptInput = Readable & {
  isTTY?: boolean;
  setRawMode?: (mode: boolean) => unknown;
};

/** Raised when the person cancels a prompt with Ctrl-C or Ctrl-D. */
export class PromptCancelled extends Error {
  constructor() {
    super('Cancelled.');
    this.name = 'PromptCancelled';
  }
}

/**
 * Reads one secret line without echoing it. On a terminal the keys are read
 * raw, so nothing is shown or kept in the scrollback; backspace works, Enter
 * ends the line, Ctrl-C or Ctrl-D cancels. Piped input is read as one line
 * (the first), so a script can feed the secret without putting it in the
 * command line.
 * @throws {PromptCancelled} when the person cancels or the input ends early.
 */
export async function readSecret(
  question: string,
  input: PromptInput,
  output: Writable,
): Promise<string> {
  output.write(question);
  if (input.isTTY && input.setRawMode) {
    return readFromTerminal(input, output, input.setRawMode.bind(input));
  }
  return readFirstLine(input);
}

function readFromTerminal(
  input: PromptInput,
  output: Writable,
  setRawMode: (mode: boolean) => unknown,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let secret = '';
    const finish = (done: () => void) => {
      input.off('data', onData);
      input.off('end', onEnd);
      setRawMode(false);
      input.pause();
      output.write('\n');
      done();
    };
    const onEnd = () => finish(() => reject(new PromptCancelled()));
    const onData = (chunk: Buffer | string) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\r' || character === '\n') {
          return finish(() => resolve(secret));
        }
        if (character === '\u0003' || character === '\u0004') {
          return finish(() => reject(new PromptCancelled()));
        }
        if (character === '\u007f' || character === '\b') {
          secret = Array.from(secret).slice(0, -1).join('');
        } else if (character >= ' ') {
          secret += character;
        }
      }
    };
    setRawMode(true);
    input.on('data', onData);
    input.on('end', onEnd);
    input.resume();
  });
}

function readFirstLine(input: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    const onData = (chunk: Buffer | string) => {
      text += chunk.toString('utf8');
      const end = text.search(/\r?\n/u);
      if (end >= 0) {
        input.off('data', onData);
        input.off('end', onEnd);
        input.pause();
        resolve(text.slice(0, end));
      }
    };
    const onEnd = () => {
      input.off('data', onData);
      if (text === '') reject(new PromptCancelled());
      else resolve(text);
    };
    input.on('data', onData);
    input.on('end', onEnd);
    input.resume();
  });
}
