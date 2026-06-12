/**
 * 运行态预览面板：嵌入真实预览 iframe（React 18 运行态链路），由 Agent 出产物 / 时间线回滚驱动切 src。
 * 与设计器画布（设计态占位渲染）互补：这里是真实数据 + 真实物料的运行态产物。
 */
import { createElement as h, useState, useEffect, useRef, Fragment } from 'react';
import type { IPublicModelPluginContext } from '@alilc/lowcode-types';
import { onPreview } from '../bus.ts';

function PreviewPanel() {
  const [url, setUrl] = useState('/preview/');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => onPreview((next) => setUrl(next + (next.includes('?') ? '&' : '?') + 't=' + Date.now())), []);

  return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' } },
    h('div', { style: { padding: '8px 12px', borderBottom: '1px solid #e5e6eb', display: 'flex', gap: 8, alignItems: 'center' } },
      h('span', { style: { fontSize: 12, color: '#646a73', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'ui-monospace, Menlo, monospace' } }, url),
      h('button', {
        onClick: () => iframeRef.current && (iframeRef.current.src = iframeRef.current.src),
        style: { fontSize: 12, padding: '3px 10px', border: '1px solid #e5e6eb', borderRadius: 6, background: '#fff', cursor: 'pointer' },
      }, '刷新'),
      h('a', { href: url, target: '_blank', rel: 'noreferrer', style: { fontSize: 12, color: '#3370ff', textDecoration: 'none' } }, '新窗口'),
    ),
    h('iframe', { ref: iframeRef, src: url, title: 'report-preview', style: { flex: 1, border: 'none', width: '100%' } }),
  );
}

const PreviewPanePlugin = (ctx: IPublicModelPluginContext) => ({
  async init() {
    ctx.skeleton.add({
      area: 'leftArea', type: 'PanelDock', name: 'dafPreview',
      content: () => h(Fragment, null, h(PreviewPanel)),
      panelProps: { width: 560, title: '运行态预览' },
      props: { align: 'top', icon: 'yulan', description: '运行态预览' },
    });
  },
});
PreviewPanePlugin.pluginName = 'PreviewPanePlugin';
PreviewPanePlugin.meta = { dependencies: ['EditorInitPlugin'] };
export default PreviewPanePlugin;
