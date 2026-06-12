/**
 * 工程沙箱（"一切修改走工程" 的物理实现）：
 * 一个独立 git 工作区 = 报告工程，Agent / 可视编排 / 拖拽的每一轮修改都落成一次 commit。
 * - 构建产物按 commit hash 缓存（builds/<hash>/），回滚 = 切该 hash 的产物 URL，零重建。
 * - 声明性修改走 schema 物化（拷上一版 bundle，零 esbuild）；代码性修改走真 esbuild。
 * 与主仓库 git 隔离（自己的 .git，落在 .artifacts/ 下，不污染仓库历史）。
 */
import { execFileSync } from 'node:child_process';
import {
  mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync, readdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import type { ReportSchema } from '@daf/report-runtime/core';
import { buildReport, deriveManifest, shortHash } from '@daf/report-scripts';

const SCHEMA_FILE = 'report.schema.json';

export interface SandboxPaths {
  /** 工作区（git 工程根） */
  work: string;
  /** 产物缓存根（builds/<hash>/） */
  builds: string;
}

export interface SeedFile {
  path: string;
  content: string;
}

export interface CommitInfo {
  hash: string;
  /** commit message 首行 */
  subject: string;
  /** 解析出的 round / intent / type（结构化 message） */
  round: number | null;
  intent: string;
  type: string;
}

export interface BuildPointer {
  hash: string;
  bundleFile: string;
  schemaFile: string;
  /** 预览 URL（host iframe 直接切 src） */
  previewUrl: string;
}

export class Sandbox {
  readonly work: string;
  readonly builds: string;

  constructor(paths: SandboxPaths) {
    this.work = paths.work;
    this.builds = paths.builds;
  }

  private git(...args: string[]): string {
    return execFileSync('git', ['-C', this.work, ...args], { encoding: 'utf8' }).trim();
  }

  isInitialized(): boolean {
    return existsSync(join(this.work, '.git'));
  }

  /** 首次：物化 seed → git init → round(0) 基线 commit → 构建基线产物。返回基线 build。 */
  async init(seed: SeedFile[]): Promise<BuildPointer> {
    rmSync(this.work, { recursive: true, force: true });
    mkdirSync(this.work, { recursive: true });
    for (const f of seed) this.writeFile(f.path, f.content);
    this.git('init', '-q');
    this.git('config', 'user.email', 'agent@daf.local');
    this.git('config', 'user.name', 'DAF Report Agent');
    this.git('add', '-A');
    this.git('commit', '-q', '-m', 'round(0): 空白报告基线 | packages: sandbox | type: seed');
    return this.build(this.head(), 'build', null);
  }

  /* ----------------------------- 文件读写 ----------------------------- */

  writeFile(rel: string, content: string): void {
    const abs = join(this.work, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  deleteFile(rel: string): void {
    rmSync(join(this.work, rel), { force: true });
  }

  readSchema(): ReportSchema {
    return JSON.parse(readFileSync(join(this.work, SCHEMA_FILE), 'utf8')) as ReportSchema;
  }

  writeSchema(schema: ReportSchema): void {
    this.writeFile(SCHEMA_FILE, JSON.stringify(schema, null, 2) + '\n');
  }

  /** 某 commit 处的文件内容（diff 用）；不存在返回 null。 */
  fileAt(hash: string, rel: string): string | null {
    try {
      return execFileSync('git', ['-C', this.work, 'show', `${hash}:${rel}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return null;
    }
  }

  schemaAt(hash: string): ReportSchema | null {
    const s = this.fileAt(hash, SCHEMA_FILE);
    return s ? (JSON.parse(s) as ReportSchema) : null;
  }

  /* ----------------------------- git 版本 ----------------------------- */

  head(): string {
    return this.git('rev-parse', 'HEAD');
  }

  /** 丢弃工作区未提交改动（自修复重试 / 失败回滚用）。 */
  reset(): void {
    this.git('checkout', '-q', '--', '.');
    this.git('clean', '-fdq');
  }

  commit(message: string): string {
    this.git('add', '-A');
    this.git('commit', '-q', '-m', message);
    return this.head();
  }

  /** 撤掉最近一次 commit 并清空工作区（自修复：坏 attempt 提交后回退重试）。 */
  undoLastCommit(): void {
    this.git('reset', '-q', '--hard', 'HEAD~1');
    this.git('clean', '-fdq');
  }

  /** 回滚到某 commit 的产物（秒级切 URL，零重建）；产物缺失则补构建。 */
  async rollbackTo(hash: string): Promise<BuildPointer> {
    if (!this.log().some((c) => c.hash.startsWith(hash))) {
      throw new Error(`[sandbox] 未知 commit: ${hash}`);
    }
    const full = this.git('rev-parse', hash);
    if (!this.hasBuild(full)) {
      // 产物被裁剪：从该 commit 重新构建一次（仍是秒级，但非缓存命中）
      const stash = this.head();
      this.git('checkout', '-q', full, '--', '.');
      await this.build(full, 'build', null);
      this.git('checkout', '-q', stash, '--', '.');
    }
    return this.pointer(full);
  }

  /** 工作区相对 HEAD 是否有改动（无改动则不提交，避免空 commit）。 */
  isDirty(): boolean {
    return this.git('status', '--porcelain').length > 0;
  }

  log(): CommitInfo[] {
    const raw = this.git('log', '--pretty=format:%H%x09%s');
    if (!raw) return [];
    return raw.split('\n').map((line) => {
      const [hash, subject] = line.split('\t');
      return { hash, subject, ...parseSubject(subject) };
    });
  }

  /* ----------------------------- 构建 / 产物 ----------------------------- */

  buildDir(hash: string): string {
    return join(this.builds, hash);
  }

  hasBuild(hash: string): boolean {
    return existsSync(join(this.buildDir(hash), 'manifest.json'));
  }

  pointer(hash: string): BuildPointer {
    const manifest = JSON.parse(readFileSync(join(this.buildDir(hash), 'manifest.json'), 'utf8'));
    return {
      hash,
      bundleFile: String(manifest.artifact.bundle).replace(/^\.\//, ''),
      schemaFile: String(manifest.artifact.schema).replace(/^\.\//, ''),
      previewUrl: `/preview/?build=${hash}`,
    };
  }

  /**
   * 为某 commit 产出/复用产物。
   * - pipeline='build'：真 esbuild（含 lint 门禁；lint/构建失败抛错驱动自修复）。
   * - pipeline='schema'：零构建，拷上一版 bundle + 写新 schema + 重派生 manifest。
   */
  async build(hash: string, pipeline: 'build' | 'schema', prevHash: string | null): Promise<BuildPointer> {
    const outDir = this.buildDir(hash);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });

    if (pipeline === 'build') {
      await buildReport(this.work, { outDir });
      return this.pointer(hash);
    }

    // schema 直更新：复用上一版 bundle（零 esbuild）
    if (!prevHash || !this.hasBuild(prevHash)) {
      throw new Error(`[sandbox] schema 直更新需要上一版产物，但 ${prevHash} 无缓存`);
    }
    const prevManifest = JSON.parse(readFileSync(join(this.buildDir(prevHash), 'manifest.json'), 'utf8'));
    const bundleFile = String(prevManifest.artifact.bundle).replace(/^\.\//, '');
    cpSync(join(this.buildDir(prevHash), bundleFile), join(outDir, bundleFile));

    const schema = this.readSchema();
    const text = JSON.stringify(schema, null, 2);
    const schemaFile = `schema.${shortHash(text)}.json`;
    writeFileSync(join(outDir, schemaFile), text);
    const manifest = deriveManifest(schema, {
      name: (schema as { name?: string }).name ?? 'report',
      version: schema.version,
      bundleFile,
      schemaFile,
    });
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return this.pointer(hash);
  }

  /** 清理超出保留窗口的旧产物缓存（按 git log 顺序保留最近 keep 个）。 */
  pruneBuilds(keep = 12): void {
    const alive = new Set(this.log().slice(0, keep).map((c) => c.hash));
    if (!existsSync(this.builds)) return;
    for (const dir of readdirSync(this.builds)) {
      if (!alive.has(dir)) rmSync(join(this.builds, dir), { recursive: true, force: true });
    }
  }
}

/** 解析结构化 commit message：`round(N): <intent> | packages: ... | type: <t>`。 */
export function parseSubject(subject: string): { round: number | null; intent: string; type: string } {
  const roundM = subject.match(/^round\((\d+)\):\s*/);
  const typeM = subject.match(/\btype:\s*(\w+)/);
  let intent = subject.replace(/^round\(\d+\):\s*/, '');
  intent = intent.split('|')[0].trim();
  return {
    round: roundM ? Number(roundM[1]) : null,
    intent,
    type: typeM ? typeM[1] : 'unknown',
  };
}
