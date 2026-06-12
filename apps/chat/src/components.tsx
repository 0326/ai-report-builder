/** 助手消息的结构化渲染：执行步骤（ThoughtChain）+ 流式正文 + 本轮变更卡（双 diff）。 */
import { ThoughtChain, type ThoughtChainItem } from '@ant-design/x';
import { Collapse, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined,
  DatabaseOutlined, FileTextOutlined, RocketOutlined, EditOutlined, FolderOpenOutlined,
} from '@ant-design/icons';
import type { CSSProperties } from 'react';
import type { RoundResult, DiffLine } from './sse.ts';
import { Markdown } from './markdown.tsx';

export interface ToolStep {
  name: string;
  detail: string;
  status: 'process' | 'success' | 'error';
  resultDetail?: string;
}

export interface TurnView {
  thinking: string;
  steps: ToolStep[];
  text: string;
  round?: RoundResult;
  error?: string;
  running: boolean;
}

const TOOL_ICON: Record<string, JSX.Element> = {
  read_project: <FolderOpenOutlined />,
  read_file: <FileTextOutlined />,
  query_dataset: <DatabaseOutlined />,
  stage_schema: <EditOutlined />,
  stage_file: <EditOutlined />,
  commit_round: <RocketOutlined />,
};

function stepItems(steps: ToolStep[]): ThoughtChainItem[] {
  return steps.map((s, i) => ({
    key: String(i),
    title: s.detail,
    icon: s.status === 'process' ? <LoadingOutlined /> : (TOOL_ICON[s.name] ?? <FileTextOutlined />),
    status: s.status === 'process' ? 'pending' : s.status,
    description: s.status === 'error' ? s.resultDetail : undefined,
  }));
}

function lineStyle(kind: DiffLine['kind']): CSSProperties {
  const base: CSSProperties = {
    fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, padding: '0 6px',
    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
  };
  if (kind === 'add') return { ...base, background: '#e7f4ea', color: '#1a7f37' };
  if (kind === 'del') return { ...base, background: '#ffeef0', color: '#cf222e' };
  return { ...base, color: '#646a73' };
}

function RoundCard({ round }: { round: RoundResult }) {
  const { diff } = round;
  const items = [];
  if (diff.schema.opCount > 0) {
    items.push({
      key: 'schema',
      label: `schema diff · ${diff.schema.opCount} 处`,
      children: (
        <div>
          {diff.schema.summary.map((s, i) => (
            <div key={i} style={lineStyle(s.startsWith('+') ? 'add' : s.startsWith('-') ? 'del' : 'ctx')}>{s}</div>
          ))}
        </div>
      ),
    });
  }
  for (const f of diff.code) {
    items.push({
      key: f.path,
      label: `${f.path}  (+${f.additions} −${f.deletions})`,
      children: (
        <div style={{ maxHeight: 240, overflowY: 'auto' }}>
          {f.lines.map((l, i) => (
            <div key={i} style={lineStyle(l.kind as DiffLine['kind'])}>
              {(l.kind === 'add' ? '+ ' : l.kind === 'del' ? '- ' : '  ') + l.text}
            </div>
          ))}
        </div>
      ),
    });
  }
  return (
    <div style={{ marginTop: 8, border: '1px solid #e5e6eb', borderRadius: 8, padding: 10, background: '#fafbfc' }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: items.length ? 8 : 0 }}>
        {round.pipeline === 'schema'
          ? <Tag color="green" style={{ margin: 0 }}>零构建直更新 {round.buildMs}ms</Tag>
          : <Tag color="blue" style={{ margin: 0 }}>esbuild 构建 {round.buildMs}ms</Tag>}
        <Tag style={{ margin: 0 }}>round({round.commit.round}) {round.commit.hash.slice(0, 7)}</Tag>
        {diff.schema.destructive && <Tag color="red" style={{ margin: 0 }}>破坏性变更</Tag>}
      </div>
      {items.length > 0 && <Collapse size="small" ghost items={items} />}
    </div>
  );
}

export function AssistantContent({ view }: { view: TurnView }) {
  return (
    <div style={{ minWidth: 0 }}>
      {view.thinking && (
        <Typography.Paragraph
          type="secondary"
          style={{ fontSize: 12, marginBottom: 8, whiteSpace: 'pre-wrap', borderLeft: '3px solid #e5e6eb', paddingLeft: 8 }}
          ellipsis={{ rows: 3, expandable: true, symbol: '展开思考' }}
        >
          {view.thinking}
        </Typography.Paragraph>
      )}
      {view.steps.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <ThoughtChain size="small" items={stepItems(view.steps)} />
        </div>
      )}
      {view.text && <Markdown text={view.text} />}
      {view.running && !view.text && view.steps.length === 0 && !view.thinking && (
        <span style={{ color: '#8f959e', fontSize: 13 }}>规划中…</span>
      )}
      {view.round && <RoundCard round={view.round} />}
      {view.error && (
        <div style={{ marginTop: 6, color: '#cf222e', fontSize: 12 }}>
          <CloseCircleOutlined /> {view.error}
        </div>
      )}
      {!view.running && view.round?.ok && (
        <div style={{ marginTop: 6, color: '#1a7f37', fontSize: 12 }}>
          <CheckCircleOutlined /> 预览已切换到最新产物
        </div>
      )}
    </div>
  );
}
