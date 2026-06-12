/**
 * 搭建工作台三栏：对话占位 / 预览 iframe / 可视编排。
 * 声明性修改管线：改 schema（本地不可变更新）→ debounce PUT /api/schema → Bridge schema.reload
 * → iframe runtime 重建重渲染。全程零构建，≤2s。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout, Typography, Tag, message } from 'antd';
import type { ReportSchema } from '@daf/report-runtime/core';
import type { PreviewHandle } from '@daf/designtime-sdk';
import { fetchSchema, putSchema } from './api.ts';
import { ChatPanel } from './panels/ChatPanel.tsx';
import { PreviewPane } from './panels/PreviewPane.tsx';
import { OrchestratorPanel } from './panels/OrchestratorPanel.tsx';

const HEADER_H = 48;

export function App() {
  const [schema, setSchema] = useState<ReportSchema | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<'idle' | 'saving' | 'error'>('idle');
  const previewRef = useRef<PreviewHandle | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestSchema = useRef<ReportSchema | null>(null);

  useEffect(() => {
    fetchSchema().then(setSchema).catch((e) => message.error(`加载 schema 失败：${e.message}`));
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const snapshot = latestSchema.current!;
      setSyncState('saving');
      try {
        const t0 = performance.now();
        const r = await putSchema(snapshot);
        await previewRef.current?.schemaReload(r.schemaUrl);
        setSyncState('idle');
        console.info(`[host] schema 直更新完成 ${Math.round(performance.now() - t0)}ms（零构建）`);
      } catch (e) {
        setSyncState('error');
        message.error(`schema 更新失败：${(e as Error).message}`);
      }
    }, 400);
  }, []);

  /** 声明性修改入口：函数式更新（连续编辑可组合），本地立即生效，400ms 合并落盘 + 通知预览重载 */
  const applySchema = useCallback((updater: (prev: ReportSchema) => ReportSchema) => {
    setSchema((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      latestSchema.current = next;
      return next;
    });
    scheduleSave();
  }, [scheduleSave]);

  const onSelect = useCallback((nodeId: string | null) => {
    setSelectedId(nodeId);
    void previewRef.current?.highlight(nodeId).catch(() => {});
  }, []);

  const onPreviewReady = useCallback((handle: PreviewHandle) => {
    previewRef.current = handle;
  }, []);

  const sync = useMemo(() => (
    syncState === 'saving' ? <Tag color="processing">同步中…</Tag>
      : syncState === 'error' ? <Tag color="error">同步失败</Tag>
        : <Tag color="success">已同步</Tag>
  ), [syncState]);

  return (
    <Layout style={{ height: '100vh' }}>
      <Layout.Header style={{
        height: HEADER_H, lineHeight: `${HEADER_H}px`, background: '#fff',
        borderBottom: '1px solid #e5e6e8', padding: '0 16px', display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <Typography.Text strong style={{ fontSize: 15 }}>AI 报告搭建工作台</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>weekly-biz-report</Typography.Text>
        {sync}
      </Layout.Header>
      <Layout style={{ height: `calc(100vh - ${HEADER_H}px)` }}>
        <Layout.Sider width={280} style={{ background: '#fff', borderRight: '1px solid #e5e6e8' }}>
          <ChatPanel />
        </Layout.Sider>
        <Layout.Content style={{ background: '#eef0f2', padding: 12, overflow: 'hidden' }}>
          <PreviewPane onReady={onPreviewReady} onSelectFromPreview={setSelectedId} />
        </Layout.Content>
        <Layout.Sider width={380} style={{ background: '#fff', borderLeft: '1px solid #e5e6e8', overflow: 'auto' }}>
          <OrchestratorPanel schema={schema} selectedId={selectedId} onSelect={onSelect} onChangeSchema={applySchema} />
        </Layout.Sider>
      </Layout>
    </Layout>
  );
}
