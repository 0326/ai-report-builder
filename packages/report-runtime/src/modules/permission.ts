/** PermissionRuntime（P0）：can() 同步判定。数据级强裁剪在 DAF 服务侧，前端做显隐/拦截/兜底 */
import type { RuntimeModule } from '../kernel.ts';
import type { LoggerRuntime } from './logger.ts';

export type PermissionType = 'dataset' | 'action';

export interface PermissionRuntime {
  can(type: PermissionType, id: string): boolean;
}

export const permissionModule: RuntimeModule<PermissionRuntime> = {
  name: 'permission',
  deps: ['logger'],
  setup(kernel, ctx) {
    const logger = kernel.get<LoggerRuntime>('logger');
    const perms = ctx.user?.permissions;
    const allowed = (list: string[] | '*' | undefined, id: string): boolean => {
      if (list === undefined || list === '*') return true; // 未声明 = 全允许（mock 默认）
      return list.includes(id);
    };
    const api: PermissionRuntime = {
      can(type, id) {
        const ok = type === 'dataset' ? allowed(perms?.datasets, id) : allowed(perms?.actions, id);
        if (!ok) logger.log('permission.denied', { type, id });
        return ok;
      },
    };
    return api;
  },
};
