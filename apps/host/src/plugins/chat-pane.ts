/**
 * 对话搭建面板（纯 chat，嵌入模式）：iframe 嵌入 React 18 工作台（apps/chat，Ant Design X）。
 * 预览/标注已并入设计器画布（preview-overlay）——选区经宿主中转进对话；
 * 每轮提交后 chat postMessage 回传 → 重载画布 + 刷新时间线 + 预览层切新产物。
 */
import { createElement as h, useEffect, useCallback, Fragment } from 'react';
import type { IPublicModelPluginContext } from '@alilc/lowcode-types';
import { emitPreview, emitTimeline, reloadDesigner, setChatFrame, markChatReady } from '../bus.ts';

function ChatFrame() {
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; previewUrl?: string } | undefined;
      if (data?.type === 'daf-chat:ready') return markChatReady();
      if (data?.type !== 'daf-chat:round') return;
      if (data.previewUrl) emitPreview(data.previewUrl);
      void reloadDesigner();
      emitTimeline();
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      setChatFrame(null);
    };
  }, []);

  const ref = useCallback((el: HTMLIFrameElement | null) => setChatFrame(el), []);

  return h('iframe', {
    ref,
    src: '/chat/?embedded=1',
    title: 'daf-chat',
    style: { width: '100%', height: '100%', border: 'none', display: 'block' },
  });
}

const ChatPanePlugin = (ctx: IPublicModelPluginContext) => ({
  async init() {
    ctx.skeleton.add({
      area: 'leftArea', type: 'PanelDock', name: 'dafChatPane',
      content: () => h(Fragment, null, h(ChatFrame)),
      panelProps: { width: 420, title: 'AI 搭建对话' },
      props: { align: 'top', icon: 'xiaoxi', description: 'AI 搭建对话' },
    });
  },
});
ChatPanePlugin.pluginName = 'ChatPanePlugin';
ChatPanePlugin.meta = { dependencies: ['EditorInitPlugin'] };
export default ChatPanePlugin;
