/**
 * 属性面板：materialMetas.configurableProps 生成表单（AIBlock 用普通 props 类型推断兜底）。
 * 改动 → onChangeSchema（声明性直更新管线，零构建）。表达式绑定的 prop 只展示不编辑。
 */
import { Form, Input, InputNumber, Switch, Select, Tag, Typography, Divider, Empty } from 'antd';
import type { ReportSchema, SchemaNode } from '@daf/report-runtime/core';
import { findNode } from '@daf/report-runtime/core';
import { getMaterialMeta } from '@daf-materials/kit/meta';
import { setNodeProp, setNodeTitle, isExpression } from '../schema-utils.ts';

interface PropField {
  name: string;
  title: string;
  type: 'boolean' | 'string' | 'number' | 'enum';
  options?: string[];
}

/** AIBlock / 无 meta 物料：从现有普通 props 推断可编辑字段 */
function inferFields(node: SchemaNode): PropField[] {
  return Object.entries(node.props ?? {})
    .filter(([k, v]) => k !== 'entry' && !isExpression(v) && ['boolean', 'string', 'number'].includes(typeof v))
    .map(([k, v]) => ({ name: k, title: k, type: typeof v as PropField['type'] }));
}

export function PropertyForm({ schema, selectedId, onChangeSchema }: {
  schema: ReportSchema;
  selectedId: string | null;
  onChangeSchema: (updater: (prev: ReportSchema) => ReportSchema) => void;
}) {
  const node = selectedId ? findNode(schema, selectedId) : undefined;
  if (!node) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="在结构树或预览中选中一个块" style={{ margin: '24px 0' }} />;
  }

  const meta = getMaterialMeta(node.componentName);
  const fields: PropField[] = meta?.configurableProps?.length ? meta.configurableProps : inferFields(node);
  const exprProps = Object.entries(node.props ?? {}).filter(([, v]) => isExpression(v));

  const control = (f: PropField) => {
    const value = node.props?.[f.name];
    switch (f.type) {
      case 'boolean':
        return <Switch size="small" checked={!!value} onChange={(v) => onChangeSchema((s) => setNodeProp(s, node.id, f.name, v))} />;
      case 'number':
        return <InputNumber size="small" value={value as number} onChange={(v) => onChangeSchema((s) => setNodeProp(s, node.id, f.name, v))} style={{ width: 120 }} />;
      case 'enum':
        return (
          <Select size="small" value={value as string} style={{ width: 140 }}
            options={(f.options ?? []).map((o) => ({ label: o, value: o }))}
            onChange={(v) => onChangeSchema((s) => setNodeProp(s, node.id, f.name, v))} />
        );
      default:
        return (
          <Input size="small" value={(value as string) ?? ''} style={{ width: 160 }}
            onChange={(e) => onChangeSchema((s) => setNodeProp(s, node.id, f.name, e.target.value))} />
        );
    }
  };

  return (
    <div>
      <Divider style={{ margin: '4px 0 12px' }} />
      <Typography.Text strong>属性 · {node.id}</Typography.Text>
      <Form size="small" labelCol={{ span: 9 }} wrapperCol={{ span: 15 }} style={{ marginTop: 8 }} labelWrap>
        <Form.Item label="标题" style={{ marginBottom: 8 }}>
          <Input size="small" value={node.title ?? ''} onChange={(e) => onChangeSchema((s) => setNodeTitle(s, node.id, e.target.value))} />
        </Form.Item>
        {fields.map((f) => (
          <Form.Item key={f.name} label={f.title} style={{ marginBottom: 8 }}>
            {control(f)}
          </Form.Item>
        ))}
        {exprProps.map(([k, v]) => (
          <Form.Item key={k} label={k} style={{ marginBottom: 8 }}>
            <Tag color="geekblue" style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              ƒ {(v as { value: string }).value}
            </Tag>
          </Form.Item>
        ))}
      </Form>
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        声明性修改：仅写 schema，零构建，≤2s 生效
      </Typography.Text>
    </div>
  );
}
