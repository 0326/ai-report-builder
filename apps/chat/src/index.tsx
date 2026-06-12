/**
 * AI 报告搭建工作台（React 18 + Ant Design X）：左对话 / 右运行态预览。
 * - 对话：/api/agent/chat SSE 流式（真实 Claude Agent；无凭证回落剧本）
 * - 标注（Claude Desktop preview 形态）：标注模式下在预览里点选块 →
 *   选区成为输入框上方 chip → 随消息作为上下文发给模型
 * - 每轮提交后切预览产物 URL，并 postMessage 通知宿主（LCE 设计器重载 + 时间线刷新）
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { Bubble, Sender, Welcome, Prompts } from '@ant-design/x';
import { Button, Tag, Tooltip, Alert, App as AntApp, ConfigProvider } from 'antd';
import {
  AimOutlined, ReloadOutlined, ExportOutlined, PlusOutlined, CloseOutlined,
  SettingOutlined, ThunderboltFilled, BarChartOutlined, FundOutlined, FilterOutlined,
} from '@ant-design/icons';
import { SettingsModal } from './settings.tsx';
import { injectMdStyles } from './markdown.tsx';
import { connectPreview, type PreviewHandle } from '@daf/designtime-sdk';
import type { SelectionCtx } from '@daf/designtime-sdk';
import { streamChat, type RoundResult } from './sse.ts';
import { AssistantContent, type TurnView, type ToolStep } from './components.tsx';

const SAMPLE_PROMPTS = [
  { key: '1', icon: <BarChartOutlined style={{ color: '#3370ff' }} />, label: '生成周报', description: '做一份周报：DAU 趋势 + 渠道占比，按区域筛选' },
  { key: '2', icon: <FundOutlined style={{ color: '#7c3aed' }} />, label: '标注修改', description: '改成环形图，点击某个渠道时联动趋势图只看该渠道' },
  { key: '3', icon: <FilterOutlined style={{ color: '#0d9488' }} />, label: '扩展报告', description: '加一个留存漏斗块' },
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
/** 嵌入模式（LCE 设计器 dock 内）：纯对话——预览/标注由宿主画布承载，选区经 postMessage 互通。 */
const EMBEDDED = new URLSearchParams(location.search).get('embedded') === '1';

function withDesigntime(url: string): string {
  return url + (url.includes('?') ? '&' : '?') + `designtime=1&dtToken=${DT_TOKEN}`;
}

function postToHost(msg: Record<string, unknown>): void {
  if (window.parent !== window) window.parent.postMessage(msg, '*');
}

function notifyHost(round: RoundResult): void {
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'daf-chat:round', previewUrl: round.previewUrl, hash: round.commit.hash }, '*');
  }
}

/** 选区人读描述：块标题，元素级附 ‹tag “文本”›。 */
function selectionDesc(sel: SelectionCtx): string {
  const block = (sel.schemaSlice as { title?: string } | undefined)?.title || sel.nodeId;
  if (sel.level === 'element' && sel.element) {
    const e = sel.element;
    return `${block} › ${e.tag}${e.text ? ` “${e.text.slice(0, 24)}${e.text.length > 24 ? '…' : ''}”` : ''}`;
  }
  return block;
}

