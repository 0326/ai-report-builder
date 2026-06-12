/**
 * DataRuntime（P0 最核心）：唯一取数通道。
 * 治理：仅声明 dsId / in-flight 去重 / LRU+TTL 缓存 / 筛选变更 abort / 超时 /
 *      state 依赖图自动 reload(x-trigger:auto) / 页面级并发预算 / 审计上报
 */
import type { RuntimeModule } from '../kernel.ts';
import type { DataSourceDef, QueryResult, Unwatch } from '../types.ts';
import { getPage } from '../types.ts';
import { evalExpression, extractStateDeps, isJSExpression, stableStringify } from '../expr.ts';
import type { LoggerRuntime } from './logger.ts';
import type { StateRuntime } from './state.ts';
import type { PermissionRuntime } from './permission.ts';

export interface QueryOpts {
  params?: Record<string, unknown>;
  /** 跳过缓存 */
  force?: boolean;
  timeoutMs?: number;
}

export interface DataState {
  dsId: string;
  loading: boolean;
  error?: string;
  rows: Array<Record<string, unknown>>;
  updatedAt?: number;
}

export interface DataRuntime {
  query(dsId: string, opts?: QueryOpts): Promise<QueryResult>;
  reload(dsId: string): Promise<void>;
  watch(dsId: string, cb: (s: DataState) => void): Unwatch;
  getState(dsId: string): DataState;
  /** JSExpression 求值用：this.dataSourceMap['ds_x'].data */
  dataSourceMap(): Record<string, { data: Array<Record<string, unknown>>; loading: boolean; error?: string }>;
  /** 启动所有 x-trigger:auto 数据源 */
  initAuto(): Promise<void>;
  listDefs(): DataSourceDef[];
}

const DEFAULT_TTL = 60_000;
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_CONCURRENCY = 6;
const CACHE_MAX = 50;

