/** 物料 meta（LCE componentMeta 精简形 + x-ai 语义块）：host 物料面板与 Agent 检索共用 */

export interface MaterialMeta {
  componentName: string;
  package: string;
  exportName: string;
  title: string;
  category: 'chart' | 'table' | 'display';
  /** 拖入画布时的默认 props（数据绑定 prop 由绑定向导填充） */
  defaultProps: Record<string, unknown>;
  /** 拖入画布时的默认尺寸（12 列栅格） */
  defaultSize: { w: number; h: number };
  /** 数据绑定入口 prop（undefined = 不消费数据源） */
  dataProp?: string;
  /** 可配置 props 描述（可视编排属性面板用） */
  configurableProps: Array<{
    name: string;
    title: string;
    type: 'boolean' | 'string' | 'number' | 'enum';
    options?: string[];
  }>;
  'x-ai': {
    summary: string;
    useWhen?: string;
    avoidWhen?: string;
  };
}

const PKG = '@daf-materials/kit';

export const materialMetas: MaterialMeta[] = [
  {
    componentName: 'LineChart', package: PKG, exportName: 'LineChart',
    title: '折线图', category: 'chart',
    defaultProps: { xField: 'date', yField: 'value', smooth: false },
    defaultSize: { w: 8, h: 6 }, dataProp: 'data',
    configurableProps: [
      { name: 'xField', title: 'X 字段', type: 'string' },
      { name: 'yField', title: 'Y 字段', type: 'string' },
      { name: 'seriesField', title: '分组字段', type: 'string' },
      { name: 'smooth', title: '平滑曲线', type: 'boolean' },
    ],
    'x-ai': { summary: '展示指标随时间/有序维度的趋势变化', useWhen: '趋势、走势、随时间变化', avoidWhen: '无序类目对比（用柱状图）' },
  },
  {
    componentName: 'BarChart', package: PKG, exportName: 'BarChart',
    title: '柱状图', category: 'chart',
    defaultProps: { xField: 'category', yField: 'value' },
    defaultSize: { w: 6, h: 6 }, dataProp: 'data',
    configurableProps: [
      { name: 'xField', title: 'X 字段', type: 'string' },
      { name: 'yField', title: 'Y 字段', type: 'string' },
      { name: 'horizontal', title: '横向', type: 'boolean' },
    ],
    'x-ai': { summary: '类目间数值对比', useWhen: '排名、对比、TopN', avoidWhen: '占比构成（用饼图）' },
  },
  {
    componentName: 'PieChart', package: PKG, exportName: 'PieChart',
    title: '饼图', category: 'chart',
    defaultProps: { categoryField: 'name', valueField: 'value', donut: false },
    defaultSize: { w: 4, h: 6 }, dataProp: 'data',
    configurableProps: [
      { name: 'categoryField', title: '类目字段', type: 'string' },
      { name: 'valueField', title: '数值字段', type: 'string' },
      { name: 'donut', title: '环形', type: 'boolean' },
    ],
    'x-ai': { summary: '部分与整体的占比构成', useWhen: '占比、构成、分布', avoidWhen: '类目超过 8 个' },
  },
  {
    componentName: 'DataTable', package: PKG, exportName: 'DataTable',
    title: '数据表格', category: 'table',
    defaultProps: {},
    defaultSize: { w: 12, h: 7 }, dataProp: 'data',
    configurableProps: [],
    'x-ai': { summary: '明细数据表格展示（VTable）', useWhen: '明细、清单、多字段查看' },
  },
  {
    componentName: 'KPICard', package: PKG, exportName: 'KPICard',
    title: '指标卡', category: 'display',
    defaultProps: { field: 'value' },
    defaultSize: { w: 3, h: 3 }, dataProp: 'data',
    configurableProps: [
      { name: 'field', title: '取值字段', type: 'string' },
      { name: 'suffix', title: '后缀', type: 'string' },
      { name: 'precision', title: '小数位', type: 'number' },
    ],
    'x-ai': { summary: '单一核心指标数值展示', useWhen: '核心 KPI、汇总值' },
  },
  {
    componentName: 'TextBlock', package: PKG, exportName: 'TextBlock',
    title: '文本块', category: 'display',
    defaultProps: { content: '双击编辑文本' },
    defaultSize: { w: 12, h: 2 },
    configurableProps: [
      { name: 'content', title: '内容', type: 'string' },
      { name: 'fontSize', title: '字号', type: 'number' },
      { name: 'align', title: '对齐', type: 'enum', options: ['left', 'center', 'right'] },
    ],
    'x-ai': { summary: '说明性文字/结论段落', useWhen: '报告结论、注释说明' },
  },
  {
    componentName: 'AreaChart', package: PKG, exportName: 'AreaChart',
    title: '面积图', category: 'chart',
    defaultProps: { xField: 'date', yField: 'value', stack: false },
    defaultSize: { w: 8, h: 6 }, dataProp: 'data',
    configurableProps: [
      { name: 'xField', title: 'X 字段', type: 'string' },
      { name: 'yField', title: 'Y 字段', type: 'string' },
      { name: 'seriesField', title: '分组字段', type: 'string' },
      { name: 'stack', title: '堆叠', type: 'boolean' },
    ],
    'x-ai': { summary: '趋势 + 量级感知（带填充的折线）', useWhen: '累计量、流量规模随时间变化', avoidWhen: '多序列交叉对比（用折线图）' },
  },
  {
    componentName: 'FunnelChart', package: PKG, exportName: 'FunnelChart',
    title: '漏斗图', category: 'chart',
    defaultProps: { categoryField: 'stage', valueField: 'value' },
    defaultSize: { w: 6, h: 6 }, dataProp: 'data',
    configurableProps: [
      { name: 'categoryField', title: '环节字段', type: 'string' },
      { name: 'valueField', title: '数值字段', type: 'string' },
    ],
    'x-ai': { summary: '多环节转化/流失展示（含转化率标签）', useWhen: '留存漏斗、转化链路、注册激活付费' },
  },
  {
    componentName: 'RadarChart', package: PKG, exportName: 'RadarChart',
    title: '雷达图', category: 'chart',
    defaultProps: { categoryField: 'dimension', valueField: 'value' },
    defaultSize: { w: 6, h: 6 }, dataProp: 'data',
    configurableProps: [
      { name: 'categoryField', title: '维度字段', type: 'string' },
      { name: 'valueField', title: '数值字段', type: 'string' },
      { name: 'seriesField', title: '分组字段', type: 'string' },
    ],
    'x-ai': { summary: '多维度能力/评分对比', useWhen: '多维评估、画像对比', avoidWhen: '维度少于 3 个' },
  },
  {
    componentName: 'GaugeChart', package: PKG, exportName: 'GaugeChart',
    title: '仪表盘', category: 'chart',
    defaultProps: { max: 100 },
    defaultSize: { w: 4, h: 5 }, dataProp: 'data',
    configurableProps: [
      { name: 'field', title: '取值字段', type: 'string' },
      { name: 'max', title: '最大值', type: 'number' },
      { name: 'label', title: '标签', type: 'string' },
    ],
    'x-ai': { summary: '单指标完成度/健康度（0~max 进度环）', useWhen: '达成率、健康分、利用率' },
  },
  {
    componentName: 'SectionTitle', package: PKG, exportName: 'SectionTitle',
    title: '区块标题', category: 'display',
    defaultProps: { title: '区块标题', divider: true },
    defaultSize: { w: 12, h: 2 },
    configurableProps: [
      { name: 'title', title: '标题', type: 'string' },
      { name: 'subtitle', title: '副标题', type: 'string' },
      { name: 'divider', title: '分隔线', type: 'boolean' },
    ],
    'x-ai': { summary: '报告分节标题（主/副标题 + 分隔线）', useWhen: '把报告划分成多个章节时' },
  },
];

export function getMaterialMeta(componentName: string): MaterialMeta | undefined {
  return materialMetas.find((m) => m.componentName === componentName);
}
