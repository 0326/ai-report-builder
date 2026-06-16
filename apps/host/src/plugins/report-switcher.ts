/**
 * 报告切换器（多报告管理）：顶栏下拉列出全部报告，支持 切换 / 新建 / 重命名 / 删除。
 * 切换/新建后重载设计器（importSchema 当前报告）+ 刷新预览/时间线。
 */
import { createElement as h, useState, useEffect, useRef } from 'react';
import { Message } from '@alifd/next';
import type { IPublicModelPluginContext } from '@alilc/lowcode-types';
import { emitPreview, emitTimeline, reloadDesigner } from '../bus.ts';

interface ReportItem { id: string; title: string; updatedAt: number; current: boolean }

function ReportSwitcher() {
  const [items, setItems] = useState<ReportItem[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    const d = await fetch('/api/reports').then((r) => r.json()).catch(() => ({ reports: [] }));
    setItems(d.reports ?? []);
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const current = items.find((r) => r.current);

  async function afterSwitch() {
    await reloadDesigner();
    emitTimeline();
    // 切到当前报告的预览（缺省 build）
    emitPreview('/preview/?t=' + Date.now());
    await refresh();
  }

  async function switchTo(id: string) {
    setOpen(false);
    if (id === current?.id) return;
    await fetch(`/api/reports/${id}/open`, { method: 'POST' });
    await afterSwitch();
    Message.success('已切换报告');
  }

  async function create() {
    setOpen(false);
    const title = window.prompt('新报告名称', '未命名报告');
    if (title === null) return;
    await fetch('/api/reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title || '未命名报告' }) });
    await afterSwitch();
    Message.success('已新建空白报告');
  }

  async function rename(it: ReportItem, e: { stopPropagation(): void }) {
    e.stopPropagation();
    const title = window.prompt('重命名报告', it.title);
    if (!title) return;
    await fetch(`/api/reports/${it.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
    await refresh();
  }

  async function remove(it: ReportItem, e: { stopPropagation(): void }) {
    e.stopPropagation();
    if (!window.confirm(`删除报告「${it.title}」？此操作不可恢复。`)) return;
    await fetch(`/api/reports/${it.id}`, { method: 'DELETE' });
    await afterSwitch();
  }

  return h('div', { ref: wrapRef, style: { position: 'relative', marginLeft: 4 } },
    h('button', {
      onClick: () => setOpen((v) => !v),
      style: {
        display: 'flex', alignItems: 'center', gap: 6, height: 30, padding: '0 10px', cursor: 'pointer',
        border: '1px solid #e5e6eb', borderRadius: 8, background: '#fff', fontSize: 13, color: '#1f2329', maxWidth: 220,
      },
    },
      h('span', { style: { width: 6, height: 6, borderRadius: 3, background: '#3370ff', flexShrink: 0 } }),
      h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 } }, current?.title ?? '报告'),
      h('span', { style: { color: '#8f959e', fontSize: 11 } }, '▾'),
    ),
    open ? h('div', {
      style: {
        position: 'absolute', top: 36, left: 0, width: 280, background: '#fff', borderRadius: 10,
        boxShadow: '0 8px 24px rgba(15,23,42,0.14)', border: '1px solid #eceef1', zIndex: 1000, overflow: 'hidden',
      },
    },
      h('div', { style: { maxHeight: 320, overflowY: 'auto', padding: 6 } },
        ...items.map((it) => h('div', {
          key: it.id, onClick: () => void switchTo(it.id),
          style: {
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
            background: it.current ? '#f0f6ff' : 'transparent',
          },
          onMouseEnter: (e: { currentTarget: HTMLElement }) => { if (!it.current) e.currentTarget.style.background = '#f7f8fa'; },
          onMouseLeave: (e: { currentTarget: HTMLElement }) => { if (!it.current) e.currentTarget.style.background = 'transparent'; },
        },
          h('span', { style: { flex: 1, fontSize: 13, color: '#1f2329', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, it.title),
          it.current ? h('span', { style: { fontSize: 11, color: '#3370ff' } }, '当前') : null,
          h('span', { onClick: (e: never) => void rename(it, e), title: '重命名', style: { color: '#8f959e', fontSize: 12, padding: '0 3px', cursor: 'pointer' } }, '✎'),
          items.length > 1 ? h('span', { onClick: (e: never) => void remove(it, e), title: '删除', style: { color: '#cf222e', fontSize: 12, padding: '0 3px', cursor: 'pointer' } }, '✕') : null,
        )),
      ),
      h('div', {
        onClick: () => void create(),
        style: { padding: '10px 12px', borderTop: '1px solid #eceef1', cursor: 'pointer', fontSize: 13, color: '#3370ff', fontWeight: 600 },
      }, '＋ 新建报告'),
    ) : null,
  );
}

const ReportSwitcherPlugin = (ctx: IPublicModelPluginContext) => ({
  async init() {
    ctx.skeleton.add({
      name: 'daf-report-switcher', area: 'topArea', type: 'Widget', props: { align: 'left' },
      content: h(ReportSwitcher),
    });
  },
});
ReportSwitcherPlugin.pluginName = 'ReportSwitcherPlugin';
ReportSwitcherPlugin.meta = { dependencies: ['EditorInitPlugin'] };
export default ReportSwitcherPlugin;
