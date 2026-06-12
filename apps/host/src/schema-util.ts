/** LCE 数据源引擎用 isInit 控制自动加载；从我们的 x-trigger 派生（非破坏拷贝）。 */
import type { ReportSchema, DataSourceDef } from '@daf/report-runtime/core';

export function withDsInit(schema: ReportSchema): ReportSchema {
  const page = schema.componentsTree[0];
  if (!page?.dataSource?.list) return schema;
  const list = page.dataSource.list.map((d: DataSourceDef) => ({
    ...d,
    isInit: (d['x-trigger'] ?? 'auto') === 'auto',
  }));
  return { ...schema, componentsTree: [{ ...page, dataSource: { ...page.dataSource, list } }, ...schema.componentsTree.slice(1)] };
}
