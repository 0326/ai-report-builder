/**
 * llm-agent 全链路（无真实 key）：脚本化 stub 扮演模型 →
 * read_project → stage_schema + stage_file(裸 fetch，会被 lint 拦截) → commit_round 失败 →
 * 自修复 stage_file → commit_round 成功 → end_turn。验证 SSE 事件、git 提交、产物、自修复闭环。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Sandbox } from '../src/sandbox.ts';
import { seedFiles, SEED_SCHEMA } from '../src/agent-scripts.ts';
import { resetLlmConfigCache } from '../src/env.ts';
import { runLlmTurn, type AgentEvent } from '../src/llm-agent.ts';

type Ev = Record<string, unknown>;

const sse = (events: Ev[]) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');

let toolSeq = 0;
function toolUseMsg(tools: Array<{ name: string; input: Record<string, unknown> }>, text = ''): Ev[] {
  const out: Ev[] = [{ type: 'message_start', message: {} }];
  let idx = 0;
  if (text) {
    out.push(
      { type: 'content_block_start', index: idx, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index: idx },
    );
    idx++;
  }
  for (const t of tools) {
    const json = JSON.stringify(t.input);
    out.push(
      { type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id: `tu_${++toolSeq}`, name: t.name } },
      // 故意分两片，覆盖 partial_json 拼接
      { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: json.slice(0, 5) } },
      { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: json.slice(5) } },
      { type: 'content_block_stop', index: idx },
    );
    idx++;
  }
  out.push({ type: 'message_delta', delta: { stop_reason: 'tool_use' } }, { type: 'message_stop' });
  return out;
}

const endTurnMsg = (text: string): Ev[] => [
  { type: 'message_start', message: {} },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  { type: 'message_stop' },
];

/* ------------------------- 剧本：模型的五次响应 ------------------------- */

const BAD_CODE = `export default function TestBlock() {
  fetch('/api/daf/query');
  return null;
}
`;

const GOOD_CODE = `import { useSyncExternalStore } from 'react';
import { LineChart } from '@daf-materials/kit';
import type { BlockRuntime } from '@daf/report-runtime';

export default function TestBlock({ runtime }: { runtime: BlockRuntime }) {
  const s = useSyncExternalStore((cb) => runtime.data.watch('ds_dau', cb), () => runtime.data.get('ds_dau'));
  return <LineChart data={s.rows} xField="date" yField="dau" />;
}
`;

function newSchema() {
  const schema = structuredClone(SEED_SCHEMA) as Record<string, never> & typeof SEED_SCHEMA;
  const page = schema.componentsTree[0];
  page.dataSource = {
    list: [{
      id: 'ds_dau', type: 'daf-query',
      options: { datasetId: 'metric_dau', fields: ['date', 'dau'] },
      'x-trigger': 'auto',
    }],
  } as never;
  page.children.push({
    componentName: 'AIBlock', id: 'node_trend',
    props: { entry: 'blocks/TestBlock' }, title: '趋势',
    'x-position': { x: 0, y: 0, w: 8, h: 6 },
    'x-consumes': ['ds_dau'],
  } as never);
  return schema;
}

function scriptedResponses(): string[] {
  return [
    sse(toolUseMsg([{ name: 'read_project', input: {} }], '我先看下工程现状。')),
    sse(toolUseMsg([
      { name: 'stage_schema', input: { schema: newSchema() } },
      { name: 'stage_file', input: { path: 'src/blocks/TestBlock/index.tsx', content: BAD_CODE } },
      { name: 'commit_round', input: { intent: '加 DAU 趋势块', pipeline: 'build' } },
    ])),
    sse(toolUseMsg([
      { name: 'stage_file', input: { path: 'src/blocks/TestBlock/index.tsx', content: GOOD_CODE } },
      { name: 'commit_round', input: { intent: '加 DAU 趋势块', pipeline: 'build' } },
    ], '裸 fetch 被 lint 拦截了，改用 runtime.data 重试。')),
    sse(endTurnMsg('已为报告新增 DAU 趋势块（数据集 metric_dau，自定义 AIBlock + LineChart）。')),
  ];
}

/* ------------------------------- 测试 ------------------------------- */

let root: string;
let sandbox: Sandbox;
let api: Server;
let apiCalls = 0;

before(async () => {
  root = mkdtempSync(join(tmpdir(), 'daf-llm-'));
  sandbox = new Sandbox({ work: join(root, 'project'), builds: join(root, 'builds') });
  await sandbox.init(seedFiles());

  const responses = scriptedResponses();
  api = createServer((_req, res) => {
    const body = responses[Math.min(apiCalls++, responses.length - 1)];
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(body);
  });
  await new Promise<void>((r) => api.listen(0, r));
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.ANTHROPIC_BASE_URL = `http://localhost:${(api.address() as { port: number }).port}`;
  resetLlmConfigCache();
});

after(() => {
  api.close();
  rmSync(root, { recursive: true, force: true });
  delete process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
  resetLlmConfigCache();
});

test('真实 Agent 链路：tool loop + lint 拦截 + 自修复 + commit + 双 diff', async () => {
  const events: AgentEvent[] = [];
  await runLlmTurn(sandbox, { sessionId: 's1', message: '加一个 DAU 趋势块' }, (ev) => events.push(ev));

  // 1) 模型被调了 4 次（read → stage+commit失败 → 修复+commit成功 → 总结）
  assert.equal(apiCalls, 4);

  // 2) commit_round 先失败（lint 裸 fetch）后成功
  const commits = events.filter((e) => e.t === 'tool_result' && e.name === 'commit_round') as Array<{ ok: boolean; detail: string }>;
  assert.equal(commits.length, 2);
  assert.equal(commits[0].ok, false);
  assert.match(commits[0].detail, /构建失败/);
  assert.equal(commits[1].ok, true);

  // 3) round 事件：build 管线 + 双 diff（schema 新增节点 + 代码新增文件）
  const round = events.find((e) => e.t === 'round') as Extract<AgentEvent, { t: 'round' }> | undefined;
  assert.ok(round?.result.ok, 'round 应成功');
  assert.equal(round!.result.pipeline, 'build');
  assert.ok(round!.result.diff.schema.opCount > 0);
  assert.ok(round!.result.diff.code.some((f) => f.path.endsWith('TestBlock/index.tsx') && f.status === 'added'));
  assert.match(round!.result.previewUrl, /^\/preview\/\?build=/);

  // 4) 工程落地：1 个新 commit（坏 attempt 已回退），代码是修复后的版本
  assert.equal(sandbox.log().length, 2);
  const code = readFileSync(join(sandbox.work, 'src/blocks/TestBlock/index.tsx'), 'utf8');
  assert.match(code, /runtime\.data\.watch/);
  assert.ok(!code.includes("fetch('"));

  // 5) 流式文本与完成事件
  const text = events.filter((e) => e.t === 'text').map((e) => (e as { delta: string }).delta).join('');
  assert.match(text, /DAU 趋势块/);
  assert.ok(events.some((e) => e.t === 'done'));
});

test('多轮会话：历史保留（同 sessionId 第二轮 messages 包含上一轮）', async () => {
  // stub 永远回 end_turn 文本；只验证不报错且 done
  const events: AgentEvent[] = [];
  await runLlmTurn(sandbox, { sessionId: 's1', message: '谢谢' }, (ev) => events.push(ev));
  assert.ok(events.some((e) => e.t === 'done'));
});
