/**
 * ReportRenderer：运行时加载 schema → React 渲染。
 * 公共物料节点按 componentsMap 从 registry 挂载；AIBlock 节点从 bundle 取模块挂载。
 * data-node-id 注入块根元素（块级定位的物理基础）。
 */
import { Component, useSyncExternalStore } from 'react';
import type { ComponentType, ReactNode, CSSProperties } from 'react';
import type { RuntimeKernel } from '../kernel.ts';
import type { SchemaNode, PageNode, FilterDef } from '../types.ts';
import { getPage } from '../types.ts';
import { resolveDeep } from '../expr.ts';
import type { StateRuntime } from '../modules/state.ts';
import type { DataRuntime } from '../modules/data.ts';
import type { EventRuntime } from '../modules/event.ts';
import type { PermissionRuntime } from '../modules/permission.ts';
import type { LoggerRuntime } from '../modules/logger.ts';
import { makeBlockRuntime } from './block-runtime.ts';

export type ComponentRegistry = Record<string, ComponentType<Record<string, unknown>> | undefined>;
export type BundleModules = Record<string, ComponentType<Record<string, unknown>> | undefined>;

export interface ReportRendererProps {
  runtime: RuntimeKernel;
  /** componentName -> 公共物料组件（buildRegistry 生成） */
  registry: ComponentRegistry;
  /** 自定义代码块模块表：entry -> 组件（来自报告 bundle） */
  bundle?: BundleModules;
}

const ROW_HEIGHT = 64;

export function ReportRenderer({ runtime, registry, bundle = {} }: ReportRendererProps) {
  useSyncExternalStore(
    (cb) => runtime.subscribe(cb),
    () => runtime.version,
    () => runtime.version,
  );
  const page = getPage(runtime.ctx.schema);
  const cols = page['x-layout']?.cols ?? 12;
  const title = (page.props?.title as string) ?? '';

  return (
    <div className="daf-report" style={{ padding: 16, fontFamily: 'system-ui, -apple-system, "PingFang SC", sans-serif', color: '#1f2329' }}>
      {title && <h2 style={{ margin: '0 0 12px', fontSize: 18 }}>{title}</h2>}
      <FiltersBar page={page} runtime={runtime} />
      <div
        className="daf-report-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridAutoRows: `${ROW_HEIGHT}px`,
          gap: 12,
        }}
      >
        {page.children.map((node) => (
          <BlockFrame key={node.id} node={node} runtime={runtime} registry={registry} bundle={bundle} />
        ))}
      </div>
    </div>
  );
}

/* ---------------- 筛选条 ---------------- */

function FiltersBar({ page, runtime }: { page: PageNode; runtime: RuntimeKernel }) {
  const filters = page['x-filters'] ?? [];
  if (!filters.length) return null;
  const state = runtime.get<StateRuntime>('state');
  const data = runtime.get<DataRuntime>('data');
  return (
    <div className="daf-report-filters" style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
      {filters.map((f) => (
        <FilterItem key={f.id} f={f} state={state} data={data} />
      ))}
    </div>
  );
}

