/**
 * x- 扩展字段保真合并：LCE 设计器 exportSchema 的结果 ⊕ 基线 schema。
 * 协议立场是"文件即合法 LCE 页面 schema，平台语义全 x- 前缀"——若引擎导出时
 * 丢弃了未知扩展字段，这里按 nodeId 从基线补回；引擎已保留的以导出值为准。
 * 同时兜底 Page 级 dataSource/state/x-filters/x-linkages 与 componentsMap 的非物料项。
 */
import type { ReportSchema, SchemaNode, PageNode } from '@daf/report-runtime/core';
import { getPage } from '@daf/report-runtime/core';

type AnyNode = SchemaNode & Record<string, unknown>;

function indexNodes(page: PageNode): Map<string, AnyNode> {
  const map = new Map<string, AnyNode>();
  const walk = (nodes: SchemaNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.id) map.set(n.id, n as AnyNode);
      walk(n.children);
    }
  };
  walk(page.children);
  return map;
}

function mergeNode(exported: AnyNode, baseline: AnyNode | undefined): AnyNode {
  if (!baseline) return exported;
  const out: AnyNode = { ...exported };
  for (const [k, v] of Object.entries(baseline)) {
    if (k.startsWith('x-') && out[k] === undefined) out[k] = v;
  }
  return out;
}

export function mergeXFields(exported: ReportSchema, baseline: ReportSchema): ReportSchema {
  const basePage = getPage(baseline);
  const baseIndex = indexNodes(basePage);

  const mergeChildren = (nodes: SchemaNode[] | undefined): SchemaNode[] | undefined =>
    nodes?.map((n) => {
      const merged = mergeNode(n as AnyNode, n.id ? baseIndex.get(n.id) : undefined);
      const children = mergeChildren(n.children);
      return children ? { ...merged, children } : merged;
    });

  const expPage = getPage(exported) as PageNode & Record<string, unknown>;
  const outPage: PageNode & Record<string, unknown> = {
    ...expPage,
    children: mergeChildren(expPage.children) ?? [],
  };

  // Page 级平台扩展与声明区兜底（引擎不认识的区段以基线为准，引擎已导出的优先）
  const PAGE_KEYS = ['dataSource', 'state', 'x-filters', 'x-linkages', 'x-layout'] as const;
  for (const k of PAGE_KEYS) {
    const fromBase = (basePage as Record<string, unknown>)[k];
    if (outPage[k] === undefined && fromBase !== undefined) outPage[k] = fromBase;
  }

  // componentsMap：引擎导出的物料映射 ∪ 基线独有项（如 AIBlock 容器声明）
  const expMap = exported.componentsMap ?? [];
  const seen = new Set(expMap.map((e) => e.componentName));
  const mergedMap = [
    ...expMap,
    ...(baseline.componentsMap ?? []).filter((e) => !seen.has(e.componentName)),
  ];

  return {
    ...exported,
    version: exported.version || baseline.version,
    componentsMap: mergedMap,
    componentsTree: [outPage as PageNode, ...exported.componentsTree.slice(1)],
  };
}
