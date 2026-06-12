/** TrendBlock 的纯数据转换函数（无 React，可单测）。 */

export interface DauRow {
  date: string;
  dau: number;
  [k: string]: unknown;
}

/** 归一化为图表 series：保证按日期升序、dau 数值化。 */
export function toTrendSeries(rows: Array<Record<string, unknown>>): DauRow[] {
  return rows
    .map((r) => ({ ...r, date: String(r.date ?? ''), dau: Number(r.dau ?? 0) }))
    .filter((r) => r.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 期末相对期初的环比涨跌幅（百分数）；样本不足返回 0。 */
export function trendDelta(rows: Array<Record<string, unknown>>): number {
  const s = toTrendSeries(rows);
  if (s.length < 2) return 0;
  const first = s[0].dau;
  const last = s[s.length - 1].dau;
  if (!first) return 0;
  return ((last - first) / first) * 100;
}

/** 峰值点（用于 drill 默认定位）。 */
export function peakPoint(rows: Array<Record<string, unknown>>): DauRow | undefined {
  const s = toTrendSeries(rows);
  if (!s.length) return undefined;
  return s.reduce((max, r) => (r.dau > max.dau ? r : max), s[0]);
}
