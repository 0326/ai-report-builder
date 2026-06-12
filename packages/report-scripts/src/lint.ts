/**
 * 声明-代码一致性 lint（构建门禁，§2.2 表）。正则级实现即可：
 * - 禁止裸 fetch/XHR/WebSocket（Runtime API 是唯一取数通道）
 * - runtime.data.query/get/watch 的 dsId ∈ 该块 x-consumes
 * - emit 的事件 ∈ 该块 x-emits
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReportSchema } from '@daf/report-runtime/core';
import { scanReport, type BlockEntry } from './schema-scan.ts';

export interface LintIssue {
  level: 'error' | 'warn';
  file: string;
  nodeId: string;
  rule: string;
  message: string;
}

export interface LintResult {
  ok: boolean;
  issues: LintIssue[];
}

const FORBIDDEN: Array<{ rule: string; re: RegExp; message: string }> = [
  { rule: 'no-bare-fetch', re: /(?<![.\w])fetch\s*\(/, message: '禁止裸 fetch：取数只能走 runtime.data.query' },
  { rule: 'no-xhr', re: /\bnew\s+XMLHttpRequest\b/, message: '禁止 XMLHttpRequest：取数只能走 runtime.data.query' },
  { rule: 'no-websocket', re: /\bnew\s+WebSocket\b/, message: '禁止 WebSocket：实时通道需平台模块授权' },
];

/** 去掉注释与字符串，避免误报（够用的近似处理）。 */
function stripNoise(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

function collect(re: RegExp, src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(re)) out.push(m[1]);
  return out;
}

function lintBlock(projectDir: string, block: BlockEntry): LintIssue[] {
  const issues: LintIssue[] = [];
  const raw = readFileSync(join(projectDir, block.file), 'utf8');
  const code = stripNoise(raw);
  const push = (level: LintIssue['level'], rule: string, message: string) =>
    issues.push({ level, file: block.file, nodeId: block.nodeId, rule, message });

  for (const f of FORBIDDEN) {
    if (f.re.test(code)) push('error', f.rule, f.message);
  }

  // dsId 必须在 x-consumes（保留原始字符串里的 dsId，故对 raw 取）
  const consumes = new Set(block.consumes);
  const dsIds = collect(/\.data\s*\.\s*(?:query|get|watch)\s*\(\s*['"]([^'"]+)['"]/g, raw);
  for (const ds of dsIds) {
    if (!consumes.has(ds)) {
      push('error', 'consumes-undeclared', `消费了未在 x-consumes 声明的数据源 "${ds}"（x-consumes: ${[...consumes].join(', ') || '空'}）`);
    }
  }

  // emit 事件必须在 x-emits（onEmit('drill') / runtime.event.emit('drill')）
  const emits = new Set(block.emits);
  const emitted = [
    ...collect(/\bonEmit\s*(?:\?\.)?\s*\(\s*['"]([^'"]+)['"]/g, raw),
    ...collect(/\.event\s*\.\s*emit\s*(?:\?\.)?\s*\(\s*['"]([^'"]+)['"]/g, raw),
  ];
  for (const ev of emitted) {
    if (!emits.has(ev)) {
      push('error', 'emits-undeclared', `emit 了未在 x-emits 声明的事件 "${ev}"（x-emits: ${[...emits].join(', ') || '空'}）`);
    }
  }

  return issues;
}

export function lintReport(projectDir: string, schema: ReportSchema): LintResult {
  const scan = scanReport(projectDir, schema);
  const issues: LintIssue[] = [];
  for (const block of scan.blocks) issues.push(...lintBlock(projectDir, block));
  return { ok: !issues.some((i) => i.level === 'error'), issues };
}
