import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schemaDiff, summarizeOps, lineDiff, codeDiff } from '../src/diff.ts';
import type { ReportSchema } from '@daf/report-runtime/core';

const base = (): ReportSchema =>
  ({
    version: '1.0.0',
    componentsMap: [],
    componentsTree: [
      {
        componentName: 'Page',
        state: { f_region: 'all' },
        'x-linkages': [{ id: 'lk1', source: 'a.click', action: 'setState' }],
        children: [
          { id: 'node_channel', componentName: 'PieChart', props: { donut: false } },
        ],
      },
    ],
  }) as unknown as ReportSchema;

test('schemaDiff：改值 / 新增 数组项 / 新增对象键（对齐附录 A 形态）', () => {
  const prev = base();
  const next = base();
  const page = next.componentsTree[0] as never as { state: Record<string, unknown>; 'x-linkages': unknown[]; children: { props: Record<string, unknown> }[] };
  page.children[0].props.donut = true;
  page.state.f_channel = 'all';
  page['x-linkages'].push({ id: 'lk3', source: 'node_channel.click', action: 'setState', target: 'f_channel' });

  const { ops, destructive } = schemaDiff(prev, next);
  assert.equal(destructive, false);
  const summary = summarizeOps(ops);
  assert.ok(summary.some((s) => /donut.*false → true/.test(s)), summary.join('\n'));
  assert.ok(summary.some((s) => /\+ .*f_channel/.test(s)));
  assert.ok(summary.some((s) => /\+ .*x-linkages\[1\]/.test(s)));
});

test('schemaDiff：删块标记为破坏性', () => {
  const prev = base();
  const next = base();
  (next.componentsTree[0] as never as { children: unknown[] }).children = [];
  const { destructive, ops } = schemaDiff(prev, next);
  assert.equal(destructive, true);
  assert.ok(ops.some((o) => o.op === 'remove' && /children\[0\]$/.test(o.path)));
});

test('lineDiff：新文件全为新增', () => {
  const lines = lineDiff('', 'a\nb\nc');
  assert.deepEqual(lines.map((l) => l.kind), ['add', 'add', 'add']);
});

test('lineDiff：修改保留 LCS context', () => {
  const lines = lineDiff('a\nb\nc', 'a\nB\nc');
  assert.deepEqual(lines.map((l) => `${l.kind}:${l.text}`), ['ctx:a', 'del:b', 'add:B', 'ctx:c']);
});

test('codeDiff：跳过未变文件、统计增删', () => {
  const out = codeDiff([
    { path: 'new.tsx', prev: null, next: 'x\ny' },
    { path: 'same.ts', prev: 'k', next: 'k' },
    { path: 'gone.ts', prev: 'old', next: null },
  ]);
  assert.equal(out.length, 2);
  const added = out.find((f) => f.path === 'new.tsx')!;
  assert.equal(added.status, 'added');
  assert.equal(added.additions, 2);
  assert.equal(out.find((f) => f.path === 'gone.ts')!.status, 'deleted');
});
