/**
 * 真实 Agent 编排（链路一/二主链路，Claude 模型驱动）：
 * 对话 → tool use 多轮循环（读工程/查数/staged 写入）→ commit_round 走真实管线
 * （lint+esbuild 或 schema 直更新）→ 失败回喂自修复 → git commit → 双 diff + 预览 URL。
 *
 * 工具即治理面：模型只能通过 stage_schema / stage_file 改工程、通过 commit_round 提交，
 * lint 与 schema 校验在管线里强制执行 —— 与剧本 mock 共享同一 Sandbox / diff 设施。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ReportSchema } from '@daf/report-runtime/core';
import { materialMetas } from '@daf-materials/kit/meta';
import { streamMessage, type ContentBlock, type MessageParam, type ToolDef } from './claude.ts';
import { getLlmConfig } from './env.ts';
import { queryDataset, KNOWN_DATASETS } from './fixtures.ts';
import { validateSchema } from './schema-store.ts';
import { schemaDiff, summarizeOps, codeDiff } from './diff.ts';
import type { Sandbox } from './sandbox.ts';
import type { SelectionCtx } from './agent-scripts.ts';

/* ------------------------------ SSE 事件协议 ------------------------------ */

export type AgentEvent =
  | { t: 'text'; delta: string }
  | { t: 'thinking'; delta: string }
  | { t: 'tool'; name: string; detail: string }
  | { t: 'tool_result'; name: string; ok: boolean; detail: string }
  | { t: 'round'; result: RoundResult }
  | { t: 'done'; usage?: { input?: number; output?: number } }
  | { t: 'error'; message: string };

export interface RoundResult {
  ok: boolean;
  intent: string;
  pipeline: 'build' | 'schema';
  buildMs: number;
  commit: { hash: string; round: number | null; message: string };
  diff: {
    schema: { summary: string[]; destructive: boolean; opCount: number };
    code: Array<{ path: string; status: string; additions: number; deletions: number; lines: Array<{ kind: string; text: string }> }>;
  };
  previewUrl: string;
}

export type Emit = (ev: AgentEvent) => void;

/* ------------------------------ system prompt ------------------------------ */

const DATASET_DOC = `可用数据集（type 一律 'daf-query'，datasetId 取下表；params 支持 JSExpression 绑定 this.state.*）：
- metric_summary: 行 {dau,newUser,revenue}，单行汇总；params.region
- metric_dau: 行 {date,dau}，近 7 天；params.region, params.channel
- metric_channel: 行 {channel,uv}；params.region
- metric_detail: 行 {date,channel,uv,dau}；params.region
- metric_retention: 行 {stage,users}，留存漏斗 5 环节；params.region
region 取值: all/app/web/mini；channel 取值: all/app/web/mini/other`;

function materialsDoc(): string {
  const lines = materialMetas.map((m) => {
    const props = m.configurableProps.map((p) => `${p.name}:${p.type}`).join(', ');
    return `- ${m.componentName}（${m.title}）props{${props}}${m.dataProp ? `，数据入口 props.${m.dataProp}` : ''}；${m['x-ai'].summary}${m['x-ai'].useWhen ? `；适用: ${m['x-ai'].useWhen}` : ''}`;
  });
  return lines.join('\n');
}

