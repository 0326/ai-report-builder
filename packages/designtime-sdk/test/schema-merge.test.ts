import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReportSchema, PageNode } from '@daf/report-runtime/core';
import { mergeXFields } from '../src/schema-merge.ts';

function baseline(): ReportSchema {
  return {
    version: '1.0.0',
    componentsMap: [
      { componentName: 'PieChart', package: '@daf-materials/kit', exportName: 'PieChart' },
      { componentName: 'AIBlock', package: '@daf/report-runtime', exportName: 'AIBlock' },
    ],
    componentsTree: [{
      componentName: 'Page',
      state: { f_region: 'all' },
      dataSource: { list: [{ id: 'ds_x', type: 'daf-query', options: { datasetId: 'm', params: {} } }] },
      'x-filters': [{ id: 'f', label: 'F', stateKey: 'f_region' }],
      'x-linkages': [{ id: 'lk', source: 'n1.click', action: 'setState', target: 'f_region' }],
      children: [
        {
          id: 'n1', componentName: 'PieChart', props: { donut: false },
          'x-position': { x: 0, y: 0, w: 4, h: 6 }, 'x-consumes': ['ds_x'], 'x-emits': ['click'],
        },
      ],
    } as PageNode],
  };
}

test('mergeXFields: 引擎丢弃的 x- 字段按 nodeId 补回；导出值优先', () => {
  // 模拟引擎导出：丢了节点 x-*、Page 级 x-filters/x-linkages/dataSource，改了 donut
  const exported: ReportSchema = {
    version: '1.0.0',
    componentsMap: [{ componentName: 'PieChart', package: '@daf-materials/kit', exportName: 'PieChart' }],
    componentsTree: [{
      componentName: 'Page',
      children: [
        { id: 'n1', componentName: 'PieChart', props: { donut: true }, 'x-position': { x: 4, y: 0, w: 8, h: 6 } },
      ],
    } as PageNode],
  };

  const merged = mergeXFields(exported, baseline());
  const page = merged.componentsTree[0];
  const n1 = page.children[0] as Record<string, unknown>;

  // 导出值优先（donut 修改、x-position 引擎已保留）
  assert.equal((n1.props as Record<string, unknown>).donut, true);
  assert.deepEqual(n1['x-position'], { x: 4, y: 0, w: 8, h: 6 });
  // 丢弃的补回
  assert.deepEqual(n1['x-consumes'], ['ds_x']);
  assert.deepEqual(n1['x-emits'], ['click']);
  assert.equal((page['x-filters'] ?? [])[0]?.id, 'f');
  assert.equal((page['x-linkages'] ?? [])[0]?.id, 'lk');
  assert.equal(page.dataSource?.list[0]?.id, 'ds_x');
  // componentsMap 基线独有项（AIBlock）补回
  assert.ok(merged.componentsMap.some((e) => e.componentName === 'AIBlock'));
});

test('mergeXFields: 新增节点（基线没有）原样保留', () => {
  const exported: ReportSchema = {
    version: '1.0.0',
    componentsMap: [],
    componentsTree: [{
      componentName: 'Page',
      children: [
        { id: 'n1', componentName: 'PieChart', props: {} },
        { id: 'n_new', componentName: 'BarChart', props: { xField: 'c' }, 'x-consumes': [] },
      ],
    } as PageNode],
  };
  const merged = mergeXFields(exported, baseline());
  const ids = merged.componentsTree[0].children.map((n) => n.id);
  assert.deepEqual(ids, ['n1', 'n_new']);
  const nNew = merged.componentsTree[0].children[1] as Record<string, unknown>;
  assert.deepEqual(nNew['x-consumes'], []);
});
