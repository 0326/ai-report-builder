/**
 * 数据源面板（真实数据层）：上传 CSV/TSV → 成为可查询数据集 → Agent / 物料据此搭建。
 * 列出内置示例 + 用户上传数据集，支持预览前若干行、删除。去 mock 的入口。
 */
import { createElement as h, useState, useEffect, useCallback, Fragment } from 'react';
import type { IPublicModelPluginContext } from '@alilc/lowcode-types';

interface Field { name: string; type: string; role: 'dimension' | 'measure' }
interface DatasetMeta { id: string; title: string; source: 'builtin' | 'upload'; fields: Field[]; rowCount: number; filterable: string[] }

const C = { ink: '#1f2329', sub: '#646a73', line: '#eceef1', brand: '#3370ff', up: '#7c3aed' };

function TypeTag({ field }: { field: Field }) {
  const color = field.role === 'measure' ? '#1554ad' : '#5a3bb5';
  const bg = field.role === 'measure' ? '#eaf2ff' : '#f0eaff';
  return h('span', {
    title: `${field.type} · ${field.role === 'measure' ? '度量' : '维度'}`,
    style: { background: bg, color, fontSize: 11, padding: '1px 6px', borderRadius: 4, marginRight: 4, marginBottom: 4, display: 'inline-block' },
  }, field.name);
}

function DataPanel() {
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ rows: Record<string, unknown>[] } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string>('');

  const refresh = useCallback(async () => {
    const d = await fetch('/api/datasets').then((r) => r.json());
    setDatasets(d.datasets ?? []);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function onFile(file: File) {
    setUploading(true);
    setMsg('');
    try {
      const text = await file.text();
      const res = await fetch(`/api/datasets?name=${encodeURIComponent(file.name)}`, {
        method: 'POST', headers: { 'content-type': 'text/plain' }, body: text,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? '上传失败');
      setMsg(`✓ 已导入 ${body.id}（${body.rowCount} 行）`);
      await refresh();
    } catch (e) {
      setMsg(`✗ ${(e as Error).message}`);
    } finally {
      setUploading(false);
    }
  }

  async function toggle(id: string) {
    if (expanded === id) { setExpanded(null); setPreview(null); return; }
    setExpanded(id);
    setPreview(null);
    const p = await fetch(`/api/datasets/${encodeURIComponent(id)}/preview`).then((r) => r.json());
    setPreview({ rows: p.rows ?? [] });
  }

  async function del(id: string, e: { stopPropagation(): void }) {
    e.stopPropagation();
    await fetch(`/api/datasets/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (expanded === id) { setExpanded(null); setPreview(null); }
    await refresh();
  }

  const uploads = datasets.filter((d) => d.source === 'upload');
  const builtins = datasets.filter((d) => d.source === 'builtin');

  const card = (d: DatasetMeta) => {
    const open = expanded === d.id;
    return h('div', { key: d.id, style: { border: `1px solid ${open ? C.brand : C.line}`, borderRadius: 8, marginBottom: 8, overflow: 'hidden' } },
      h('div', {
        onClick: () => void toggle(d.id),
        style: { padding: '8px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, background: open ? '#f0f6ff' : '#fff' },
      },
        h('span', { style: { fontWeight: 600, fontSize: 13, color: C.ink, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, d.title),
        h('span', { style: { fontSize: 11, color: C.sub } }, `${d.rowCount} 行`),
        d.source === 'upload'
          ? h('span', { onClick: (e: never) => void del(d.id, e), title: '删除', style: { color: '#cf222e', cursor: 'pointer', fontSize: 12, padding: '0 2px' } }, '✕')
          : null,
      ),
      open ? h('div', { style: { padding: 10, borderTop: `1px solid ${C.line}` } },
        h('div', { style: { fontSize: 10, color: C.sub, marginBottom: 4, fontFamily: 'ui-monospace, Menlo, monospace' } }, d.id),
        h('div', { style: { marginBottom: 6 } }, ...d.fields.map((f) => TypeTag({ field: f }))),
        preview && preview.rows.length
          ? h('div', { style: { overflowX: 'auto', border: `1px solid ${C.line}`, borderRadius: 6 } },
              h('table', { style: { borderCollapse: 'collapse', fontSize: 11, width: '100%' } },
                h('thead', null, h('tr', null, ...d.fields.map((f) => h('th', { key: f.name, style: { textAlign: 'left', padding: '3px 6px', borderBottom: `1px solid ${C.line}`, color: C.sub, whiteSpace: 'nowrap' } }, f.name)))),
                h('tbody', null, ...preview.rows.slice(0, 6).map((row, i) =>
                  h('tr', { key: i }, ...d.fields.map((f) => h('td', { key: f.name, style: { padding: '3px 6px', borderBottom: `1px solid #f5f6f7`, whiteSpace: 'nowrap' } }, String(row[f.name] ?? '')))))),
              ))
          : h('div', { style: { fontSize: 12, color: C.sub } }, '加载预览…'),
      ) : null,
    );
  };

  return h('div', { style: { height: '100%', overflowY: 'auto', padding: 12, background: '#fff' } },
    // 上传区
    h('label', {
      style: {
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
        border: `1.5px dashed ${uploading ? C.brand : '#c9d3e8'}`, borderRadius: 10, padding: '16px 12px',
        cursor: uploading ? 'wait' : 'pointer', color: C.up, background: '#fbfaff', marginBottom: 6, textAlign: 'center',
      },
    },
      h('div', { style: { fontSize: 22 } }, '⬆'),
      h('div', { style: { fontSize: 13, fontWeight: 600, color: C.ink } }, uploading ? '解析中…' : '上传 CSV / TSV 数据'),
      h('div', { style: { fontSize: 11, color: C.sub } }, '拖入或点击选择文件 · 自动识别列类型'),
      h('input', {
        type: 'file', accept: '.csv,.tsv,.txt,text/csv', disabled: uploading, style: { display: 'none' },
        onChange: (e: { target: { files: FileList | null } }) => { const f = e.target.files?.[0]; if (f) void onFile(f); },
      }),
    ),
    msg ? h('div', { style: { fontSize: 12, color: msg.startsWith('✓') ? '#1a7f37' : '#cf222e', marginBottom: 8, padding: '0 2px' } }, msg) : null,

    uploads.length ? h('div', { style: { fontSize: 11, color: C.sub, fontWeight: 600, margin: '6px 2px 6px' } }, `我的数据（${uploads.length}）`) : null,
    ...uploads.map(card),

    h('div', { style: { fontSize: 11, color: C.sub, fontWeight: 600, margin: '10px 2px 6px' } }, '示例数据'),
    ...builtins.map(card),
  );
}

const DataPanePlugin = (ctx: IPublicModelPluginContext) => ({
  async init() {
    ctx.skeleton.add({
      area: 'leftArea', type: 'PanelDock', name: 'dafDataPane',
      content: () => h(Fragment, null, h(DataPanel)),
      panelProps: { width: 340, title: '数据源' },
      props: { align: 'top', icon: 'shujuyuan', description: '数据源' },
    });
  },
});
DataPanePlugin.pluginName = 'DataPanePlugin';
DataPanePlugin.meta = { dependencies: ['EditorInitPlugin'] };
export default DataPanePlugin;
