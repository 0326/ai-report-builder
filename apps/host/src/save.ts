/** 设计器保存（共享逻辑）：exportSchema → mergeXFields x-保真 → PUT /api/schema（零构建直更新）。 */
import { Message } from '@alifd/next';
import type { IPublicModelPluginContext } from '@alilc/lowcode-types';
import type { ReportSchema } from '@daf/report-runtime/core';
import { mergeXFields } from '@daf/designtime-sdk';
import { getBaseline, setBaseline } from './store.ts';
import { emitPreview, emitTimeline } from './bus.ts';

export interface SaveBody {
  previewUrl?: string;
  round?: number;
  unchanged?: boolean;
  hash?: string;
}

/** 保存当前画布；成功返回服务端响应（unchanged=true 表示无改动未产生新版本）。 */
export async function saveDesigner(ctx: IPublicModelPluginContext, silent = false): Promise<SaveBody | null> {
  try {
    const exported = ctx.project.exportSchema('save' as never) as unknown as ReportSchema;
    const merged = mergeXFields(exported, getBaseline());
    const t0 = performance.now();
    const res = await fetch('/api/schema', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(merged),
    });
    const body = (await res.json()) as SaveBody & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `PUT ${res.status}`);
    setBaseline(merged);
    if (!body.unchanged) {
      if (body.previewUrl) emitPreview(body.previewUrl);
      emitTimeline();
      if (!silent) Message.success(`已保存 round(${body.round})（零构建直更新，${Math.round(performance.now() - t0)}ms）`);
    } else if (!silent) {
      Message.success('无改动，未产生新版本');
    }
    return body;
  } catch (e) {
    Message.error(`保存失败：${(e as Error).message}`);
    return null;
  }
}
