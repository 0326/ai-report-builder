/** 初始化：注册物料 assets（materialMetas 派生）+ 导入 report.schema.json（LCE 兼容协议直接进引擎） */
import type { IPublicModelPluginContext } from '@alilc/lowcode-types';
import type { ReportSchema, DataSourceDef } from '@daf/report-runtime/core';
import { setBaseline } from '../store.ts';

/** LCE 数据源引擎用 isInit 控制自动加载；从我们的 x-trigger 派生（非破坏拷贝） */
function withDsInit(schema: ReportSchema): ReportSchema {
  const page = schema.componentsTree[0];
  if (!page?.dataSource?.list) return schema;
  const list = page.dataSource.list.map((d: DataSourceDef) => ({
    ...d,
    isInit: (d['x-trigger'] ?? 'auto') === 'auto',
  }));
  return { ...schema, componentsTree: [{ ...page, dataSource: { ...page.dataSource, list } }, ...schema.componentsTree.slice(1)] };
}

const EditorInitPlugin = (ctx: IPublicModelPluginContext) => ({
  async init() {
    const { material, project } = ctx;
    const [assets, schema] = await Promise.all([
      fetch('/api/lce/assets').then((r) => r.json()),
      fetch('/api/schema').then((r) => r.json()) as Promise<ReportSchema>,
    ]);
    await material.setAssets(assets);
    setBaseline(schema);
    project.importSchema(withDsInit(schema) as never);
  },
});
EditorInitPlugin.pluginName = 'EditorInitPlugin';
export default EditorInitPlugin;
