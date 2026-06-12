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
