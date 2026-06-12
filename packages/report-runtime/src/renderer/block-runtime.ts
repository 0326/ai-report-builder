/**
 * 块作用域 runtime facade —— AI 生成代码的唯一世界接口。
 * 治理在 facade 上兜底：query 仅允许 x-consumes 声明的 dsId；emit 仅允许 x-emits 声明的事件。
 */
import type { RuntimeKernel } from '../kernel.ts';
import type { SchemaNode, Unwatch } from '../types.ts';
import type { DataRuntime, DataState, QueryOpts } from '../modules/data.ts';
import type { StateRuntime } from '../modules/state.ts';
import type { EventRuntime } from '../modules/event.ts';
import type { LoggerRuntime } from '../modules/logger.ts';
import type { QueryResult } from '../types.ts';

export interface BlockRuntime {
  nodeId: string;
  data: {
    query(dsId: string, opts?: QueryOpts): Promise<QueryResult>;
    watch(dsId: string, cb: (s: DataState) => void): Unwatch;
    get(dsId: string): DataState;
  };
  state: Pick<StateRuntime, 'get' | 'set' | 'watch'>;
  event: {
    emit(event: string, payload?: unknown): void;
    on(source: string, cb: (payload: unknown) => void): Unwatch;
  };
  log(type: string, payload?: Record<string, unknown>): void;
}

export function makeBlockRuntime(kernel: RuntimeKernel, node: SchemaNode): BlockRuntime {
  const data = kernel.get<DataRuntime>('data');
  const state = kernel.get<StateRuntime>('state');
  const event = kernel.get<EventRuntime>('event');
  const logger = kernel.get<LoggerRuntime>('logger');
  const consumes = new Set(node['x-consumes'] ?? []);

  const assertConsumes = (dsId: string) => {
    if (!consumes.has(dsId)) {
      logger.log('data.blocked', { nodeId: node.id, dsId, reason: 'not in x-consumes' });
      throw new Error(`[block:${node.id}] 数据源未在 x-consumes 声明: ${dsId}`);
    }
  };

  return {
    nodeId: node.id,
    data: {
      query(dsId, opts) {
        assertConsumes(dsId);
        return data.query(dsId, opts);
      },
      watch(dsId, cb) {
        assertConsumes(dsId);
        return data.watch(dsId, cb);
      },
      get(dsId) {
        assertConsumes(dsId);
        return data.getState(dsId);
      },
    },
    state: {
      get: (k) => state.get(k),
      set: (k, v) => state.set(k, v),
      watch: (k, cb) => state.watch(k, cb),
    },
    event: {
      emit: event.emitFrom(node.id),
      on: (source, cb) => event.on(source, cb),
    },
    log: (type, payload) => logger.log(`block.${type}`, { nodeId: node.id, ...payload }),
  };
}
