/** 发布：冻结 bundle/schema + 上传数据集快照；发布查询走快照且独立于源数据集删除。 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { datasetIdsInSchema, publishReport, listPublished, queryPublished } from '../src/publish.ts';
import { importDataset, deleteDataset } from '../src/datasets.ts';
import { toDatasetId } from '../src/csv.ts';
import type { ReportSchema } from '@daf/report-runtime/core';

const dsId = toDatasetId('__pubtest_sales__');

const schema = (): ReportSchema =>
  ({
    version: '1.0.0',
    name: '销售报告',
    componentsMap: [],
    componentsTree: [{
      componentName: 'Page',
      dataSource: { list: [
        { id: 'ds_sales', type: 'daf-query', options: { datasetId: dsId } },
        { id: 'ds_dau', type: 'daf-query', options: { datasetId: 'metric_dau' } },
      ] },
      children: [],
    }],
  }) as unknown as ReportSchema;

let root: string;
let buildDir: string;
let publishedDir: string;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'daf-pub-'));
  buildDir = join(root, 'build');
  publishedDir = join(root, 'published');
  mkdirSync(buildDir, { recursive: true });
  // 伪造构建产物
  writeFileSync(join(buildDir, 'bundle.abc.js'), 'export const bundle={};export const customHandlers={};');
  writeFileSync(join(buildDir, 'schema.def.json'), JSON.stringify(schema()));
  writeFileSync(join(buildDir, 'manifest.json'), JSON.stringify({ name: '销售报告', artifact: { bundle: './bundle.abc.js', schema: './schema.def.json' } }));
  // 真实上传数据集
  importDataset('region,product,sales\n华东,A,100\n华东,B,200\n华北,A,300\n', { id: dsId, title: '测试销售' });
});

after(() => {
  deleteDataset(dsId);
  rmSync(root, { recursive: true, force: true });
});

test('datasetIdsInSchema 提取去重', () => {
  assert.deepEqual(datasetIdsInSchema(schema()).sort(), [dsId, 'metric_dau'].sort());
});

test('发布：冻结产物 + 上传数据快照（内置不冻结）', () => {
  const rec = publishReport({ buildDir, publishedDir, hash: 'deadbeef', schema: schema(), title: '销售报告', createdAt: 1700000000000 });
  assert.match(rec.id, /^pub_/);
  assert.deepEqual(rec.datasets, [dsId]); // metric_dau 内置，不冻结
  assert.equal(listPublished(publishedDir).length, 1);

  // 发布查询命中冻结快照
  assert.equal(queryPublished(publishedDir, rec.id, dsId, {}).length, 3);
  assert.equal(queryPublished(publishedDir, rec.id, dsId, { region: '华东' }).length, 2);
  // 内置数据集走实时
  assert.equal(queryPublished(publishedDir, rec.id, 'metric_dau', {}).length, 7);
});

test('发布产物独立于源数据集删除', () => {
  const rec = publishReport({ buildDir, publishedDir, hash: 'cafe', schema: schema(), title: '销售报告', createdAt: 1700000001000 });
  deleteDataset(dsId); // 源数据集删除
  // 已发布快照仍可查
  assert.equal(queryPublished(publishedDir, rec.id, dsId, {}).length, 3);
  // 重新导入以便 after 清理幂等
  importDataset('region,product,sales\n华东,A,100\n', { id: dsId, title: 'x' });
});
