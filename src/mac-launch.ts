import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This launches the local preview only. It never connects to or operates TKC.
const server = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.js')], {
  stdio: ['inherit', 'pipe', 'inherit'], env: process.env,
});
let pending = '';
let opened = false;
server.stdout!.on('data', (chunk: Buffer) => {
  process.stdout.write(chunk);
  pending += chunk.toString('utf8');
  let end: number;
  while ((end = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, end).trim();
    pending = pending.slice(end + 1);
    const match = /^P1 preview: (http:\/\/127\.0\.0\.1:\d+)$/.exec(line);
    if (match && !opened && process.platform === 'darwin' && !process.argv.includes('--no-browser')) {
      opened = true;
      const browser = spawn('/usr/bin/open', [match[1]], { stdio: 'ignore' });
      browser.on('error', () => console.error('表示されたlocalhost URLをブラウザで開いてください。'));
    }
  }
});
server.on('error', () => { console.error('プレビューを起動できませんでした。'); process.exitCode = 1; });
server.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.kill(signal); });
