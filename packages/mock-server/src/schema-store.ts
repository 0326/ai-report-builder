/**
 * schema 直更新存储：PUT /api/schema 的落盘实现。
 * 写源 schema（report.schema.json，第 5 轮 git 管理的对象）+ 新 hash 产物 + 重派生 manifest + 历史副本。
 * 全程不碰 bundle —— 声明性修改零构建（双管线分流的物理保证）。
 */
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ReportSchema } from '@daf/report-runtime/core';
import { getPage } from '@daf/report-runtime/core';
import { shortHash, deriveManifest } from '@daf/report-scripts';

export interface SaveResult {
  hash: string;
  schemaFile: string;
  schemaUrl: string;
  historyFile: string;
}

export function validateSchema(schema: unknown): asserts schema is ReportSchema {
  const s = schema as ReportSchema;
  if (!s || typeof s !== 'object') throw new Error('schema 必须是对象');
  if (!Array.isArray(s.componentsMap)) throw new Error('缺少 componentsMap');
  if (!Array.isArray(s.componentsTree)) throw new Error('缺少 componentsTree');
  const page = getPage(s); // componentsTree 空会抛
  if (page.componentName !== 'Page') throw new Error('componentsTree[0] 必须是 Page');
  const ids = new Set<string>();
  for (const n of page.children ?? []) {
    if (!n.id) throw new Error('块节点缺少 id');
    if (ids.has(n.id)) throw new Error(`块节点 id 重复: ${n.id}`);
    ids.add(n.id);
  }
}

export function saveSchema(projectDir: string, artifactsDir: string, schema: ReportSchema): SaveResult {
  validateSchema(schema);
  const text = JSON.stringify(schema, null, 2);
  const hash = shortHash(text);
  const reportDir = join(artifactsDir, 'report');
  const historyDir = join(artifactsDir, 'schema-history');
  mkdirSync(reportDir, { recursive: true });
  mkdirSync(historyDir, { recursive: true });

  // 1) 源工程 schema（结构半权威层的权威落点）
  writeFileSync(join(projectDir, 'report.schema.json'), text + '\n');

  // 2) hash 寻址产物（运行时 fetch 的对象；旧版本保留，支撑回滚秒级切 URL）
  const schemaFile = `schema.${hash}.json`;
  writeFileSync(join(reportDir, schemaFile), text);

  // 3) manifest 重派生（bundle 指针不变）
  const manifestPath = join(reportDir, 'manifest.json');
  const prev = JSON.parse(readFileSync(manifestPath, 'utf8')) as { artifact: { bundle: string } };
  const bundleFile = String(prev.artifact.bundle).replace(/^\.\//, '');
  const manifest = deriveManifest(schema, {
    name: (schema as { name?: string }).name ?? 'report',
    version: schema.version,
    bundleFile,
    schemaFile,
  });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // 4) 历史副本（序号递增，第 5 轮换 git commit）
  const seq = readdirSync(historyDir).length + 1;
  const historyFile = `${String(seq).padStart(4, '0')}.${hash}.json`;
  writeFileSync(join(historyDir, historyFile), text);

  return { hash, schemaFile, schemaUrl: `/artifacts/report/${schemaFile}`, historyFile };
}