function systemPrompt(): string {
  return `你是 DAF 智能报告搭建 Agent。你通过工具操作一个报告工程（report.schema.json + src/ 块代码），每轮修改最终成为一次 git commit，用户在预览里立刻看到效果。回复一律用中文，简洁、面向结果。

## 搭建协议（report.schema.json，LCE 兼容 + x- 平台扩展）
顶层: { "version":"1.0.0", "name":string, "componentsMap":[{componentName,package,exportName,version}], "componentsTree":[Page] }
Page: { "componentName":"Page", "props":{"title":string}, "x-layout":{"mode":"grid","cols":12}, "state":{...筛选默认值}, "dataSource":{"list":[DS]}, "x-filters":[Filter], "x-linkages":[Linkage], "children":[Node] }
DS: { "id":"ds_xxx", "type":"daf-query", "options":{"datasetId":string,"fields":[string],"params":{k:{"type":"JSExpression","value":"this.state.f_xxx"}}}, "x-trigger":"auto" }
Filter: { "id":"f_xxx", "label":string, "stateKey":"f_xxx", "valueType":"enum", "options":[{label,value}], "default":string }（每个 filter 必须在 Page.state 里有默认值）
Linkage: { "id":"lk_x", "source":"<nodeId>.<event>", "action":"setState", "target":"<stateKey>", "mapping":"payload.name" } 或 { "action":"custom", "handler":"src/blocks/Xxx#fnName" }
Node: { "id":"node_xxx"(全局唯一), "componentName":物料名或"AIBlock", "props":{...}, "title":string, "x-position":{x,y,w,h}(12列栅格,y 自上而下), "x-consumes":[dsId], "x-listens":[stateKey], "x-emits":[event] }
公共物料消费数据用 JSExpression: "data": {"type":"JSExpression","value":"this.dataSourceMap['ds_xxx'].data"}，并把 dsId 写进 x-consumes。

## 物料（componentsMap 的 package 一律 "@daf-materials/kit"，exportName=componentName）
${materialsDoc()}
- AIBlock（自定义代码块）package "@daf/report-runtime"，props.entry="blocks/Xxx"，源码放 src/blocks/Xxx/index.tsx；图表类需求优先用公共物料（零构建），只有公共物料表达不了的逻辑才写 AIBlock。

## 数据
${DATASET_DOC}
不确定数据形状时先 query_dataset 看样本。

## 自定义块代码（AIBlock）铁律 —— 违反会被 lint 拦截
- 取数唯一通道 runtime.data：const s = useSyncExternalStore((cb)=>runtime.data.watch('ds_x',cb), ()=>runtime.data.get('ds_x'))，s.rows 为行数组；dsId 必须 ∈ 该节点 x-consumes。严禁 fetch/XMLHttpRequest/WebSocket。
- 发事件用 props.onEmit?.('event', payload)，event 必须 ∈ x-emits。
- 组件: React 函数组件 default export，props 形如 { runtime, onEmit?, ...自定义 }；图表 import { LineChart, BarChart, PieChart } from '@daf-materials/kit'；类型 import type { BlockRuntime } from '@daf/report-runtime'。
- 相对导入必须带 .ts/.tsx 扩展名；不用 enum。

## 双管线（commit_round 的 pipeline 选择，影响用户等待时长）
- 声明性修改（props/标题/位置/增删公共物料节点/数据源/筛选/声明式联动）→ 只改 schema → pipeline="schema"（零构建，秒级）
- 涉及 src/ 代码（新增/修改 AIBlock）→ pipeline="build"（lint + esbuild，10s 级）

## 工作流
1. 先 read_project 了解现状（首轮必做）；2. 规划：先 schema 后代码；3. stage_schema / stage_file 落盘；4. commit_round 提交（一次用户请求 = 一次 commit）。
- commit_round 失败时：根据错误修正 staged 内容后重新 commit_round（最多再试 2 次），不要放弃。
- 用户消息若带【选区上下文】，修改聚焦该节点；改 schema 时务必保留与本次修改无关的一切字段（x- 字段、其他节点）。
- 最终回复包含：做了什么、选用的数据集/物料及理由、变更要点。不要贴大段 JSON。`;
}

/* ------------------------------ 工具定义 ------------------------------ */

const TOOLS: ToolDef[] = [
  {
    name: 'read_project',
    description: '读取工程现状：当前 report.schema.json 全文 + src/ 文件清单。每个会话开始或不确定现状时调用。',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'read_file',
    description: '读取工程内某个源码文件内容（如 src/blocks/TrendBlock/index.tsx）。',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: '相对工程根路径' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'query_dataset',
    description: '查询数据集样本（最多 8 行），用于确认字段形状后再写 schema。',
    input_schema: {
      type: 'object',
      properties: {
        datasetId: { type: 'string', enum: KNOWN_DATASETS },
        params: { type: 'object', description: '可选过滤参数，如 {"region":"app"}' },
      },
      required: ['datasetId'],
      additionalProperties: false,
    },
  },
  {
    name: 'stage_schema',
    description: '将完整的新 report.schema.json 写入工作区（未提交）。必须传全量 schema，保留所有与本次修改无关的字段。',
    input_schema: {
      type: 'object',
      properties: { schema: { type: 'object', description: '完整 ReportSchema JSON' } },
      required: ['schema'],
      additionalProperties: false,
    },
  },
  {
    name: 'stage_file',
    description: '将源码文件写入工作区（未提交），如自定义块 src/blocks/Xxx/index.tsx。',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '相对工程根路径，必须在 src/ 下' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'commit_round',
    description: '提交本轮 staged 修改并构建产物。pipeline="schema"（仅 schema 改动，零构建）或 "build"（含代码改动，lint+esbuild）。失败返回错误详情，请修复后重试。',
    input_schema: {
      type: 'object',
      properties: {
        intent: { type: 'string', description: '一句话意图，作为 commit message' },
        pipeline: { type: 'string', enum: ['schema', 'build'] },
      },
      required: ['intent', 'pipeline'],
      additionalProperties: false,
    },
  },
];

/* ------------------------------ 工具执行 ------------------------------ */

function listSrcFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(p.slice(root.length + 1));
    }
  };
  walk(join(root, 'src'));
  return out;
}

interface TurnState {
  committed: RoundResult | null;
  commitAttempts: number;
}

async function execTool(
  sandbox: Sandbox,
  state: TurnState,
  name: string,
  input: Record<string, unknown>,
): Promise<{ ok: boolean; result: string }> {
  switch (name) {
    case 'read_project': {
      const schema = readFileSync(join(sandbox.work, 'report.schema.json'), 'utf8');
      const files = listSrcFiles(sandbox.work);
      return { ok: true, result: `=== report.schema.json ===\n${schema}\n=== src/ 文件 ===\n${files.join('\n') || '(空)'}` };
    }
    case 'read_file': {
      const rel = String(input.path ?? '');
      if (rel.includes('..')) return { ok: false, result: '非法路径' };
      try {
        return { ok: true, result: readFileSync(join(sandbox.work, rel), 'utf8') };
      } catch {
        return { ok: false, result: `文件不存在: ${rel}` };
      }
    }
    case 'query_dataset': {
      const rows = queryDataset(String(input.datasetId ?? ''), (input.params as Record<string, unknown>) ?? {});
      return { ok: true, result: JSON.stringify({ rows: rows.slice(0, 8), total: rows.length }) };
    }
    case 'stage_schema': {
      try {
        validateSchema(input.schema);
      } catch (e) {
        return { ok: false, result: `schema 校验失败: ${(e as Error).message}` };
      }
      sandbox.writeSchema(input.schema as ReportSchema);
      return { ok: true, result: 'schema 已写入工作区（未提交）' };
    }
    case 'stage_file': {
      const rel = String(input.path ?? '');
      if (!rel.startsWith('src/') || rel.includes('..')) return { ok: false, result: '路径必须在 src/ 下' };
      sandbox.writeFile(rel, String(input.content ?? ''));
      return { ok: true, result: `${rel} 已写入工作区（未提交）` };
    }
    case 'commit_round':
      return commitRound(sandbox, state, input);
    default:
      return { ok: false, result: `未知工具: ${name}` };
  }
}

async function commitRound(
  sandbox: Sandbox,
  state: TurnState,
  input: Record<string, unknown>,
): Promise<{ ok: boolean; result: string }> {
  if (state.committed) return { ok: false, result: '本轮已提交过，请直接给出最终回复' };
  if (state.commitAttempts >= 3) return { ok: false, result: '重试次数已用尽，请向用户说明失败原因' };
  state.commitAttempts++;

  if (!sandbox.isDirty()) return { ok: false, result: '工作区无改动（先 stage_schema / stage_file）' };
  const pipeline = input.pipeline === 'schema' ? 'schema' : 'build';
  const intent = String(input.intent ?? '更新报告').slice(0, 120);

  try {
    validateSchema(sandbox.readSchema());
  } catch (e) {
    return { ok: false, result: `schema 校验失败: ${(e as Error).message}` };
  }

  const prevHead = sandbox.head();
  const prevSchema = sandbox.schemaAt(prevHead);
  const round = sandbox.log().length;
  const message = `round(${round}): ${intent} | packages: sandbox | type: ${pipeline === 'schema' ? 'schema' : 'code'}`;

  // 提交前记录改动文件（diff 用）
  const changed = sandbox
    .status()
    .filter((p) => p !== 'report.schema.json');

  const hash = sandbox.commit(message);
  const t0 = Date.now();
  try {
    await sandbox.build(hash, pipeline, prevHead);
  } catch (e) {
    // 撤销提交但保留工作区：模型只需修复出错的文件后重新 commit_round
    sandbox.undoLastCommitKeepWork();
    return { ok: false, result: `构建失败（提交已撤销，工作区改动仍保留，请修复后重新 commit_round）:\n${firstLines((e as Error).message, 12)}` };
  }

  const sDiff = schemaDiff(prevSchema, sandbox.readSchema());
  const cDiff = codeDiff(
    changed.map((path) => ({ path, prev: sandbox.fileAt(prevHead, path), next: sandbox.fileAt(hash, path) })),
  );
  sandbox.pruneBuilds();
  const pointer = sandbox.pointer(hash);

  state.committed = {
    ok: true,
    intent,
    pipeline,
    buildMs: Date.now() - t0,
    commit: { hash, round, message },
    diff: {
      schema: { summary: summarizeOps(sDiff.ops), destructive: sDiff.destructive, opCount: sDiff.ops.length },
      code: cDiff,
    },
    previewUrl: pointer.previewUrl,
  };
  return { ok: true, result: `已提交 round(${round}) ${hash.slice(0, 8)}，${pipeline === 'schema' ? '零构建直更新' : `构建 ${Date.now() - t0}ms`}，预览已就绪。请给出最终回复。` };
}

