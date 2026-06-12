/** schema 不可变更新工具（host 本地态 → PUT 直更新管线） */
import type { ReportSchema, SchemaNode, PageNode } from '@daf/report-runtime/core';
import { getPage } from '@daf/report-runtime/core';

export { getPage };

/** 对指定节点应用变换，返回新 schema（路径上的对象全部新引用） */
export function mapNode(schema: ReportSchema, nodeId: string, fn: (n: SchemaNode) => SchemaNode): ReportSchema {
  const mapChildren = (nodes: SchemaNode[] | undefined): SchemaNode[] | undefined =>
    nodes?.map((n) => {
      if (n.id === nodeId) return fn({ ...n });
      const children = mapChildren(n.children);
      return children === n.children ? n : { ...n, children };
    });
  const page = getPage(schema);
  const nextPage: PageNode = { ...page, children: mapChildren(page.children) ?? [] };
  return { ...schema, componentsTree: [nextPage, ...schema.componentsTree.slice(1)] };
}

export function setNodeProp(schema: ReportSchema, nodeId: string, key: string, value: unknown): ReportSchema {
  return mapNode(schema, nodeId, (n) => ({ ...n, props: { ...(n.props ?? {}), [key]: value } }));
}

export function setNodeTitle(schema: ReportSchema, nodeId: string, title: string): ReportSchema {
  return mapNode(schema, nodeId, (n) => ({ ...n, title }));
}

export function isExpression(v: unknown): boolean {
  return !!v && typeof v === 'object' && (v as { type?: string }).type === 'JSExpression';
}
