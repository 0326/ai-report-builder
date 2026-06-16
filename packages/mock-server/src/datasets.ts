/**
 * 数据集注册中心（真实数据层，去 mock）：
 * - 内置示例数据集（demo：metric_*，带 region/channel 联动语义）
 * - 用户上传数据集（CSV → 解析 → 落盘 .artifacts/datasets/<id>.json，重启不丢）
 * 统一 query 接口供 /api/daf/query、Agent query_dataset、运行态预览共用；
 * 动态派生 KNOWN_DATASETS / Agent 数据集文档 —— Agent 可基于上传的真实数据搭建报告。
 */
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryDataset as queryBuiltin, BUILTIN_DATASETS } from './fixtures.ts';
import { parseTable, type ColumnMeta } from './csv.ts';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const STORE_DIR = join(REPO_ROOT, '.artifacts/datasets');

export interface DatasetField {
  name: string;
  type: 'number' | 'date' | 'string';
  /** 维度（适合分组/筛选）vs 度量（适合聚合） */
  role: 'dimension' | 'measure';
}

export interface DatasetMeta {
  id: string;
  title: string;
  source: 'builtin' | 'upload';
  fields: DatasetField[];
  rowCount: number;
  /** 上传数据集支持按这些维度字段过滤（params[field]=value） */
  filterable: string[];
  createdAt?: number;
}

interface StoredDataset {
  meta: DatasetMeta;
  rows: Array<Record<string, unknown>>;
}

/* ----------------------------- 内置示例数据集 ----------------------------- */

const BUILTIN_META: DatasetMeta[] = [
  {
    id: 'metric_summary', title: '核心指标汇总（示例）', source: 'builtin', rowCount: 1, filterable: ['region'],
    fields: [
      { name: 'dau', type: 'number', role: 'measure' },
      { name: 'newUser', type: 'number', role: 'measure' },
      { name: 'revenue', type: 'number', role: 'measure' },
    ],
  },
  {
    id: 'metric_dau', title: 'DAU 趋势（示例·近7天）', source: 'builtin', rowCount: 7, filterable: ['region', 'channel'],
    fields: [
      { name: 'date', type: 'date', role: 'dimension' },
      { name: 'dau', type: 'number', role: 'measure' },
    ],
  },
  {
    id: 'metric_channel', title: '渠道占比（示例）', source: 'builtin', rowCount: 4, filterable: ['region'],
    fields: [
      { name: 'channel', type: 'string', role: 'dimension' },
      { name: 'uv', type: 'number', role: 'measure' },
    ],
  },
  {
    id: 'metric_detail', title: '渠道明细（示例）', source: 'builtin', rowCount: 28, filterable: ['region'],
    fields: [
      { name: 'date', type: 'date', role: 'dimension' },
      { name: 'channel', type: 'string', role: 'dimension' },
      { name: 'uv', type: 'number', role: 'measure' },
      { name: 'dau', type: 'number', role: 'measure' },
    ],
  },
  {
    id: 'metric_retention', title: '留存漏斗（示例）', source: 'builtin', rowCount: 5, filterable: ['region'],
    fields: [
      { name: 'stage', type: 'string', role: 'dimension' },
      { name: 'users', type: 'number', role: 'measure' },
    ],
  },
];

/* ----------------------------- 上传数据集存储 ----------------------------- */

function fieldsFromColumns(cols: ColumnMeta[], rowCount: number): DatasetField[] {
  return cols.map((c) => ({
    name: c.name,
    type: c.type,
    // 启发式：字符串/日期 或 低基数数值 → 维度；其余数值 → 度量
    role: c.type === 'number' && c.distinct > Math.min(rowCount * 0.5, 12) ? 'measure' : c.type === 'number' ? 'measure' : 'dimension',
  }));
}

function loadUploaded(id: string): StoredDataset | null {
  try {
    return JSON.parse(readFileSync(join(STORE_DIR, `${id}.json`), 'utf8')) as StoredDataset;
  } catch {
    return null;
  }
}

function listUploadedIds(): string[] {
  if (!existsSync(STORE_DIR)) return [];
  return readdirSync(STORE_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
}

/** 上传/覆盖一个数据集（CSV 文本 → 解析落盘）。返回 meta。 */
export function importDataset(rawCsv: string, opts: { id: string; title?: string }): DatasetMeta {
  const table = parseTable(rawCsv);
  const fields = fieldsFromColumns(table.columns, table.rows.length);
  const meta: DatasetMeta = {
    id: opts.id,
    title: opts.title ?? opts.id,
    source: 'upload',
    fields,
    rowCount: table.rows.length,
    filterable: fields.filter((f) => f.role === 'dimension').map((f) => f.name).slice(0, 4),
    createdAt: 0, // 调用方落盘后由 server 戳时间戳；这里保持纯（无 Date.now）
  };
  mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(join(STORE_DIR, `${opts.id}.json`), JSON.stringify({ meta, rows: table.rows }));
  return meta;
}

export function deleteDataset(id: string): boolean {
  const file = join(STORE_DIR, `${id}.json`);
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

/* ----------------------------- 统一查询接口 ----------------------------- */

export function listDatasets(): DatasetMeta[] {
  const uploaded = listUploadedIds().map((id) => loadUploaded(id)?.meta).filter(Boolean) as DatasetMeta[];
  return [...uploaded, ...BUILTIN_META];
}

export function getDatasetMeta(id: string): DatasetMeta | undefined {
  return listDatasets().find((d) => d.id === id);
}

export function knownDatasetIds(): string[] {
  return listDatasets().map((d) => d.id);
}

/** 行级查询：内置走 fixtures（含 region/channel 因子），上传按 filterable 字段精确过滤。 */
export function queryDataset(id: string, params: Record<string, unknown>): Array<Record<string, unknown>> {
  if (BUILTIN_DATASETS.includes(id)) return queryBuiltin(id, params);
  const ds = loadUploaded(id);
  if (!ds) return [];
  let rows = ds.rows;
  for (const field of ds.meta.filterable) {
    const want = params[field];
    if (want != null && want !== '' && want !== 'all') {
      rows = rows.filter((r) => String(r[field]) === String(want));
    }
  }
  return rows;
}

/** 数据集预览（前 N 行 + 列 meta），数据源面板与绑定向导用。 */
export function previewDataset(id: string, limit = 20): { meta: DatasetMeta; rows: Array<Record<string, unknown>> } | null {
  const meta = getDatasetMeta(id);
  if (!meta) return null;
  const rows = queryDataset(id, {}).slice(0, limit);
  return { meta, rows };
}

/* ----------------------------- Agent 数据集文档 ----------------------------- */

/** 供 Agent system prompt 的动态数据集清单（含上传的真实数据，Agent 据此选字段搭建）。 */
export function datasetDoc(): string {
  const lines = listDatasets().map((d) => {
    const fields = d.fields.map((f) => `${f.name}:${f.type}/${f.role === 'measure' ? '度量' : '维度'}`).join(', ');
    const filt = d.filterable.length ? `；可过滤参数 ${d.filterable.join('/')}` : '';
    const tag = d.source === 'upload' ? '【用户上传·真实数据】' : '【示例】';
    return `- ${d.id} ${tag} ${d.title}（${d.rowCount} 行）字段{${fields}}${filt}`;
  });
  return lines.join('\n');
}
