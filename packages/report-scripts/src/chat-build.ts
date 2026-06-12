/**
 * AI 搭建对话工作台（apps/chat，React 18 + Ant Design X）构建：
 * antd / @ant-design/x 打进 chat.js；react / designtime-sdk 等共享依赖 external，
 * 经 import-map 指向 vendor 单例（与预览 harness 同一 React 实例）。
 */
import { build as esbuild } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMPORT_MAP } from './vendor.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');

export interface ChatBuildResult {
  outFile: string;
  bytes: number;
}

export async function buildChatApp(artifactsDir: string): Promise<ChatBuildResult> {
  const outDir = join(artifactsDir, 'chat');
  mkdirSync(outDir, { recursive: true });

  const out = await esbuild({
    entryPoints: [join(REPO_ROOT, 'apps/chat/src/index.tsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    write: false,
    minify: true,
    external: Object.keys(IMPORT_MAP),
    define: { 'process.env.NODE_ENV': '"production"' },
    legalComments: 'none',
  });

  const code = out.outputFiles[0].text;
  const outFile = join(outDir, 'chat.js');
  writeFileSync(outFile, code);
  return { outFile, bytes: Buffer.byteLength(code) };
}
