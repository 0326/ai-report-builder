import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReportRuntime } from '../src/create.ts';
import type { StateRuntime } from '../src/modules/state.ts';
import type { EventRuntime } from '../src/modules/event.ts';
import type { LoggerRuntime } from '../src/modules/logger.ts';
import { makeSchema, makeFakeDafQuery } from './fixtures.ts';

const boot = (customHandlers?: Record<string, (p: unknown, api: unknown) => void>) =>
  createReportRuntime({
    schema: makeSchema(),
    services: { dafQuery: makeFakeDafQuery().service },
    customHandlers,
    autoQuery: false,
  });

test('state: schema 初始化 + set/watch', async () => {
  const rt = await boot();
  const state = rt.get<StateRuntime>('state');
  assert.equal(state.get('f_region'), 'all');

  const seen: unknown[] = [];
  state.watch('f_region', (v) => seen.push(v));
  state.set('f_region', 'north');
  state.set('f_region', 'north'); // 相同值不触发
  assert.deepEqual(seen, ['north']);
  assert.equal(rt.version > 0, true);
});

test('event: 声明式 linkage 自动装配（click → setState mapping）', async () => {
  const rt = await boot();
  const state = rt.get<StateRuntime>('state');
  const event = rt.get<EventRuntime>('event');
  // schema: lk1 = node_channel.click -> setState f_region = payload.name
  event.emitFrom('node_channel')('click', { name: 'app', value: 40 });
  assert.equal(state.get('f_region'), 'app');
});

test('event: 未声明事件被拒绝（log + no-op）', async () => {
  const rt = await boot();
  const event = rt.get<EventRuntime>('event');
  const logger = rt.get<LoggerRuntime>('logger');
  let received = 0;
  event.on('node_channel.hover', () => received++);
  event.emitFrom('node_channel')('hover', {}); // hover 未在 x-emits 声明
  assert.equal(received, 0);
  assert.ok(logger.getBuffer().some((e) => e.type === 'event.blocked'));
});

test('event: custom linkage 调 handler；缺失 handler 记日志', async () => {
  let got: unknown = null;
  const rt = await boot({ 'src/blocks/TrendBlock#onDrill': (p) => (got = p) });
  const event = rt.get<EventRuntime>('event');
  event.emitFrom('node_trend')('drill', { level: 2 });
  assert.deepEqual(got, { level: 2 });

  const rt2 = await boot(); // 不提供 handler
  const logger2 = rt2.get<LoggerRuntime>('logger');
  assert.ok(logger2.getBuffer().some((e) => e.type === 'linkage.handler.missing'));
});

test('event: emit 落审计日志', async () => {
  const rt = await boot();
  const event = rt.get<EventRuntime>('event');
  const logger = rt.get<LoggerRuntime>('logger');
  event.emitFrom('node_trend')('drill', {});
  assert.ok(logger.getBuffer().some((e) => e.type === 'event.emit' && e.payload?.source === 'node_trend.drill'));
});
