/**
 * mock Agent 剧本（"意图关键词匹配 → 固定响应"，§3.4 链路一）。
 * 每个剧本产出：过程卡（数据集/物料/变更摘要，§3.6）+ 一或多次 attempt（自修复：先错后对）。
 * 剧本是纯函数：plan(ctx) 基于当前工作区 schema 算出新 schema / 源码文件，编排层负责落盘+构建+提交。
 */
import type { ReportSchema, PageNode, SchemaNode, FilterDef, LinkageDef, DataSourceDef } from '@daf/report-runtime/core';
import { getPage, findNode } from '@daf/report-runtime/core';

export interface SelectionCtx {
  nodeId?: string;
  componentName?: string;
}

export interface TurnContext {
  /** 当前工作区 schema（HEAD） */
  schema: ReportSchema;
  selection?: SelectionCtx | null;
  /** 读 weekly-report fixture（剧本①的"生成产物"= 固定 fixture） */
  readFixture: (rel: string) => string;
}

export interface SourceFile {
  path: string;
  content: string;
}

export interface Attempt {
  /** 本次尝试的说明（自修复时解释改了什么） */
  note: string;
  /** 全量新 schema（undefined = 不改 schema） */
  schema?: ReportSchema;
  files?: SourceFile[];
  deletes?: string[];
}

export interface ProcessCard {
  datasets: string[];
  materials: string[];
  summary: string[];
  notes?: string[];
}

export interface AgentPlan {
  intent: string;
  pipeline: 'build' | 'schema';
  commitType: 'code' | 'schema';
  processCard: ProcessCard;
  attempts: Attempt[];
}

export interface AgentScript {
  id: string;
  title: string;
  match: (msg: string, ctx: TurnContext) => boolean;
  plan: (ctx: TurnContext) => AgentPlan;
}

const clone = <T>(v: T): T => structuredClone(v);

/* --------------------------- 剧本① 对话生成周报 --------------------------- */

const weeklyScript: AgentScript = {
  id: 'weekly',
  title: '生成周度经营报告',
  match: (msg) => /周报|周度|做.*报告|生成.*报告|建.*报告/.test(msg) && !/漏斗|留存|环形|donut/.test(msg),
  plan: (ctx) => {
    const schema = JSON.parse(ctx.readFixture('report.schema.json')) as ReportSchema;
    const files: SourceFile[] = [
      { path: 'src/blocks/TrendBlock/index.tsx', content: ctx.readFixture('src/blocks/TrendBlock/index.tsx') },
      { path: 'src/data/trend.ts', content: ctx.readFixture('src/data/trend.ts') },
    ];
    return {
      intent: '生成周报（DAU 趋势 + 渠道占比，按区域筛选）',
      pipeline: 'build',
      commitType: 'code',
      processCard: {
        datasets: ['metric_summary', 'metric_dau', 'metric_channel', 'metric_detail'],
        materials: ['KPICard×3', 'AIBlock(TrendBlock·LineChart)', 'PieChart', 'DataTable'],
        summary: [
          'Page + 6 个块：3 张 KPI 卡 / DAU 趋势 / 渠道占比 / 渠道明细',
          '4 个 daf-query 数据源，f_region 区域筛选驱动全量刷新',
          'lk1 渠道点击联动区域、lk2 趋势下钻（代码联动登记）',
          'TrendBlock 为自定义代码块 → 走 esbuild 构建管线',
        ],
        notes: ['冷启动从模板 fork，仅生成业务块；公共物料/runtime 作为共享依赖不打进 bundle'],
      },
      attempts: [{ note: '生成全量 schema + TrendBlock 代码', schema, files }],
    };
  },
};

/* ------------------------ 剧本② 标注：饼图改环形 + 联动 ------------------------ */

function findPie(ctx: TurnContext): SchemaNode | undefined {
  if (ctx.selection?.nodeId) {
    const sel = findNode(ctx.schema, ctx.selection.nodeId);
    if (sel?.componentName === 'PieChart') return sel;
  }
  return getPage(ctx.schema).children.find((n) => n.componentName === 'PieChart');
}

