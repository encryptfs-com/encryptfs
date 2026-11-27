import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { link, open, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { encrypt, unlock } from '../dist/lib/format.js';

function diskSource(handle, size) {
  return {
    size,
    slice(start, end) {
      return { async arrayBuffer() {
        const bytes = new Uint8Array(Math.min(size, end) - start);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, start + offset);
          if (!bytesRead) throw new Error(`Unexpected end of file at byte ${start + offset}.`);
          offset += bytesRead;
        }
        return bytes.buffer;
      } };
    }
  };
}

async function readPassword() {
  const interactive = process.stdin.isTTY;
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const prompt = createInterface({ input: process.stdin, output: muted, terminal: Boolean(interactive) });
  try {
    if (!interactive) {
      for await (const line of prompt) return line;
      throw new Error('Supply a password on standard input.');
    }
    process.stderr.write('Password: ');
    const password = await prompt.question('');
    process.stderr.write('\nConfirm password: ');
    const confirmation = await prompt.question('');
    process.stderr.write('\n');
    if (password !== confirmation) throw new Error('Passwords do not match.');
    return password;
  } finally {
    prompt.close();
  }
}

async function main() {
  const [source, destination, ...rest] = process.argv.slice(2);
  if (!source || !destination || rest.length || !destination.toLowerCase().endsWith('.efs')) {
    throw new Error('Usage: node scripts/encrypt-file.mjs INPUT OUTPUT.efs');
  }
  const password = await readPassword();
  const input = await open(source, 'r');
  const outputPath = resolve(destination);
  const temporaryPath = join(dirname(outputPath), `.encryptfs-${crypto.randomUUID()}.tmp`);
  let output;
  try {
    const before = await input.stat();
    if (!before.isFile()) throw new Error('Choose a regular input file.');
    output = await open(temporaryPath, 'wx+', 0o600);
    await encrypt([{ path: basename(source), blob: diskSource(input, before.size), lastModified: Math.max(0, Math.trunc(before.mtimeMs)) }], password, {
      sink: {
        write: bytes => output.writeFile(new Uint8Array(bytes)),
        async close() { await output.sync(); },
        async abort() {}
      }
    });
    const after = await input.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error('The input file changed during encryption.');
    }
    const { size } = await output.stat();
    await unlock(diskSource(output, size), password);
    await output.close();
    // Publish atomically without replacing an existing file.
    await link(temporaryPath, outputPath);
    process.stdout.write(`Saved ${outputPath} (${size} bytes)\n`);
  } finally {
    try { await input.close(); }
    finally {
      if (output) {
        try { await output.close(); }
        finally { await unlink(temporaryPath); }
      }
    }
  }
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
