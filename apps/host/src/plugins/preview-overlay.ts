/**
 * 画布内预览（设计 ↔ 预览一体）：顶栏「设计 | 预览」切换。
 * - 设计：LCE 画布原样（拖拽/属性编辑）
 * - 预览：在 mainArea 上盖一层运行态预览 iframe（真实数据 React18 链路），
 *   支持标注 —— 点选块（data-node-id）→ 选区经 postMessage 进对话面板成为 chip。
 * 切到预览前自动保存（exportSchema → 零构建直更新），保证画布与产物一致；
 * Agent 每轮提交 / 手动保存 → bus onPreview → 预览层自动切新产物 URL。
 */
import { createElement as h, useState, useRef, useEffect, useCallback, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { Button, Message } from '@alifd/next';
import type { IPublicModelPluginContext } from '@alilc/lowcode-types';
import { connectPreview, type PreviewHandle } from '@daf/designtime-sdk';
import { onPreview, sendToChat } from '../bus.ts';
import { saveDesigner } from '../save.ts';

const DT_TOKEN = `host-${Math.random().toString(36).slice(2)}`;

function withDesigntime(url: string): string {
  return url + (url.includes('?') ? '&' : '?') + `designtime=1&dtToken=${DT_TOKEN}`;
}

/** 在 LCE mainArea 内创建覆盖层容器（画布保持挂载，状态不丢）。 */
function ensureHolder(): HTMLDivElement | null {
  const main = document.querySelector<HTMLElement>('.lc-main-area');
  if (!main) return null;
  let holder = main.querySelector<HTMLDivElement>(':scope > .daf-preview-overlay');
  if (!holder) {
    holder = document.createElement('div');
    holder.className = 'daf-preview-overlay';
    Object.assign(holder.style, {
      position: 'absolute', inset: '0', zIndex: '20', display: 'none',
      flexDirection: 'column', background: '#f5f6f7',
    } satisfies Partial<CSSStyleDeclaration>);
    if (getComputedStyle(main).position === 'static') main.style.position = 'relative';
    main.appendChild(holder);
  }
  return holder;
}

function PreviewSwitch({ ctx }: { ctx: IPublicModelPluginContext }) {
  const [mode, setMode] = useState<'design' | 'preview'>('design');
  const [annotating, setAnnotating] = useState(false);
  const [url, setUrl] = useState('/preview/');
  const [holder, setHolder] = useState<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const handleRef = useRef<PreviewHandle | null>(null);
  const modeRef = useRef(mode);
  const annotatingRef = useRef(annotating);
  modeRef.current = mode;
  annotatingRef.current = annotating;

  // 覆盖层容器：组件挂载时（workbench DOM 已就绪）创建
  useEffect(() => {
    const t = setTimeout(() => setHolder(ensureHolder()), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (holder) holder.style.display = mode === 'preview' ? 'flex' : 'none';
  }, [holder, mode]);

  // Agent 提交 / 保存 → 切新产物（仅更新 URL；预览模式下 iframe 重载并重连 Bridge）
  useEffect(() => onPreview((u) => setUrl(u)), []);

  // 对话面板请求标注（嵌入模式的「标注」按钮）→ 切到预览 + 开标注
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { type?: string } | undefined;
      if (data?.type === 'daf-chat:annotate-request') void enterPreview(true);
      else if (data?.type === 'daf-chat:selection-clear') void handleRef.current?.highlight(null);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncAnnotate = useCallback((on: boolean) => {
    setAnnotating(on);
    sendToChat({ type: 'daf-host:annotate-state', on });
  }, []);

  const onIframeLoad = useCallback(() => {
    handleRef.current?.dispose();
    const iframe = iframeRef.current;
    if (!iframe) return;
    const handle = connectPreview(iframe, DT_TOKEN, {
      onSelect: (sel) => {
        // 选中 → 退出标注 + 选区送进对话面板 + 打开对话 dock
        syncAnnotate(false);
        void handle.enable('browse');
        sendToChat({ type: 'daf-host:selection', selection: sel });
        try {
          ctx.skeleton.showPanel('dafChatPane');
        } catch {
          /* 面板未注册时忽略 */
        }
      },
    });
    handleRef.current = handle;
    void handle.whenReady.then(() => {
      if (annotatingRef.current) void handle.enable('annotate');
    });
  }, [ctx, syncAnnotate]);

  async function enterPreview(annotate: boolean) {
    if (modeRef.current !== 'preview') {
      const saved = await saveDesigner(ctx, true);
      if (!saved) return;
      setMode('preview');
    }
    syncAnnotate(annotate);
    if (annotate) {
      void handleRef.current?.enable('annotate');
      Message.show({ type: 'notice', content: '标注模式：在预览中点选要修改的块' });
    }
  }

  function exitPreview() {
    syncAnnotate(false);
    void handleRef.current?.enable('browse');
    setMode('design');
  }

  const toggleAnnotate = () => {
    const next = !annotatingRef.current;
    syncAnnotate(next);
    void handleRef.current?.enable(next ? 'annotate' : 'browse');
  };

  const overlay = holder
    ? createPortal(
        h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
          h('div', {
            style: {
              padding: '6px 12px', background: '#fff', borderBottom: '1px solid #e5e6eb',
              display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto',
            },
          },
            h(Button, { size: 'small', type: annotating ? 'primary' : 'normal', onClick: toggleAnnotate },
              annotating ? '点选预览中的块…' : '标注'),
            h('span', {
              style: { flex: 1, fontSize: 12, color: '#8f959e', fontFamily: 'ui-monospace, Menlo, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
            }, url),
            h(Button, {
              size: 'small',
              onClick: () => iframeRef.current && (iframeRef.current.src = iframeRef.current.src),
            }, '刷新'),
            h(Button, { size: 'small', component: 'a', href: url, target: '_blank' } as never, '新窗口'),
          ),
          mode === 'preview'
            ? h('iframe', {
                ref: iframeRef,
                src: withDesigntime(url),
                title: 'canvas-preview',
                onLoad: onIframeLoad,
                style: { flex: 1, border: 'none', width: '100%' },
              })
            : null,
        ),
        holder,
      )
    : null;

  return h(Fragment, null,
    h('div', { style: { display: 'flex', gap: 0, marginRight: 8 } },
      h(Button, {
        size: 'small', type: mode === 'design' ? 'primary' : 'normal',
        style: { borderTopRightRadius: 0, borderBottomRightRadius: 0 },
        onClick: exitPreview,
      }, '设计'),
      h(Button, {
        size: 'small', type: mode === 'preview' ? 'primary' : 'normal',
        style: { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 },
        onClick: () => void enterPreview(false),
      }, '预览'),
    ),
    overlay,
  );
}

const PreviewOverlayPlugin = (ctx: IPublicModelPluginContext) => ({
  async init() {
    ctx.skeleton.add({
      name: 'daf-preview-switch', area: 'topArea', type: 'Widget', props: { align: 'center' },
      content: () => h(PreviewSwitch, { ctx }),
    });
  },
});
PreviewOverlayPlugin.pluginName = 'PreviewOverlayPlugin';
PreviewOverlayPlugin.meta = { dependencies: ['EditorInitPlugin'] };
export default PreviewOverlayPlugin;
