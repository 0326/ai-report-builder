/**
 * DAF 查询 mock 数据集（零依赖）。按 region 参数缩放，模拟"切区域 → 数据变化 → 联动刷新"。
 * datasetId: metric_summary / metric_dau / metric_channel / metric_detail
 */

type Row = Record<string, unknown>;

const REGION_FACTOR: Record<string, number> = { all: 1, app: 0.55, web: 0.3, mini: 0.15 };

function factor(region: unknown): number {
  const r = typeof region === 'string' ? region : 'all';
  return REGION_FACTOR[r] ?? 1;
}

const DATES = ['06-06', '06-07', '06-08', '06-09', '06-10', '06-11', '06-12'].map((d) => `2026-${d}`);
const BASE_DAU = [12800, 13120, 12640, 14010, 15230, 16880, 16240];
const CHANNELS: Array<{ channel: string; uv: number }> = [
  { channel: 'app', uv: 9200 },
  { channel: 'web', uv: 5100 },
  { channel: 'mini', uv: 2600 },
  { channel: 'other', uv: 1300 },
];

const round = (n: number) => Math.round(n);

export function queryDataset(datasetId: string, params: Record<string, unknown>): Row[] {
  const f = factor(params.region);

  switch (datasetId) {
    case 'metric_summary':
      return [{
        dau: round(16240 * f),
        newUser: round(2310 * f),
        revenue: round(184500 * f),
      }];

    case 'metric_dau':
      return DATES.map((date, i) => ({ date, dau: round(BASE_DAU[i] * f) }));

    case 'metric_channel':
      return CHANNELS.map((c) => ({ channel: c.channel, uv: round(c.uv * f) }));

    case 'metric_detail':
      return DATES.flatMap((date, i) =>
        CHANNELS.map((c) => ({
          date,
          channel: c.channel,
          uv: round(c.uv * f * (0.85 + (i % 3) * 0.07)),
          dau: round(BASE_DAU[i] * f * (c.uv / 18200)),
        })),
      );

    default:
      return [];
  }
}

export const KNOWN_DATASETS = ['metric_summary', 'metric_dau', 'metric_channel', 'metric_detail'];
