#!/usr/bin/env node
/** report-scripts CLI：lint | build | vendor | all。仓库内构建脚本仅一行引用本 CLI。 */
import { resolve, join } from 'node:path';
import { ARTIFACTS_DIR } from './common.ts';
import { readSchema } from './schema-scan.ts';
import { lintReport } from './lint.ts';
import { buildReport } from './build.ts';
import { buildVendor } from './vendor.ts';
import { buildAll } from './pipeline.ts';

const [cmd, dirArg = '.'] = process.argv.slice(2);
const projectDir = resolve(process.cwd(), dirArg);
const artifactsDir = join(process.cwd(), ARTIFACTS_DIR);

function fmtBytes(n: number): string {
  return n < 1024 ? `${n}B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)}KB` : `${(n / 1024 / 1024).toFixed(2)}MB`;
}

async function runLint() {
  const schema = readSchema(projectDir);
  const res = lintReport(projectDir, schema);
  for (const i of res.issues) {
    const mark = i.level === 'error' ? '✗' : '⚠';
    console.log(`${mark} [${i.rule}] ${i.file} (${i.nodeId}): ${i.message}`);
  }
  if (res.ok) {
    console.log(`✓ lint 通过${res.issues.length ? `（${res.issues.length} 条 warn）` : ''}`);
  } else {
    console.error('✗ lint 未通过');
    process.exit(1);
  }
}

async function runBuild() {
  const r = await buildReport(projectDir);
  console.log(`✓ 构建完成 → ${r.outDir}`);
  console.log(`  ${r.bundleFile} (${fmtBytes(r.bytes)}) · ${r.schemaFile} · ${r.manifestFile}`);
}

async function runVendor() {
  const r = await buildVendor(artifactsDir);
  console.log(`✓ vendor → ${r.vendorDir}`);
  for (const [k, v] of Object.entries(r.bytes)) console.log(`  ${k} (${fmtBytes(v)})`);
}

async function runAll() {
  const r = await buildAll(projectDir, artifactsDir);
  console.log(`✓ 全量产物 → ${artifactsDir}`);
  console.log(`  report: ${r.report.bundleFile} (${fmtBytes(r.report.bytes)}) · ${r.report.schemaFile}`);
  console.log(`  vendor: ${Object.keys(r.vendor.bytes).join(', ')}`);
}

try {
  if (cmd === 'lint') await runLint();
  else if (cmd === 'build') await runBuild();
  else if (cmd === 'vendor') await runVendor();
  else if (cmd === 'all') await runAll();
  else {
    console.error(`未知命令: ${cmd ?? '(空)'}\n用法: report-scripts <lint|build|vendor|all> [projectDir]`);
    process.exit(2);
  }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
