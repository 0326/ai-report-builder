/**
 * 保存：project.exportSchema → mergeXFields（x- 扩展保真）→ PUT /api/schema（零构建直更新管线）。
 * 运行态预览已并入画布（preview-overlay 插件，顶栏「设计 | 预览」切换），此处只保留保存入口 + ⌘S。
 */
import { createElement as h } from 'react';
import { Button } from '@alifd/next';
import type { IPublicModelPluginContext } from '@alilc/lowcode-types';
import { saveDesigner } from '../save.ts';

const SaveAndPreviewPlugin = (ctx: IPublicModelPluginContext) => ({
  async init() {
    const { skeleton, hotkey } = ctx;

    skeleton.add({
      name: 'daf-save', area: 'topArea', type: 'Widget', props: { align: 'right' },
      content: h(Button, { type: 'primary', onClick: () => void saveDesigner(ctx) }, '保存'),
    });

    hotkey.bind('command+s', (e) => {
      e.preventDefault();
      void saveDesigner(ctx);
    });
  },
});
SaveAndPreviewPlugin.pluginName = 'SaveAndPreviewPlugin';
SaveAndPreviewPlugin.meta = { dependencies: ['EditorInitPlugin'] };
export default SaveAndPreviewPlugin;