const donutScript: AgentScript = {
  id: 'donut',
  title: '饼图改环形 + 点击渠道联动趋势',
  match: (msg) => /环形|donut|甜甜圈/.test(msg),
  plan: (ctx) => {
    const next = clone(ctx.schema);
    const page = getPage(next);
    const pie = findPie({ ...ctx, schema: next });
    if (!pie) throw new Error('[donut] 当前报告找不到 PieChart 节点，请先选中渠道占比图');

    // ① 环形图 = 声明性 props
    pie.props = { ...pie.props, donut: true };

    // ② 新增渠道筛选器 + state 默认值
    page.state = { ...(page.state ?? {}), f_channel: 'all' };
    const filters: FilterDef[] = page['x-filters'] ?? (page['x-filters'] = []);
    if (!filters.some((f) => f.id === 'f_channel')) {
      filters.push({ id: 'f_channel', label: '渠道', stateKey: 'f_channel', valueType: 'enum', default: 'all' });
    }

    // ③ 新增声明式联动：点击渠道 → setState f_channel
    const linkages: LinkageDef[] = page['x-linkages'] ?? (page['x-linkages'] = []);
    if (!linkages.some((l) => l.id === 'lk3')) {
      linkages.push({ id: 'lk3', source: `${pie.id}.click`, action: 'setState', target: 'f_channel', mapping: 'payload.name' });
    }

    // ④ ds_dau 接入 channel 参数（依赖图自动接好刷新链）
    const ds = page.dataSource?.list.find((d: DataSourceDef) => d.id === 'ds_dau');
    if (ds) {
      ds.options.params = { ...(ds.options.params ?? {}), channel: { type: 'JSExpression', value: 'this.state.f_channel' } };
    }

    // 趋势块声明监听 f_channel（治理可见性）
    const trend = page.children.find((n) => n.componentName === 'AIBlock');
    if (trend) trend['x-listens'] = [...new Set([...(trend['x-listens'] ?? []), 'f_channel'])];

    return {
      intent: '渠道占比饼图改环形，点击渠道联动趋势图',
      pipeline: 'schema',
      commitType: 'schema',
      processCard: {
        datasets: ['metric_channel', 'metric_dau'],
        materials: ['PieChart(donut=true)'],
        summary: [
          `${pie.id}.props.donut: false → true`,
          '+ x-filters[f_channel]、state.f_channel="all"',
          '+ x-linkages[lk3]: 渠道点击 → setState f_channel',
          'ds_dau.params.channel ← this.state.f_channel（依赖图自动接刷新链）',
        ],
        notes: ['全部落在 schema → 零构建直更新管线，≤2s 生效，AI 出错面最小'],
      },
      attempts: [{ note: '环形 + 联动均为声明性，仅改 report.schema.json', schema: next }],
    };
  },
};

/* --------------------- 剧本③ 加留存漏斗块（自修复演示） --------------------- */

const FUNNEL_NODE_ID = 'node_funnel';

function withFunnelSchema(base: ReportSchema): ReportSchema {
  const next = clone(base);
  const page: PageNode = getPage(next);
  // 新数据源
  const list = page.dataSource?.list ?? (page.dataSource = { list: [] }).list;
  if (!list.some((d) => d.id === 'ds_retention')) {
    list.push({
      id: 'ds_retention',
      type: 'daf-query',
      options: { datasetId: 'metric_retention', fields: ['stage', 'users'] },
      'x-trigger': 'auto',
    } as DataSourceDef);
  }
  // 新块节点
  if (!page.children.some((n) => n.id === FUNNEL_NODE_ID)) {
    const maxY = Math.max(0, ...page.children.map((n) => (n['x-position']?.y ?? 0) + (n['x-position']?.h ?? 0)));
    page.children.push({
      componentName: 'AIBlock',
      id: FUNNEL_NODE_ID,
      props: { entry: 'blocks/FunnelBlock' },
      title: '留存漏斗',
      'x-position': { x: 0, y: maxY, w: 6, h: 6 },
      'x-consumes': ['ds_retention'],
      'x-listens': ['f_region'],
    });
  }
  return next;
}

const FUNNEL_GOOD = `/**
 * 自定义代码块：留存漏斗。取数只走 runtime.data（唯一世界接口）。
 */
import { useSyncExternalStore } from 'react';
import { BarChart } from '@daf-materials/kit';
import type { BlockRuntime } from '@daf/report-runtime';

export interface FunnelBlockProps {
  runtime: BlockRuntime;
}

export default function FunnelBlock({ runtime }: FunnelBlockProps) {
  const state = useSyncExternalStore(
    (cb) => runtime.data.watch('ds_retention', cb),
    () => runtime.data.get('ds_retention'),
  );

  const rows = (state.rows ?? []).map((r) => ({ category: String(r.stage ?? ''), value: Number(r.users ?? 0) }));
  if (!rows.length) {
    return <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#8f959e', fontSize: 13 }}>暂无留存数据</div>;
  }
  return (
    <div style={{ height: '100%' }}>
      <BarChart data={rows} xField="category" yField="value" />
    </div>
  );
}
`;

