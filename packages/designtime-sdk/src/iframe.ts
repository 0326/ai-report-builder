/**
 * DesignTime SDK（iframe 侧）：仅搭建态加载（预览 harness 按 ?designtime=1 动态 import），
 * 运行态产物零开销。块级定位基于渲染器注入的 data-node-id。
 */
import type { RuntimeKernel, ReportSchema } from '@daf/report-runtime/core';
import { findNode } from '@daf/report-runtime/core';
import type { DataRuntime, StateRuntime } from '@daf/report-runtime/core';
import { Bridge, windowEndpoint } from './bridge.ts';
import {
  BRIDGE_VERSION, M_ENABLE, M_HIGHLIGHT, M_GET_SCHEMA, M_GET_SELECTION,
  M_RUNTIME_ACTION, M_THEME_SYNC, M_SCHEMA_RELOAD, M_ON_SELECT,
  type DesigntimeMode, type SelectionCtx,
} from './protocol.ts';

export interface InstallOptions {
  getSchema(): ReportSchema;
  getKernel(): RuntimeKernel | null;
  /** schema 直更新：重取 schema 重建 runtime（host 经 Bridge schema.reload 触发） */
  reloadSchema(schemaUrl?: string): Promise<void>;
}

/** 高亮 overlay：独立层，不侵入业务 DOM */
function makeOverlay(color: string, bg: string): HTMLDivElement {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'absolute', display: 'none', pointerEvents: 'none', zIndex: '9999',
    border: `2px solid ${color}`, background: bg, borderRadius: '8px',
    transition: 'all 0.15s ease', boxSizing: 'border-box',
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  return el;
}

function coverNode(overlay: HTMLDivElement, nodeId: string | null): void {
  if (!nodeId) {
    overlay.style.display = 'none';
    return;
  }
  const target = document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`);
  if (!target) {
    overlay.style.display = 'none';
    return;
  }
  const r = target.getBoundingClientRect();
  Object.assign(overlay.style, {
    display: 'block',
    left: `${r.left + window.scrollX - 2}px`,
    top: `${r.top + window.scrollY - 2}px`,
    width: `${r.width + 4}px`,
    height: `${r.height + 4}px`,
  });
}

/** 在预览页安装搭建态 SDK；非 designtime 模式返回 null（什么都不做）。 */
export function installDesigntimeSDK(opts: InstallOptions): Bridge | null {
  const qp = new URLSearchParams(window.location.search);
  if (qp.get('designtime') !== '1') return null;
  const token = qp.get('dtToken') ?? '';
  if (!token) return null;

  const bridge = new Bridge(windowEndpoint(window, window.parent), token);
  let mode: DesigntimeMode = 'browse';
  let selection: SelectionCtx | null = null;

  const highlightLayer = makeOverlay('#1456f0', 'rgba(20,86,240,0.06)');
  const hoverLayer = makeOverlay('rgba(20,86,240,0.45)', 'transparent');

  bridge.handle(M_ENABLE, (params) => {
    mode = ((params as { mode?: DesigntimeMode })?.mode) ?? 'browse';
    if (mode === 'browse') coverNode(hoverLayer, null);
    return { mode };
  });

  bridge.handle(M_HIGHLIGHT, (params) => {
    coverNode(highlightLayer, (params as { nodeId?: string })?.nodeId ?? null);
  });

  bridge.handle(M_GET_SCHEMA, () => opts.getSchema());
  bridge.handle(M_GET_SELECTION, () => selection);

  bridge.handle(M_RUNTIME_ACTION, async (params) => {
    const { name, payload } = (params ?? {}) as { name?: string; payload?: Record<string, unknown> };
    const kernel = opts.getKernel();
    if (!kernel) throw new Error('runtime not ready');
    if (name === 'reload') {
      const data = kernel.get<DataRuntime>('data');
      await Promise.allSettled(
        data.listDefs().filter((d) => (d['x-trigger'] ?? 'auto') === 'auto').map((d) => data.reload(d.id)),
      );
      return { ok: true };
    }
    if (name === 'setFilter') {
      const { key, value } = (payload ?? {}) as { key?: string; value?: unknown };
      if (!key) throw new Error('setFilter 缺少 key');
      kernel.get<StateRuntime>('state').set(key, value);
      return { ok: true };
    }
    throw new Error(`未知 action: ${name}`);
  });

  bridge.handle(M_THEME_SYNC, (params) => {
    const tokens = ((params as { tokens?: Record<string, string> })?.tokens) ?? {};
    for (const [k, v] of Object.entries(tokens)) {
      document.documentElement.style.setProperty(k.startsWith('--') ? k : `--${k}`, v);
    }
    return { applied: Object.keys(tokens).length };
  });

  bridge.handle(M_SCHEMA_RELOAD, async (params) => {
    const url = (params as { schemaUrl?: string })?.schemaUrl;
    await opts.reloadSchema(url);
    // 重渲染后旧 rect 失效，清掉高亮（host 会按需重新 highlight）
    coverNode(highlightLayer, null);
    selection = null;
    return { ok: true };
  });

  // 标注模式：hover 高亮 + 点选命中块级 data-node-id → 上报选区
  const nodeIdAt = (e: MouseEvent): string | null =>
    (e.target as Element | null)?.closest?.('[data-node-id]')?.getAttribute('data-node-id') ?? null;

  document.addEventListener('mousemove', (e) => {
    if (mode !== 'annotate') return;
    coverNode(hoverLayer, nodeIdAt(e));
  }, { passive: true });

  document.addEventListener('click', (e) => {
    if (mode !== 'annotate') return;
    const nodeId = nodeIdAt(e);
    if (!nodeId) return;
    e.preventDefault();
    e.stopPropagation();
    selection = { level: 'block', nodeId, schemaSlice: findNode(opts.getSchema(), nodeId) };
    coverNode(highlightLayer, nodeId);
    bridge.notify(M_ON_SELECT, selection);
  }, { capture: true });

  bridge.announceReady(BRIDGE_VERSION);
  return bridge;
}
