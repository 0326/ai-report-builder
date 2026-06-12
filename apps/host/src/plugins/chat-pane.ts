/**
 * 对话搭建面板（§3.4 链路一 + §3.6）：意图 → Agent → 过程卡 + 双 diff + 预览切换。
 * 选区上下文（标注修改链路）从 LCE 当前选中节点派生，随消息发给 Agent。
 */
import { createElement as h, useState, useRef, useEffect, Fragment } from 'react';
import type { CSSProperties } from 'react';
import type { IPublicModelPluginContext } from '@alilc/lowcode-types';
import { currentSelection, emitPreview, emitTimeline, reloadDesigner } from '../bus.ts';

interface FileDiff {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
  lines: { kind: 'ctx' | 'add' | 'del'; text: string }[];
}
interface ProcessCard {
  datasets: string[];
  materials: string[];
  summary: string[];
  notes?: string[];
}
interface TurnResult {
  matched: boolean;
  ok: boolean;
  reply: string;
  pipeline?: 'build' | 'schema';
  buildMs?: number;
  attempts?: { note: string; ok: boolean; error?: string }[];
  processCard?: ProcessCard;
  diff?: { schema: { summary: string[]; destructive: boolean; opCount: number }; code: FileDiff[] };
  commit?: { hash: string; round: number | null };
  previewUrl?: string;
}
interface Msg {
  role: 'user' | 'assistant';
  text: string;
  result?: TurnResult;
  selection?: string;
}

const SAMPLES = [
  '做一份周报：DAU 趋势 + 渠道占比，按区域筛选',
  '改成环形图，点击某个渠道时联动趋势图只看该渠道',
  '加一个留存漏斗块',
];

const C = {
  ink: '#1f2329', sub: '#646a73', line: '#e5e6eb', brand: '#3370ff',
  add: '#e7f4ea', addInk: '#1a7f37', del: '#ffeef0', delInk: '#cf222e',
  cardBg: '#f7f8fa', warn: '#bc4c00',
};

function Pill({ text, bg, color }: { text: string; bg: string; color: string }) {
  return h('span', { style: { background: bg, color, fontSize: 11, padding: '1px 7px', borderRadius: 10, fontWeight: 600 } }, text);
}

function Section({ title, children }: { title: string; children: unknown }) {
  return h('div', { style: { marginTop: 8 } },
    h('div', { style: { fontSize: 11, color: C.sub, marginBottom: 3, fontWeight: 600 } }, title),
    children as never,
  );
}

function ProcessCardView({ card }: { card: ProcessCard }) {
  const chips = (items: string[], bg: string, color: string) =>
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
      ...items.map((t) => h('span', { key: t, style: { background: bg, color, fontSize: 11, padding: '1px 6px', borderRadius: 4 } }, t)));
  return h('div', { style: { background: C.cardBg, border: `1px solid ${C.line}`, borderRadius: 8, padding: 10, marginTop: 8 } },
    h('div', { style: { fontSize: 11, color: C.sub, fontWeight: 600, marginBottom: 6 } }, '过程卡'),
    Section({ title: '数据集', children: chips(card.datasets, '#eaf2ff', '#1554ad') }),
    Section({ title: '物料', children: chips(card.materials, '#f0eaff', '#5a3bb5') }),
    Section({
      title: '变更摘要',
      children: h('ul', { style: { margin: '2px 0 0', paddingLeft: 16, fontSize: 12, color: C.ink, lineHeight: 1.6 } },
        ...card.summary.map((s, i) => h('li', { key: i }, s))),
    }),
    card.notes?.length
      ? Section({ title: '说明', children: h('div', { style: { fontSize: 11, color: C.warn, lineHeight: 1.6 } }, ...card.notes.map((n, i) => h('div', { key: i }, '· ' + n))) })
      : null,
  );
}

function lineStyle(kind: 'ctx' | 'add' | 'del'): CSSProperties {
  const base: CSSProperties = { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, padding: '0 6px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' };
  if (kind === 'add') return { ...base, background: C.add, color: C.addInk };
  if (kind === 'del') return { ...base, background: C.del, color: C.delInk };
  return { ...base, color: C.sub };
}

