/** StateRuntime（P0）：跨块状态，schema state 初始化，set 触发数据依赖刷新（由 data 模块订阅） */
import type { RuntimeModule } from '../kernel.ts';
import type { Unwatch } from '../types.ts';
import { getPage } from '../types.ts';
import type { LoggerRuntime } from './logger.ts';

export interface StateRuntime {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  snapshot(): Record<string, unknown>;
  watch(key: string, cb: (value: unknown, prev: unknown) => void): Unwatch;
  watchAll(cb: (key: string, value: unknown, prev: unknown) => void): Unwatch;
}

export const stateModule: RuntimeModule<StateRuntime> = {
  name: 'state',
  deps: ['logger'],
  setup(kernel, ctx) {
    const logger = kernel.get<LoggerRuntime>('logger');
    const page = getPage(ctx.schema);
    const store: Record<string, unknown> = { ...(page.state ?? {}) };
    // x-filters 默认值兜底进 state
    for (const f of page['x-filters'] ?? []) {
      if (!(f.stateKey in store) && f.default !== undefined) store[f.stateKey] = f.default;
    }
    const keyWatchers = new Map<string, Set<(v: unknown, p: unknown) => void>>();
    const allWatchers = new Set<(k: string, v: unknown, p: unknown) => void>();

    const api: StateRuntime = {
      get: (key) => store[key],
      snapshot: () => ({ ...store }),
      set(key, value) {
        const prev = store[key];
        if (Object.is(prev, value)) return;
        store[key] = value;
        logger.log('state.set', { key, value, prev });
        for (const cb of [...(keyWatchers.get(key) ?? [])]) cb(value, prev);
        for (const cb of [...allWatchers]) cb(key, value, prev);
        kernel.invalidate();
      },
      watch(key, cb) {
        let set = keyWatchers.get(key);
        if (!set) keyWatchers.set(key, (set = new Set()));
        set.add(cb);
        return () => set!.delete(cb);
      },
      watchAll(cb) {
        allWatchers.add(cb);
        return () => allWatchers.delete(cb);
      },
    };
    return api;
  },
};
