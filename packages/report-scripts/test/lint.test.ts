import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSchema } from '../src/schema-scan.ts';
import { lintReport } from '../src/lint.ts';
import type { ReportSchema } from '@daf/report-runtime/core';

const REAL_PROJECT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../apps/template-report');

function makeTempProject(blockSrc: string, node: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'daf-lint-'));
  mkdirSync(join(dir, 'src/blocks/Bad'), { recursive: true });
  writeFileSync(join(dir, 'src/blocks/Bad/index.tsx'), blockSrc);
  const schema: ReportSchema = {
    version: '1.0.0',
    componentsMap: [{ componentName: 'AIBlock', package: '@daf/report-runtime', exportName: 'AIBlock' }],
    componentsTree: [{
      componentName: 'Page',
      children: [{ id: 'node_bad', componentName: 'AIBlock', props: { entry: 'blocks/Bad' }, ...node }],
    }],
  };
  writeFileSync(join(dir, 'report.schema.json'), JSON.stringify(schema));
  return dir;
}

test('真实工程 template-report lint 通过', () => {
  const schema = readSchema(REAL_PROJECT);
  const res = lintReport(REAL_PROJECT, schema);
  assert.equal(res.ok, true, JSON.stringify(res.issues));
});

test('裸 fetch 被拦截', () => {
  const dir = makeTempProject(
    `export default function B({ runtime }) { fetch('/x'); return null; }`,
    { 'x-consumes': [], 'x-emits': [] },
  );
  try {
    const res = lintReport(dir, readSchema(dir));
    assert.equal(res.ok, false);
    assert.ok(res.issues.some((i) => i.rule === 'no-bare-fetch'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('消费未声明数据源 + emit 未声明事件 被拦截', () => {
  const dir = makeTempProject(
    `export default function B({ runtime, onEmit }) {
       runtime.data.query('ds_secret');
       onEmit('boom');
       return null;
     }`,
    { 'x-consumes': ['ds_ok'], 'x-emits': ['drill'] },
  );
  try {
    const schema = readSchema(dir);
    const res = lintReport(dir, schema);
    assert.equal(res.ok, false);
    assert.ok(res.issues.some((i) => i.rule === 'consumes-undeclared' && i.message.includes('ds_secret')));
    assert.ok(res.issues.some((i) => i.rule === 'emits-undeclared' && i.message.includes('boom')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('comment 中的 fetch 不误报', () => {
  const dir = makeTempProject(
    `export default function B() { /* 不要用 fetch('/x') */ return null; }`,
    { 'x-consumes': [], 'x-emits': [] },
  );
  try {
    const res = lintReport(dir, readSchema(dir));
    assert.equal(res.ok, true, JSON.stringify(res.issues));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
