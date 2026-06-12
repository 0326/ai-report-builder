/**
 * mock-server（node:http 零依赖）：
 * - POST /api/daf/query        按 datasetId 返回 fixtures（region 过滤 + 100-300ms 延迟）
 * - GET  /api/schema           当前源 schema（host 可视编排的数据源）
 * - PUT  /api/schema           schema 直更新：写盘存新版本（零构建），返回新 schemaUrl
 * - GET  /preview/             预览 HTML（import-map 指向 vendor 产物 + 注入 __PREVIEW__）
 * - GET  /artifacts/*          产物静态服务（vendor / preview / report bundle+schema+manifest）
 * 启动时跑一次全量构建（真 esbuild），产物落 .artifacts/。
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAll, IMPORT_MAP, readSchema } from '@daf/report-scripts';
import { queryDataset, KNOWN_DATASETS } from './fixtures.ts';
import { saveSchema } from './schema-store.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url)); // packages/mock-server/src/
const REPO_ROOT = resolve(HERE, '../../..');
const ARTIFACTS_DIR = join(REPO_ROOT, '.artifacts');
const PROJECT_DIR = join(REPO_ROOT, 'apps/template-report');
const PORT = Number(process.env.MOCK_PORT ?? 5173); // 不读 PORT：避免外层启动器注入冲突

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readManifest(): { schema: string; bundle: string } {
  const m = JSON.parse(readFileSync(join(ARTIFACTS_DIR, 'report/manifest.json'), 'utf8'));
  // manifest.artifact.{schema,bundle} 形如 "./schema.<hash>.json"
  return {
    schema: String(m.artifact.schema).replace(/^\.\//, ''),
    bundle: String(m.artifact.bundle).replace(/^\.\//, ''),
  };
}

function previewHtml(): string {
  const { schema, bundle } = readManifest();
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>报告预览 · 周度经营报告</title>
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
    schemaUrl: '/artifacts/report/${schema}',
    bundleUrl: '/artifacts/report/${bundle}',
    apiBase: ''
  };
</script>
<script type="module" src="/artifacts/preview/preview.js"></script>
</body>
</html>`;
}

function send(res: import('node:http').ServerResponse, status: number, body: string | Buffer, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

async function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
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
    return send(res, 400, JSON.stringify({ error: 'invalid json' }), MIME['.json']);
  }
  const datasetId = payload.datasetId ?? '';
  if (!KNOWN_DATASETS.includes(datasetId)) {
    return send(res, 404, JSON.stringify({ error: `unknown datasetId: ${datasetId}` }), MIME['.json']);
  }
  await delay(100 + Math.floor(Math.random() * 200)); // 100–300ms
  const rows = queryDataset(datasetId, payload.params ?? {});
  send(res, 200, JSON.stringify({ rows, total: rows.length }), MIME['.json']);
}

async function handleSchemaPut(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
  let schema: unknown;
  try {
    schema = JSON.parse((await readBody(req)) || 'null');
  } catch {
    return send(res, 400, JSON.stringify({ error: 'invalid json' }), MIME['.json']);
  }
  try {
    const t0 = Date.now();
    const r = saveSchema(PROJECT_DIR, ARTIFACTS_DIR, schema as never);
    console.log(`  ✓ schema 直更新 → ${r.schemaFile}（零构建，${Date.now() - t0}ms）`);
    send(res, 200, JSON.stringify(r), MIME['.json']);
  } catch (e) {
    send(res, 400, JSON.stringify({ error: (e as Error).message }), MIME['.json']);
  }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === 'POST' && path === '/api/daf/query') return void handleQuery(req, res);
  if (req.method === 'GET' && path === '/api/schema') {
    return send(res, 200, JSON.stringify(readSchema(PROJECT_DIR)), MIME['.json']);
  }
  if (req.method === 'PUT' && path === '/api/schema') return void handleSchemaPut(req, res);
  if (req.method === 'GET' && path.startsWith('/artifacts/')) return void serveArtifact(res, path);
  if (req.method === 'GET' && (path === '/' || path === '/preview' || path === '/preview/')) {
    return send(res, 200, previewHtml(), MIME['.html']);
  }
  send(res, 404, `not found: ${req.method} ${path}`);
});

async function main() {
  console.log('› 构建产物（真 esbuild）…');
  const t0 = Date.now();
  const r = await buildAll(PROJECT_DIR, ARTIFACTS_DIR);
  console.log(`  ✓ 报告 ${r.report.bundleFile} · vendor ${Object.keys(r.vendor.bytes).length} 个 · ${Date.now() - t0}ms`);
  server.listen(PORT, () => {
    console.log(`\n  报告预览  →  http://localhost:${PORT}/preview/\n`);
  });
}

void main();
