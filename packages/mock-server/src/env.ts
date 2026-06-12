/**
 * LLM 配置（零依赖），优先级：运行时配置（UI 保存，.artifacts/llm-config.json）> 进程 env > 仓库根 .env。
 * 支持 ANTHROPIC_API_KEY（x-api-key）或 ANTHROPIC_AUTH_TOKEN（OAuth Bearer）两种凭证。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const RUNTIME_FILE = join(REPO_ROOT, '.artifacts/llm-config.json');

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

export interface LlmRuntimeConfig {
  model?: string;
  apiKey?: string;
  authToken?: string;
  baseUrl?: string;
}

function readRuntime(): LlmRuntimeConfig {
  try {
    return JSON.parse(readFileSync(RUNTIME_FILE, 'utf8')) as LlmRuntimeConfig;
  } catch {
    return {};
  }
}

/** UI 保存的运行时配置：与已有项合并落盘（空字符串 = 清除该项），保存即生效。 */
export function saveLlmRuntimeConfig(patch: LlmRuntimeConfig): void {
  const cur = readRuntime();
  const next: Record<string, string> = {};
  for (const k of ['model', 'apiKey', 'authToken', 'baseUrl'] as const) {
    const v = patch[k] !== undefined ? patch[k] : cur[k];
    if (v) next[k] = v;
  }
  mkdirSync(dirname(RUNTIME_FILE), { recursive: true });
  writeFileSync(RUNTIME_FILE, JSON.stringify(next, null, 2));
  cached = null;
}

export interface LlmConfig {
  /** 二选一：apiKey（x-api-key 头）或 authToken（Bearer + oauth beta 头） */
  apiKey?: string;
  authToken?: string;
  baseUrl: string;
  model: string;
  /** 凭证是否就绪（false 时 /api/agent/chat 回落剧本 mock） */
  enabled: boolean;
  /** 凭证来源（UI 展示）：runtime | env | none */
  source: 'runtime' | 'env' | 'none';
}

let cached: LlmConfig | null = null;

export function getLlmConfig(): LlmConfig {
  if (cached) return cached;
  const rt = readRuntime();
  const dot = parseDotEnv(join(REPO_ROOT, '.env'));
  const pick = (k: string) => process.env[k] ?? dot[k];

  const apiKey = rt.apiKey ?? pick('ANTHROPIC_API_KEY');
  const authToken = rt.authToken ?? pick('ANTHROPIC_AUTH_TOKEN');
  const source: LlmConfig['source'] = rt.apiKey || rt.authToken ? 'runtime' : apiKey || authToken ? 'env' : 'none';
  cached = {
    apiKey,
    authToken,
    baseUrl: (rt.baseUrl ?? pick('ANTHROPIC_BASE_URL') ?? 'https://api.anthropic.com').replace(/\/$/, ''),
    model: rt.model ?? pick('CLAUDE_MODEL') ?? 'claude-opus-4-8',
    enabled: Boolean(apiKey || authToken),
    source,
  };
  return cached;
}

/** 测试用：重置缓存（注入不同 env 后重读） */
export function resetLlmConfigCache(): void {
  cached = null;
}
