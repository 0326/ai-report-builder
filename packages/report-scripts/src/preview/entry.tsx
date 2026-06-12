/**
 * 浏览器预览 harness（构建为 preview.js，externalize 共享依赖经 import-map 解析）。
 * 职责：fetch schema → 动态 import 报告 bundle → 装配 runtime（dafQuery 走 mock-server）→ 渲染。
 * 这就是"schema 运行时 fetch、产物分离部署"的运行侧体现。
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createReportRuntime, ReportRenderer, buildRegistry } from '@daf/report-runtime';
import type { QueryRequest } from '@daf/report-runtime';
import { kitExports } from '@daf-materials/kit';

interface PreviewConfig {
  schemaUrl: string;
  bundleUrl: string;
  apiBase?: string;
}

declare global {
  interface Window {
    __PREVIEW__?: PreviewConfig;
    __DAF_RELOAD__?: () => Promise<void>;
  }
}

async function dafQuery(req: QueryRequest, apiBase: string) {
  const res = await fetch(`${apiBase}/api/daf/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ datasetId: req.datasetId, fields: req.fields, params: req.params }),
    signal: req.signal,
  });
  if (!res.ok) throw new Error(`daf query failed: ${res.status}`);
  return res.json() as Promise<{ rows: Array<Record<string, unknown>>; total?: number }>;
}

async function main() {
  const cfg = window.__PREVIEW__;
  const mount = document.getElementById('root')!;
  if (!cfg) {
    mount.textContent = '缺少预览配置 window.__PREVIEW__';
    return;
  }
  const apiBase = cfg.apiBase ?? '';

  try {
    const [schema, bundleMod] = await Promise.all([
      fetch(cfg.schemaUrl).then((r) => r.json()),
      import(/* @vite-ignore */ cfg.bundleUrl),
    ]);

    const runtime = await createReportRuntime({
      schema,
      env: 'preview',
      services: { dafQuery: (req) => dafQuery(req, apiBase) },
      customHandlers: bundleMod.customHandlers,
    });

    const registry = buildRegistry(schema.componentsMap, { '@daf-materials/kit': kitExports });
    const root = createRoot(mount);
    root.render(createElement(ReportRenderer, { runtime, registry, bundle: bundleMod.bundle }));
  } catch (e) {
    mount.textContent = `预览加载失败：${(e as Error).message}`;
    throw e;
  }
}

void main();
