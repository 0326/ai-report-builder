/**
 * 自定义代码块：DAU 趋势。
 * - 取数只走 runtime.data（唯一世界接口），dsId 必须 ∈ x-consumes
 * - 用公共物料 LineChart 渲染（@daf-materials/kit，作为共享依赖不打进 bundle）
 * - 点击数据点 emit 'drill'（必须 ∈ x-emits），由 schema x-linkages 登记的 onDrill 接收
 */
import { useSyncExternalStore } from 'react';
import { LineChart } from '@daf-materials/kit';
import type { BlockRuntime } from '@daf/report-runtime';
import { toTrendSeries, trendDelta } from '../../data/trend.ts';

export interface TrendBlockProps {
  smooth?: boolean;
  runtime: BlockRuntime;
  onEmit?: (event: string, payload?: unknown) => void;
}

export default function TrendBlock({ smooth = false, runtime, onEmit }: TrendBlockProps) {
  const state = useSyncExternalStore(
    (cb) => runtime.data.watch('ds_dau', cb),
    () => runtime.data.get('ds_dau'),
  );

  const series = toTrendSeries(state.rows);
  const delta = trendDelta(state.rows);

  if (!series.length) {
    return <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#8f959e', fontSize: 13 }}>暂无趋势数据</div>;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 12, padding: '0 4px 4px', color: delta >= 0 ? '#34a853' : '#d54941' }}>
        区间环比 {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%（点击数据点下钻）
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <LineChart
          data={series}
          xField="date"
          yField="dau"
          smooth={smooth}
          onEmit={(event: string, payload?: unknown) => {
            if (event === 'click') onEmit?.('drill', payload);
          }}
        />
      </div>
    </div>
  );
}

/**
 * 代码联动 handler（schema x-linkages: "src/blocks/TrendBlock#onDrill" 登记）。
 * 治理要求代码联动必须登记可见——它通过 runtime.state 写跨块状态，不裸操作 DOM。
 */
export function onDrill(payload: unknown, api: { state: { set(k: string, v: unknown): void } }) {
  const date = payload && typeof payload === 'object' ? (payload as { date?: unknown }).date : payload;
  api.state.set('drillDate', date ?? null);
}
