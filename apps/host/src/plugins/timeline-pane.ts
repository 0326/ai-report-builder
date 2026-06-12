/**
 * 版本时间线（§3.5）：每轮修改 = 一个 commit；点任意节点回滚 = 切该 commit 产物 URL（零重建）。
 */
import { createElement as h, useState, useEffect, useCallback, Fragment } from 'react';
import type { IPublicModelPluginContext } from '@alilc/lowcode-types';
import { onTimeline, emitPreview } from '../bus.ts';

interface Node {
  hash: string; short: string; round: number | null; intent: string; type: string; hasBuild: boolean; current: boolean;
}

const TYPE_COLOR: Record<string, [string, string]> = {
  seed: ['#eef0f3', '#646a73'],
  code: ['#eaf2ff', '#1554ad'],
  schema: ['#e7f4ea', '#1a7f37'],
};

function TimelinePanel() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [active, setActive] = useState<string>('');

  const refresh = useCallback(async () => {
    const data = (await fetch('/api/timeline').then((r) => r.json())) as { nodes: Node[]; head: string };
    setNodes(data.nodes);
    setActive((a) => a || data.head);
  }, []);

  useEffect(() => { void refresh(); return onTimeline(() => void refresh()); }, [refresh]);

  async function rollback(n: Node) {
    if (!n.hasBuild && n.type === 'seed') return;
    const res = await fetch('/api/timeline/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hash: n.hash }),
    });
    const body = await res.json();
    if (body.previewUrl) { setActive(n.hash); emitPreview(body.previewUrl); }
  }

  return h('div', { style: { height: '100%', overflowY: 'auto', padding: 12, background: '#fff' } },
    h('div', { style: { fontSize: 12, color: '#646a73', marginBottom: 10 } }, '点任意节点回滚预览（切产物 URL，零重建）'),
    h('div', { style: { display: 'flex', flexDirection: 'column' } },
      ...nodes.map((n) => {
        const [bg, fg] = TYPE_COLOR[n.type] ?? TYPE_COLOR.seed;
        const isActive = n.hash === active;
        return h('div', { key: n.hash, style: { display: 'flex', gap: 8 } },
          // 时间线轴
          h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: 14 } },
            h('div', { style: { width: 10, height: 10, borderRadius: '50%', background: isActive ? '#3370ff' : '#c9cdd4', marginTop: 6 } }),
            h('div', { style: { flex: 1, width: 2, background: '#e5e6eb' } }),
          ),
          h('div', {
            onClick: () => void rollback(n),
            style: {
              flex: 1, marginBottom: 8, padding: 10, borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${isActive ? '#3370ff' : '#e5e6eb'}`,
              background: isActive ? '#f0f6ff' : '#fff',
            },
          },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 } },
              h('span', { style: { fontWeight: 600, fontSize: 12, color: '#1f2329' } }, n.round === null ? '—' : `round(${n.round})`),
              h('span', { style: { background: bg, color: fg, fontSize: 10, padding: '1px 6px', borderRadius: 4 } }, n.type),
            ),
            h('div', { style: { fontSize: 12, color: '#1f2329', marginTop: 4, lineHeight: 1.5 } }, n.intent),
            h('div', { style: { fontSize: 10, color: '#8f959e', marginTop: 4, fontFamily: 'ui-monospace, Menlo, monospace' } },
              `${n.short}${n.current ? ' · 当前' : ''}${n.hasBuild ? '' : ' · 无缓存(重建)'}`),
          ),
        );
      }),
    ),
  );
}

const TimelinePanePlugin = (ctx: IPublicModelPluginContext) => ({
  async init() {
    ctx.skeleton.add({
      area: 'leftArea', type: 'PanelDock', name: 'dafTimeline',
      content: () => h(Fragment, null, h(TimelinePanel)),
      panelProps: { width: 300, title: '版本时间线' },
      props: { align: 'top', icon: 'lishi', description: '版本时间线' },
    });
  },
});
TimelinePanePlugin.pluginName = 'TimelinePanePlugin';
TimelinePanePlugin.meta = { dependencies: ['EditorInitPlugin'] };
export default TimelinePanePlugin;
