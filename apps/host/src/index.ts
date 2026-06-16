/**
 * 搭建工作台入口：基于 lowcode-engine（UMD 本地化）。
 * 我们的协议立场：report.schema.json 即合法 LCE 项目 schema，x- 平台扩展经
 * mergeXFields 保真；保存走既有零构建直更新管线（PUT /api/schema）。
 */
import { init, plugins } from '@alilc/lowcode-engine';
import './theme.css';
import ComponentsPanePlugin from '@alilc/lowcode-plugin-components-pane';
import EditorInitPlugin from './plugins/editor-init.ts';
import DefaultSettersRegistryPlugin from './plugins/setters-registry.ts';
import SaveAndPreviewPlugin from './plugins/save-and-preview.ts';
import ChatPanePlugin from './plugins/chat-pane.ts';
import TimelinePanePlugin from './plugins/timeline-pane.ts';
import PreviewOverlayPlugin from './plugins/preview-overlay.ts';
import BrandingPlugin from './plugins/branding.ts';
import DataPanePlugin from './plugins/data-pane.ts';
import PublishPlugin from './plugins/publish.ts';

/** daf-query 数据源 → mock-server DAF 查询（画布内真实数据） */
function createDafQueryHandler() {
  return async (options: { datasetId?: string; uri?: string; params?: Record<string, unknown> }) => {
    const res = await fetch('/api/daf/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ datasetId: options.datasetId ?? options.uri, params: options.params ?? {} }),
    });
    if (!res.ok) throw new Error(`daf query failed: ${res.status}`);
    const body = await res.json() as { rows: unknown[] };
    return { data: body.rows }; // 数据源引擎默认 dataHandler 取 response.data
  };
}

async function main() {
  await plugins.register(BrandingPlugin as never);
  await plugins.register(EditorInitPlugin as never);
  await plugins.register(DefaultSettersRegistryPlugin as never);
  await plugins.register(ComponentsPanePlugin as never);
  await plugins.register(SaveAndPreviewPlugin as never);
  await plugins.register(ChatPanePlugin as never);
  await plugins.register(DataPanePlugin as never);
  await plugins.register(TimelinePanePlugin as never);
  await plugins.register(PreviewOverlayPlugin as never);
  await plugins.register(PublishPlugin as never);

  await init(document.getElementById('lce-container')!, {
    locale: 'zh-CN',
    enableCondition: true,
    enableCanvasLock: true,
    supportVariableGlobally: true,
    enableContextMenu: true,
    requestHandlersMap: {
      'daf-query': createDafQueryHandler(),
    },
  } as never);
}

void main();