/* ------------------------------ 会话与主循环 ------------------------------ */

const sessions = new Map<string, MessageParam[]>();
let busy = false;

export function resetSession(sessionId: string): void {
  sessions.delete(sessionId);
}

interface ElementSel {
  selector?: string;
  tag?: string;
  text?: string;
  region?: string;
}

function selectionText(sel: (SelectionCtx & { element?: ElementSel; level?: string }) | null | undefined): string {
  if (!sel?.nodeId) return '';
  let out = `\n\n【选区上下文】用户在预览中选中了节点 ${sel.nodeId}（${sel.componentName ?? '?'}）`;
  if (sel.level === 'element' && sel.element) {
    const e = sel.element;
    out += `，且精确标注了块内元素：<${e.tag ?? '?'}>${e.text ? ` 文本="${e.text}"` : ''}${e.region ? `，位于块内 ${e.region} 区域` : ''}${e.selector ? `，路径 ${e.selector}` : ''}。修改应聚焦该元素对应的 props/字段/代码片段，而非整块重写`;
  }
  out += `：\n${JSON.stringify((sel as { schemaSlice?: unknown }).schemaSlice ?? sel, null, 1)}`;
  return out;
}

/** 把 assistant content 转回 API 回传格式（thinking 签名原样保留）。 */
function toParam(content: ContentBlock[]): Array<Record<string, unknown>> {
  return content.map((b) => ({ ...b }));
}

export async function runLlmTurn(
  sandbox: Sandbox,
  req: { sessionId: string; message: string; selection?: SelectionCtx | null },
  emit: Emit,
): Promise<void> {
  if (busy) {
    emit({ t: 'error', message: '上一轮还在执行中，请稍候' });
    return;
  }
  busy = true;
  const cfg = getLlmConfig();
  const state: TurnState = { committed: null, commitAttempts: 0 };
  const history = sessions.get(req.sessionId) ?? [];

  const userText = req.message + selectionText(req.selection);
  const messages: MessageParam[] = [...history, { role: 'user', content: userText }];

  try {
    for (let iter = 0; iter < 24; iter++) {
      const final = await streamMessage(
        {
          model: cfg.model,
          max_tokens: 16000,
          system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
          messages,
          tools: TOOLS,
          thinking: { type: 'adaptive', display: 'summarized' },
          output_config: { effort: 'high' },
        },
        cfg,
        {
          onText: (d) => emit({ t: 'text', delta: d }),
          onThinking: (d) => emit({ t: 'thinking', delta: d }),
        },
      );

      messages.push({ role: 'assistant', content: toParam(final.content) });

      if (final.stop_reason !== 'tool_use') {
        if (sandbox.isDirty()) sandbox.reset(); // 未提交的残留改动丢弃
        if (state.committed) emit({ t: 'round', result: state.committed });
        sessions.set(req.sessionId, messages);
        emit({ t: 'done' });
        return;
      }

      const results: Array<Record<string, unknown>> = [];
      for (const blk of final.content) {
        if (blk.type !== 'tool_use') continue;
        emit({ t: 'tool', name: blk.name, detail: toolDetail(blk.name, blk.input) });
        const r = await execTool(sandbox, state, blk.name, blk.input);
        emit({ t: 'tool_result', name: blk.name, ok: r.ok, detail: firstLines(r.result, 3) });
        results.push({
          type: 'tool_result',
          tool_use_id: blk.id,
          content: clip(r.result, 24000),
          ...(r.ok ? {} : { is_error: true }),
        });
      }
      messages.push({ role: 'user', content: results });
    }
    throw new Error('超过最大工具调用轮数（24）');
  } catch (e) {
    if (sandbox.isDirty()) sandbox.reset();
    emit({ t: 'error', message: (e as Error).message });
    sessions.set(req.sessionId, messages); // 保留上下文便于追问
  } finally {
    busy = false;
  }
}

function toolDetail(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'query_dataset': return `查询 ${input.datasetId}${input.params ? ' ' + JSON.stringify(input.params) : ''}`;
    case 'stage_schema': return '写入新 schema';
    case 'stage_file': return `写入 ${input.path}`;
    case 'commit_round': return `提交「${input.intent}」（${input.pipeline} 管线）`;
    case 'read_file': return `读取 ${input.path}`;
    default: return '读取工程现状';
  }
}

function firstLines(s: string, n: number): string {
  const lines = s.split('\n');
  return lines.slice(0, n).join('\n') + (lines.length > n ? ' …' : '');
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + `\n…[截断，共 ${s.length} 字符]` : s;
}
