/**
 * 发布（全链路出口，非 mock）：把当前 commit 的报告冻结成可分享产物。
 * - 冻结 bundle + schema + manifest（来自 builds/<hash>/）
 * - 冻结所用「上传数据集」的行快照（内置示例是纯函数，确定性，不需冻结）
 * 发布产物自洽：源数据集删除 / 工程继续编辑都不影响已发布报告。
 */
import { mkdirSync, writeFileSync, readFileSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ReportSchema, PageNode } from '@daf/report-runtime/core';
import { getPage } from '@daf/report-runtime/core';
import { shortHash } from '@daf/report-scripts';
import { queryDataset, getDatasetMeta } from './datasets.ts';
import { BUILTIN_DATASETS } from './fixtures.ts';

export interface PublishRecord {
  id: string;
  title: string;
  hash: string;
  datasets: string[];
  createdAt: number;
}

/** schema 里所有 dataSource 引用的 datasetId（去重）。 */
export function datasetIdsInSchema(schema: ReportSchema): string[] {
  const page: PageNode = getPage(schema);
  const ids = (page.dataSource?.list ?? []).map((d) => d.options?.datasetId).filter(Boolean) as string[];
  return [...new Set(ids)];
}

function indexPath(publishedDir: string): string {
  return join(publishedDir, 'index.json');
}

export function listPublished(publishedDir: string): PublishRecord[] {
  try {
    return JSON.parse(readFileSync(indexPath(publishedDir), 'utf8')) as PublishRecord[];
  } catch {
    return [];
  }
}

/**
 * 发布当前报告。buildDir = builds/<hash>/（已构建产物），返回发布记录。
 * createdAt 由调用方传入（纯函数避免 Date.now）。
 */
export function publishReport(opts: {
  buildDir: string;
  publishedDir: string;
  hash: string;
  schema: ReportSchema;
  title: string;
  createdAt: number;
}): PublishRecord {
  const { buildDir, publishedDir, hash, schema, title, createdAt } = opts;
  if (!existsSync(join(buildDir, 'manifest.json'))) throw new Error('当前报告尚未构建，无法发布');

  const id = `pub_${shortHash(`${hash}:${createdAt}`)}`;
  const outDir = join(publishedDir, id);
  mkdirSync(join(outDir, 'data'), { recursive: true });

  // 1) 冻结构建产物（bundle/schema/manifest + 同 hash 的所有文件）
  for (const f of readdirSync(buildDir)) cpSync(join(buildDir, f), join(outDir, f));

  // 2) 冻结上传数据集快照（内置示例确定性，跳过）
  const datasets = datasetIdsInSchema(schema);
  const frozen: string[] = [];
  for (const dsId of datasets) {
    if (BUILTIN_DATASETS.includes(dsId)) continue;
    const meta = getDatasetMeta(dsId);
    if (!meta) continue;
    const rows = queryDataset(dsId, {});
    writeFileSync(join(outDir, 'data', `${dsId}.json`), JSON.stringify({ meta, rows }));
    frozen.push(dsId);
  }

  const record: PublishRecord = { id, title, hash, datasets: frozen, createdAt };
  const all = [record, ...listPublished(publishedDir).filter((r) => r.id !== id)];
  writeFileSync(indexPath(publishedDir), JSON.stringify(all, null, 2));
  return record;
}

/** 发布产物的数据查询：上传数据集走冻结快照（含 filterable 过滤），内置走实时纯函数。 */
export function queryPublished(
  publishedDir: string,
  publishId: string,
  datasetId: string,
  params: Record<string, unknown>,
): Array<Record<string, unknown>> | null {
  if (BUILTIN_DATASETS.includes(datasetId)) return queryDataset(datasetId, params);
  const file = join(publishedDir, publishId, 'data', `${datasetId}.json`);
  let snap: { meta: { filterable: string[] }; rows: Array<Record<string, unknown>> };
  try {
    snap = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  let rows = snap.rows;
  for (const field of snap.meta.filterable ?? []) {
    const want = params[field];
    if (want != null && want !== '' && want !== 'all') rows = rows.filter((r) => String(r[field]) === String(want));
  }
  return rows;
}
