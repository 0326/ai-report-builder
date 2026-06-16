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

// 渠道在总 UV 中的占比（metric_dau 按选中渠道缩放，演示"点击渠道 → 趋势只看该渠道"）
const CHANNEL_SHARE: Record<string, number> = { app: 0.505, web: 0.28, mini: 0.143, other: 0.071 };

function channelFactor(channel: unknown): number {
  const c = typeof channel === 'string' ? channel : 'all';
  return c === 'all' ? 1 : CHANNEL_SHARE[c] ?? 1;
}

// 留存漏斗各环节人数（按 region 缩放）
const RETENTION: Array<{ stage: string; users: number }> = [
  { stage: '访问', users: 16240 },
  { stage: '注册', users: 8420 },
  { stage: '激活', users: 5310 },
  { stage: '7日留存', users: 2980 },
  { stage: '付费', users: 1120 },
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

    case 'metric_dau': {
      const cf = channelFactor(params.channel);
      return DATES.map((date, i) => ({ date, dau: round(BASE_DAU[i] * f * cf) }));
    }

    case 'metric_retention':
      return RETENTION.map((r) => ({ stage: r.stage, users: round(r.users * f) }));

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

/** 内置示例数据集 id（datasets 注册中心据此路由到 fixtures）。 */
export const BUILTIN_DATASETS = ['metric_summary', 'metric_dau', 'metric_channel', 'metric_detail', 'metric_retention'];
/** @deprecated 用 datasets.knownDatasetIds()（含上传数据集）；保留兼容旧引用 */
export const KNOWN_DATASETS = BUILTIN_DATASETS;