export const dataModule: RuntimeModule<DataRuntime> = {
  name: 'data',
  deps: ['logger', 'state', 'permission'],
  setup(kernel, ctx) {
    const logger = kernel.get<LoggerRuntime>('logger');
    const state = kernel.get<StateRuntime>('state');
    const permission = kernel.get<PermissionRuntime>('permission');
    const page = getPage(ctx.schema);
    const defs = new Map<string, DataSourceDef>();
    for (const d of page.dataSource?.list ?? []) defs.set(d.id, d);

    const states = new Map<string, DataState>();
    for (const id of defs.keys()) states.set(id, { dsId: id, loading: false, rows: [] });

    const cache = new Map<string, { result: QueryResult; at: number; ttl: number }>();
    const inflight = new Map<string, Promise<QueryResult>>();
    const controllers = new Map<string, AbortController>();
    const watchers = new Map<string, Set<(s: DataState) => void>>();

    // --- 并发预算（信号量） ---
    let active = 0;
    const waiting: Array<() => void> = [];
    const acquire = (): Promise<void> =>
      active < DEFAULT_CONCURRENCY
        ? (active++, Promise.resolve())
        : new Promise((res) => waiting.push(() => { active++; res(); }));
    const release = () => {
      active--;
      waiting.shift()?.();
    };

    // --- state 依赖图: stateKey -> Set<dsId> ---
    const depGraph = new Map<string, Set<string>>();
    for (const def of defs.values()) {
      for (const v of Object.values(def.options.params ?? {})) {
        if (!isJSExpression(v)) continue;
        for (const key of extractStateDeps(v.value)) {
          let set = depGraph.get(key);
          if (!set) depGraph.set(key, (set = new Set()));
          set.add(def.id);
        }
      }
    }
    state.watchAll((key) => {
      const dependents = depGraph.get(key);
      if (!dependents) return;
      for (const dsId of dependents) {
        const def = defs.get(dsId)!;
        if ((def['x-trigger'] ?? 'auto') === 'auto') {
          logger.log('data.depReload', { trigger: key, dsId });
          void api.query(dsId, { force: true }).catch(() => {});
        }
      }
    });

    const notify = (dsId: string) => {
      const s = states.get(dsId)!;
      for (const cb of [...(watchers.get(dsId) ?? [])]) cb(s);
      kernel.invalidate();
    };

    const patchState = (dsId: string, patch: Partial<DataState>) => {
      states.set(dsId, { ...states.get(dsId)!, ...patch });
      notify(dsId);
    };

    const resolveParams = (def: DataSourceDef): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      const thisArg = { state: state.snapshot() };
      for (const [k, v] of Object.entries(def.options.params ?? {})) {
        out[k] = isJSExpression(v)
          ? evalExpression(v.value, thisArg, {}, (e) => logger.log('data.params.error', { dsId: def.id, key: k, error: e.message }))
          : v;
      }
      return out;
    };

    const lruSet = (key: string, entry: { result: QueryResult; at: number; ttl: number }) => {
      cache.delete(key);
      cache.set(key, entry);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
    };

    const api: DataRuntime = {
      listDefs: () => [...defs.values()],
      getState: (dsId) => states.get(dsId) ?? { dsId, loading: false, rows: [], error: `undeclared: ${dsId}` },
      watch(dsId, cb) {
        let set = watchers.get(dsId);
        if (!set) watchers.set(dsId, (set = new Set()));
        set.add(cb);
        return () => set!.delete(cb);
      },
      dataSourceMap() {
        const map: Record<string, { data: Array<Record<string, unknown>>; loading: boolean; error?: string }> = {};
        for (const [id, s] of states) map[id] = { data: s.rows, loading: s.loading, error: s.error };
        return map;
      },

      async query(dsId, opts = {}) {
        const def = defs.get(dsId);
        if (!def) {
          logger.log('data.blocked', { dsId, reason: 'undeclared dataSource' });
          throw new Error(`[data] undeclared dataSource: ${dsId}（schema dataSource.list 未声明，运行期拒绝执行）`);
        }
        const { datasetId, fields } = def.options;
        if (!permission.can('dataset', datasetId)) {
          patchState(dsId, { loading: false, error: `no permission: ${datasetId}` });
          throw new Error(`[data] permission denied for dataset: ${datasetId}`);
        }

        const params = { ...resolveParams(def), ...(opts.params ?? {}) };
        const key = `${dsId}:${stableStringify(params)}`;

        // 缓存命中
        const hit = cache.get(key);
        if (!opts.force && hit && Date.now() - hit.at < hit.ttl) {
          logger.log('data.cacheHit', { dsId, key });
          patchState(dsId, { loading: false, error: undefined, rows: hit.result.rows, updatedAt: hit.at });
          return { ...hit.result, fromCache: true };
        }
        // in-flight 去重
        const pending = inflight.get(key);
        if (pending) {
          logger.log('data.dedupe', { dsId, key });
          return pending;
        }
        // 同 dsId 的上一轮未完成查询：abort（筛选变更场景）
        controllers.get(dsId)?.abort();
        const ac = new AbortController();
        controllers.set(dsId, ac);
        const timer = setTimeout(() => ac.abort(new Error('timeout')), opts.timeoutMs ?? DEFAULT_TIMEOUT);

        patchState(dsId, { loading: true, error: undefined });
        const started = Date.now();

        const run = (async (): Promise<QueryResult> => {
          await acquire();
          try {
            if (ac.signal.aborted) throw new Error('aborted');
            const res = await ctx.services.dafQuery({ dsId, datasetId, fields, params, signal: ac.signal });
            if (ac.signal.aborted) throw new Error('aborted');
            const result: QueryResult = {
              dsId, datasetId, rows: res.rows, total: res.total ?? res.rows.length, tookMs: Date.now() - started,
            };
            lruSet(key, { result, at: Date.now(), ttl: def['x-cacheTTL'] ?? DEFAULT_TTL });
            patchState(dsId, { loading: false, error: undefined, rows: result.rows, updatedAt: Date.now() });
            logger.log('data.query', { dsId, datasetId, params, tookMs: result.tookMs, rowCount: result.rows.length });
            return result;
          } catch (e) {
            const msg = (e as Error).message ?? String(e);
            if (ac.signal.aborted || msg === 'aborted') {
              logger.log('data.aborted', { dsId, key });
              // 被新一轮查询替代：不写 error 态
              if (controllers.get(dsId) === ac) patchState(dsId, { loading: false });
            } else {
              logger.log('data.error', { dsId, datasetId, error: msg });
              patchState(dsId, { loading: false, error: msg });
            }
            throw e;
          } finally {
            clearTimeout(timer);
            release();
            if (inflight.get(key) === run) inflight.delete(key);
          }
        })();

        inflight.set(key, run);
        return run;
      },

      async reload(dsId) {
        await api.query(dsId, { force: true });
      },

      async initAuto() {
        const autos = [...defs.values()].filter((d) => (d['x-trigger'] ?? 'auto') === 'auto');
        await Promise.allSettled(autos.map((d) => api.query(d.id)));
      },
    };

    return api;
  },
};
