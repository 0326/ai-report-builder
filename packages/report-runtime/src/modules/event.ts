/** EventRuntime（P0）：块间事件总线，事件名约束为 x-emits 声明集；声明式 linkage 自动装配 */
import type { RuntimeModule } from '../kernel.ts';
import type { Unwatch } from '../types.ts';
import { getPage } from '../types.ts';
import { evalExpression } from '../expr.ts';
import type { LoggerRuntime } from './logger.ts';
import type { StateRuntime } from './state.ts';

export interface EventRuntime {
  /** source = "nodeId.eventName" */
  emit(source: string, payload?: unknown): void;
  on(source: string, cb: (payload: unknown) => void): Unwatch;
  /** 块作用域 emit：未声明事件被拒绝（log + no-op） */
  emitFrom(nodeId: string): (event: string, payload?: unknown) => void;
}

export const eventModule: RuntimeModule<EventRuntime> = {
  name: 'event',
  deps: ['logger', 'state'],
  setup(kernel, ctx) {
    const logger = kernel.get<LoggerRuntime>('logger');
    const state = kernel.get<StateRuntime>('state');
    const page = getPage(ctx.schema);

    // 声明集：nodeId.event
    const declared = new Set<string>();
    const walk = (nodes = page.children) => {
      for (const n of nodes) {
        for (const e of n['x-emits'] ?? []) declared.add(`${n.id}.${e}`);
        if (n.children) walk(n.children);
      }
    };
    walk();

    const handlers = new Map<string, Set<(p: unknown) => void>>();

    const api: EventRuntime = {
      emit(source, payload) {
        logger.log('event.emit', { source, payload });
        for (const cb of [...(handlers.get(source) ?? [])]) cb(payload);
      },
      on(source, cb) {
        let set = handlers.get(source);
        if (!set) handlers.set(source, (set = new Set()));
        set.add(cb);
        return () => set!.delete(cb);
      },
      emitFrom(nodeId) {
        return (event, payload) => {
          const source = `${nodeId}.${event}`;
          if (!declared.has(source)) {
            logger.log('event.blocked', { source, reason: 'not declared in x-emits' });
            return;
          }
          api.emit(source, payload);
        };
      },
    };

    // 声明式 linkage 自动装配
    for (const lk of page['x-linkages'] ?? []) {
      if (lk.action === 'setState' && lk.target) {
        api.on(lk.source, (payload) => {
          const value = lk.mapping
            ? evalExpression(lk.mapping, {}, { payload }, (e) => logger.log('linkage.mapping.error', { id: lk.id, error: e.message }))
            : payload;
          logger.log('linkage.fire', { id: lk.id, target: lk.target, value });
          state.set(lk.target!, value);
        });
      } else if (lk.action === 'custom' && lk.handler) {
        const fn = ctx.customHandlers?.[lk.handler];
        if (!fn) {
          logger.log('linkage.handler.missing', { id: lk.id, handler: lk.handler });
        } else {
          api.on(lk.source, (payload) => {
            logger.log('linkage.fire', { id: lk.id, handler: lk.handler });
            fn(payload, { state, event: api });
          });
        }
      }
    }

    return api;
  },
};
