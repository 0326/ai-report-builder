import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeKernel } from '../src/kernel.ts';
import type { RuntimeModule } from '../src/kernel.ts';
import type { RuntimeContext } from '../src/types.ts';
import { makeSchema, makeFakeDafQuery } from './fixtures.ts';

const ctx = (): RuntimeContext => ({
  schema: makeSchema(),
  env: 'preview',
  services: { dafQuery: makeFakeDafQuery().service },
});

test('kernel: 依赖序初始化 + get', async () => {
  const order: string[] = [];
  const a: RuntimeModule = { name: 'a', setup: () => (order.push('a'), 'apiA') };
  const b: RuntimeModule = { name: 'b', deps: ['a'], setup: () => (order.push('b'), 'apiB') };
  const k = new RuntimeKernel();
  k.use(b).use(a); // 注册顺序故意反着来
  await k.init(ctx());
  assert.deepEqual(order, ['a', 'b']);
  assert.equal(k.get('b'), 'apiB');
});

test('kernel: 缺失依赖抛错', async () => {
  const k = new RuntimeKernel();
  k.use({ name: 'x', deps: ['missing'], setup: () => null });
  await assert.rejects(() => k.init(ctx()), /missing module dep/);
});

test('kernel: 循环依赖抛错', async () => {
  const k = new RuntimeKernel();
  k.use({ name: 'a', deps: ['b'], setup: () => null });
  k.use({ name: 'b', deps: ['a'], setup: () => null });
  await assert.rejects(() => k.init(ctx()), /circular/);
});

test('kernel: 未安装模块 get 抛错', async () => {
  const k = new RuntimeKernel();
  await k.init(ctx());
  assert.throws(() => k.get('nope'), /module not installed/);
});

test('kernel: dispose 逆序', async () => {
  const disposed: string[] = [];
  const k = new RuntimeKernel();
  k.use({ name: 'a', setup: () => null, dispose: () => disposed.push('a') });
  k.use({ name: 'b', deps: ['a'], setup: () => null, dispose: () => disposed.push('b') });
  await k.init(ctx());
  k.dispose();
  assert.deepEqual(disposed, ['b', 'a']);
});

test('kernel: invalidate/subscribe 版本通知', async () => {
  const k = new RuntimeKernel();
  await k.init(ctx());
  let called = 0;
  const un = k.subscribe(() => called++);
  k.invalidate();
  k.invalidate();
  un();
  k.invalidate();
  assert.equal(called, 2);
  assert.equal(k.version, 3);
});
