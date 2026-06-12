/** createReportRuntime：装配内核 + P0 模块（业务工程入口由 @daf/report-scripts 注入，调用本函数） */
import { RuntimeKernel } from './kernel.ts';
import type { RuntimeModule } from './kernel.ts';
import type { ReportSchema, RuntimeContext, RuntimeEnv, UserContext, DafQueryService } from './types.ts';
import { loggerModule } from './modules/logger.ts';
import { stateModule } from './modules/state.ts';
import { permissionModule } from './modules/permission.ts';
import { dataModule } from './modules/data.ts';
import { eventModule } from './modules/event.ts';
import type { DataRuntime } from './modules/data.ts';

export interface CreateRuntimeOptions {
  schema: ReportSchema;
  env?: RuntimeEnv;
  user?: UserContext;
  services: { dafQuery: DafQueryService };
  customHandlers?: RuntimeContext['customHandlers'];
  host?: unknown;
  manifest?: unknown;
  /** 额外插拔模块（监控等横切由平台配置注入） */
  modules?: RuntimeModule[];
  /** 是否在 init 后自动启动 x-trigger:auto 数据源，默认 true */
  autoQuery?: boolean;
}

export async function createReportRuntime(opts: CreateRuntimeOptions): Promise<RuntimeKernel> {
  const kernel = new RuntimeKernel();
  kernel.use(loggerModule).use(stateModule).use(permissionModule).use(dataModule).use(eventModule);
  for (const m of opts.modules ?? []) kernel.use(m);
  await kernel.init({
    schema: opts.schema,
    env: opts.env ?? 'preview',
    user: opts.user ?? { id: 'mock-user' },
    services: opts.services,
    customHandlers: opts.customHandlers,
    host: opts.host ?? null,
    manifest: opts.manifest ?? null,
  });
  if (opts.autoQuery !== false) {
    await kernel.get<DataRuntime>('data').initAuto();
  }
  return kernel;
}
