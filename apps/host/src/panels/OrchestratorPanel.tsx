/** 可视编排面板：结构树 / 数据源 / 联动 —— 全部是 schema 的投影视图 */
import { Tabs, Empty } from 'antd';
import type { ReportSchema } from '@daf/report-runtime/core';
import { StructureTree } from './StructureTree.tsx';
import { PropertyForm } from './PropertyForm.tsx';
import { DataSourceView } from './DataSourceView.tsx';
import { LinkageView } from './LinkageView.tsx';

export function OrchestratorPanel({ schema, selectedId, onSelect, onChangeSchema }: {
  schema: ReportSchema | null;
  selectedId: string | null;
  onSelect: (nodeId: string | null) => void;
  onChangeSchema: (updater: (prev: ReportSchema) => ReportSchema) => void;
}) {
  if (!schema) return <Empty style={{ marginTop: 80 }} description="schema 加载中…" />;

  return (
    <Tabs
      size="small"
      style={{ padding: '0 12px' }}
      items={[
        {
          key: 'structure',
          label: '结构树',
          children: (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <StructureTree schema={schema} selectedId={selectedId} onSelect={onSelect} />
              <PropertyForm schema={schema} selectedId={selectedId} onChangeSchema={onChangeSchema} />
            </div>
          ),
        },
        { key: 'data', label: '数据源', children: <DataSourceView schema={schema} onSelect={onSelect} /> },
        { key: 'linkage', label: '联动', children: <LinkageView schema={schema} onSelect={onSelect} /> },
      ]}
    />
  );
}
