/** Bridge 协议常量与类型（§3.3）。按"长期原生承载"设计：方法签名不绑定 postMessage。 */
import type { SchemaNode } from '@daf/report-runtime/core';

export const BRIDGE_VERSION = '1.0';

export type DesigntimeMode = 'browse' | 'annotate';

/** 块内元素定位（细粒度标注）：selector 相对块根，足以让 Agent 理解"改哪儿"。 */
export interface ElementCtx {
  /** 相对块根的 CSS 路径（≤4 级，tag.class:nth-child 链） */
  selector: string;
  tag: string;
  /** 元素可见文本（截断 ≤60 字符） */
  text?: string;
  classes?: string[];
  /** 元素在块内的相对位置描述（如 "top-right"），辅助语义定位 */
  region?: string;
}

/** 选区上下文：块级（整块）或元素级（块内具体元素）。 */
export interface SelectionCtx {
  level: 'block' | 'element';
  nodeId: string;
  schemaSlice?: SchemaNode;
  element?: ElementCtx;
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
/** 模式变更上报（如 Esc 退出标注），宿主据此同步 UI 状态 */
export const M_ON_MODE = 'designtime.onMode';