function FilterItem({ f, state, data }: { f: FilterDef; state: StateRuntime; data: DataRuntime }) {
  let options: Array<{ label: string; value: string }> = [];
  if (f.options) {
    options = f.options.map((o) => (typeof o === 'string' ? { label: o, value: o } : o));
  } else if (f.optionsFrom) {
    const rows = data.getState(f.optionsFrom).rows;
    options = rows.map((r) => ({
      label: String(r.label ?? r.name ?? r.value ?? ''),
      value: String(r.value ?? r.name ?? ''),
    }));
  }
  if (f.default !== undefined && !options.some((o) => o.value === String(f.default))) {
    options = [{ label: '全部', value: String(f.default) }, ...options];
  }
  const value = String(state.get(f.stateKey) ?? f.default ?? '');
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
      <span style={{ color: '#646a73' }}>{f.label}</span>
      <select
        value={value}
        onChange={(e) => state.set(f.stateKey, e.target.value)}
        style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #d0d3d6', background: '#fff', fontSize: 13 }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

/* ---------------- 块容器 ---------------- */

function BlockFrame({ node, runtime, registry, bundle }: {
  node: SchemaNode; runtime: RuntimeKernel; registry: ComponentRegistry; bundle: BundleModules;
}) {
  const pos = node['x-position'] ?? { x: 0, y: 0, w: 12, h: 5 };
  const style: CSSProperties = {
    gridColumn: `${pos.x + 1} / span ${Math.min(pos.w, 12)}`,
    gridRow: `${pos.y + 1} / span ${pos.h}`,
    background: '#fff',
    border: '1px solid #e5e6e8',
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    overflow: 'hidden',
  };

  const data = runtime.get<DataRuntime>('data');
  const permission = runtime.get<PermissionRuntime>('permission');
  const consumes = node['x-consumes'] ?? [];

  // 组件级显隐：消费的数据集无权限 → 占位
  const denied = consumes.find((dsId) => {
    const def = data.listDefs().find((d) => d.id === dsId);
    return def && !permission.can('dataset', def.options.datasetId);
  });

  const loading = consumes.some((dsId) => data.getState(dsId).loading);
  const dsError = consumes.map((dsId) => data.getState(dsId).error).find(Boolean);

  return (
    <section data-node-id={node.id} className="daf-block" style={style}>
      {node.title && (
        <header style={{ padding: '8px 12px 0', fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          {node.title}
          {loading && <span style={{ fontSize: 11, color: '#8f959e', fontWeight: 400 }}>加载中…</span>}
        </header>
      )}
      <div style={{ flex: 1, minHeight: 0, padding: 8, position: 'relative' }}>
        {denied ? (
          <Placeholder text="无权限查看该数据" />
        ) : dsError ? (
          <Placeholder text={`数据加载失败：${dsError}`} tone="error" />
        ) : (
          <BlockErrorBoundary nodeId={node.id} runtime={runtime}>
            <BlockBody node={node} runtime={runtime} registry={registry} bundle={bundle} />
          </BlockErrorBoundary>
        )}
      </div>
    </section>
  );
}

function BlockBody({ node, runtime, registry, bundle }: {
  node: SchemaNode; runtime: RuntimeKernel; registry: ComponentRegistry; bundle: BundleModules;
}) {
  const state = runtime.get<StateRuntime>('state');
  const data = runtime.get<DataRuntime>('data');
  const event = runtime.get<EventRuntime>('event');
  const logger = runtime.get<LoggerRuntime>('logger');

  const scope = { state: state.snapshot(), dataSourceMap: data.dataSourceMap() };
  const resolved = resolveDeep(node.props ?? {}, scope, {}, (e) =>
    logger.log('render.expr.error', { nodeId: node.id, error: e.message }),
  ) as Record<string, unknown>;

  const onEmit = event.emitFrom(node.id);

  if (node.componentName === 'AIBlock') {
    const entry = String(resolved.entry ?? '');
    const Comp = bundle[entry];
    if (!Comp) return <Placeholder text={`自定义块缺失：bundle 未提供 "${entry}"`} tone="error" />;
    const blockRuntime = makeBlockRuntime(runtime, node);
    const { entry: _e, ...rest } = resolved;
    return <Comp {...rest} runtime={blockRuntime} onEmit={onEmit} />;
  }

  const Comp = registry[node.componentName];
  if (!Comp) return <Placeholder text={`未注册物料：${node.componentName}（检查 componentsMap）`} tone="error" />;
  return <Comp {...resolved} onEmit={onEmit} />;
}

function Placeholder({ text, tone = 'normal' }: { text: string; tone?: 'normal' | 'error' }) {
  return (
    <div style={{
      height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: tone === 'error' ? '#d54941' : '#8f959e', fontSize: 13, textAlign: 'center', padding: 8,
    }}>
      {text}
    </div>
  );
}

/* ---------------- 块级错误边界：单块异常不拖垮整页 ---------------- */

class BlockErrorBoundary extends Component<
  { nodeId: string; runtime: RuntimeKernel; children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    try {
      this.props.runtime.get<LoggerRuntime>('logger').log('block.error', {
        nodeId: this.props.nodeId, error: error.message,
      });
    } catch { /* logger 不可用时静默 */ }
  }

  render() {
    if (this.state.error) {
      return <Placeholder text={`块渲染异常（${this.props.nodeId}）：${this.state.error.message}`} tone="error" />;
    }
    return this.props.children;
  }
}