function DualDiff({ diff }: { diff: NonNullable<TurnResult['diff']> }) {
  const [open, setOpen] = useState(false);
  const codeFiles = diff.code.length;
  return h('div', { style: { marginTop: 8, border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden' } },
    h('button', {
      onClick: () => setOpen((v) => !v),
      style: { width: '100%', textAlign: 'left', border: 'none', background: C.cardBg, padding: '7px 10px', cursor: 'pointer', fontSize: 12, color: C.ink, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
    },
      h('span', null, `${open ? '▾' : '▸'} 双 diff · schema ${diff.schema.opCount} 处${codeFiles ? ` · 代码 ${codeFiles} 文件` : ''}`),
      diff.schema.destructive ? Pill({ text: '破坏性', bg: C.del, color: C.delInk }) : null,
    ),
    open ? h('div', { style: { padding: 10 } },
      Section({
        title: 'schema diff',
        children: h('div', { style: { display: 'flex', flexDirection: 'column', gap: 1 } },
          ...diff.schema.summary.map((s, i) => h('div', { key: i, style: lineStyle(s.startsWith('+') ? 'add' : s.startsWith('-') ? 'del' : 'ctx') }, s))),
      }),
      ...diff.code.map((f) =>
        Section({
          title: `${f.path}  (+${f.additions} −${f.deletions})`,
          children: h('div', { style: { border: `1px solid ${C.line}`, borderRadius: 6, overflow: 'hidden', maxHeight: 220, overflowY: 'auto' } },
            ...f.lines.map((l, i) => h('div', { key: i, style: lineStyle(l.kind) }, (l.kind === 'add' ? '+ ' : l.kind === 'del' ? '- ' : '  ') + l.text))),
        }),
      ),
    ) : null,
  );
}

function Assistant({ r }: { r: TurnResult }) {
  const repaired = (r.attempts ?? []).filter((a) => !a.ok).length;
  return h('div', { style: { display: 'flex', flexDirection: 'column' } },
    h('div', { style: { fontSize: 13, color: C.ink, lineHeight: 1.6 } }, r.reply),
    r.ok ? h('div', { style: { display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' } },
      r.pipeline === 'schema'
        ? Pill({ text: '零构建直更新 ≤2s', bg: '#e7f4ea', color: C.addInk })
        : Pill({ text: `esbuild 构建 ${r.buildMs}ms`, bg: '#eaf2ff', color: '#1554ad' }),
      repaired ? Pill({ text: `自修复 ${repaired} 次`, bg: '#fff3e0', color: C.warn }) : null,
      r.commit ? Pill({ text: `round(${r.commit.round}) ${r.commit.hash.slice(0, 7)}`, bg: C.cardBg, color: C.sub }) : null,
    ) : null,
    repaired ? h('div', { style: { marginTop: 6, fontSize: 11, color: C.warn } },
      ...(r.attempts ?? []).filter((a) => !a.ok).map((a, i) => h('div', { key: i }, `✗ ${a.note}：${(a.error ?? '').split('\n')[0]}`))) : null,
    r.processCard ? ProcessCardView({ card: r.processCard }) : null,
    r.diff ? DualDiff({ diff: r.diff }) : null,
  );
}

function ChatPanel() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [msgs, busy]);

  async function send(message: string) {
    const msg = message.trim();
    if (!msg || busy) return;
    const sel = currentSelection();
    setMsgs((m) => [...m, { role: 'user', text: msg, selection: sel?.componentName ? `选区: ${sel.componentName}` : undefined }]);
    setText('');
    setBusy(true);
    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: msg, selection: sel }),
      });
      const result = (await res.json()) as TurnResult;
      setMsgs((m) => [...m, { role: 'assistant', text: result.reply, result }]);
      if (result.ok) {
        if (result.previewUrl) emitPreview(result.previewUrl);
        await reloadDesigner();
        emitTimeline();
      }
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', text: `请求失败：${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', background: '#fff' } },
    h('div', { ref: scroller, style: { flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 } },
      msgs.length === 0 ? h('div', { style: { color: C.sub, fontSize: 12, lineHeight: 1.8 } },
        h('div', { style: { fontWeight: 600, color: C.ink, marginBottom: 6 } }, '从空白报告开始，试试：'),
        ...SAMPLES.map((s, i) => h('div', {
          key: i, onClick: () => send(s),
          style: { cursor: 'pointer', color: C.brand, padding: '4px 0' },
        }, `${i + 1}. ${s}`)),
        h('div', { style: { marginTop: 8, color: C.sub } }, '② 前先在画布选中"渠道占比"图，体验标注修改。'),
      ) : null,
      ...msgs.map((m, i) => h('div', { key: i, style: { display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'stretch' } },
        m.role === 'user'
          ? h('div', { style: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, maxWidth: '90%' } },
              m.selection ? h('span', { style: { fontSize: 10, color: C.brand } }, m.selection) : null,
              h('div', { style: { background: C.brand, color: '#fff', padding: '7px 11px', borderRadius: 10, fontSize: 13, lineHeight: 1.5 } }, m.text))
          : h('div', { style: { background: '#fff', border: `1px solid ${C.line}`, borderRadius: 10, padding: 11 } },
              m.result ? Assistant({ r: m.result }) : h('div', { style: { fontSize: 13, color: C.ink } }, m.text)),
      )),
      busy ? h('div', { style: { color: C.sub, fontSize: 12 } }, 'Agent 规划中（取数理解 → 结构规划 → 落 schema/代码 → 构建）…') : null,
    ),
    h('div', { style: { borderTop: `1px solid ${C.line}`, padding: 10, display: 'flex', gap: 8 } },
      h('input', {
        value: text, disabled: busy, placeholder: '描述你的报告需求…',
        onChange: (e: { target: { value: string } }) => setText(e.target.value),
        onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') void send(text); },
        style: { flex: 1, padding: '8px 12px', borderRadius: 6, border: `1px solid ${C.line}`, fontSize: 13, outline: 'none' },
      }),
      h('button', {
        onClick: () => void send(text), disabled: busy || !text.trim(),
        style: { padding: '0 16px', borderRadius: 6, border: 'none', background: busy || !text.trim() ? '#c9d3e8' : C.brand, color: '#fff', fontSize: 13, cursor: 'pointer' },
      }, '发送'),
    ),
  );
}

const ChatPanePlugin = (ctx: IPublicModelPluginContext) => ({
  async init() {
    ctx.skeleton.add({
      area: 'leftArea', type: 'PanelDock', name: 'dafChatPane',
      content: () => h(Fragment, null, h(ChatPanel)),
      panelProps: { width: 380, title: '对话搭建' },
      props: { align: 'top', icon: 'xiaoxi', description: '对话搭建' },
    });
  },
});
ChatPanePlugin.pluginName = 'ChatPanePlugin';
ChatPanePlugin.meta = { dependencies: ['EditorInitPlugin'] };
export default ChatPanePlugin;
