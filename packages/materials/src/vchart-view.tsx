/** VChart 通用挂载容器：spec 驱动，自动 updateSpec / release */
import { useEffect, useRef } from 'react';

type VChartEvents = Record<string, (params: { datum?: Record<string, unknown> }) => void>;

export function VChartView({ spec, events }: { spec: Record<string, unknown>; events?: VChartEvents }) {
  const domRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<{ updateSpec: (s: unknown) => unknown; release: () => void; on: (...args: unknown[]) => void } | null>(null);
  const eventsRef = useRef<VChartEvents | undefined>(events);
  eventsRef.current = events;

  const specJson = JSON.stringify(spec);

  useEffect(() => {
    let disposed = false;
    const mount = async () => {
      const { default: VChart } = await import('@visactor/vchart');
      if (disposed || !domRef.current) return;
      const fullSpec = { ...JSON.parse(specJson), autoFit: true };
      if (!chartRef.current) {
        const chart = new VChart(fullSpec, { dom: domRef.current });
        chartRef.current = chart as unknown as typeof chartRef.current;
        chart.on('click', { level: 'mark' } as never, ((params: { datum?: Record<string, unknown> }) => {
          eventsRef.current?.click?.(params);
        }) as never);
        await chart.renderAsync();
      } else {
        chartRef.current.updateSpec(fullSpec);
      }
    };
    void mount();
    return () => { disposed = true; };
  }, [specJson]);

  useEffect(() => () => {
    chartRef.current?.release();
    chartRef.current = null;
  }, []);

  return <div ref={domRef} style={{ width: '100%', height: '100%', minHeight: 80 }} />;
}
