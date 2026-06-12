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
import { readFileSync } from 'node:fs';
import { join, resolve, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVendor, buildLceBundles, buildChatApp, IMPORT_MAP, deriveLceAssets } from '@daf/report-scripts';
import { materialMetas } from '@daf-materials/kit/meta';
import { queryDataset, KNOWN_DATASETS } from './fixtures.ts';
import { validateSchema } from './schema-store.ts';
import { Sandbox } from './sandbox.ts';
import { seedFiles } from './agent-scripts.ts';
import { runAgentTurn } from './agent.ts';
import { runLlmTurn, resetSession, type AgentEvent } from './llm-agent.ts';
import { getLlmConfig, saveLlmRuntimeConfig, resetLlmConfigCache } from './env.ts';
import type { ReportSchema } from '@daf/report-runtime/core';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const ARTIFACTS_DIR = join(REPO_ROOT, '.artifacts');
const FIXTURES_DIR = join(REPO_ROOT, 'packages/mock-server/fixtures/weekly-report');
const PORT = Number(process.env.MOCK_PORT ?? 5173);

const sandbox = new Sandbox({
  work: join(ARTIFACTS_DIR, 'sandbox/project'),
  builds: join(ARTIFACTS_DIR, 'sandbox/builds'),
});
/** 当前预览指针（缺省 build）；Agent / PUT 推进，回滚不动它。 */
let currentHead = '';

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function previewHtml(buildId: string): string {
  const dir = sandbox.buildDir(buildId);
  const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const schema = String(m.artifact.schema).replace(/^\.\//, '');
  const bundle = String(m.artifact.bundle).replace(/^\.\//, '');
  const base = `/artifacts/sandbox/builds/${buildId}`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>报告预览 · ${(m.name as string) ?? 'report'}</title>
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
    schemaUrl: '${base}/${schema}',
    bundleUrl: '${base}/${bundle}',
    apiBase: ''
  };
</script>
<script type="module" src="/artifacts/preview/preview.js"></script>
</body>
</html>`;
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
  if (!KNOWN_DATASETS.includes(datasetId)) {
    return sendJson(res, 404, { error: `unknown datasetId: ${datasetId}` });
  }
  await delay(100 + Math.floor(Math.random() * 200));
  const rows = queryDataset(datasetId, payload.params ?? {});
  sendJson(res, 200, { rows, total: rows.length });
}

/** PUT /api/schema：可视编排/拖拽保存 = 写沙箱 + 零构建直更新 + commit。 */
async function handleSchemaPut(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  let schema: ReportSchema;
  try {
    schema = await readJson<ReportSchema>(req);
    validateSchema(schema);
  } catch (e) {
    return sendJson(res, 400, { error: (e as Error).message });
  }
  try {
    const t0 = Date.now();
    const prevHead = currentHead;
    sandbox.writeSchema(schema);
    if (!sandbox.isDirty()) {
      return sendJson(res, 200, { ...sandbox.pointer(prevHead), unchanged: true });
    }
    const round = sandbox.log().length;
    const hash = sandbox.commit(`round(${round}): 可视编排保存 | packages: sandbox | type: schema`);
    const pointer = await sandbox.build(hash, 'schema', prevHead);
    currentHead = hash;
    console.log(`  ✓ schema 直更新 → ${hash.slice(0, 8)}（零构建，${Date.now() - t0}ms）`);
    sendJson(res, 200, { ...pointer, round, ms: Date.now() - t0 });
  } catch (e) {
    sandbox.reset();
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

  try {
    if (getLlmConfig().enabled) {
      await runLlmTurn(
        sandbox,
        { sessionId: body.sessionId ?? 'default', message: body.message, selection: body.selection as never },
        (ev) => {
          if (ev.t === 'round' && ev.result.ok) {
            currentHead = ev.result.commit.hash;
            console.log(`  ✓ Agent(${getLlmConfig().model}) ${ev.result.intent} → ${ev.result.commit.hash.slice(0, 8)}（${ev.result.pipeline}, ${ev.result.buildMs}ms）`);
          }
          emit(ev);
        },
      );
    } else {
      // 剧本回落：适配为同一 SSE 事件流
      const result = await runAgentTurn(sandbox, FIXTURES_DIR, { message: body.message, selection: body.selection as never });
      if (result.ok && result.commit) {
        currentHead = result.commit.hash;
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
  const nodes = sandbox.log().map((c) => ({
    hash: c.hash,
    short: c.hash.slice(0, 8),
    round: c.round,
    intent: c.intent,
    type: c.type,
    hasBuild: sandbox.hasBuild(c.hash),
    current: c.hash === currentHead,
  }));
  sendJson(res, 200, { nodes, head: currentHead });
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
    const pointer = await sandbox.rollbackTo(body.hash);
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
  const cur = getLlmConfig();
  const model = body.model || cur.model;
  const baseUrl = (body.baseUrl || cur.baseUrl).replace(/\/$/, '');
  const apiKey = body.apiKey || cur.apiKey;
  const authToken = body.authToken || cur.authToken;
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
  if (m === 'GET' && path === '/api/schema') return sendJson(res, 200, sandbox.readSchema());
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
    const buildId = url.searchParams.get('build') || currentHead;
    if (!sandbox.hasBuild(buildId)) return send(res, 404, `无此版本产物: ${buildId}`);
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

  console.log('› 初始化报告工程沙箱（git 工作区 + 空白基线）…');
  const t1 = Date.now();
  const base = await sandbox.init(seedFiles());
  currentHead = base.hash;
  console.log(`  ✓ 沙箱基线 ${base.hash.slice(0, 8)}（${Date.now() - t1}ms）`);

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