const FUNNEL_BAD = `/**
 * 自定义代码块：留存漏斗（首版：直接 fetch 取数 —— 会被 lint 拦截）。
 */
import { useEffect, useState } from 'react';
import { BarChart } from '@daf-materials/kit';
import type { BlockRuntime } from '@daf/report-runtime';

export interface FunnelBlockProps {
  runtime: BlockRuntime;
}

export default function FunnelBlock({ runtime }: FunnelBlockProps) {
  const [rows, setRows] = useState<Array<{ category: string; value: number }>>([]);
  useEffect(() => {
    fetch('/api/daf/query', {
      method: 'POST',
      body: JSON.stringify({ datasetId: 'metric_retention' }),
    })
      .then((r) => r.json())
      .then((b) => setRows(b.rows.map((x: Record<string, unknown>) => ({ category: String(x.stage), value: Number(x.users) }))));
  }, []);
  return <div style={{ height: '100%' }}><BarChart data={rows} xField="category" yField="value" /></div>;
}
`;

const funnelScript: AgentScript = {
  id: 'funnel',
  title: '新增留存漏斗块',
  match: (msg) => /漏斗|留存|funnel/i.test(msg),
  plan: (ctx) => {
    const schema = withFunnelSchema(ctx.schema);
    return {
      intent: '新增"留存漏斗"自定义块',
      pipeline: 'build',
      commitType: 'code',
      processCard: {
        datasets: ['metric_retention'],
        materials: ['AIBlock(FunnelBlock·BarChart)'],
        summary: [
          '+ dataSource[ds_retention]（metric_retention）',
          `+ AIBlock 节点 ${FUNNEL_NODE_ID}，x-consumes=[ds_retention]`,
          '+ src/blocks/FunnelBlock/index.tsx（自定义代码块 → 走构建）',
        ],
        notes: ['首版误用裸 fetch，被声明一致性 lint 拦截 → 自动改用 runtime.data 重试（≤2 次）'],
      },
      attempts: [
        {
          note: '首版：useEffect 内裸 fetch 取数',
          schema,
          files: [{ path: 'src/blocks/FunnelBlock/index.tsx', content: FUNNEL_BAD }],
        },
        {
          note: '自修复：改用 runtime.data.watch（唯一世界接口）',
          schema,
          files: [{ path: 'src/blocks/FunnelBlock/index.tsx', content: FUNNEL_GOOD }],
        },
      ],
    };
  },
};

export const AGENT_SCRIPTS: AgentScript[] = [weeklyScript, donutScript, funnelScript];

export function matchScript(msg: string, ctx: TurnContext): AgentScript | null {
  return AGENT_SCRIPTS.find((s) => s.match(msg, ctx)) ?? null;
}

/* ------------------------------- 空白基线 seed ------------------------------- */

export const SEED_SCHEMA: ReportSchema = {
  version: '1.0.0',
  name: 'untitled-report',
  componentsMap: [
    { componentName: 'AIBlock', package: '@daf/report-runtime', exportName: 'AIBlock' },
    { componentName: 'KPICard', package: '@daf-materials/kit', exportName: 'KPICard' },
    { componentName: 'PieChart', package: '@daf-materials/kit', exportName: 'PieChart' },
    { componentName: 'DataTable', package: '@daf-materials/kit', exportName: 'DataTable' },
  ],
  componentsTree: [
    {
      componentName: 'Page',
      props: { title: '未命名报告' },
      'x-layout': { mode: 'grid', cols: 12 },
      state: {},
      dataSource: { list: [] },
      'x-filters': [],
      'x-linkages': [],
      children: [],
    } as PageNode,
  ],
} as ReportSchema & { name: string };

export function seedFiles(): SourceFile[] {
  return [
    { path: 'report.schema.json', content: JSON.stringify(SEED_SCHEMA, null, 2) + '\n' },
    { path: 'package.json', content: JSON.stringify({ name: 'sandbox-report', private: true, type: 'module' }, null, 2) + '\n' },
  ];
}
