/**
 * 多报告管理（商业生产级）：每个报告 = 独立 git 沙箱工作区 + 独立产物缓存，
 * 注册表持久化（重启不丢），支持 新建 / 切换 / 重命名 / 删除 / 列表。
 * 所有既有链路（schema / agent / timeline / publish / preview）作用于"当前报告"。
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Sandbox } from './sandbox.ts';
import { seedFiles } from './agent-scripts.ts';

export interface ReportMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface Report {
  meta: ReportMeta;
  sandbox: Sandbox;
  /** 当前预览指针（缺省 build）；agent/保存推进，回滚不动 */
  head: string;
}

export class ReportStore {
  private root: string;
  private reports = new Map<string, Report>();
  private currentId = '';

  constructor(sandboxRoot: string) {
    this.root = sandboxRoot;
  }

  private regPath(): string {
    return join(this.root, 'reports.json');
  }

  private mkSandbox(id: string): Sandbox {
    return new Sandbox({ work: join(this.root, id, 'project'), builds: join(this.root, id, 'builds') });
  }

  private persist(): void {
    mkdirSync(this.root, { recursive: true });
    const metas = [...this.reports.values()].map((r) => r.meta).sort((a, b) => b.updatedAt - a.updatedAt);
    writeFileSync(this.regPath(), JSON.stringify({ current: this.currentId, reports: metas }, null, 2));
  }

  /** 启动：恢复注册表 + 重建各报告 sandbox；空则建默认报告。 */
  async init(): Promise<void> {
    let reg: { current?: string; reports?: ReportMeta[] } = {};
    try {
      reg = JSON.parse(readFileSync(this.regPath(), 'utf8'));
    } catch {
      reg = {};
    }
    for (const meta of reg.reports ?? []) {
      const sandbox = this.mkSandbox(meta.id);
      if (sandbox.isInitialized()) {
        this.reports.set(meta.id, { meta, sandbox, head: sandbox.head() });
      }
    }
    if (this.reports.size === 0) {
      await this.create('未命名报告');
    } else {
      this.currentId = reg.current && this.reports.has(reg.current) ? reg.current : [...this.reports.keys()][0];
    }
    this.persist();
  }

  list(): Array<ReportMeta & { current: boolean }> {
    return [...this.reports.values()]
      .map((r) => ({ ...r.meta, current: r.meta.id === this.currentId }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  current(): Report {
    const r = this.reports.get(this.currentId);
    if (!r) throw new Error('[report-store] 无当前报告');
    return r;
  }

  has(id: string): boolean {
    return this.reports.has(id);
  }

  /** 新建空白报告并切为当前。 */
  async create(title: string): Promise<Report> {
    const id = `rep_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    const sandbox = this.mkSandbox(id);
    const base = await sandbox.init(seedFiles());
    const now = Date.now();
    const report: Report = { meta: { id, title, createdAt: now, updatedAt: now }, sandbox, head: base.hash };
    this.reports.set(id, report);
    this.currentId = id;
    this.persist();
    return report;
  }

  open(id: string): Report {
    if (!this.reports.has(id)) throw new Error(`未知报告: ${id}`);
    this.currentId = id;
    this.persist();
    return this.current();
  }

  rename(id: string, title: string): void {
    const r = this.reports.get(id);
    if (!r) throw new Error(`未知报告: ${id}`);
    r.meta.title = title;
    r.meta.updatedAt = Date.now();
    this.persist();
  }

  async remove(id: string): Promise<void> {
    if (!this.reports.has(id)) return;
    this.reports.delete(id);
    rmSync(join(this.root, id), { recursive: true, force: true });
    if (this.currentId === id) {
      if (this.reports.size === 0) await this.create('未命名报告');
      else this.currentId = this.list()[0].id;
    }
    this.persist();
  }

  /** 标记当前报告更新时间（保存/agent 后调用，驱动列表排序）。 */
  touch(): void {
    const r = this.reports.get(this.currentId);
    if (r) {
      r.meta.updatedAt = Date.now();
      this.persist();
    }
  }
}
