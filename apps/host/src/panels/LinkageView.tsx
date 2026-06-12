/** 联动视图：x-linkages 有向关系（含代码联动登记项），schema 投影只读 */
import { Card, Tag, Typography, Space } from 'antd';
import type { ReportSchema } from '@daf/report-runtime/core';
import { findNode } from '@daf/report-runtime/core';
import { getPage } from '../schema-utils.ts';

export function LinkageView({ schema, onSelect }: {
  schema: ReportSchema;
  onSelect: (nodeId: string) => void;
}) {
  const page = getPage(schema);
  const linkages = page['x-linkages'] ?? [];

  return (
    <Space direction="vertical" size={10} style={{ width: '100%', paddingBottom: 16 }}>
      {linkages.map((lk) => {
        const [srcNode, srcEvent] = lk.source.split('.');
        const node = findNode(schema, srcNode);
        return (
          <Card key={lk.id} size="small" styles={{ body: { padding: '10px 12px' } }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
              <Tag color="cyan" style={{ cursor: 'pointer' }} onClick={() => onSelect(srcNode)}>
                {node?.title ?? srcNode}
              </Tag>
              <code>{srcEvent}</code>
              <span style={{ color: '#8f959e' }}>──▶</span>
              {lk.action === 'setState' ? (
                <>
                  <Tag color="orange">state.{lk.target}</Tag>
                  {lk.mapping && <code style={{ color: '#646a73' }}>ƒ {lk.mapping}</code>}
                </>
              ) : (
                <Tag color="purple">代码联动 {lk.handler}</Tag>
              )}
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>{lk.id} · {lk.action}</Typography.Text>
          </Card>
        );
      })}
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        声明式联动优先；代码联动必须在 x-linkages 登记（治理可见）
      </Typography.Text>
    </Space>
  );
}
