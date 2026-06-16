/**
 * 发布：把当前报告冻结成可分享产物（/published/<id>/，自带数据快照）。
 * 发布前自动保存（exportSchema → 直更新），再 POST /api/publish，列出可复制的分享链接。
 * 仅用 Fusion 已 shim 导出的组件（Button/Dialog/Input/Message/Tag）。
 */
import { createElement as h, useState } from 'react';
import { Button, Dialog, Input, Message } from '@alifd/next';
import type { IPublicModelPluginContext } from '@alilc/lowcode-types';
import { saveDesigner } from '../save.ts';

interface PublishedItem { id: string; title: string; url: string; datasets: string[] }

function PublishButton({ ctx }: { ctx: IPublicModelPluginContext }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<PublishedItem[]>([]);

  async function loadList() {
    const d = await fetch('/api/published').then((r) => r.json()).catch(() => ({ published: [] }));
    setItems(d.published ?? []);
  }

  function openModal() {
    setOpen(true);
    void loadList();
  }

  async function doPublish() {
    setBusy(true);
    try {
      await saveDesigner(ctx, true);
      const res = await fetch('/api/publish', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? '发布失败');
      Message.success(`已发布：${body.id}（冻结数据集 ${body.datasets.length} 个）`);
      await loadList();
    } catch (e) {
      Message.error(`发布失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const fullUrl = (u: string) => `${location.protocol}//${location.host}${u}`;

  const itemRow = (it: PublishedItem) =>
    h('div', { key: it.id, style: { border: '1px solid #eceef1', borderRadius: 8, padding: 10, marginBottom: 8 } },
      h('div', { style: { fontWeight: 600, fontSize: 13, marginBottom: 6 } }, it.title,
        h('span', { style: { fontWeight: 400, fontSize: 11, color: '#8f959e', marginLeft: 8 } }, `冻结数据 ${it.datasets.length} 集`)),
      h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
        h(Input as never, { value: fullUrl(it.url), readOnly: true, style: { flex: 1, fontSize: 12 } } as never),
        h(Button as never, {
          onClick: () => { void navigator.clipboard?.writeText(fullUrl(it.url)); Message.success('链接已复制'); },
        } as never, '复制'),
        h(Button as never, { component: 'a', href: it.url, target: '_blank' } as never, '打开'),
      ),
    );

  return h('span', null,
    h(Button, { onClick: openModal, style: { marginRight: 8 } }, '发布'),
    h(Dialog as never, {
      title: '发布报告', visible: open, footer: false, onClose: () => setOpen(false),
      onCancel: () => setOpen(false), shouldUpdatePosition: true, style: { width: 580 },
    } as never,
      h('div', { style: { padding: '4px 0 12px', color: '#646a73', fontSize: 13, lineHeight: 1.7 } },
        '发布 = 冻结当前报告（结构 + 代码 + 所用数据快照）为独立可分享页面。源数据或工程后续改动不影响已发布版本。'),
      h(Button, { type: 'primary', loading: busy, onClick: () => void doPublish() }, '发布当前报告'),
      h('div', { style: { marginTop: 16, fontSize: 12, color: '#8f959e', fontWeight: 600 } }, `已发布（${items.length}）`),
      h('div', { style: { marginTop: 8, maxHeight: 300, overflowY: 'auto' } },
        items.length === 0
          ? h('div', { style: { color: '#8f959e', fontSize: 13, padding: '8px 0' } }, '暂无发布记录')
          : items.map(itemRow),
      ),
    ),
  );
}

const PublishPlugin = (ctx: IPublicModelPluginContext) => ({
  async init() {
    ctx.skeleton.add({
      name: 'daf-publish', area: 'topArea', type: 'Widget', props: { align: 'right' },
      content: h(PublishButton, { ctx }),
    });
  },
});
PublishPlugin.pluginName = 'PublishPlugin';
PublishPlugin.meta = { dependencies: ['EditorInitPlugin'] };
export default PublishPlugin;
