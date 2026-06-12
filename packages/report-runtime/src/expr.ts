/** JSExpression 求值（LCE 形态: this.state.xxx / this.dataSourceMap[...].data / payload.xxx） */
import type { JSExpression } from './types.ts';

export function isJSExpression(v: unknown): v is JSExpression {
  return !!v && typeof v === 'object' && (v as JSExpression).type === 'JSExpression'
    && typeof (v as JSExpression).value === 'string';
}

const fnCache = new Map<string, (...args: unknown[]) => unknown>();

/**
 * 求值表达式。thisArg 绑定为 this（如 {state, dataSourceMap}），vars 作为具名变量（如 {payload}）。
 * 求值失败返回 undefined 并可选上报。
 */
export function evalExpression(
  code: string,
  thisArg: Record<string, unknown>,
  vars: Record<string, unknown> = {},
  onError?: (err: Error) => void,
): unknown {
  const varNames = Object.keys(vars);
  const key = `${varNames.join(',')}::${code}`;
  let fn = fnCache.get(key);
  if (!fn) {
    try {
      // eslint-disable-next-line no-new-func
      fn = new Function(...varNames, `"use strict"; return (${code});`) as (...args: unknown[]) => unknown;
      fnCache.set(key, fn);
    } catch (e) {
      onError?.(e as Error);
      return undefined;
    }
  }
  try {
    return fn.apply(thisArg, varNames.map((n) => vars[n]));
  } catch (e) {
    onError?.(e as Error);
    return undefined;
  }
}

/** 深度解析值：JSExpression 求值，其余原样；数组/对象递归 */
export function resolveDeep(
  value: unknown,
  thisArg: Record<string, unknown>,
  vars: Record<string, unknown> = {},
  onError?: (err: Error) => void,
): unknown {
  if (isJSExpression(value)) return evalExpression(value.value, thisArg, vars, onError);
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, thisArg, vars, onError));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveDeep(v, thisArg, vars, onError);
    }
    return out;
  }
  return value;
}

/** 提取表达式中引用的 state key（数据源依赖图的来源） */
export function extractStateDeps(code: string): string[] {
  const out = new Set<string>();
  for (const m of code.matchAll(/this\.state\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) out.add(m[1]);
  for (const m of code.matchAll(/this\.state\[['"]([^'"]+)['"]\]/g)) out.add(m[1]);
  return [...out];
}

/** 稳定序列化（对象 key 排序），用于查询缓存/去重 key */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`;
}
