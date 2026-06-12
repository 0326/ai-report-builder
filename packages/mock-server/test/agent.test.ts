/**
 * 端到端：空白基线 → 对话生成周报（走构建）→ 标注改环形（零构建直更新）→ 加漏斗块（自修复）→ 回滚。
 * 真 git 工作区 + 真 esbuild，验证双管线分流 / 自修复 / 版本时间线 / 回滚切 URL。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sandbox } from '../src/sandbox.ts';
import { runAgentTurn } from '../src/agent.ts';
import { seedFiles } from '../src/agent-scripts.ts';

const FIXTURES = resolve(fileURLToPath(new URL('.', import.meta.url)), '../fixtures/weekly-report');

let root: string;
let sandbox: Sandbox;

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'daf-sandbox-'));
  sandbox = new Sandbox({ work: join(root, 'project'), builds: join(root, 'builds') });
  const base = await sandbox.init(seedFiles());
  assert.ok(sandbox.hasBuild(base.hash), '空白基线应产出可预览产物');
});

after(() => rmSync(root, { recursive: true, force: true }));

const chat = (message: string, selection?: unknown) =>
  runAgentTurn(sandbox, FIXTURES, { message, selection: selection as never });

test('链路一·对话生成周报 → 走 esbuild 构建管线，一个 commit', async () => {
  const r = await chat('做一份周报：DAU 趋势 + 渠道占比，按区域筛选');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.pipeline, 'build');
  assert.equal(r.scriptId, 'weekly');
  // 双 diff：schema 大量新增 + 代码新增 TrendBlock
  assert.ok((r.diff?.schema.opCount ?? 0) > 10);
  assert.ok(r.diff?.code.some((f) => f.path.endsWith('TrendBlock/index.tsx') && f.status === 'added'));
  assert.match(r.previewUrl ?? '', /^\/preview\/\?build=/);
  assert.equal(sandbox.log().length, 2); // round0 + round1
});

test('链路二·标注改环形 + 联动 → 零构建直更新（schema 管线）', async () => {
  const pie = sandbox.readSchema().componentsTree[0].children.find((n) => n.componentName === 'PieChart');
  const r = await chat('改成环形图，点击某个渠道时联动趋势图只看该渠道', { nodeId: pie?.id, componentName: 'PieChart' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.pipeline, 'schema');
  assert.equal(r.diff?.code.length, 0, '声明性修改不应有代码 diff');
  const sum = r.diff?.schema.summary.join('\n') ?? '';
  assert.match(sum, /donut.*false → true/);
  assert.match(sum, /x-linkages/);
  // 落盘后 donut 确为 true
  const pie2 = sandbox.readSchema().componentsTree[0].children.find((n) => n.componentName === 'PieChart');
  assert.equal(pie2?.props?.donut, true);
});

test('链路一·加留存漏斗块 → 首版裸 fetch 被 lint 拦截，自修复后通过', async () => {
  const r = await chat('在报告里加一个留存漏斗块');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.pipeline, 'build');
  assert.equal(r.attempts?.length, 2, '应两次尝试（先错后对）');
  assert.equal(r.attempts?.[0].ok, false);
  assert.match(r.attempts?.[0].error ?? '', /fetch/);
  assert.equal(r.attempts?.[1].ok, true);
  // 只产生一个 commit（坏 attempt 已回退）
  assert.equal(sandbox.log().length, 4); // round0..round3
  // 新块源码进了 code diff
  assert.ok(r.diff?.code.some((f) => f.path.endsWith('FunnelBlock/index.tsx')));
});

test('§3.5 时间线 + 回滚：切到 round1 产物（秒级切 URL，零重建）', async () => {
  const log = sandbox.log();
  const round1 = log.find((c) => c.round === 1)!;
  assert.ok(round1, '应有 round1');
  const before = sandbox.head();
  const ptr = await sandbox.rollbackTo(round1.hash);
  assert.equal(ptr.hash, round1.hash);
  assert.match(ptr.previewUrl, /build=/);
  assert.ok(sandbox.hasBuild(round1.hash));
  assert.equal(sandbox.head(), before, '回滚只切产物指针，不动工作区 HEAD');
});

test('未命中剧本 → 友好兜底，不改工程', async () => {
  const before = sandbox.head();
  const r = await chat('今天天气怎么样');
  assert.equal(r.matched, false);
  assert.equal(r.ok, false);
  assert.equal(sandbox.head(), before);
});
