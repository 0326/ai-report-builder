/** 初始化：注册物料 assets（materialMetas 派生）+ 导入工程 schema（LCE 兼容协议直接进引擎） */
import type { IPublicModelPluginContext } from '@alilc/lowcode-types';
import type { ReportSchema } from '@daf/report-runtime/core';
import { setBaseline } from '../store.ts';
import { setCtx } from '../bus.ts';
import { withDsInit } from '../schema-util.ts';

/** 冷启动容错：dev 栈下 host 可能先于 mock-server 就绪，重试到拿到合法 JSON。 */
async function fetchJson<T>(url: string, tries = 8): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return (await r.json()) as T;
    } catch {
      /* 连接被拒，重试 */
    }
    if (i >= tries) throw new Error(`[host] ${url} 多次重试仍不可用`);
    await new Promise((res) => setTimeout(res, 400));
  }
}

const EditorInitPlugin = (ctx: IPublicModelPluginContext) => ({
  async init() {
    const { material, project } = ctx;
    setCtx(ctx);
    const [assets, schema] = await Promise.all([
      fetchJson<unknown>('/api/lce/assets'),
      fetchJson<ReportSchema>('/api/schema'),
    ]);
    await material.setAssets(assets);
    setBaseline(schema);
    project.importSchema(withDsInit(schema) as never);
  },
});
EditorInitPlugin.pluginName = 'EditorInitPlugin';
export default EditorInitPlugin;
