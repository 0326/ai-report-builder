/** 宿主侧连接器：对 iframe 建 Bridge，类型化封装 §3.3 方法。 */
import type { ReportSchema } from '@daf/report-runtime/core';
import { Bridge, windowEndpoint } from './bridge.ts';
import {
  M_ENABLE, M_HIGHLIGHT, M_GET_SCHEMA, M_GET_SELECTION,
  M_RUNTIME_ACTION, M_THEME_SYNC, M_SCHEMA_RELOAD, M_ON_SELECT,
  type DesigntimeMode, type SelectionCtx,
} from './protocol.ts';

export interface PreviewHandle {
  bridge: Bridge;
  whenReady: Promise<{ version: string }>;
  enable(mode: DesigntimeMode): Promise<void>;
  highlight(nodeId: string | null): Promise<void>;
  getSchema(): Promise<ReportSchema>;
  getSelection(): Promise<SelectionCtx | null>;
  action(name: string, payload?: Record<string, unknown>): Promise<void>;
  themeSync(tokens: Record<string, string>): Promise<void>;
  /** schema 直更新：通知 iframe 重载 schema 并重建 runtime */
  schemaReload(schemaUrl?: string): Promise<void>;
  dispose(): void;
}

export interface ConnectOptions {
  onSelect?: (ctx: SelectionCtx) => void;
  onReady?: (info: { version: string }) => void;
}

export function connectPreview(iframe: HTMLIFrameElement, token: string, opts: ConnectOptions = {}): PreviewHandle {
  const peer = iframe.contentWindow;
  if (!peer) throw new Error('[designtime] iframe 尚未挂载（contentWindow 为空）');
  const bridge = new Bridge(windowEndpoint(window, peer), token, { onReady: opts.onReady });
  if (opts.onSelect) bridge.handle(M_ON_SELECT, (params) => opts.onSelect!(params as SelectionCtx));

  return {
    bridge,
    whenReady: bridge.whenReady,
    enable: async (mode) => void (await bridge.call(M_ENABLE, { mode })),
    highlight: async (nodeId) => void (await bridge.call(M_HIGHLIGHT, { nodeId })),
    getSchema: () => bridge.call<ReportSchema>(M_GET_SCHEMA),
    getSelection: () => bridge.call<SelectionCtx | null>(M_GET_SELECTION),
    action: async (name, payload) => void (await bridge.call(M_RUNTIME_ACTION, { name, payload })),
    themeSync: async (tokens) => void (await bridge.call(M_THEME_SYNC, { tokens })),
    schemaReload: async (schemaUrl) => void (await bridge.call(M_SCHEMA_RELOAD, { schemaUrl }, 15000)),
    dispose: () => bridge.dispose(),
  };
}
