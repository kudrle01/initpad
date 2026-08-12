import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export async function readSecret(prompt: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
    const readline = createInterface({ input: stdin, output: stdout, terminal: false });
    try {
      stdout.write(prompt);
      return (await readline.question('')).trim();
    } finally {
      readline.close();
      stdout.write('\n');
    }
  }

  return new Promise((resolve, reject) => {
    let secret = '';
    const wasRaw = stdin.isRaw;
    const finish = (error?: Error) => {
      stdin.off('data', onData);
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
      stdout.write('\n');
      if (error) reject(error);
      else resolve(secret.trim());
    };
    const onData = (data: Buffer | string) => {
      for (const character of data.toString('utf8')) {
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u0003') return finish(new Error('Enrollment cancelled'));
        if (character === '\u007f' || character === '\b') {
          secret = secret.slice(0, -1);
        } else if (character >= ' ') {
          secret += character;
        }
      }
    };
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}
