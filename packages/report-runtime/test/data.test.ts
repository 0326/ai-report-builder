import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReportRuntime } from '../src/create.ts';
import type { DataRuntime } from '../src/modules/data.ts';
import type { StateRuntime } from '../src/modules/state.ts';
import { makeSchema, makeFakeDafQuery } from './fixtures.ts';

test('data: 未声明 dsId 运行期拒绝', async () => {
  const { service } = makeFakeDafQuery();
  const rt = await createReportRuntime({ schema: makeSchema(), services: { dafQuery: service }, autoQuery: false });
  const data = rt.get<DataRuntime>('data');
  await assert.rejects(() => data.query('ds_hacked'), /undeclared dataSource/);
});

test('data: initAuto 启动全部 auto 数据源并带初始 params', async () => {
  const { service, log } = makeFakeDafQuery();
  const rt = await createReportRuntime({ schema: makeSchema(), services: { dafQuery: service } });
  const data = rt.get<DataRuntime>('data');
  assert.equal(log.calls.length, 2);
  assert.ok(log.calls.every((c) => c.params.region === 'all'));
  assert.equal(data.getState('ds_dau').rows.length, 2);
  assert.equal(data.getState('ds_dau').loading, false);
});

test('data: in-flight 去重（并发同参查询只打一次）', async () => {
  const { service, log } = makeFakeDafQuery({ delayMs: 20 });
  const rt = await createReportRuntime({ schema: makeSchema(), services: { dafQuery: service }, autoQuery: false });
  const data = rt.get<DataRuntime>('data');
  const [r1, r2] = await Promise.all([data.query('ds_dau'), data.query('ds_dau')]);
  assert.equal(log.calls.length, 1);
  assert.deepEqual(r1.rows, r2.rows);
});

test('data: 缓存命中（顺序同参查询 fromCache）', async () => {
  const { service, log } = makeFakeDafQuery();
  const rt = await createReportRuntime({ schema: makeSchema(), services: { dafQuery: service }, autoQuery: false });
  const data = rt.get<DataRuntime>('data');
  const r1 = await data.query('ds_dau');
  const r2 = await data.query('ds_dau');
  assert.equal(log.calls.length, 1);
  assert.equal(r1.fromCache, undefined);
  assert.equal(r2.fromCache, true);
});

test('data: 筛选变化 → 依赖图自动 reload（新 params）', async () => {
  const { service, log } = makeFakeDafQuery();
  const rt = await createReportRuntime({ schema: makeSchema(), services: { dafQuery: service } });
  const state = rt.get<StateRuntime>('state');
  const callsBefore = log.calls.length;
  state.set('f_region', 'north');
  await new Promise((r) => setTimeout(r, 50));
  const newCalls = log.calls.slice(callsBefore);
  // ds_dau 与 ds_channel 都依赖 f_region
  assert.equal(newCalls.length, 2);
  assert.ok(newCalls.every((c) => c.params.region === 'north'));
});

test('data: 页面级并发预算 ≤ 6', async () => {
  const { service, log } = makeFakeDafQuery({ delayMs: 30 });
  const rt = await createReportRuntime({
    schema: makeSchema({ extraDs: 10 }), // 共 12 个 auto 数据源
    services: { dafQuery: service },
  });
  assert.ok(rt.has('data'));
  assert.equal(log.calls.length, 12);
  assert.ok(log.maxConcurrent <= 6, `maxConcurrent=${log.maxConcurrent}`);
});

test('data: 权限拒绝的数据集查询失败', async () => {
  const { service } = makeFakeDafQuery();
  const rt = await createReportRuntime({
    schema: makeSchema(),
    services: { dafQuery: service },
    user: { id: 'u1', permissions: { datasets: ['metric_channel'] } }, // 不含 metric_dau
    autoQuery: false,
  });
  const data = rt.get<DataRuntime>('data');
  await assert.rejects(() => data.query('ds_dau'), /permission denied/);
  await data.query('ds_channel'); // 有权限的正常
});

test('data: dataSourceMap 形态可供 JSExpression 消费', async () => {
  const { service } = makeFakeDafQuery();
  const rt = await createReportRuntime({ schema: makeSchema(), services: { dafQuery: service } });
  const data = rt.get<DataRuntime>('data');
  const map = data.dataSourceMap();
  assert.ok(Array.isArray(map.ds_channel.data));
  assert.equal(map.ds_channel.loading, false);
});
