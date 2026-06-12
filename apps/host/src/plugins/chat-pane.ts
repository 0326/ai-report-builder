/** 对话搭建面板占位（左侧 dock；第 5 轮接入 mock Agent 剧本） */
import { createElement as h } from 'react';
import type { IPublicModelPluginContext } from '@alilc/lowcode-types';

function ChatPlaceholder() {
  return h('div', { style: { padding: 12, height: '100%', display: 'flex', flexDirection: 'column', gap: 12 } },
    h('div', { style: { fontWeight: 600, fontSize: 14 } }, '对话搭建'),
    h('div', {
      style: {
        flex: 1, border: '1px dashed #d0d3d6', borderRadius: 8, display: 'flex',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        color: '#8f959e', fontSize: 13, textAlign: 'center', gap: 6, padding: 16,
      },
    },
      h('div', null, '“做一份周报：DAU 趋势 + 渠道占比，按区域筛选”'),
      h('div', { style: { fontSize: 12 } }, 'mock Agent 对话将在第 5 轮接入'),
    ),
    h('input', {
      disabled: true, placeholder: '描述你的报告需求…',
      style: { padding: '8px 12px', borderRadius: 6, border: '1px solid #d0d3d6', fontSize: 13 },
    }),
  );
}

const ChatPanePlugin = (ctx: IPublicModelPluginContext) => ({
  async init() {
    ctx.skeleton.add({
      area: 'leftArea',
      type: 'PanelDock',
      name: 'dafChatPane',
      content: ChatPlaceholder,
      panelProps: { width: 300, title: '对话搭建' },
      props: { align: 'top', icon: 'xiaoxi', description: '对话搭建' },
    });
  },
});
ChatPanePlugin.pluginName = 'ChatPanePlugin';
export default ChatPanePlugin;
