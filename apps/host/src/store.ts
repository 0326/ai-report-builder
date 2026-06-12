/** 设计器侧 schema 基线：x- 保真合并的参照（导入时建立，每次保存后更新） */
import type { ReportSchema } from '@daf/report-runtime/core';

let baseline: ReportSchema | null = null;

export function setBaseline(schema: ReportSchema): void {
  baseline = schema;
}

export function getBaseline(): ReportSchema {
  if (!baseline) throw new Error('[host] schema 基线未初始化');
  return baseline;
}
