/** 从 report.schema.json 派生构建/校验所需的结构信息。 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReportSchema, SchemaNode, PageNode } from '@daf/report-runtime/core';
import { getPage } from '@daf/report-runtime/core';
import { resolveModuleFile } from './common.ts';

export function readSchema(projectDir: string): ReportSchema {
  return JSON.parse(readFileSync(join(projectDir, 'report.schema.json'), 'utf8')) as ReportSchema;
}

export function walkNodes(page: PageNode): SchemaNode[] {
  const out: SchemaNode[] = [];
  const walk = (nodes: SchemaNode[] | undefined) => {
    for (const n of nodes ?? []) {
      out.push(n);
      walk(n.children);
    }
  };
  walk(page.children);
  return out;
}

export interface BlockEntry {
  /** schema props.entry，bundle map 的 key */
  entry: string;
  /** 拥有该块的节点 id */
  nodeId: string;
  /** 相对工程根的源码文件 */
  file: string;
  /** 该节点声明的可消费数据源 */
  consumes: string[];
  /** 该节点声明的可发事件 */
  emits: string[];
}

export interface HandlerEntry {
  /** schema x-linkages.handler 原文，customHandlers map 的 key（如 "src/blocks/X#onDrill"） */
  ref: string;
  file: string;
  exportName: string;
}

export interface ScanResult {
  schema: ReportSchema;
  page: PageNode;
  blocks: BlockEntry[];
  handlers: HandlerEntry[];
}

export function scanReport(projectDir: string, schema: ReportSchema): ScanResult {
  const page = getPage(schema);
  const nodes = walkNodes(page);

  const blocks: BlockEntry[] = [];
  for (const n of nodes) {
    if (n.componentName !== 'AIBlock') continue;
    const entry = n.props?.entry;
    if (typeof entry !== 'string') {
      throw new Error(`[report-scripts] AIBlock 节点 ${n.id} 缺少 props.entry`);
    }
    blocks.push({
      entry,
      nodeId: n.id,
      file: resolveModuleFile(projectDir, entry),
      consumes: n['x-consumes'] ?? [],
      emits: n['x-emits'] ?? [],
    });
  }

  const handlers: HandlerEntry[] = [];
  for (const lk of page['x-linkages'] ?? []) {
    if (lk.action !== 'custom' || !lk.handler) continue;
    const [mod, exp] = splitHandler(lk.handler);
    handlers.push({ ref: lk.handler, file: resolveModuleFile(projectDir, mod), exportName: exp });
  }

  return { schema, page, blocks, handlers };
}

function splitHandler(handler: string): [string, string] {
  const idx = handler.indexOf('#');
  if (idx < 0) throw new Error(`[report-scripts] 非法 handler（缺少 #export）: ${handler}`);
  return [handler.slice(0, idx), handler.slice(idx + 1)];
}
