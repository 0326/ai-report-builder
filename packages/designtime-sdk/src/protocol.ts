/** Bridge 协议常量与类型（§3.3）。按"长期原生承载"设计：方法签名不绑定 postMessage。 */
import type { SchemaNode } from '@daf/report-runtime/core';

export const BRIDGE_VERSION = '1.0';

export type DesigntimeMode = 'browse' | 'annotate';

/** 选区上下文（第 3 轮块级最小形；第 4 轮扩 schemaSlice/runtimeState 完整包） */
export interface SelectionCtx {
  level: 'block';
  nodeId: string;
  schemaSlice?: SchemaNode;
}

/** 宿主→SDK */
export const M_ENABLE = 'designtime.enable';
export const M_HIGHLIGHT = 'designtime.highlight';
export const M_GET_SCHEMA = 'designtime.getSchema';
export const M_GET_SELECTION = 'designtime.getSelection';
export const M_RUNTIME_ACTION = 'runtime.action';
export const M_THEME_SYNC = 'theme.sync';
export const M_SCHEMA_RELOAD = 'schema.reload';

/** SDK→宿主（notify） */
export const M_ON_SELECT = 'designtime.onSelect';
export const M_ON_EVENT = 'runtime.onEvent';
