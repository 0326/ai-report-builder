/** 结构树：块层级与布局的 schema 投影；点选 → 选中 + 预览高亮 */
import { Tree, Typography, Tag } from 'antd';
import type { DataNode } from 'antd/es/tree';
import type { ReportSchema, SchemaNode } from '@daf/report-runtime/core';
import { getPage } from '../schema-utils.ts';

const CATEGORY_ICON: Record<string, string> = {
  KPICard: '🔢', LineChart: '📈', BarChart: '📊', PieChart: '🥧',
  DataTable: '🗒️', TextBlock: '📝', AIBlock: '🧩',
};

function toTreeNode(n: SchemaNode): DataNode {
  const pos = n['x-position'];
  return {
    key: n.id,
    title: (
      <span>
        {CATEGORY_ICON[n.componentName] ?? '▫️'} {n.title ?? n.id}{' '}
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
          {n.componentName}{pos ? ` · ${pos.w}×${pos.h}` : ''}
        </Typography.Text>
        {n.componentName === 'AIBlock' && <Tag style={{ marginLeft: 6 }} color="purple">代码块</Tag>}
      </span>
    ),
    children: n.children?.map(toTreeNode),
  };
}

export function StructureTree({ schema, selectedId, onSelect }: {
  schema: ReportSchema;
  selectedId: string | null;
  onSelect: (nodeId: string | null) => void;
}) {
  const page = getPage(schema);
  const treeData: DataNode[] = [{
    key: '__page__',
    title: <span>📄 {(page.props?.title as string) ?? 'Page'}</span>,
    children: page.children.map(toTreeNode),
  }];

  return (
    <Tree
      treeData={treeData}
      defaultExpandAll
      selectedKeys={selectedId ? [selectedId] : []}
      onSelect={(keys) => {
        const k = keys[0] as string | undefined;
        onSelect(k && k !== '__page__' ? k : null);
      }}
      blockNode
    />
  );
}
