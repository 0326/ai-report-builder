/**
 * 数据绑定归一化（可视编排 → 协议自洽）：
 * 从节点 props 里的 JSExpression `this.dataSourceMap['ds_x'].data` 反推数据消费关系，
 * 自动补齐 节点 x-consumes 与 Page.dataSource.list（datasetId=被消费 id），
 * 让"拖物料→选数据集"无需手写 dataSource，保存即合法运行。
 * 只增不减：不清除 AI/手写已声明的 x-consumes / dataSource（幂等安全）。
 */
import type { ReportSchema, SchemaNode, PageNode, DataSourceDef } from '@daf/report-runtime/core';
import { getPage } from '@daf/report-runtime/core';

const DSMAP_RE = /dataSourceMap\s*\[\s*['"]([^'"]+)['"]\s*\]/g;

/** 递归找出某节点 props（不含 children）里 JSExpression 引用的 dataSource id（AI/手写路径）。 */
function jsExprIdsOf(node: SchemaNode): string[] {
  const ids = new Set<string>();
  const scan = (v: unknown) => {
    if (!v) return;
    if (typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      if (obj.type === 'JSExpression' && typeof obj.value === 'string') {
        for (const m of obj.value.matchAll(DSMAP_RE)) ids.add(m[1]);
        return;
      }
      for (const val of Object.values(obj)) scan(val);
    }
  };
  scan(node.props);
  return [...ids];
}

/**
 * 可视编排：DataBindSetter 写 plain `props.dataset` = 数据集 id（避开 LCE 变量绑定模式）。
 * 归一化把它落成 `props.data` = JSExpression（公共物料运行态取数入口）。known 校验防脏写。
 */
function applyDatasetProp(node: SchemaNode, known: Set<string>): string | null {
  const props = node.props as Record<string, unknown> | undefined;
  const ds = props?.dataset;
  if (typeof ds !== 'string' || !ds || !known.has(ds)) return null;
  props!.data = { type: 'JSExpression', value: `this.dataSourceMap['${ds}'].data` };
  return ds;
}

/** 某节点最终消费的 dataSource id（dataset prop + 既有 JSExpression）。 */
function consumedIdsOf(node: SchemaNode, known: Set<string>): string[] {
  const ids = new Set<string>();
  const fromDataset = applyDatasetProp(node, known);
  if (fromDataset) ids.add(fromDataset);
  for (const id of jsExprIdsOf(node)) ids.add(id);
  return [...ids];
}

export interface NormalizeResult {
  schema: ReportSchema;
  /** 本次新增的 dataSource id（供日志/提示） */
  addedDataSources: string[];
}

export function normalizeDataBindings(schema: ReportSchema, knownDatasetIds: string[]): NormalizeResult {
  const page: PageNode = getPage(schema);
  const known = new Set(knownDatasetIds);
  const allConsumed = new Set<string>();

  const walk = (nodes: SchemaNode[] | undefined) => {
    for (const n of nodes ?? []) {
      const ids = consumedIdsOf(n, known);
      if (ids.length) {
        const prev = new Set(n['x-consumes'] ?? []);
        for (const id of ids) prev.add(id);
        n['x-consumes'] = [...prev];
        for (const id of ids) allConsumed.add(id);
      }
      walk(n.children);
    }
  };
  walk(page.children);

  const list: DataSourceDef[] = page.dataSource?.list ?? [];
  const existing = new Set(list.map((d) => d.id));
  const added: string[] = [];
  for (const id of allConsumed) {
    if (existing.has(id) || !known.has(id)) continue;
    list.push({ id, type: 'daf-query', options: { datasetId: id }, 'x-trigger': 'auto' } as DataSourceDef);
    added.push(id);
  }
  if (added.length) {
    if (!page.dataSource) page.dataSource = { list };
    else page.dataSource.list = list;
  }

  return { schema, addedDataSources: added };
}
