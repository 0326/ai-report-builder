/**
 * AI 报告搭建工作台（React 18 + Ant Design X）：左对话 / 右运行态预览。
 * - 对话：/api/agent/chat SSE 流式（真实 Claude Agent；无凭证回落剧本）
 * - 标注（Claude Desktop preview 形态）：标注模式下在预览里点选块 →
 *   选区成为输入框上方 chip → 随消息作为上下文发给模型
 * - 每轮提交后切预览产物 URL，并 postMessage 通知宿主（LCE 设计器重载 + 时间线刷新）
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Bubble, Sender } from '@ant-design/x';
import { Button, Tag, Tooltip, Alert, App as AntApp, ConfigProvider } from 'antd';
import {
  AimOutlined, ReloadOutlined, ExportOutlined, PlusOutlined, CloseOutlined, RobotOutlined,
} from '@ant-design/icons';
import { connectPreview, type PreviewHandle } from '@daf/designtime-sdk';
import type { SelectionCtx } from '@daf/designtime-sdk';
import { streamChat, type RoundResult } from './sse.ts';
import { AssistantContent, type TurnView, type ToolStep } from './components.tsx';

const SAMPLES = [
  '做一份周报：DAU 趋势 + 渠道占比，按区域筛选',
  '改成环形图，点击某个渠道时联动趋势图只看该渠道',
  '加一个留存漏斗块',
];

interface Msg {
  id: number;
  role: 'user' | 'ai';
  text?: string;
  selectionLabel?: string;
  view?: TurnView;
}

const sessionId = crypto.randomUUID();
const DT_TOKEN = crypto.randomUUID();

function withDesigntime(url: string): string {
  return url + (url.includes('?') ? '&' : '?') + `designtime=1&dtToken=${DT_TOKEN}`;
}

function notifyHost(round: RoundResult): void {
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'daf-chat:round', previewUrl: round.previewUrl, hash: round.commit.hash }, '*');
  }
}

function ChatApp() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<{ llm: boolean; model: string | null } | null>(null);
  const [previewUrl, setPreviewUrl] = useState('/preview/');
  const [annotating, setAnnotating] = useState(false);
  const [selection, setSelection] = useState<SelectionCtx | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const handleRef = useRef<PreviewHandle | null>(null);
  const annotatingRef = useRef(false);
  const idRef = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetch('/api/agent/config').then((r) => r.json()).then(setConfig).catch(() => setConfig({ llm: false, model: null }));
  }, []);

  useEffect(() => { annotatingRef.current = annotating; }, [annotating]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); });

  /** 预览 iframe 每次加载后重建 Bridge（产物切换 = 整页重载）。 */
  const onIframeLoad = useCallback(() => {
    handleRef.current?.dispose();
    const iframe = iframeRef.current;
    if (!iframe) return;
    const handle = connectPreview(iframe, DT_TOKEN, {
      onSelect: (ctx) => {
        setSelection(ctx);
        setAnnotating(false);
        void handleRef.current?.enable('browse');
      },
    });
    handleRef.current = handle;
    void handle.whenReady.then(() => {
      if (annotatingRef.current) void handle.enable('annotate');
    });
  }, []);

  const toggleAnnotate = useCallback(() => {
    const next = !annotatingRef.current;
    setAnnotating(next);
    void handleRef.current?.enable(next ? 'annotate' : 'browse');
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(null);
    void handleRef.current?.highlight(null);
  }, []);

  async function send(raw: string) {
    const message = raw.trim();
    if (!message || busy) return;
    setBusy(true);
    setInput('');
    const sel = selection;
    const selectionLabel = sel ? `已标注: ${(sel.schemaSlice as { title?: string } | undefined)?.title || sel.nodeId}` : undefined;
    const aiId = idRef.current + 1;
    idRef.current += 2;

    const view: TurnView = { thinking: '', steps: [], text: '', running: true };
    setMsgs((m) => [
      ...m,
      { id: aiId - 1, role: 'user', text: message, selectionLabel },
      { id: aiId, role: 'ai', view: { ...view } },
    ]);
    setSelection(null);
    void handleRef.current?.highlight(null);

    const patch = () => setMsgs((m) => m.map((x) => (x.id === aiId ? { ...x, view: { ...view, steps: [...view.steps] } } : x)));

    try {
      await streamChat(
        {
          sessionId,
          message,
          selection: sel ? { nodeId: sel.nodeId, componentName: (sel.schemaSlice as { componentName?: string } | undefined)?.componentName, schemaSlice: sel.schemaSlice } : undefined,
        },
        (ev) => {
          if (ev.t === 'text') view.text += ev.delta;
          else if (ev.t === 'thinking') view.thinking += ev.delta;
          else if (ev.t === 'tool') view.steps.push({ name: ev.name, detail: ev.detail, status: 'process' } satisfies ToolStep);
          else if (ev.t === 'tool_result') {
            const step = [...view.steps].reverse().find((s) => s.name === ev.name && s.status === 'process');
            if (step) {
              step.status = ev.ok ? 'success' : 'error';
              step.resultDetail = ev.detail;
            }
          } else if (ev.t === 'round') {
            view.round = ev.result;
            if (ev.result.ok) {
              setPreviewUrl(ev.result.previewUrl);
              notifyHost(ev.result);
            }
          } else if (ev.t === 'error') view.error = ev.message;
          patch();
        },
      );
    } catch (e) {
      view.error = (e as Error).message;
    }
    view.running = false;
    patch();
    setBusy(false);
  }

  async function newSession() {
    await fetch('/api/agent/reset', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId }),
    }).catch(() => undefined);
    setMsgs([]);
  }

  const bubbleItems = msgs.map((m) =>
    m.role === 'user'
      ? {
          key: m.id, role: 'user' as const,
          content: (
            <div>
              {m.selectionLabel && <div style={{ fontSize: 11, opacity: 0.85, marginBottom: 2 }}><AimOutlined /> {m.selectionLabel}</div>}
              {m.text}
            </div>
          ),
        }
      : { key: m.id, role: 'ai' as const, content: <AssistantContent view={m.view!} /> },
  );

  const selTitle = selection ? ((selection.schemaSlice as { title?: string } | undefined)?.title || selection.nodeId) : '';

  return (
    <div style={{ display: 'flex', height: '100vh', minWidth: 0 }}>
      {/* 左：对话 */}
      <div style={{ width: 440, minWidth: 360, display: 'flex', flexDirection: 'column', borderRight: '1px solid #e5e6eb' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #e5e6eb', display: 'flex', alignItems: 'center', gap: 8 }}>
          <RobotOutlined style={{ color: '#3370ff' }} />
          <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>对话搭建</span>
          {config && (config.llm
            ? <Tag color="geekblue" style={{ margin: 0 }}>{config.model}</Tag>
            : <Tooltip title="在仓库根 .env 写入 ANTHROPIC_API_KEY=sk-… 后重启 pnpm dev 即接入真实模型"><Tag color="orange" style={{ margin: 0 }}>剧本模式</Tag></Tooltip>)}
          <Tooltip title="新会话"><Button size="small" type="text" icon={<PlusOutlined />} onClick={() => void newSession()} /></Tooltip>
        </div>

        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
          {msgs.length === 0 ? (
            <div style={{ color: '#646a73', fontSize: 13, lineHeight: 2 }}>
              <div style={{ fontWeight: 600, color: '#1f2329', marginBottom: 4 }}>从空白报告开始，试试：</div>
              {SAMPLES.map((s, i) => (
                <div key={i} style={{ cursor: 'pointer', color: '#3370ff' }} onClick={() => void send(s)}>{i + 1}. {s}</div>
              ))}
              <div style={{ marginTop: 10, fontSize: 12, color: '#8f959e' }}>
                <AimOutlined /> 点右上「标注」后在预览里点选任意块，再描述改法 —— 选区会作为上下文发给模型。
              </div>
            </div>
          ) : (
            <Bubble.List
              items={bubbleItems}
              roles={{
                user: { placement: 'end', variant: 'filled', styles: { content: { background: '#3370ff', color: '#fff', maxWidth: 360 } } },
                ai: { placement: 'start', variant: 'outlined', styles: { content: { maxWidth: 392, width: '100%' } } },
              }}
            />
          )}
        </div>

        <div style={{ padding: 12, borderTop: '1px solid #e5e6eb' }}>
          <Sender
            value={input}
            onChange={setInput}
            onSubmit={(v) => void send(v)}
            loading={busy}
            disabled={busy}
            placeholder={selection ? `针对「${selTitle}」描述修改…` : '描述你的报告需求…'}
            header={
              selection ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: '#f0f6ff', borderRadius: 8, margin: '0 0 6px', fontSize: 12 }}>
                  <AimOutlined style={{ color: '#3370ff' }} />
                  <span style={{ flex: 1, color: '#1f2329' }}>已标注: <b>{selTitle}</b> <span style={{ color: '#8f959e' }}>{selection.nodeId}</span></span>
                  <Button size="small" type="text" icon={<CloseOutlined />} onClick={clearSelection} />
                </div>
              ) : undefined
            }
            prefix={
              <Tooltip title={annotating ? '退出标注' : '标注：在预览中点选要修改的块'}>
                <Button type={annotating ? 'primary' : 'text'} icon={<AimOutlined />} onClick={toggleAnnotate} />
              </Tooltip>
            }
          />
        </div>
      </div>

      {/* 右：运行态预览 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: '#f5f6f7' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #e5e6eb', background: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button size="small" type={annotating ? 'primary' : 'default'} icon={<AimOutlined />} onClick={toggleAnnotate}>
            {annotating ? '点选预览中的块…' : '标注'}
          </Button>
          <span style={{ flex: 1, fontSize: 12, color: '#8f959e', fontFamily: 'ui-monospace, Menlo, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previewUrl}</span>
          <Tooltip title="刷新"><Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => iframeRef.current && (iframeRef.current.src = iframeRef.current.src)} /></Tooltip>
          <Tooltip title="新窗口打开"><Button size="small" type="text" icon={<ExportOutlined />} href={previewUrl} target="_blank" /></Tooltip>
        </div>
        {annotating && (
          <Alert type="info" banner showIcon icon={<AimOutlined />} message="标注模式：移动到块上高亮，点击选中后回到左侧描述修改" style={{ fontSize: 12 }} />
        )}
        <iframe
          ref={iframeRef}
          src={withDesigntime(previewUrl)}
          title="report-preview"
          onLoad={onIframeLoad}
          style={{ flex: 1, border: 'none', width: '100%' }}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <ConfigProvider theme={{ token: { colorPrimary: '#3370ff', borderRadius: 8 } }}>
    <AntApp><ChatApp /></AntApp>
  </ConfigProvider>,
);
