/** RuntimeKernel：模块注册/依赖序初始化/获取/销毁 + 变更通知。保持极小。 */
import type { RuntimeContext } from './types.ts';

export interface RuntimeModule<Api = unknown> {
  name: string;
  deps?: string[];
  setup(kernel: RuntimeKernel, ctx: RuntimeContext): Api | Promise<Api>;
  dispose?(): void;
}

export class RuntimeKernel {
  private modules = new Map<string, RuntimeModule>();
  private apis = new Map<string, unknown>();
  private initOrder: string[] = [];
  private listeners = new Set<() => void>();
  private initialized = false;
  /** 渲染层 useSyncExternalStore 的快照版本号 */
  version = 0;
  ctx!: RuntimeContext;

  use(mod: RuntimeModule): this {
    if (this.initialized) throw new Error('[kernel] cannot use() after init');
    this.modules.set(mod.name, mod);
    return this;
  }

  async init(ctx: RuntimeContext): Promise<void> {
    if (this.initialized) throw new Error('[kernel] already initialized');
    this.ctx = ctx;
    for (const name of this.topoSort()) {
      const mod = this.modules.get(name)!;
      const api = await mod.setup(this, ctx);
      this.apis.set(name, api);
      this.initOrder.push(name);
    }
    this.initialized = true;
  }

  has(name: string): boolean {
    return this.apis.has(name);
  }

  get<T = unknown>(name: string): T {
    if (!this.apis.has(name)) throw new Error(`[kernel] module not installed: ${name}`);
    return this.apis.get(name) as T;
  }

  /** 模块状态变化时调用，驱动渲染层刷新 */
  invalidate(): void {
    this.version++;
    for (const l of [...this.listeners]) l();
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    for (const name of [...this.initOrder].reverse()) {
      try {
        this.modules.get(name)?.dispose?.();
      } catch {
        /* dispose 失败不阻断 */
      }
    }
    this.apis.clear();
    this.listeners.clear();
    this.initOrder = [];
    this.initialized = false;
  }

  private topoSort(): string[] {
    const order: string[] = [];
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (name: string, path: string[]) => {
      const s = state.get(name);
      if (s === 'done') return;
      if (s === 'visiting') throw new Error(`[kernel] circular module deps: ${[...path, name].join(' -> ')}`);
      const mod = this.modules.get(name);
      if (!mod) throw new Error(`[kernel] missing module dep: ${name} (required by ${path[path.length - 1] ?? '?'})`);
      state.set(name, 'visiting');
      for (const d of mod.deps ?? []) visit(d, [...path, name]);
      state.set(name, 'done');
      order.push(name);
    };
    for (const name of this.modules.keys()) visit(name, []);
    return order;
  }
}
