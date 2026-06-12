/**
 * 双 diff 引擎（零依赖，纯函数）：
 * - schemaDiff：jsondiffpatch 风格的结构化 delta + 人读 ops 摘要（声明性修改给用户确认）
 * - codeDiff：按文件的行级 LCS diff（新增/修改/删除，按文件折叠）
 * 破坏性变更识别（删块/删数据源）交给上层决定是否先确认。
 */
import type { ReportSchema } from '@daf/report-runtime/core';

/* ----------------------------- schema diff ----------------------------- */

export type DiffOp =
  | { op: 'add'; path: string; to: unknown }
  | { op: 'remove'; path: string; from: unknown }
  | { op: 'replace'; path: string; from: unknown; to: unknown };

/** jsondiffpatch 风格 delta：叶子 [new] 新增 / [old,0,0] 删除 / [old,new] 改值；对象/数组递归。 */
export type Delta = Record<string, unknown>;

export interface SchemaDiff {
  ops: DiffOp[];
  delta: Delta;
  /** 破坏性：删除了块节点或数据源 */
  destructive: boolean;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function keysOf(v: Record<string, unknown>): string[] {
  return Array.isArray(v) ? v.map((_, i) => String(i)) : Object.keys(v);
}

function joinPath(base: string, key: string, arr: boolean): string {
  return arr ? `${base}[${key}]` : base ? `${base}.${key}` : key;
}

function walk(prev: unknown, next: unknown, path: string, ops: DiffOp[]): unknown {
  // 叶子或类型不同 → 直接 replace
  if (!isObj(prev) || !isObj(next) || Array.isArray(prev) !== Array.isArray(next)) {
    if (JSON.stringify(prev) === JSON.stringify(next)) return undefined;
    ops.push({ op: 'replace', path, from: prev, to: next });
    return [prev, next];
  }
  const arr = Array.isArray(prev);
  const out: Delta = arr ? { _t: 'a' } : {};
  const allKeys = new Set([...keysOf(prev), ...keysOf(next)]);
  let changed = false;
  for (const k of allKeys) {
    const has1 = k in prev, has2 = k in next;
    const childPath = joinPath(path, k, arr);
    if (has1 && !has2) {
      ops.push({ op: 'remove', path: childPath, from: prev[k] });
      out[arr ? `_${k}` : k] = [prev[k], 0, 0];
      changed = true;
    } else if (!has1 && has2) {
      ops.push({ op: 'add', path: childPath, to: next[k] });
      out[k] = [next[k]];
      changed = true;
    } else {
      const d = walk(prev[k], next[k], childPath, ops);
      if (d !== undefined) {
        out[k] = d;
        changed = true;
      }
    }
  }
  return changed ? out : undefined;
}

export function schemaDiff(prev: ReportSchema | null, next: ReportSchema): SchemaDiff {
  const ops: DiffOp[] = [];
  const delta = (walk(prev ?? {}, next, '', ops) as Delta) ?? {};
  const destructive = ops.some(
    (o) =>
      o.op === 'remove' &&
      (/componentsTree\[0\]\.children\[\d+\]$/.test(o.path) ||
        /dataSource\.list\[\d+\]$/.test(o.path)),
  );
  return { ops, delta, destructive };
}

/** 人读单行摘要（host 气泡渲染）。值过长截断。 */
export function summarizeOps(ops: DiffOp[], limit = 40): string[] {
  const short = (v: unknown): string => {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s == null ? 'null' : s.length > limit ? s.slice(0, limit) + '…' : s;
  };
  return ops.map((o) => {
    if (o.op === 'add') return `+ ${o.path} = ${short(o.to)}`;
    if (o.op === 'remove') return `- ${o.path}  (was ${short(o.from)})`;
    return `~ ${o.path}: ${short(o.from)} → ${short(o.to)}`;
  });
}

/* ------------------------------ code diff ------------------------------ */

export type LineKind = 'ctx' | 'add' | 'del';
export interface DiffLine {
  kind: LineKind;
  text: string;
}

/** 行级 LCS diff（小文件够用；不折叠 context）。 */
export function lineDiff(prev: string, next: string): DiffLine[] {
  const a = prev === '' ? [] : prev.replace(/\n$/, '').split('\n');
  const b = next === '' ? [] : next.replace(/\n$/, '').split('\n');
  const m = a.length, n = b.length;
  // LCS 长度表
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: 'ctx', text: a[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'del', text: a[i++] });
    } else {
      out.push({ kind: 'add', text: b[j++] });
    }
  }
  while (i < m) out.push({ kind: 'del', text: a[i++] });
  while (j < n) out.push({ kind: 'add', text: b[j++] });
  return out;
}

export interface FileDiff {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
  lines: DiffLine[];
}

export interface CodeDiffInput {
  path: string;
  /** null = 文件新增 */
  prev: string | null;
  /** null = 文件删除 */
  next: string | null;
}

export function codeDiff(files: CodeDiffInput[]): FileDiff[] {
  const out: FileDiff[] = [];
  for (const f of files) {
    if (f.prev === f.next) continue;
    const status: FileDiff['status'] = f.prev === null ? 'added' : f.next === null ? 'deleted' : 'modified';
    const lines = lineDiff(f.prev ?? '', f.next ?? '');
    out.push({
      path: f.path,
      status,
      additions: lines.filter((l) => l.kind === 'add').length,
      deletions: lines.filter((l) => l.kind === 'del').length,
      lines,
    });
  }
  return out;
}
