/**
 * 数据绑定 Setter（可视编排核心）：选数据集 + 字段映射，替代裸 JSON 绑定。
 * - 选数据集 → 写 data prop = JSExpression `this.dataSourceMap['<id>'].data`（保存时服务端归一化补 dataSource/x-consumes）
 * - 字段下拉用数据集真实列填充；选数据集时自动把维度→类目字段、度量→数值字段
 * 用 class 组件：LCE 以 `new Setter()` 实例化，不能用 hooks。
 */
import React from 'react';

const h = React.createElement;

interface DatasetField { name: string; type: string; role: 'dimension' | 'measure' }
interface DatasetMeta { id: string; title: string; source: string; fields: DatasetField[] }
interface FieldProp { name: string; title: string }

let cache: DatasetMeta[] | null = null;
const listeners = new Set<(d: DatasetMeta[]) => void>();
async function loadDatasets(): Promise<DatasetMeta[]> {
  if (cache) return cache;
  const d = await fetch('/api/datasets').then((r) => r.json()).catch(() => ({ datasets: [] }));
  cache = d.datasets ?? [];
  listeners.forEach((fn) => fn(cache!));
  return cache!;
}
/** 数据源面板上传后使缓存失效 */
export function invalidateDatasetCache() { cache = null; void loadDatasets(); }

interface SetterProps {
  value?: unknown;
  onChange: (v: unknown) => void;
  fieldProps?: FieldProp[];
  field?: { getNode?: () => { getPropValue(n: string): unknown; setPropValue(n: string, v: unknown): void } };
}

const SEL = {
  width: '100%', height: 28, fontSize: 12, padding: '0 8px', borderRadius: 6,
  border: '1px solid #dcdfe6', background: '#fff', color: '#1f2329', cursor: 'pointer', outline: 'none',
} as const;

/** value = plain 数据集 id（绑在 `dataset` prop 上，保存时服务端归一化成 data JSExpression）。 */
function currentDsId(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

class DataBindSetter extends React.Component<SetterProps, { datasets: DatasetMeta[] }> {
  state = { datasets: cache ?? [] };

  private onData = (d: DatasetMeta[]) => this.setState({ datasets: d });

  componentDidMount() {
    void loadDatasets().then((d) => this.setState({ datasets: d }));
    listeners.add(this.onData);
  }

  componentWillUnmount() {
    listeners.delete(this.onData);
  }

  private node() {
    return this.props.field?.getNode?.();
  }

  private pickDataset = (id: string) => {
    const { onChange, fieldProps = [] } = this.props;
    if (!id) return onChange(undefined);
    onChange(id); // plain 数据集 id；data JSExpression 由服务端归一化生成
    const meta = this.state.datasets.find((d) => d.id === id);
    const node = this.node();
    if (meta && node) {
      const dims = meta.fields.filter((f) => f.role === 'dimension');
      const measures = meta.fields.filter((f) => f.role === 'measure');
      for (const fp of fieldProps) {
        const isCategory = /category|x|dimension|stage|name|^field$/i.test(fp.name);
        const pick = isCategory ? (dims[0] ?? meta.fields[0]) : (measures[0] ?? meta.fields[0]);
        if (pick) node.setPropValue(fp.name, pick.name);
      }
    }
    this.forceUpdate();
  };

  private select(val: string, onSel: (v: string) => void, opts: Array<{ value: string; label: string }>, placeholder: string) {
    return h('select', { value: val, onChange: (e: { target: { value: string } }) => onSel(e.target.value), style: SEL },
      h('option', { value: '' }, placeholder),
      ...opts.map((o) => h('option', { key: o.value, value: o.value }, o.label)),
    );
  }

  render() {
    const { value, fieldProps = [] } = this.props;
    const { datasets } = this.state;
    const dsId = currentDsId(value);
    const ds = datasets.find((d) => d.id === dsId);
    const node = this.node();
    const label = (t: string) => h('div', { style: { fontSize: 11, color: '#8f959e', margin: '8px 0 3px' } }, t);

    return h('div', { style: { width: '100%' } },
      label('数据集'),
      this.select(dsId, this.pickDataset,
        datasets.map((d) => ({ value: d.id, label: `${d.title}${d.source === 'upload' ? ' ·上传' : ''}` })),
        '选择数据集…'),
      ds && fieldProps.length
        ? h('div', null, ...fieldProps.map((fp) => {
            const cur = String(node?.getPropValue?.(fp.name) ?? '');
            return h('div', { key: fp.name },
              label(fp.title),
              this.select(cur, (v) => { node?.setPropValue(fp.name, v); this.forceUpdate(); },
                ds.fields.map((f) => ({ value: f.name, label: `${f.name}（${f.role === 'measure' ? '度量' : '维度'}）` })),
                '选择字段…'),
            );
          }))
        : null,
      ds ? h('div', { style: { fontSize: 11, color: '#8f959e', marginTop: 8, lineHeight: 1.6 } },
        `已绑定 ${ds.fields.length} 列 · 保存后自动接入数据源`) : null,
    );
  }
}

export default DataBindSetter;
