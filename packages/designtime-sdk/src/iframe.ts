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
  M_RUNTIME_ACTION, M_THEME_SYNC, M_SCHEMA_RELOAD, M_ON_SELECT, M_ON_MODE,
  type DesigntimeMode, type SelectionCtx, type ElementCtx,
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

function coverEl(overlay: HTMLDivElement, target: Element | null): void {
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

function coverNode(overlay: HTMLDivElement, nodeId: string | null): void {
  coverEl(overlay, nodeId ? document.querySelector(`[data-node-id="${CSS.escape(nodeId)}"]`) : null);
}

/* ---------------- 细粒度元素定位（块内 CSS 路径 + 语义信息） ---------------- */

function cssStep(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const cls = [...el.classList].filter((c) => !c.startsWith('lc-') && c.length < 32).slice(0, 2);
  let step = tag + cls.map((c) => `.${c}`).join('');
  const parent = el.parentElement;
  if (parent) {
    const siblings = [...parent.children].filter((s) => s.tagName === el.tagName);
    if (siblings.length > 1) step += `:nth-of-type(${siblings.indexOf(el) + 1})`;
  }
  return step;
}

/** 相对块根的 CSS 路径（最多 4 级，足够 Agent 定位语义区域）。 */
function selectorWithin(blockRoot: Element, el: Element): string {
  const steps: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== blockRoot && steps.length < 4) {
    steps.unshift(cssStep(cur));
    cur = cur.parentElement;
  }
  return steps.join(' > ');
}

/** 元素在块内的九宫格区域（top-left … bottom-right），辅助模型语义定位。 */
function regionOf(blockRoot: Element, el: Element): string {
  const b = blockRoot.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (b.width === 0 || b.height === 0) return 'center';
  const cx = (r.left + r.width / 2 - b.left) / b.width;
  const cy = (r.top + r.height / 2 - b.top) / b.height;
  const col = cx < 0.34 ? 'left' : cx > 0.66 ? 'right' : 'center';
  const row = cy < 0.34 ? 'top' : cy > 0.66 ? 'bottom' : 'middle';
  return row === 'middle' && col === 'center' ? 'center' : `${row}-${col}`;
}

function elementCtx(blockRoot: Element, el: Element): ElementCtx {
  const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
  return {
    selector: selectorWithin(blockRoot, el),
    tag: el.tagName.toLowerCase(),
    ...(text ? { text: text.slice(0, 60) } : {}),
    classes: [...el.classList].slice(0, 4),
    region: regionOf(blockRoot, el),
  };
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
    if (mode === 'browse') {
      coverEl(hoverLayer, null);
      coverEl(blockHintLayer, null);
    }
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

  // 标注模式（细粒度）：hover 同时高亮 块（虚线提示）+ 块内最深元素（实线）；
  // 点击 = 元素级选区（含 selector/text/region），⌥Alt+点击 = 整块选区；Esc 退出标注。
  const blockHintLayer = makeOverlay('rgba(20,86,240,0.3)', 'transparent');
  blockHintLayer.style.borderStyle = 'dashed';

  const blockAt = (e: MouseEvent): Element | null =>
    (e.target as Element | null)?.closest?.('[data-node-id]') ?? null;

  /** 命中的最深有意义元素：从 e.target 起，跳过纯包装（与父节点同尺寸的单子元素）。 */
  const elementAt = (e: MouseEvent, block: Element): Element => {
    let el = e.target as Element;
    if (el.nodeType === Node.TEXT_NODE) el = el.parentElement ?? block;
    // canvas/svg 内部命中归一到其容器（图表区域）
    const chartHost = el.closest('canvas, svg');
    if (chartHost) el = chartHost.parentElement ?? chartHost;
    return block.contains(el) ? el : block;
  };

  document.addEventListener('mousemove', (e) => {
    if (mode !== 'annotate') return;
    const block = blockAt(e);
    coverEl(blockHintLayer, block);
    coverEl(hoverLayer, block ? elementAt(e, block) : null);
  }, { passive: true });

  document.addEventListener('click', (e) => {
    if (mode !== 'annotate') return;
    const block = blockAt(e);
    if (!block) return;
    e.preventDefault();
    e.stopPropagation();
    const nodeId = block.getAttribute('data-node-id')!;
    const el = elementAt(e, block);
    const isBlockLevel = e.altKey || el === block;
    selection = {
      level: isBlockLevel ? 'block' : 'element',
      nodeId,
      schemaSlice: findNode(opts.getSchema(), nodeId),
      ...(isBlockLevel ? {} : { element: elementCtx(block, el) }),
    };
    coverEl(highlightLayer, isBlockLevel ? block : el);
    coverEl(blockHintLayer, null);
    coverEl(hoverLayer, null);
    bridge.notify(M_ON_SELECT, selection);
  }, { capture: true });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mode === 'annotate') {
      mode = 'browse';
      coverEl(hoverLayer, null);
      coverEl(blockHintLayer, null);
      bridge.notify(M_ON_MODE, { mode });
    }
  });

  bridge.announceReady(BRIDGE_VERSION);
  return bridge;
}
