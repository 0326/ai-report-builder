import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveSchema, validateSchema } from '../src/schema-store.ts';
import type { ReportSchema } from '@daf/report-runtime/core';

function makeSchema(donut: boolean): ReportSchema {
  return {
    version: '1.0.0',
    componentsMap: [{ componentName: 'PieChart', package: '@daf-materials/kit', exportName: 'PieChart' }],
    componentsTree: [{
      componentName: 'Page',
      children: [{ id: 'n1', componentName: 'PieChart', props: { donut } }],
    }],
  } as ReportSchema;
}

function setup(): { projectDir: string; artifactsDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'daf-store-'));
  const projectDir = join(root, 'project');
  const artifactsDir = join(root, 'artifacts');
  mkdirSync(join(artifactsDir, 'report'), { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(artifactsDir, 'report/manifest.json'), JSON.stringify({
    artifact: { bundle: './bundle.aaaa.js', schema: './schema.bbbb.json' },
  }));
  return { projectDir, artifactsDir };
}

test('saveSchema: 源文件 + hash 产物 + manifest + 历史副本，bundle 指针不动', () => {
  const { projectDir, artifactsDir } = setup();
  try {
    const r1 = saveSchema(projectDir, artifactsDir, makeSchema(false));
    assert.ok(existsSync(join(projectDir, 'report.schema.json')));
    assert.ok(existsSync(join(artifactsDir, 'report', r1.schemaFile)));
    const m1 = JSON.parse(readFileSync(join(artifactsDir, 'report/manifest.json'), 'utf8'));
    assert.equal(m1.artifact.schema, `./${r1.schemaFile}`);
    assert.equal(m1.artifact.bundle, './bundle.aaaa.js'); // 零构建：bundle 不变

    const r2 = saveSchema(projectDir, artifactsDir, makeSchema(true));
    assert.notEqual(r2.hash, r1.hash);
    // 旧 hash 产物保留（回滚 = 秒级切 URL）
    assert.ok(existsSync(join(artifactsDir, 'report', r1.schemaFile)));
    assert.ok(r2.historyFile.startsWith('0002.'));
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('validateSchema: 拒绝非法 schema', () => {
  assert.throws(() => validateSchema(null), /对象/);
  assert.throws(() => validateSchema({ componentsMap: [], componentsTree: [] }), /empty/);
  assert.throws(() => validateSchema({
    componentsMap: [],
    componentsTree: [{ componentName: 'Page', children: [{ id: 'a', componentName: 'X' }, { id: 'a', componentName: 'Y' }] }],
  }), /重复/);
});
