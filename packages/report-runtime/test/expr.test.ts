import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evalExpression, resolveDeep, extractStateDeps, stableStringify, isJSExpression } from '../src/expr.ts';

test('evalExpression: this.state 取值', () => {
  const v = evalExpression('this.state.f_region', { state: { f_region: 'north' } });
  assert.equal(v, 'north');
});

test('evalExpression: payload 具名变量（linkage mapping）', () => {
  const v = evalExpression('payload.name', {}, { payload: { name: 'app' } });
  assert.equal(v, 'app');
});

test('evalExpression: 求值失败返回 undefined 并上报', () => {
  let err: Error | undefined;
  const v = evalExpression('this.state.a.b.c', { state: {} }, {}, (e) => (err = e));
  assert.equal(v, undefined);
  assert.ok(err);
});

test('resolveDeep: 嵌套 JSExpression 解析', () => {
  const scope = { state: { f: 1 }, dataSourceMap: { ds: { data: [{ a: 1 }] } } };
  const out = resolveDeep(
    {
      plain: 'x',
      expr: { type: 'JSExpression', value: "this.dataSourceMap['ds'].data" },
      nested: { arr: [{ type: 'JSExpression', value: 'this.state.f' }, 2] },
    },
    scope,
  ) as Record<string, unknown>;
  assert.equal(out.plain, 'x');
  assert.deepEqual(out.expr, [{ a: 1 }]);
  assert.deepEqual((out.nested as { arr: unknown[] }).arr, [1, 2]);
});

test('extractStateDeps: 点取与下标取', () => {
  assert.deepEqual(extractStateDeps('this.state.f_region + this.state["f_channel"]').sort(), ['f_channel', 'f_region']);
  assert.deepEqual(extractStateDeps('1 + 1'), []);
});

test('stableStringify: key 顺序无关', () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
});

test('isJSExpression 判别', () => {
  assert.ok(isJSExpression({ type: 'JSExpression', value: '1' }));
  assert.ok(!isJSExpression({ type: 'other', value: '1' }));
  assert.ok(!isJSExpression(null));
});
