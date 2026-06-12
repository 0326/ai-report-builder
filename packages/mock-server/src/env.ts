/**
 * LLM 配置（零依赖）：进程 env 优先，其次仓库根 .env（KEY=VALUE，# 注释）。
 * 支持 ANTHROPIC_API_KEY（x-api-key）或 ANTHROPIC_AUTH_TOKEN（OAuth Bearer）两种凭证。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

function parseDotEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || m[1].startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export interface LlmConfig {
  /** 二选一：apiKey（x-api-key 头）或 authToken（Bearer + oauth beta 头） */
  apiKey?: string;
  authToken?: string;
  baseUrl: string;
  model: string;
  /** 凭证是否就绪（false 时 /api/agent/chat 回落剧本 mock） */
  enabled: boolean;
}

let cached: LlmConfig | null = null;

export function getLlmConfig(): LlmConfig {
  if (cached) return cached;
  const dot = parseDotEnv(join(REPO_ROOT, '.env'));
  const pick = (k: string) => process.env[k] ?? dot[k];
  const apiKey = pick('ANTHROPIC_API_KEY');
  const authToken = pick('ANTHROPIC_AUTH_TOKEN');
  cached = {
    apiKey,
    authToken,
    baseUrl: (pick('ANTHROPIC_BASE_URL') ?? 'https://api.anthropic.com').replace(/\/$/, ''),
    model: pick('CLAUDE_MODEL') ?? 'claude-opus-4-8',
    enabled: Boolean(apiKey || authToken),
  };
  return cached;
}

/** 测试用：重置缓存（注入不同 env 后重读） */
export function resetLlmConfigCache(): void {
  cached = null;
}
