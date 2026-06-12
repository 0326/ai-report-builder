/**
 * 工作台内部事件总线：协调 对话 / 预览 / 时间线 / 设计器 四块插件（各自独立注册，需共享 ctx 与信号）。
 * - 选区上下文（标注修改链路）：从 LCE 当前选中节点派生，喂给 Agent 对话。
 * - 预览切换：Agent 出新产物 / 时间线回滚 → 通知预览 iframe 切 src。
 * - 设计器重载：工程被 Agent 改写后，重新 importSchema 让画布与工程一致。
 */
import type { IPublicModelPluginContext } from '@alilc/lowcode-types';
import type { ReportSchema } from '@daf/report-runtime/core';
import { setBaseline } from './store.ts';
import { withDsInit } from './schema-util.ts';

export interface SelectionCtx {
  nodeId: string;
  componentName?: string;
}

let ctx: IPublicModelPluginContext | null = null;
const previewListeners = new Set<(url: string) => void>();
const timelineListeners = new Set<() => void>();

export function setCtx(c: IPublicModelPluginContext): void {
  ctx = c;
}

export function onPreview(fn: (url: string) => void): () => void {
  previewListeners.add(fn);
  return () => void previewListeners.delete(fn);
}
export function emitPreview(url: string): void {
  for (const fn of previewListeners) fn(url);
}

export function onTimeline(fn: () => void): () => void {
  timelineListeners.add(fn);
  return () => void timelineListeners.delete(fn);
}
export function emitTimeline(): void {
  for (const fn of timelineListeners) fn();
}

/** 当前选区（best-effort；取不到返回 null，剧本侧有 componentName 兜底）。 */
export function currentSelection(): SelectionCtx | null {
  try {
    const doc = (ctx?.project as unknown as { currentDocument?: unknown })?.currentDocument as
      | { selection?: { selected?: string[] }; getNode?: (id: string) => { componentName?: string } | null }
      | undefined;
    const id = doc?.selection?.selected?.[0];
    if (!id) return null;
    const node = doc?.getNode?.(id);
    return { nodeId: id, componentName: node?.componentName };
  } catch {
    return null;
  }
}

/** Agent/回滚改写工程后，重新把最新 schema 导入设计器，画布与工程保持一致。 */
export async function reloadDesigner(): Promise<void> {
  if (!ctx) return;
  const schema = (await fetch('/api/schema').then((r) => r.json())) as ReportSchema;
  setBaseline(schema);
  (ctx.project as unknown as { importSchema: (s: unknown) => void }).importSchema(withDsInit(schema) as never);
}
