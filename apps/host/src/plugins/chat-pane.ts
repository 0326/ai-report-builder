/**
 * 对话搭建面板：iframe 嵌入独立 React 18 工作台（apps/chat，Ant Design X + 标注预览）。
 * LCE 壳是 React 16，对话 UI 经 iframe 解耦；/chat 经 vite 代理到 mock-server。
 * 每轮提交后 chat 应用 postMessage 回传 → 重载设计器画布 + 刷新时间线 + 切预览。
 */
import { createElement as h, useEffect, Fragment } from 'react';
import type { IPublicModelPluginContext } from '@alilc/lowcode-types';
import { emitPreview, emitTimeline, reloadDesigner } from '../bus.ts';

function ChatFrame() {
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; previewUrl?: string } | undefined;
      if (data?.type !== 'daf-chat:round') return;
      if (data.previewUrl) emitPreview(data.previewUrl);
      void reloadDesigner();
      emitTimeline();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return h('iframe', {
    src: '/chat/',
    title: 'daf-chat',
    style: { width: '100%', height: '100%', border: 'none', display: 'block' },
  });
}

const ChatPanePlugin = (ctx: IPublicModelPluginContext) => ({
  async init() {
    ctx.skeleton.add({
      area: 'leftArea', type: 'PanelDock', name: 'dafChatPane',
      content: () => h(Fragment, null, h(ChatFrame)),
      panelProps: { width: 980, title: 'AI 搭建（对话 + 标注预览）' },
      props: { align: 'top', icon: 'xiaoxi', description: 'AI 搭建' },
    });
  },
});
ChatPanePlugin.pluginName = 'ChatPanePlugin';
ChatPanePlugin.meta = { dependencies: ['EditorInitPlugin'] };
export default ChatPanePlugin;
