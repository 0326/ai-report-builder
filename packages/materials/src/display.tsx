/** 展示类物料（antd）：KPICard / TextBlock */
import { Statistic } from 'antd';

type Row = Record<string, unknown>;

export interface KPICardProps {
  /** 直接给值，或通过 data + field 从数据源取首行 */
  value?: number | string;
  data?: Row[];
  field?: string;
  suffix?: string;
  prefix?: string;
  precision?: number;
  /** 环比变化（百分数，正绿负红） */
  delta?: number;
  onEmit?: (event: string, payload?: unknown) => void;
}

export function KPICard({ value, data, field, suffix, prefix, precision, delta }: KPICardProps) {
  const v = value ?? (field && data?.length ? (data[0][field] as number | string) : undefined);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 8px' }}>
      <Statistic value={v as never} suffix={suffix} prefix={prefix} precision={precision} />
      {typeof delta === 'number' && (
        <div style={{ fontSize: 12, marginTop: 4, color: delta >= 0 ? '#34a853' : '#d54941' }}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}% 环比
        </div>
      )}
    </div>
  );
}

export interface TextBlockProps {
  content?: string;
  align?: 'left' | 'center' | 'right';
  fontSize?: number;
  onEmit?: (event: string, payload?: unknown) => void;
}

export function TextBlock({ content = '', align = 'left', fontSize = 14 }: TextBlockProps) {
  return (
    <div style={{ whiteSpace: 'pre-wrap', textAlign: align, fontSize, lineHeight: 1.7, color: '#1f2329', padding: '0 4px' }}>
      {content}
    </div>
  );
}
