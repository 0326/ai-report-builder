/** report-scripts 公共常量与小工具（零 React，node 环境运行）。 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 共享运行时依赖：这些包作为 CDN/import-map 共享单例，**不打进报告 bundle**。
 * 物料升级、AIBlock 拖入都不触发报告重建（双管线物理基础）。
 */
export const SHARED_EXTERNALS = [
  'react',
  'react-dom',
  'react-dom/client',
  '@daf/report-runtime',
  '@daf-materials/kit',
];

export const ARTIFACTS_DIR = '.artifacts';

export function shortHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 8);
}

/**
 * 解析块/handler 模块引用为工程内真实文件。
 * 接受 "blocks/TrendBlock"（相对 src）或 "src/blocks/TrendBlock"（相对工程根），
 * 目录则取 index.tsx。返回相对工程根的 posix 路径（供 import 与 fs 共用）。
 */
export function resolveModuleFile(projectDir: string, ref: string): string {
  const base = ref.startsWith('src/') ? ref : `src/${ref}`;
  const candidates = [`${base}/index.tsx`, `${base}/index.ts`, `${base}.tsx`, `${base}.ts`];
  for (const rel of candidates) {
    if (existsSync(join(projectDir, rel))) return rel;
  }
  throw new Error(`[report-scripts] 找不到模块文件: ${ref}（尝试 ${candidates.join(', ')}）`);
}
