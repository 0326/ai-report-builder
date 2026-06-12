/**
 * Agent 编排（§3.4 链路一 + §3.5）：意图匹配 → 落盘 → lint/构建（自修复 ≤2 次）→ git commit → 双 diff + 预览 URL。
 * 一轮修改 = 一个 commit；构建产物按 commit hash 缓存，回滚即切 URL。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReportSchema } from '@daf/report-runtime/core';
import { matchScript, type SelectionCtx, type Attempt, type ProcessCard } from './agent-scripts.ts';
import { validateSchema } from './schema-store.ts';
import { schemaDiff, summarizeOps, codeDiff, type FileDiff } from './diff.ts';
import type { Sandbox } from './sandbox.ts';

export interface ChatRequest {
  message: string;
  selection?: SelectionCtx | null;
}

export interface AttemptResult {
  note: string;
  ok: boolean;
  error?: string;
}

export interface SchemaDiffView {
  summary: string[];
  destructive: boolean;
  opCount: number;
}

export interface AgentTurnResult {
  matched: boolean;
  ok: boolean;
  reply: string;
  scriptId?: string;
  title?: string;
  intent?: string;
  pipeline?: 'build' | 'schema';
  buildMs?: number;
  attempts?: AttemptResult[];
  processCard?: ProcessCard;
  diff?: { schema: SchemaDiffView; code: FileDiff[] };
  commit?: { hash: string; round: number | null; message: string };
  previewUrl?: string;
  error?: string;
}

function makeReader(fixturesDir: string) {
  return (rel: string) => readFileSync(join(fixturesDir, rel), 'utf8');
}

function applyAttempt(sandbox: Sandbox, attempt: Attempt): void {
  sandbox.reset();
  if (attempt.schema) sandbox.writeSchema(attempt.schema);
  for (const f of attempt.files ?? []) sandbox.writeFile(f.path, f.content);
  for (const p of attempt.deletes ?? []) sandbox.deleteFile(p);
}

/** 成功 attempt 涉及的源码文件（schema 由 schemaDiff 单独展示，不进 code diff）。 */
function changedSourcePaths(attempt: Attempt): string[] {
  const set = new Set<string>();
  for (const f of attempt.files ?? []) set.add(f.path);
  for (const p of attempt.deletes ?? []) set.add(p);
  set.delete('report.schema.json');
  return [...set];
}

export async function runAgentTurn(
  sandbox: Sandbox,
  fixturesDir: string,
  req: ChatRequest,
): Promise<AgentTurnResult> {
  const readFixture = makeReader(fixturesDir);
  const currentSchema = sandbox.readSchema();
  const ctx = { schema: currentSchema, selection: req.selection ?? null, readFixture };

  const script = matchScript(req.message, ctx);
  if (!script) {
    return {
      matched: false,
      ok: false,
      reply:
        '没太理解这条指令。可以试试：「做一份周报：DAU 趋势 + 渠道占比，按区域筛选」；' +
        '选中渠道占比图后说「改成环形图，点击渠道联动趋势」；或「加一个留存漏斗块」。',
    };
  }

  let plan;
  try {
    plan = script.plan(ctx);
  } catch (e) {
    return { matched: true, ok: false, reply: `这条指令我接住了，但执行失败：${(e as Error).message}`, scriptId: script.id, error: (e as Error).message };
  }

  const prevHead = sandbox.head();
  const prevSchema = sandbox.schemaAt(prevHead);
  const nextRound = sandbox.log().length; // round0 是首个 commit，第 k 轮 → 第 k 个 agent commit
  const message = `round(${nextRound}): ${plan.intent} | packages: sandbox | type: ${plan.commitType}`;

  const attemptResults: AttemptResult[] = [];
  let success: { attempt: Attempt; hash: string; ms: number } | null = null;

  for (const attempt of plan.attempts) {
    applyAttempt(sandbox, attempt);
    if (!sandbox.isDirty()) {
      attemptResults.push({ note: attempt.note, ok: false, error: '无变更（与当前工程一致）' });
      continue;
    }
    if (attempt.schema) {
      try {
        validateSchema(attempt.schema);
      } catch (e) {
        attemptResults.push({ note: attempt.note, ok: false, error: (e as Error).message });
        sandbox.reset();
        continue;
      }
    }
    const hash = sandbox.commit(message);
    try {
      const t0 = Date.now();
      await sandbox.build(hash, plan.pipeline, prevHead);
      attemptResults.push({ note: attempt.note, ok: true });
      success = { attempt, hash, ms: Date.now() - t0 };
      break;
    } catch (e) {
      attemptResults.push({ note: attempt.note, ok: false, error: firstLines((e as Error).message) });
      sandbox.undoLastCommit(); // reset --hard HEAD~1：撤掉坏 commit，回到 prevHead 再试
    }
  }

  if (!success) {
    sandbox.reset();
    return {
      matched: true,
      ok: false,
      reply: `「${plan.intent}」尝试 ${attemptResults.length} 次仍未通过构建门禁，已回滚到上一版。`,
      scriptId: script.id,
      title: script.title,
      intent: plan.intent,
      pipeline: plan.pipeline,
      attempts: attemptResults,
      processCard: plan.processCard,
      error: attemptResults.at(-1)?.error,
    };
  }

  const newSchema = sandbox.readSchema();
  const sDiff = schemaDiff(prevSchema, newSchema);
  const cDiff = codeDiff(
    changedSourcePaths(success.attempt).map((path) => ({
      path,
      prev: sandbox.fileAt(prevHead, path),
      next: sandbox.fileAt(success!.hash, path),
    })),
  );
  sandbox.pruneBuilds();
  const pointer = sandbox.pointer(success.hash);
  const repaired = attemptResults.filter((a) => !a.ok).length;

  return {
    matched: true,
    ok: true,
    reply:
      `已${plan.pipeline === 'schema' ? '通过零构建直更新' : '经构建管线'}完成「${plan.intent}」` +
      `${repaired ? `（自修复 ${repaired} 次）` : ''}，${plan.pipeline === 'schema' ? '≤2s' : `${success.ms}ms`} 生效。`,
    scriptId: script.id,
    title: script.title,
    intent: plan.intent,
    pipeline: plan.pipeline,
    buildMs: success.ms,
    attempts: attemptResults,
    processCard: plan.processCard,
    diff: {
      schema: { summary: summarizeOps(sDiff.ops), destructive: sDiff.destructive, opCount: sDiff.ops.length },
      code: cDiff,
    },
    commit: { hash: success.hash, round: nextRound, message },
    previewUrl: pointer.previewUrl,
  };
}

function firstLines(msg: string, n = 6): string {
  return msg.split('\n').slice(0, n).join('\n');
}
