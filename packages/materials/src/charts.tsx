/** 图表物料（VChart）：LineChart / BarChart / PieChart */
import { VChartView } from './vchart-view.tsx';

type Row = Record<string, unknown>;
type EmitFn = (event: string, payload?: unknown) => void;

export interface LineChartProps {
  data?: Row[];
  xField?: string;
  yField?: string;
  seriesField?: string;
  smooth?: boolean;
  onEmit?: EmitFn;
}

export function LineChart({ data = [], xField = 'date', yField = 'value', seriesField, smooth = false, onEmit }: LineChartProps) {
  const spec: Record<string, unknown> = {
    type: 'line',
    data: [{ id: 'data', values: data }],
    xField,
    yField,
    ...(seriesField ? { seriesField } : {}),
    line: { style: { curveType: smooth ? 'monotone' : 'linear' } },
    point: { visible: data.length <= 40 },
    padding: 8,
  };
  return (
    <VChartView
      spec={spec}
      events={{ click: (p) => p.datum && onEmit?.('click', p.datum) }}
    />
  );
}

export interface BarChartProps {
  data?: Row[];
  xField?: string;
  yField?: string;
  seriesField?: string;
  horizontal?: boolean;
  onEmit?: EmitFn;
}

export function BarChart({ data = [], xField = 'category', yField = 'value', seriesField, horizontal = false, onEmit }: BarChartProps) {
  const spec: Record<string, unknown> = {
    type: 'bar',
    data: [{ id: 'data', values: data }],
    xField: horizontal ? yField : xField,
    yField: horizontal ? xField : yField,
    direction: horizontal ? 'horizontal' : 'vertical',
    ...(seriesField ? { seriesField } : {}),
    padding: 8,
  };
  return (
    <VChartView
      spec={spec}
      events={{ click: (p) => p.datum && onEmit?.('click', p.datum) }}
    />
  );
}

export interface PieChartProps {
  data?: Row[];
  categoryField?: string;
  valueField?: string;
  donut?: boolean;
  onEmit?: EmitFn;
}

export function PieChart({ data = [], categoryField = 'name', valueField = 'value', donut = false, onEmit }: PieChartProps) {
  const spec: Record<string, unknown> = {
    type: 'pie',
    data: [{ id: 'data', values: data }],
    categoryField,
    valueField,
    outerRadius: 0.85,
    innerRadius: donut ? 0.55 : 0,
    label: { visible: true },
    legends: { visible: true, orient: 'right' },
    padding: 8,
  };
  return (
    <VChartView
      spec={spec}
      events={{
        click: (p) => p.datum && onEmit?.('click', {
          name: p.datum[categoryField],
          value: p.datum[valueField],
        }),
      }}
    />
  );
}

export interface AreaChartProps {
  data?: Row[];
  xField?: string;
  yField?: string;
  seriesField?: string;
  stack?: boolean;
  onEmit?: EmitFn;
}

export function AreaChart({ data = [], xField = 'date', yField = 'value', seriesField, stack = false, onEmit }: AreaChartProps) {
  const spec: Record<string, unknown> = {
    type: 'area',
    data: [{ id: 'data', values: data }],
    xField,
    yField,
    ...(seriesField ? { seriesField, stack } : {}),
    area: { style: { fillOpacity: 0.25 } },
    line: { style: { curveType: 'monotone' } },
    point: { visible: false },
    padding: 8,
  };
  return (
    <VChartView
      spec={spec}
      events={{ click: (p) => p.datum && onEmit?.('click', p.datum) }}
    />
  );
}

export interface FunnelChartProps {
  data?: Row[];
  categoryField?: string;
  valueField?: string;
  onEmit?: EmitFn;
}

export function FunnelChart({ data = [], categoryField = 'stage', valueField = 'value', onEmit }: FunnelChartProps) {
  const spec: Record<string, unknown> = {
    type: 'funnel',
    data: [{ id: 'data', values: data }],
    categoryField,
    valueField,
    isTransform: true,
    label: { visible: true },
    transformLabel: { visible: true },
    legends: { visible: false },
    padding: 8,
  };
  return (
    <VChartView
      spec={spec}
      events={{
        click: (p) => p.datum && onEmit?.('click', {
          name: p.datum[categoryField],
          value: p.datum[valueField],
        }),
      }}
    />
  );
}

export interface RadarChartProps {
  data?: Row[];
  categoryField?: string;
  valueField?: string;
  seriesField?: string;
  onEmit?: EmitFn;
}

export function RadarChart({ data = [], categoryField = 'dimension', valueField = 'value', seriesField, onEmit }: RadarChartProps) {
  const spec: Record<string, unknown> = {
    type: 'radar',
    data: [{ id: 'data', values: data }],
    categoryField,
    valueField,
    ...(seriesField ? { seriesField } : {}),
    area: { visible: true, style: { fillOpacity: 0.2 } },
    axes: [
      { orient: 'radius', grid: { smooth: true } },
      { orient: 'angle', tick: { visible: false } },
    ],
    padding: 8,
  };
  return (
    <VChartView
      spec={spec}
      events={{ click: (p) => p.datum && onEmit?.('click', p.datum) }}
    />
  );
}

export interface GaugeChartProps {
  /** 直接给值，或 data+field 取首行 */
  value?: number;
  data?: Row[];
  field?: string;
  max?: number;
  label?: string;
  onEmit?: EmitFn;
}

export function GaugeChart({ value, data, field, max = 100, label }: GaugeChartProps) {
  const v = Number(value ?? (field && data?.length ? data[0][field] : 0)) || 0;
  const percent = max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0;
  return <GaugeRing value={v} percent={percent} label={label} />;
}


/** 达成度进度环（antd Progress dashboard）：值随容器自适应，中心显示真实值。 */
import { Progress } from 'antd';

function GaugeRing({ value, percent, label }: { value: number; percent: number; label?: string }) {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Progress
        type="dashboard"
        percent={Math.round(percent * 10) / 10}
        gapDegree={90}
        strokeColor={{ '0%': '#3370ff', '100%': '#7c3aed' }}
        strokeWidth={10}
        size={160}
        format={() => (
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <span style={{ fontSize: 26, fontWeight: 600, color: '#1f2329' }}>{value}</span>
            {label && <span style={{ fontSize: 12, color: '#8f959e' }}>{label}</span>}
          </span>
        )}
      />
    </div>
  );
}
