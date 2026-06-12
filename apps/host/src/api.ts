/** mock-server API（经 Vite 代理同源访问） */
import type { ReportSchema } from '@daf/report-runtime/core';

export async function fetchSchema(): Promise<ReportSchema> {
  const res = await fetch('/api/schema');
  if (!res.ok) throw new Error(`GET /api/schema ${res.status}`);
  return res.json();
}

export interface SaveSchemaResult {
  hash: string;
  schemaFile: string;
  schemaUrl: string;
}

export async function putSchema(schema: ReportSchema): Promise<SaveSchemaResult> {
  const res = await fetch('/api/schema', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(schema),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `PUT /api/schema ${res.status}`);
  return body;
}