function ChatApp() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<{ llm: boolean; model: string | null } | null>(null);
  const [previewUrl, setPreviewUrl] = useState('/preview/');
  const [annotating, setAnnotating] = useState(false);
  const [selection, setSelection] = useState<SelectionCtx | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const handleRef = useRef<PreviewHandle | null>(null);
  const annotatingRef = useRef(false);
  const idRef = useRef(1);
  const listRef = useRef<HTMLDivElement>(null);

  const refreshConfig = useCallback(() => {
    void fetch('/api/agent/config').then((r) => r.json()).then(setConfig).catch(() => setConfig({ llm: false, model: null }));
  }, []);

  useEffect(() => {
    injectMdStyles();
    refreshConfig();
  }, [refreshConfig]);

  useEffect(() => { annotatingRef.current = annotating; }, [annotating]);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); });

  // 嵌入模式：握手 ready（宿主冲刷积压的选区消息）+ 接收宿主选区 / 标注状态
  useEffect(() => {
    if (!EMBEDDED) return;
    postToHost({ type: 'daf-chat:ready' });
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string; selection?: SelectionCtx; on?: boolean } | undefined;
      if (data?.type === 'daf-host:selection' && data.selection) {
        setSelection(data.selection);
        setAnnotating(false);
      } else if (data?.type === 'daf-host:annotate-state') {
        setAnnotating(Boolean(data.on));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

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
      onMode: (m) => setAnnotating(m === 'annotate'),
    });
    handleRef.current = handle;
    void handle.whenReady.then(() => {
      if (annotatingRef.current) void handle.enable('annotate');
    });
  }, []);

  const toggleAnnotate = useCallback(() => {
    if (EMBEDDED) {
      // 宿主负责切到画布预览模式并开标注；状态经 annotate-state 回同步
      postToHost({ type: 'daf-chat:annotate-request' });
      return;
    }
    const next = !annotatingRef.current;
    setAnnotating(next);
    void handleRef.current?.enable(next ? 'annotate' : 'browse');
  }, []);

  const clearSelection = useCallback(() => {
    setSelection(null);
    if (EMBEDDED) postToHost({ type: 'daf-chat:selection-clear' });
    else void handleRef.current?.highlight(null);
  }, []);

  async function send(raw: string) {
    const message = raw.trim();
    if (!message || busy) return;
    setBusy(true);
    setInput('');
    const sel = selection;
    const selectionLabel = sel ? `已标注: ${selectionDesc(sel)}` : undefined;
    const aiId = idRef.current + 1;
    idRef.current += 2;

    const view: TurnView = { thinking: '', steps: [], text: '', running: true };
    setMsgs((m) => [
      ...m,
      { id: aiId - 1, role: 'user', text: message, selectionLabel },
      { id: aiId, role: 'ai', view: { ...view } },
    ]);
    setSelection(null);
    if (EMBEDDED) postToHost({ type: 'daf-chat:selection-clear' });
    else void handleRef.current?.highlight(null);

    const patch = () => setMsgs((m) => m.map((x) => (x.id === aiId ? { ...x, view: { ...view, steps: [...view.steps] } } : x)));

    try {
      await streamChat(
        {
          sessionId,
          message,
          selection: sel
            ? {
                level: sel.level,
                nodeId: sel.nodeId,
                componentName: (sel.schemaSlice as { componentName?: string } | undefined)?.componentName,
                schemaSlice: sel.schemaSlice,
                element: sel.element,
              }
            : undefined,
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

  const selTitle = selection ? selectionDesc(selection) : '';

  return (
    <div style={{ display: 'flex', height: '100vh', minWidth: 0 }}>
      {/* 左：对话（嵌入模式独占全宽） */}
      <div style={{ width: EMBEDDED ? '100%' : 440, minWidth: 320, display: 'flex', flexDirection: 'column', borderRight: EMBEDDED ? 'none' : '1px solid #e5e6eb' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #eceef1', display: 'flex', alignItems: 'center', gap: 8, background: '#fff' }}>
          <span style={{
            width: 26, height: 26, borderRadius: 8, display: 'grid', placeItems: 'center',
            background: 'linear-gradient(135deg,#3370ff,#7c3aed)', color: '#fff', fontSize: 13, flexShrink: 0,
          }}><ThunderboltFilled /></span>
          <span style={{ fontWeight: 600, fontSize: 14, flex: 1, letterSpacing: 0.2 }}>AI 搭建</span>
          <Tooltip title={config?.llm ? '点击切换模型 / 凭证' : '未配置模型凭证，点击配置后即可真实对话'}>
            <Button size="small" onClick={() => setSettingsOpen(true)}
              style={{ borderRadius: 999, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: config?.llm ? '#22c55e' : '#f59e0b', display: 'inline-block' }} />
              {config?.llm ? config.model : '配置模型'}
              <SettingOutlined style={{ fontSize: 11, color: '#8f959e' }} />
            </Button>
          </Tooltip>
          <Tooltip title="新会话"><Button size="small" type="text" icon={<PlusOutlined />} onClick={() => void newSession()} /></Tooltip>
        </div>

        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
          {msgs.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
              <Welcome
                variant="borderless"
                icon={
                  <span style={{
                    width: 44, height: 44, borderRadius: 14, display: 'grid', placeItems: 'center',
                    background: 'linear-gradient(135deg,#3370ff,#7c3aed)', color: '#fff', fontSize: 22,
                  }}><ThunderboltFilled /></span>
                }
                title="用一句话搭出可交互的数据报告"
                description="生成 → 标注修改 → 拖拽微调，每一步可回滚。声明性修改秒级生效，代码块自动构建。"
              />
              <Prompts
                items={SAMPLE_PROMPTS}
                vertical
                onItemClick={(info) => void send(String(info.data.description))}
                styles={{ item: { width: '100%', borderRadius: 10 } }}
              />
              <div style={{ fontSize: 12, color: '#8f959e', lineHeight: 1.8, padding: '0 4px' }}>
                <AimOutlined /> 点「标注」后在预览里点选任意元素（⌥点击选整块，Esc 退出）—— 选区会作为上下文发给模型。
              </div>
            </div>
          ) : (
            <Bubble.List
              items={bubbleItems}
              roles={{
                user: {
                  placement: 'end', variant: 'filled',
                  styles: { content: { background: 'linear-gradient(135deg,#3370ff,#4f46e5)', color: '#fff', maxWidth: 360, borderRadius: 12 } },
                },
                ai: {
                  placement: 'start', variant: 'outlined',
                  avatar: {
                    icon: <ThunderboltFilled />,
                    style: { background: 'linear-gradient(135deg,#3370ff,#7c3aed)', color: '#fff', flexShrink: 0 },
                  },
                  styles: { content: { maxWidth: 'calc(100% - 48px)', width: '100%', borderRadius: 12, borderColor: '#eceef1', boxShadow: '0 1px 3px rgba(15,23,42,0.04)' } },
                },
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

      {/* 右：运行态预览（嵌入模式由宿主画布承载，不渲染） */}
      {!EMBEDDED && <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, background: '#f5f6f7' }}>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #e5e6eb', background: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button size="small" type={annotating ? 'primary' : 'default'} icon={<AimOutlined />} onClick={toggleAnnotate}>
            {annotating ? '点选预览中的块…' : '标注'}
          </Button>
          <span style={{ flex: 1, fontSize: 12, color: '#8f959e', fontFamily: 'ui-monospace, Menlo, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previewUrl}</span>
          <Tooltip title="刷新"><Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => iframeRef.current && (iframeRef.current.src = iframeRef.current.src)} /></Tooltip>
          <Tooltip title="新窗口打开"><Button size="small" type="text" icon={<ExportOutlined />} href={previewUrl} target="_blank" /></Tooltip>
        </div>
        {annotating && (
          <Alert type="info" banner showIcon icon={<AimOutlined />} message="标注：悬停高亮元素（虚线为所属块），点击精确标注 · ⌥点击选整块 · Esc 退出" style={{ fontSize: 12 }} />
        )}
        <iframe
          ref={iframeRef}
          src={withDesigntime(previewUrl)}
          title="report-preview"
          onLoad={onIframeLoad}
          style={{ flex: 1, border: 'none', width: '100%' }}
        />
      </div>}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onSaved={refreshConfig} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <ConfigProvider theme={{ token: { colorPrimary: '#3370ff', borderRadius: 8 } }}>
    <AntApp><ChatApp /></AntApp>
  </ConfigProvider>,
);
