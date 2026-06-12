/**
 * 浏览器预览 harness（构建为 preview.js，externalize 共享依赖经 import-map 解析）。
 * 职责：fetch schema → 动态 import 报告 bundle → 装配 runtime（dafQuery 走 mock-server）→ 渲染。
 * 搭建态（?designtime=1）额外动态加载 DesignTime SDK —— 运行态产物零开销；
 * schema 直更新 = 重 fetch schema → dispose 旧 runtime → 重建重渲染（不动 bundle）。
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { createReportRuntime, ReportRenderer, buildRegistry } from '@daf/report-runtime';
import type { QueryRequest, RuntimeKernel } from '@daf/report-runtime';
import { kitExports } from '@daf-materials/kit';

interface PreviewConfig {
  schemaUrl: string;
  bundleUrl: string;
  apiBase?: string;
}

declare global {
  interface Window {
    __PREVIEW__?: PreviewConfig;
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
  const designtime = new URLSearchParams(window.location.search).get('designtime') === '1';

  try {
    const bundleMod = await import(/* @vite-ignore */ cfg.bundleUrl) as {
      bundle: Record<string, never>;
      customHandlers: Record<string, never>;
    };
    const root = createRoot(mount);
    let kernel: RuntimeKernel | null = null;

    const boot = async (schemaUrl: string): Promise<void> => {
      const schema = await fetch(schemaUrl, { cache: 'no-store' }).then((r) => {
        if (!r.ok) throw new Error(`schema fetch failed: ${r.status}`);
        return r.json();
      });
      kernel?.dispose();
      kernel = await createReportRuntime({
        schema,
        env: designtime ? 'design' : 'preview',
        services: { dafQuery: (req) => dafQuery(req, apiBase) },
        customHandlers: bundleMod.customHandlers,
      });
      const registry = buildRegistry(schema.componentsMap, { '@daf-materials/kit': kitExports });
      root.render(createElement(ReportRenderer, { runtime: kernel, registry, bundle: bundleMod.bundle }));
    };

    let lastSchemaUrl = cfg.schemaUrl;
    await boot(lastSchemaUrl);

    if (designtime) {
      const sdk = await import('@daf/designtime-sdk');
      sdk.installDesigntimeSDK({
        getSchema: () => kernel!.ctx.schema,
        getKernel: () => kernel,
        reloadSchema: async (schemaUrl) => {
          if (schemaUrl) lastSchemaUrl = schemaUrl;
          await boot(lastSchemaUrl);
        },
      });
    }
  } catch (e) {
    mount.textContent = `预览加载失败：${(e as Error).message}`;
    throw e;
  }
}

void main();
