/** 数据源视图：dataSource / x-filters 及块消费关系（schema 投影，只读） */
import { Card, Tag, Typography, Space } from 'antd';
import type { ReportSchema, SchemaNode } from '@daf/report-runtime/core';
import { getPage, isExpression } from '../schema-utils.ts';

export function DataSourceView({ schema, onSelect }: {
  schema: ReportSchema;
  onSelect: (nodeId: string) => void;
}) {
  const page = getPage(schema);
  const list = page.dataSource?.list ?? [];
  const filters = page['x-filters'] ?? [];

  const consumersOf = (dsId: string): SchemaNode[] => {
    const out: SchemaNode[] = [];
    const walk = (nodes: SchemaNode[] | undefined) => {
      for (const n of nodes ?? []) {
        if (n['x-consumes']?.includes(dsId)) out.push(n);
        walk(n.children);
      }
    };
    walk(page.children);
    return out;
  };

  return (
    <Space direction="vertical" size={10} style={{ width: '100%', paddingBottom: 16 }}>
      {filters.length > 0 && (
        <Card size="small" title="全局筛选 x-filters" styles={{ body: { padding: '8px 12px' } }}>
          {filters.map((f) => (
            <div key={f.id} style={{ fontSize: 12, lineHeight: 2 }}>
              <Tag color="orange">{f.id}</Tag>
              {f.label} → <code>state.{f.stateKey}</code>（默认 {String(f.default)}）
            </div>
          ))}
        </Card>
      )}
      {list.map((d) => (
        <Card key={d.id} size="small" styles={{ body: { padding: '8px 12px' } }}
          title={<span><Tag color="blue">{d.id}</Tag><code style={{ fontSize: 12 }}>{d.options.datasetId}</code></span>}
          extra={<Tag>{d['x-trigger'] ?? 'auto'}</Tag>}
        >
          <div style={{ fontSize: 12, color: '#646a73' }}>
            <div>字段：{(d.options.fields ?? []).join(', ') || '—'}</div>
            {Object.entries(d.options.params ?? {}).map(([k, v]) => (
              <div key={k}>参数 {k}：{isExpression(v) ? <code>ƒ {(v as { value: string }).value}</code> : JSON.stringify(v)}</div>
            ))}
            <div style={{ marginTop: 4 }}>
              消费方：
              {consumersOf(d.id).map((n) => (
                <Tag key={n.id} style={{ cursor: 'pointer' }} onClick={() => onSelect(n.id)}>{n.title ?? n.id}</Tag>
              ))}
            </div>
          </div>
        </Card>
      ))}
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        块只能消费 x-consumes 声明的数据源（lint + 运行期双重拒绝）
      </Typography.Text>
    </Space>
  );
}
