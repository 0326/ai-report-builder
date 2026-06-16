/** 多报告管理：新建/切换/重命名/删除/持久化，各报告独立 git 沙箱。 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReportStore } from '../src/report-store.ts';

let root: string;

before(() => { root = mkdtempSync(join(tmpdir(), 'daf-reports-')); });
after(() => rmSync(root, { recursive: true, force: true }));

test('init 空库 → 建默认报告', async () => {
  const s = new ReportStore(root);
  await s.init();
  assert.equal(s.list().length, 1);
  assert.ok(s.current().sandbox.isInitialized(), '默认报告应有 git 工作区');
  assert.ok(s.current().sandbox.hasBuild(s.current().head), '默认报告应已构建');
});

test('新建 → 切为当前 + 独立工作区', async () => {
  const s = new ReportStore(root);
  await s.init();
  const a = s.current().meta.id;
  const b = await s.create('报告B');
  assert.equal(s.current().meta.id, b.meta.id);
  assert.notEqual(a, b.meta.id);
  // 独立性：写入 B 的 schema 不影响 A
  s.current().sandbox.writeSchema({ version: '9.9', componentsMap: [], componentsTree: [{ componentName: 'Page', children: [] }] } as never);
  s.open(a);
  assert.notEqual((s.current().sandbox.readSchema() as { version: string }).version, '9.9');
});

test('重命名 + 删除当前 → 自动切其他', async () => {
  const s = new ReportStore(root);
  await s.init();
  const b = await s.create('待删');
  s.rename(b.meta.id, '改名了');
  assert.ok(s.list().find((r) => r.id === b.meta.id)?.title === '改名了');
  const dir = join(root, b.meta.id);
  assert.ok(existsSync(dir));
  await s.remove(b.meta.id);
  assert.ok(!existsSync(dir), '删除应清掉工作区目录');
  assert.notEqual(s.current().meta.id, b.meta.id);
});

test('持久化：重建 store 恢复报告列表与当前指针', async () => {
  const s1 = new ReportStore(root);
  await s1.init();
  const c = await s1.create('持久化报告');
  const curId = s1.current().meta.id;
  assert.equal(curId, c.meta.id);

  const s2 = new ReportStore(root);
  await s2.init();
  assert.ok(s2.list().some((r) => r.title === '持久化报告'));
  assert.equal(s2.current().meta.id, curId, '恢复当前指针');
});
