/**
 * 报告 bundle 构建（真 esbuild）：注入标准入口模板 → 把块代码打成 bundle，
 * react/物料/runtime 外置为共享依赖（不打进 bundle）。
 * 产物：dist/bundle.{hash}.js + schema.{hash}.json + manifest.json，hash 寻址。
 */
import { build as esbuild } from 'esbuild';
import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ReportSchema } from '@daf/report-runtime/core';
import { SHARED_EXTERNALS, shortHash } from './common.ts';
import { readSchema, scanReport } from './schema-scan.ts';
import { generateBundleEntry } from './template.ts';
import { deriveManifest, type ReportManifest } from './manifest.ts';
import { lintReport } from './lint.ts';

export interface BuildResult {
  outDir: string;
  bundleFile: string;
  schemaFile: string;
  manifestFile: string;
  manifest: ReportManifest;
  bytes: number;
}

export interface BuildOptions {
  /** 跳过 lint（默认 false：lint 不过直接构建失败，构建门禁） */
  skipLint?: boolean;
  /** 产物输出目录（默认 <projectDir>/dist） */
  outDir?: string;
}

export async function buildReport(projectDir: string, opts: BuildOptions = {}): Promise<BuildResult> {
  const schema: ReportSchema = readSchema(projectDir);

  if (!opts.skipLint) {
    const lint = lintReport(projectDir, schema);
    if (!lint.ok) {
      const msg = lint.issues
        .filter((i) => i.level === 'error')
        .map((i) => `  ✗ [${i.rule}] ${i.file} (${i.nodeId}): ${i.message}`)
        .join('\n');
      throw new Error(`[report-scripts] lint 未通过，构建中止：\n${msg}`);
    }
  }

  const scan = scanReport(projectDir, schema);
  const entryCode = generateBundleEntry(scan);

  const out = await esbuild({
    stdin: { contents: entryCode, resolveDir: projectDir, loader: 'tsx', sourcefile: '__report_entry.tsx' },
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    write: false,
    minify: false,
    external: SHARED_EXTERNALS,
    define: { 'process.env.NODE_ENV': '"production"' },
  });

  const bundleCode = out.outputFiles[0].text;
  const bundleHash = shortHash(bundleCode);
  const schemaText = JSON.stringify(schema, null, 2);
  const schemaHash = shortHash(schemaText);

  const bundleFile = `bundle.${bundleHash}.js`;
  const schemaFile = `schema.${schemaHash}.json`;
  const manifest = deriveManifest(schema, {
    name: (schema as { name?: string }).name ?? 'report',
    version: schema.version,
    bundleFile,
    schemaFile,
  });

  const outDir = opts.outDir ?? join(projectDir, 'dist');
  mkdirSync(outDir, { recursive: true });
  // 清理旧的 hash 产物，避免目录堆积
  for (const f of readdirSync(outDir)) {
    if (/^bundle\.[0-9a-f]+\.js$/.test(f) || /^schema\.[0-9a-f]+\.json$/.test(f)) {
      rmSync(join(outDir, f));
    }
  }
  writeFileSync(join(outDir, bundleFile), bundleCode);
  writeFileSync(join(outDir, schemaFile), schemaText);
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  return {
    outDir,
    bundleFile,
    schemaFile,
    manifestFile: 'manifest.json',
    manifest,
    bytes: Buffer.byteLength(bundleCode),
  };
}
