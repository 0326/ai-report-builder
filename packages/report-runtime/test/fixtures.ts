/** 测试用 schema fixture（对齐技术方案 §2.2 示例） */
import type { ReportSchema, DafQueryService, QueryRequest } from '../src/types.ts';

export function makeSchema(overrides?: { extraDs?: number }): ReportSchema {
  const extraList = Array.from({ length: overrides?.extraDs ?? 0 }, (_, i) => ({
    id: `ds_extra_${i}`,
    type: 'daf-query',
    options: { datasetId: `metric_extra_${i}`, fields: ['k', 'v'], params: {} },
    'x-trigger': 'auto' as const,
  }));
  return {
    version: '1.0.0',
    componentsMap: [
      { componentName: 'PieChart', package: '@daf-materials/kit', version: '^0.1.0', exportName: 'PieChart' },
      { componentName: 'AIBlock', package: '@daf/report-runtime', exportName: 'AIBlock' },
    ],
    componentsTree: [
      {
        componentName: 'Page',
        props: { title: '周度经营报告' },
        'x-layout': { mode: 'grid', cols: 12 },
        state: { f_region: 'all' },
        dataSource: {
          list: [
            {
              id: 'ds_dau',
              type: 'daf-query',
              options: {
                datasetId: 'metric_dau',
                fields: ['date', 'dau'],
                params: { region: { type: 'JSExpression', value: 'this.state.f_region' } },
              },
              'x-trigger': 'auto',
            },
            {
              id: 'ds_channel',
              type: 'daf-query',
              options: {
                datasetId: 'metric_channel',
                fields: ['channel', 'uv'],
                params: { region: { type: 'JSExpression', value: 'this.state.f_region' } },
              },
              'x-trigger': 'auto',
            },
            ...extraList,
          ],
        },
        'x-filters': [
          { id: 'f_region', label: '区域', stateKey: 'f_region', valueType: 'enum', default: 'all' },
        ],
        'x-linkages': [
          { id: 'lk1', source: 'node_channel.click', action: 'setState', target: 'f_region', mapping: 'payload.name' },
          { id: 'lk2', source: 'node_trend.drill', action: 'custom', handler: 'src/blocks/TrendBlock#onDrill' },
        ],
        children: [
          {
            id: 'node_trend',
            componentName: 'AIBlock',
            title: 'DAU 趋势',
            props: { entry: 'blocks/TrendBlock', smooth: true },
            'x-position': { x: 0, y: 1, w: 8, h: 6 },
            'x-consumes': ['ds_dau'],
            'x-listens': ['f_region'],
            'x-emits': ['drill'],
          },
          {
            id: 'node_channel',
            componentName: 'PieChart',
            title: '渠道占比',
            props: {
              donut: false,
              data: { type: 'JSExpression', value: "this.dataSourceMap['ds_channel'].data" },
            },
            'x-position': { x: 8, y: 1, w: 4, h: 6 },
            'x-consumes': ['ds_channel'],
            'x-listens': ['f_region'],
            'x-emits': ['click'],
          },
        ],
      },
    ],
  };
}

export interface FakeQueryLog {
  calls: QueryRequest[];
  concurrent: number;
  maxConcurrent: number;
}

export function makeFakeDafQuery(opts?: { delayMs?: number }): { service: DafQueryService; log: FakeQueryLog } {
  const log: FakeQueryLog = { calls: [], concurrent: 0, maxConcurrent: 0 };
  const service: DafQueryService = async (req) => {
    log.calls.push(req);
    log.concurrent++;
    log.maxConcurrent = Math.max(log.maxConcurrent, log.concurrent);
    await new Promise((r) => setTimeout(r, opts?.delayMs ?? 5));
    log.concurrent--;
    if (req.signal?.aborted) throw new Error('aborted');
    return {
      rows: [
        { date: '2026-06-01', dau: 100, channel: 'app', uv: 40, region: req.params.region ?? 'all' },
        { date: '2026-06-02', dau: 120, channel: 'web', uv: 60, region: req.params.region ?? 'all' },
      ],
    };
  };
  return { service, log };
}
