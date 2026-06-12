/**
 * 保存 + 真实预览：
 * 保存 = project.exportSchema → mergeXFields（x- 扩展保真）→ PUT /api/schema（零构建直更新管线）
 * 预览 = 先保存，再开运行态产物预览页（schema 运行时 fetch 最新 hash 产物）
 */
import { createElement as h } from 'react';
import { Button, Message } from '@alifd/next';
import type { IPublicModelPluginContext } from '@alilc/lowcode-types';
import type { ReportSchema } from '@daf/report-runtime/core';
import { mergeXFields } from '@daf/designtime-sdk';
import { getBaseline, setBaseline } from '../store.ts';
import { emitPreview, emitTimeline } from '../bus.ts';

async function doSave(ctx: IPublicModelPluginContext): Promise<boolean> {
  try {
    const exported = ctx.project.exportSchema('save' as never) as unknown as ReportSchema;
    const merged = mergeXFields(exported, getBaseline());
    const t0 = performance.now();
    const res = await fetch('/api/schema', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(merged),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `PUT ${res.status}`);
    setBaseline(merged);
    if (body.previewUrl) emitPreview(body.previewUrl);
    emitTimeline();
    Message.success(
      body.unchanged
        ? '无改动，未产生新版本'
        : `已保存 round(${body.round})（零构建直更新，${Math.round(performance.now() - t0)}ms）`,
    );
    return true;
  } catch (e) {
    Message.error(`保存失败：${(e as Error).message}`);
    return false;
  }
}

const SaveAndPreviewPlugin = (ctx: IPublicModelPluginContext) => ({
  async init() {
    const { skeleton, hotkey } = ctx;

    skeleton.add({
      name: 'daf-save', area: 'topArea', type: 'Widget', props: { align: 'right' },
      content: h(Button, { type: 'primary', onClick: () => void doSave(ctx) }, '保存'),
    });
    skeleton.add({
      name: 'daf-preview', area: 'topArea', type: 'Widget', props: { align: 'right' },
      content: h(Button, {
        onClick: async () => {
          if (await doSave(ctx)) window.open('/preview/', 'daf-report-preview');
        },
      }, '预览（运行态产物）'),
    });

    hotkey.bind('command+s', (e) => {
      e.preventDefault();
      void doSave(ctx);
    });
  },
});
SaveAndPreviewPlugin.pluginName = 'SaveAndPreviewPlugin';
SaveAndPreviewPlugin.meta = { dependencies: ['EditorInitPlugin'] };
export default SaveAndPreviewPlugin;
