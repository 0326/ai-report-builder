/** LoggerRuntime（P0 横切）：统一打点，模块治理事件自动上报 */
import type { RuntimeModule } from '../kernel.ts';

export interface LogEvent {
  ts: number;
  type: string;
  payload?: Record<string, unknown>;
}

export interface LoggerRuntime {
  log(type: string, payload?: Record<string, unknown>): void;
  subscribe(cb: (e: LogEvent) => void): () => void;
  getBuffer(): LogEvent[];
}

const BUFFER_MAX = 500;

export const loggerModule: RuntimeModule<LoggerRuntime> = {
  name: 'logger',
  setup(_kernel, ctx) {
    const buffer: LogEvent[] = [];
    const subs = new Set<(e: LogEvent) => void>();
    const api: LoggerRuntime = {
      log(type, payload) {
        const e: LogEvent = { ts: Date.now(), type, payload };
        buffer.push(e);
        if (buffer.length > BUFFER_MAX) buffer.shift();
        if (ctx.env === 'design') {
          // eslint-disable-next-line no-console
          console.debug(`[daf:${type}]`, payload ?? '');
        }
        for (const cb of [...subs]) cb(e);
      },
      subscribe(cb) {
        subs.add(cb);
        return () => subs.delete(cb);
      },
      getBuffer: () => [...buffer],
    };
    return api;
  },
};
