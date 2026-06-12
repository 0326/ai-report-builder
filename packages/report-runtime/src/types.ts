/** 搭建协议与运行时公共类型（LCE 兼容 + x- 扩展） */

export interface JSExpression {
  type: 'JSExpression';
  value: string;
}

export interface ComponentMapEntry {
  componentName: string;
  package: string;
  version?: string;
  exportName?: string;
}

export interface DataSourceDef {
  id: string;
  type: 'daf-query' | string;
  options: {
    datasetId: string;
    fields?: string[];
    params?: Record<string, unknown>;
  };
  'x-trigger'?: 'auto' | 'manual' | 'lazy';
  /** 缓存 TTL（ms），默认 60s */
  'x-cacheTTL'?: number;
}

export interface FilterDef {
  id: string;
  label: string;
  stateKey: string;
  valueType?: 'enum' | 'string' | 'date';
  /** 选项来源数据源 id（rows 形如 {label,value} 或字符串数组） */
  optionsFrom?: string;
  /** 静态选项 */
  options?: Array<{ label: string; value: string } | string>;
  default?: unknown;
}

export interface LinkageDef {
  id: string;
  /** "nodeId.eventName" */
  source: string;
  action: 'setState' | 'custom';
  target?: string;
  /** 对 payload 的取值表达式，如 "payload.name" */
  mapping?: string;
  /** 代码联动登记: "src/blocks/TrendBlock#onDrill" */
  handler?: string;
}

export interface NodePosition {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SchemaNode {
  id: string;
  componentName: string;
  title?: string;
  props?: Record<string, unknown>;
  'x-position'?: NodePosition;
  'x-consumes'?: string[];
  'x-listens'?: string[];
  'x-emits'?: string[];
  children?: SchemaNode[];
}

export interface PageNode {
  componentName: 'Page';
  props?: Record<string, unknown>;
  state?: Record<string, unknown>;
  dataSource?: { list: DataSourceDef[] };
  'x-layout'?: { mode: 'grid'; cols: number };
  'x-filters'?: FilterDef[];
  'x-linkages'?: LinkageDef[];
  children: SchemaNode[];
}

export interface ReportSchema {
  version: string;
  componentsMap: ComponentMapEntry[];
  componentsTree: PageNode[];
}

/* ---------------- 运行时 ---------------- */

export interface QueryRequest {
  dsId: string;
  datasetId: string;
  fields?: string[];
  params: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface QueryResult {
  dsId: string;
  datasetId: string;
  rows: Array<Record<string, unknown>>;
  total?: number;
  tookMs?: number;
  fromCache?: boolean;
}

export type DafQueryService = (req: QueryRequest) => Promise<{ rows: Array<Record<string, unknown>>; total?: number }>;

export interface UserContext {
  id: string;
  name?: string;
  permissions?: {
    datasets?: string[] | '*';
    actions?: string[] | '*';
  };
}

export type RuntimeEnv = 'design' | 'preview' | 'production';

export interface RuntimeContext {
  schema: ReportSchema;
  manifest?: unknown;
  env: RuntimeEnv;
  /** iframe 模式为 Bridge，原生模式为直连，独立运行为 null */
  host?: unknown;
  user?: UserContext;
  services: { dafQuery: DafQueryService };
  /** 代码联动 handler 注册表（bundle 提供），key = LinkageDef.handler */
  customHandlers?: Record<string, (payload: unknown, api: unknown) => void>;
}

export type Unwatch = () => void;

export function getPage(schema: ReportSchema): PageNode {
  const page = schema.componentsTree[0];
  if (!page) throw new Error('[runtime] schema.componentsTree is empty');
  return page;
}

export function findNode(schema: ReportSchema, nodeId: string): SchemaNode | undefined {
  const walk = (nodes: SchemaNode[] | undefined): SchemaNode | undefined => {
    for (const n of nodes ?? []) {
      if (n.id === nodeId) return n;
      const hit = walk(n.children);
      if (hit) return hit;
    }
    return undefined;
  };
  return walk(getPage(schema).children);
}
