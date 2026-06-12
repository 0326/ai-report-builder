/** pnpm dev：mock-server(5173) + host Vite(5174) 双进程 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const procs = [
  spawn('node', ['packages/mock-server/src/server.ts'], { cwd: ROOT, stdio: 'inherit' }),
  spawn('pnpm', ['--filter', 'host', 'dev'], { cwd: ROOT, stdio: 'inherit' }),
];

const stop = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { if (code && code !== 0) stop(); });

console.log('\n  工作台  →  http://localhost:5174/   （预览直连 → http://localhost:5173/preview/）\n');
