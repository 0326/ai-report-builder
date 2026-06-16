/**
 * mock-server（node:http 零依赖）。第 5 轮起报告工程 = 一个 git 沙箱工作区（Sandbox），
 * 一切修改（Agent / 可视编排保存 / 拖拽）都落成 commit，产物按 commit hash 缓存。
 *
 * - POST /api/daf/query        按 datasetId 返回 fixtures（region/channel 过滤 + 100-300ms 延迟）
 * - GET  /api/schema           当前工作区 schema（设计器导入源）
 * - PUT  /api/schema           可视编排保存：写沙箱 + 零构建直更新 + commit，返回新预览 URL
 * - POST /api/agent/chat       对话搭建（链路一）：意图匹配 → 落盘 → lint/构建（自修复）→ commit → 双 diff
 * - GET  /api/timeline         版本时间线（git log + 当前指针 + 产物可用性）
 * - POST /api/timeline/checkout 回滚到某 commit 的产物（秒级切 URL）
 * - GET  /api/lce/assets       LCE 物料 assets（materialMetas 派生）
 * - GET  /preview/?build=<h>   预览 HTML（指定 commit 产物；缺省取当前指针）
 * - GET  /artifacts/*          产物静态服务（vendor / preview harness / sandbox builds）
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVendor, buildLceBundles, buildChatApp, IMPORT_MAP, deriveLceAssets } from '@daf/report-scripts';
import { materialMetas } from '@daf-materials/kit/meta';
import {
  queryDataset, knownDatasetIds, listDatasets, previewDataset, importDataset, deleteDataset,
} from './datasets.ts';
import { toDatasetId } from './csv.ts';
import { publishReport, listPublished, queryPublished } from './publish.ts';
import { normalizeDataBindings } from './normalize.ts';
import { validateSchema } from './schema-store.ts';
import { runAgentTurn } from './agent.ts';
import { runLlmTurn, resetSession, type AgentEvent } from './llm-agent.ts';
import { getLlmConfig, saveLlmRuntimeConfig, resetLlmConfigCache } from './env.ts';
import type { ReportSchema } from '@daf/report-runtime/core';

import { ReportStore } from './report-store.ts';
import { relative } from 'node:path';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const ARTIFACTS_DIR = join(REPO_ROOT, '.artifacts');
const PUBLISHED_DIR = join(ARTIFACTS_DIR, 'published');
const SANDBOX_ROOT = join(ARTIFACTS_DIR, 'sandbox');
const FIXTURES_DIR = join(REPO_ROOT, 'packages/mock-server/fixtures/weekly-report');
const PORT = Number(process.env.MOCK_PORT ?? 5173);

/** 多报告：每报告独立 git 沙箱 + 产物；所有链路作用于当前报告。 */
const store = new ReportStore(SANDBOX_ROOT);
const cur = () => store.current();

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function renderHtml(opts: { title: string; base: string; schema: string; bundle: string; queryUrl: string }): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${opts.title}</title>
<script type="importmap">${JSON.stringify({ imports: IMPORT_MAP })}</script>
<style>
  html, body, #root { height: 100%; margin: 0; }
  body { background: #f5f6f7; font-family: system-ui, -apple-system, "PingFang SC", sans-serif; }
  #root { box-sizing: border-box; }
  .boot { display: grid; place-items: center; height: 100%; color: #8f959e; }
</style>
</head>
<body>
<div id="root"><div class="boot">报告加载中…</div></div>
<script>
  window.__PREVIEW__ = {
    schemaUrl: '${opts.base}/${opts.schema}',
    bundleUrl: '${opts.base}/${opts.bundle}',
    apiBase: '',
    queryUrl: '${opts.queryUrl}'
  };
</script>
<script type="module" src="/artifacts/preview/preview.js"></script>
</body>
</html>`;
}

function previewHtml(buildId: string): string {
  const dir = cur().sandbox.buildDir(buildId);
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  return renderHtml({
    title: `报告预览 · ${(m.name as string) ?? 'report'}`,
    base: `/artifacts/${relative(ARTIFACTS_DIR, dir)}`,
    schema: String(m.artifact.schema).replace(/^\.\//, ''),
    bundle: String(m.artifact.bundle).replace(/^\.\//, ''),
    queryUrl: '/api/daf/query',
  });
}

/** 发布产物页面：指向冻结的 published/<id>/，数据查询走发布作用域端点（快照）。 */
function publishedHtml(id: string): string {
  const m = JSON.parse(readFileSync(join(PUBLISHED_DIR, id, 'manifest.json'), 'utf8'));
  return renderHtml({
    title: `${(m.name as string) ?? '报告'} · 已发布`,
    base: `/artifacts/published/${id}`,
    schema: String(m.artifact.schema).replace(/^\.\//, ''),
    bundle: String(m.artifact.bundle).replace(/^\.\//, ''),
    queryUrl: `/api/published/${id}/query`,
  });
}

/** AI 搭建工作台（React 18 + Ant Design X，esbuild 产物；左对话右预览，标注直连同源预览 iframe）。 */
function chatHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AI 报告搭建</title>
<script type="importmap">${JSON.stringify({ imports: IMPORT_MAP })}</script>
<style>
  html, body, #root { height: 100%; margin: 0; }
  body { font-family: system-ui, -apple-system, "PingFang SC", sans-serif; background: #fff; }
</style>
</head>
<body>
<div id="root"></div>
<script type="module" src="/artifacts/chat/chat.js"></script>
</body>
</html>`;
}

function send(res: import('node:http').ServerResponse, status: number, body: string | Buffer, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

const sendJson = (res: import('node:http').ServerResponse, status: number, obj: unknown) =>
  send(res, status, JSON.stringify(obj), MIME['.json']);

async function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson<T>(req: import('node:http').IncomingMessage): Promise<T> {
  return JSON.parse((await readBody(req)) || 'null') as T;
}

async function serveArtifact(res: import('node:http').ServerResponse, urlPath: string) {
  const rel = normalize(decodeURIComponent(urlPath.replace(/^\/artifacts\//, ''))).replace(/^(\.\.[/\\])+/, '');
  const filePath = join(ARTIFACTS_DIR, rel);
  if (!filePath.startsWith(ARTIFACTS_DIR)) return send(res, 403, 'forbidden');
  try {
    const st = await stat(filePath);
    if (!st.isFile()) return send(res, 404, 'not found');
    const buf = await readFile(filePath);
    send(res, 200, buf, MIME[extname(filePath)] ?? 'application/octet-stream');
  } catch {
    send(res, 404, `artifact not found: ${rel}`);
  }
}

async function handleQuery(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  let payload: { datasetId?: string; params?: Record<string, unknown> };
  try {
    payload = JSON.parse((await readBody(req)) || '{}');
  } catch {
    return sendJson(res, 400, { error: 'invalid json' });
  }
  const datasetId = payload.datasetId ?? '';
  if (!knownDatasetIds().includes(datasetId)) {
    return sendJson(res, 404, { error: `unknown datasetId: ${datasetId}` });
  }
  await delay(80 + Math.floor(Math.random() * 160));
  const rows = queryDataset(datasetId, payload.params ?? {});
  sendJson(res, 200, { rows, total: rows.length });
}

/** POST /api/datasets：上传 CSV/TSV（body=原始文本，?name= 文件名）→ 解析落盘 → 返回 meta。 */
async function handleDatasetUpload(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, url: URL) {
  const raw = await readBody(req);
  if (!raw.trim()) return sendJson(res, 400, { error: '空文件' });
  const name = url.searchParams.get('name') ?? 'dataset';
  const title = url.searchParams.get('title') ?? name.replace(/\.[a-z]+$/i, '');
  try {
    let id = toDatasetId(name);
    // id 冲突则追加序号
    const existing = new Set(listDatasets().map((d) => d.id));
    if (existing.has(id)) {
      let n = 2;
      while (existing.has(`${id}_${n}`)) n++;
      id = `${id}_${n}`;
    }
    const meta = importDataset(raw, { id, title });
    console.log(`  ✓ 数据集导入 ${id}（${meta.rowCount} 行 · ${meta.fields.length} 列）`);
    sendJson(res, 200, meta);
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
  }
}

/** POST /api/reports：新建空白报告并切为当前。 */
async function handleReportCreate(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  let body: { title?: string };
  try { body = (await readJson(req)) ?? {}; } catch { body = {}; }
  const r = await store.create((body.title ?? '').slice(0, 60) || '未命名报告');
  console.log(`  ✓ 新建报告 ${r.meta.id}「${r.meta.title}」`);
  sendJson(res, 200, { id: r.meta.id, title: r.meta.title });
}

/** POST /api/publish：冻结当前报告为可分享产物（bundle+schema+上传数据快照）。 */
async function handlePublish(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  let body: { title?: string };
  try {
    body = (await readJson(req)) ?? {};
  } catch {
    body = {};
  }
  try {
    const { sandbox, head, meta } = cur();
    if (!sandbox.hasBuild(head)) return sendJson(res, 400, { error: '当前报告尚未构建' });
    const schema = sandbox.readSchema();
    const title = body.title || meta.title || (schema as { name?: string }).name || '未命名报告';
    const rec = publishReport({
      buildDir: sandbox.buildDir(head),
      publishedDir: PUBLISHED_DIR,
      hash: head,
      schema,
      title,
      createdAt: Date.now(),
    });
    console.log(`  ✓ 报告发布 ${rec.id}（冻结数据集 ${rec.datasets.length} 个）`);
    sendJson(res, 200, { ...rec, url: `/published/${rec.id}/` });
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
  }
}

/** PUT /api/schema：可视编排/拖拽保存 = 写沙箱 + 零构建直更新 + commit。 */
async function handleSchemaPut(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  let schema: ReportSchema;
  try {
    schema = await readJson<ReportSchema>(req);
    // 可视编排数据绑定归一化：从 data JSExpression 反推 x-consumes + 自动补 dataSource
    const norm = normalizeDataBindings(schema, knownDatasetIds());
    schema = norm.schema;
    if (norm.addedDataSources.length) console.log(`  ↳ 自动补数据源 ${norm.addedDataSources.join(', ')}`);
    validateSchema(schema);
  } catch (e) {
    return sendJson(res, 400, { error: (e as Error).message });
  }
  try {
    const t0 = Date.now();
    const c = cur();
    const sandbox = c.sandbox;
    const prevHead = c.head;
    sandbox.writeSchema(schema);
    if (!sandbox.isDirty()) {
      return sendJson(res, 200, { ...sandbox.pointer(prevHead), unchanged: true });
    }
    const round = sandbox.log().length;
    const hash = sandbox.commit(`round(${round}): 可视编排保存 | packages: sandbox | type: schema`);
    const pointer = await sandbox.build(hash, 'schema', prevHead);
    c.head = hash;
    store.touch();
    console.log(`  ✓ schema 直更新 → ${hash.slice(0, 8)}（零构建，${Date.now() - t0}ms）`);
    sendJson(res, 200, { ...pointer, round, ms: Date.now() - t0 });
  } catch (e) {
    cur().sandbox.reset();
    sendJson(res, 400, { error: (e as Error).message });
  }
}

/**
 * 对话搭建（SSE 流式）：凭证就绪走真实 Claude Agent（llm-agent），
 * 否则回落剧本 mock（同一事件协议，UI 无差别）。
 */
async function handleAgentChat(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  let body: { message?: string; selection?: unknown; sessionId?: string };
  try {
    body = await readJson(req);
  } catch {
    return sendJson(res, 400, { error: 'invalid json' });
  }
  if (!body?.message) return sendJson(res, 400, { error: '缺少 message' });

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  });
  const emit = (ev: AgentEvent) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  const c = cur();
  const sandbox = c.sandbox;

  try {
    if (getLlmConfig().enabled) {
      await runLlmTurn(
        sandbox,
        { sessionId: `${c.meta.id}:${body.sessionId ?? 'default'}`, message: body.message, selection: body.selection as never },
        (ev) => {
          if (ev.t === 'round' && ev.result.ok) {
            c.head = ev.result.commit.hash;
            store.touch();
            console.log(`  ✓ Agent(${getLlmConfig().model}) ${ev.result.intent} → ${ev.result.commit.hash.slice(0, 8)}（${ev.result.pipeline}, ${ev.result.buildMs}ms）`);
          }
          emit(ev);
        },
      );
    } else {
      // 剧本回落：适配为同一 SSE 事件流
      const result = await runAgentTurn(sandbox, FIXTURES_DIR, { message: body.message, selection: body.selection as never });
      if (result.ok && result.commit) {
        c.head = result.commit.hash;
        store.touch();
        console.log(`  ✓ Agent(剧本) ${result.intent} → ${result.commit.hash.slice(0, 8)}（${result.pipeline}, ${result.buildMs ?? 0}ms）`);
        emit({ t: 'text', delta: result.reply });
        emit({
          t: 'round',
          result: {
            ok: true,
            intent: result.intent ?? '',
            pipeline: result.pipeline ?? 'schema',
            buildMs: result.buildMs ?? 0,
            commit: { ...result.commit, message: '' },
            diff: (result.diff ?? { schema: { summary: [], destructive: false, opCount: 0 }, code: [] }) as never,
            previewUrl: result.previewUrl ?? '/preview/',
          },
        });
      } else {
        emit({ t: 'text', delta: result.reply });
      }
      emit({ t: 'done' });
    }
  } catch (e) {
    sandbox.reset();
    emit({ t: 'error', message: (e as Error).message });
  }
  res.end();
}

function handleTimeline(res: import('node:http').ServerResponse) {
  const { sandbox, head } = cur();
  const nodes = sandbox.log().map((c) => ({
    hash: c.hash,
    short: c.hash.slice(0, 8),
    round: c.round,
    intent: c.intent,
    type: c.type,
    hasBuild: sandbox.hasBuild(c.hash),
    current: c.hash === head,
  }));
  sendJson(res, 200, { nodes, head });
}

async function handleCheckout(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  let body: { hash?: string };
  try {
    body = await readJson(req);
  } catch {
    return sendJson(res, 400, { error: 'invalid json' });
  }
  if (!body?.hash) return sendJson(res, 400, { error: '缺少 hash' });
  try {
    const t0 = Date.now();
    const pointer = await cur().sandbox.rollbackTo(body.hash);
    console.log(`  ↩ 回滚预览 → ${pointer.hash.slice(0, 8)}（切 URL，${Date.now() - t0}ms）`);
    sendJson(res, 200, { ...pointer, ms: Date.now() - t0 });
  } catch (e) {
    sendJson(res, 400, { error: (e as Error).message });
  }
}

/**
 * 测试 LLM 连接（零成本）：GET {baseUrl}/v1/models/{model} —— 同时验证凭证与模型 id。
 * body 可带临时配置（未保存的表单值），缺省用当前生效配置。
 */
async function handleLlmTest(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  let body: { model?: string; apiKey?: string; authToken?: string; baseUrl?: string };
  try {
    body = (await readJson(req)) ?? {};
  } catch {
    return sendJson(res, 400, { error: 'invalid json' });
  }
  const lc = getLlmConfig();
  const model = body.model || lc.model;
  const baseUrl = (body.baseUrl || lc.baseUrl).replace(/\/$/, '');
  const apiKey = body.apiKey || lc.apiKey;
  const authToken = body.authToken || lc.authToken;
  if (!apiKey && !authToken) return sendJson(res, 200, { ok: false, error: '未配置 API Key / Token' });

  const headers: Record<string, string> = { 'anthropic-version': '2023-06-01' };
  if (authToken) {
    headers['authorization'] = `Bearer ${authToken}`;
    headers['anthropic-beta'] = 'oauth-2025-04-20';
  } else if (apiKey) {
    headers['x-api-key'] = apiKey;
  }
  try {
    const r = await fetch(`${baseUrl}/v1/models/${encodeURIComponent(model)}`, { headers, signal: AbortSignal.timeout(10000) });
    if (r.ok) {
      const info = (await r.json()) as { display_name?: string };
      return sendJson(res, 200, { ok: true, model, displayName: info.display_name ?? model });
    }
    const text = await r.text().catch(() => '');
    const hint = r.status === 401 ? '凭证无效' : r.status === 404 ? `模型 id 不存在: ${model}` : `HTTP ${r.status}`;
    return sendJson(res, 200, { ok: false, error: `${hint}${text ? ` · ${text.slice(0, 160)}` : ''}` });
  } catch (e) {
    return sendJson(res, 200, { ok: false, error: `连接失败: ${(e as Error).message}` });
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const m = req.method;

  if (m === 'POST' && path === '/api/daf/query') return void handleQuery(req, res);
  if (m === 'GET' && path === '/api/datasets') return sendJson(res, 200, { datasets: listDatasets() });
  if (m === 'POST' && path === '/api/datasets') return void handleDatasetUpload(req, res, url);
  if (m === 'GET' && path.startsWith('/api/datasets/') && path.endsWith('/preview')) {
    const id = decodeURIComponent(path.slice('/api/datasets/'.length, -'/preview'.length));
    const p = previewDataset(id);
    return p ? sendJson(res, 200, p) : sendJson(res, 404, { error: `未知数据集: ${id}` });
  }
  if (m === 'DELETE' && path.startsWith('/api/datasets/')) {
    const id = decodeURIComponent(path.slice('/api/datasets/'.length));
    return sendJson(res, 200, { ok: deleteDataset(id) });
  }
  if (m === 'GET' && path === '/api/schema') return sendJson(res, 200, cur().sandbox.readSchema());
  // 多报告管理
  if (m === 'GET' && path === '/api/reports') return sendJson(res, 200, { reports: store.list() });
  if (m === 'POST' && path === '/api/reports') return void handleReportCreate(req, res);
  if (m === 'POST' && /^\/api\/reports\/[^/]+\/open$/.test(path)) {
    const id = path.split('/')[3];
    try { store.open(id); return sendJson(res, 200, { ok: true, current: id }); }
    catch (e) { return sendJson(res, 400, { error: (e as Error).message }); }
  }
  if (m === 'PUT' && /^\/api\/reports\/[^/]+$/.test(path)) {
    const id = path.split('/')[3];
    return void readJson<{ title?: string }>(req).then((b) => {
      try { store.rename(id, (b?.title ?? '').slice(0, 60) || '未命名报告'); sendJson(res, 200, { ok: true }); }
      catch (e) { sendJson(res, 400, { error: (e as Error).message }); }
    }).catch(() => sendJson(res, 400, { error: 'invalid json' }));
  }
  if (m === 'DELETE' && /^\/api\/reports\/[^/]+$/.test(path)) {
    const id = path.split('/')[3];
    return void store.remove(id).then(() => sendJson(res, 200, { ok: true, current: store.current().meta.id }));
  }
  if (m === 'PUT' && path === '/api/schema') return void handleSchemaPut(req, res);
  if (m === 'POST' && path === '/api/agent/chat') return void handleAgentChat(req, res);
  if (m === 'GET' && path === '/api/agent/config') {
    const cfg = getLlmConfig();
    return sendJson(res, 200, { llm: cfg.enabled, model: cfg.enabled ? cfg.model : null });
  }
  if (m === 'GET' && path === '/api/agent/llm-config') {
    const cfg = getLlmConfig();
    return sendJson(res, 200, {
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      hasKey: Boolean(cfg.apiKey),
      hasToken: Boolean(cfg.authToken),
      enabled: cfg.enabled,
      source: cfg.source,
    });
  }
  if (m === 'PUT' && path === '/api/agent/llm-config') {
    return void readJson<{ model?: string; apiKey?: string; authToken?: string; baseUrl?: string }>(req)
      .then((b) => {
        saveLlmRuntimeConfig(b ?? {});
        resetLlmConfigCache();
        const cfg = getLlmConfig();
        console.log(`  ⚙ LLM 配置已更新：${cfg.enabled ? cfg.model : '未配置凭证（剧本模式）'}`);
        sendJson(res, 200, { ok: true, enabled: cfg.enabled, model: cfg.model });
      })
      .catch(() => sendJson(res, 400, { error: 'invalid json' }));
  }
  if (m === 'POST' && path === '/api/agent/llm-test') return void handleLlmTest(req, res);
  if (m === 'POST' && path === '/api/agent/reset') {
    return void readJson<{ sessionId?: string }>(req)
      .then((b) => {
        resetSession(b?.sessionId ?? 'default');
        sendJson(res, 200, { ok: true });
      })
      .catch(() => sendJson(res, 400, { error: 'invalid json' }));
  }
  if (m === 'GET' && (path === '/chat' || path === '/chat/')) {
    return send(res, 200, chatHtml(), MIME['.html']);
  }
  // 发布
  if (m === 'POST' && path === '/api/publish') return void handlePublish(req, res);
  if (m === 'GET' && path === '/api/published') {
    return sendJson(res, 200, { published: listPublished(PUBLISHED_DIR).map((r) => ({ ...r, url: `/published/${r.id}/` })) });
  }
  if (m === 'POST' && /^\/api\/published\/[^/]+\/query$/.test(path)) {
    const id = path.split('/')[3];
    return void (async () => {
      let payload: { datasetId?: string; params?: Record<string, unknown> };
      try { payload = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, { error: 'invalid json' }); }
      await delay(60 + Math.floor(Math.random() * 120));
      const rows = queryPublished(PUBLISHED_DIR, id, payload.datasetId ?? '', payload.params ?? {});
      if (rows == null) return sendJson(res, 404, { error: `发布产物无此数据集快照: ${payload.datasetId}` });
      sendJson(res, 200, { rows, total: rows.length });
    })();
  }
  if (m === 'GET' && /^\/published\/[^/]+\/?$/.test(path)) {
    const id = path.split('/')[2];
    if (!existsSync(join(PUBLISHED_DIR, id, 'manifest.json'))) return send(res, 404, `发布产物不存在: ${id}`);
    return send(res, 200, publishedHtml(id), MIME['.html']);
  }
  if (m === 'GET' && path === '/api/timeline') return handleTimeline(res);
  if (m === 'POST' && path === '/api/timeline/checkout') return void handleCheckout(req, res);
  if (m === 'GET' && path === '/api/lce/assets') {
    const assets = deriveLceAssets(materialMetas, {
      materialsUrl: '/artifacts/lce/materials.umd.js',
      runtimeDesignUrl: '/artifacts/lce/runtime-design.umd.js',
    });
    return sendJson(res, 200, assets);
  }
  if (m === 'GET' && path.startsWith('/artifacts/')) return void serveArtifact(res, path);
  if (m === 'GET' && (path === '/' || path === '/preview' || path === '/preview/')) {
    const buildId = url.searchParams.get('build') || cur().head;
    if (!cur().sandbox.hasBuild(buildId)) return send(res, 404, `无此版本产物: ${buildId}`);
    return send(res, 200, previewHtml(buildId), MIME['.html']);
  }
  send(res, 404, `not found: ${m} ${path}`);
});

async function main() {
  console.log('› 构建共享依赖 vendor + 预览 harness + LCE 物料 UMD + 对话工作台（真 esbuild）…');
  const t0 = Date.now();
  await buildVendor(ARTIFACTS_DIR);
  await buildLceBundles(ARTIFACTS_DIR);
  const chat = await buildChatApp(ARTIFACTS_DIR);
  console.log(`  ✓ vendor/preview/lce/chat 就绪（${Date.now() - t0}ms，chat.js ${(chat.bytes / 1024 / 1024).toFixed(1)}MB）`);

  console.log('› 初始化报告库（多报告 git 工作区）…');
  const t1 = Date.now();
  await store.init();
  console.log(`  ✓ 报告库就绪：${store.list().length} 个报告，当前「${cur().meta.title}」（${Date.now() - t1}ms）`);

  const llm = getLlmConfig();
  server.listen(PORT, () => {
    console.log(`\n  AI 搭建工作台  →  http://localhost:${PORT}/chat/`);
    console.log(`  报告预览      →  http://localhost:${PORT}/preview/`);
    console.log(
      llm.enabled
        ? `  Agent: 真实模型 ${llm.model}（${llm.authToken ? 'OAuth token' : 'API key'}）\n`
        : `  Agent: 剧本模式 —— 在仓库根 .env 写入 ANTHROPIC_API_KEY=sk-… 后重启即接入真实模型\n`,
    );
  });
}

void main();
