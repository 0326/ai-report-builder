/** 数据绑定归一化：从 JSExpression 反推 x-consumes + 自动补 dataSource（只增不减，幂等）。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDataBindings } from '../src/normalize.ts';
import type { ReportSchema } from '@daf/report-runtime/core';

const known = ['ds_sales', 'metric_dau'];

function mk(dataExpr: string): ReportSchema {
  return {
    version: '1.0.0',
    componentsMap: [],
    componentsTree: [{
      componentName: 'Page',
      dataSource: { list: [] },
      children: [{
        id: 'node_chart', componentName: 'BarChart',
        props: { xField: 'month', data: { type: 'JSExpression', value: dataExpr } },
      }],
    }],
  } as unknown as ReportSchema;
}

function mkDatasetProp(datasetId: string): ReportSchema {
  return {
    version: '1.0.0',
    componentsMap: [],
    componentsTree: [{
      componentName: 'Page',
      dataSource: { list: [] },
      children: [{ id: 'node_chart', componentName: 'BarChart', props: { dataset: datasetId, xField: 'month' } }],
    }],
  } as unknown as ReportSchema;
}

test('可视编排 dataset prop → 落成 data JSExpression + x-consumes + dataSource', () => {
  const { schema, addedDataSources } = normalizeDataBindings(mkDatasetProp('ds_sales'), known);
  assert.deepEqual(addedDataSources, ['ds_sales']);
  const node = schema.componentsTree[0].children[0];
  const data = node.props!.data as { type: string; value: string };
  assert.equal(data.type, 'JSExpression');
  assert.match(data.value, /dataSourceMap\['ds_sales'\]\.data/);
  assert.deepEqual(node['x-consumes'], ['ds_sales']);
});

test('未知 dataset prop 不落 data（防脏写）', () => {
  const { schema, addedDataSources } = normalizeDataBindings(mkDatasetProp('ds_bogus'), known);
  assert.deepEqual(addedDataSources, []);
  assert.equal(schema.componentsTree[0].children[0].props!.data, undefined);
});

test('从 data JSExpression 反推 x-consumes 并补 dataSource', () => {
  const { schema, addedDataSources } = normalizeDataBindings(mk("this.dataSourceMap['ds_sales'].data"), known);
  assert.deepEqual(addedDataSources, ['ds_sales']);
  const page = schema.componentsTree[0];
  assert.deepEqual(page.children[0]['x-consumes'], ['ds_sales']);
  assert.equal(page.dataSource!.list.length, 1);
  assert.equal(page.dataSource!.list[0].options.datasetId, 'ds_sales');
  assert.equal(page.dataSource!.list[0].type, 'daf-query');
});

test('未知数据集不补 dataSource（防脏写）', () => {
  const { addedDataSources } = normalizeDataBindings(mk("this.dataSourceMap['ds_unknown'].data"), known);
  assert.deepEqual(addedDataSources, []);
});

test('幂等：已存在 dataSource 不重复添加', () => {
  const s = mk("this.dataSourceMap['ds_sales'].data");
  normalizeDataBindings(s, known);
  const { addedDataSources } = normalizeDataBindings(s, known);
  assert.deepEqual(addedDataSources, []);
  assert.equal(s.componentsTree[0].dataSource!.list.length, 1);
});

test('保留已有 x-consumes（只增不减）', () => {
  const s = mk("this.dataSourceMap['ds_sales'].data");
  s.componentsTree[0].children[0]['x-consumes'] = ['metric_dau'];
  normalizeDataBindings(s, known);
  assert.deepEqual(s.componentsTree[0].children[0]['x-consumes'].sort(), ['ds_sales', 'metric_dau']);
});
