/** Manifest 构建期派生（§2.3）：字段全部来自 schema，避免与运行时双写漂移。 */
import type { ReportSchema } from '@daf/report-runtime/core';
import { getPage } from '@daf/report-runtime/core';
import { walkNodes } from './schema-scan.ts';

export interface ReportManifest {
  name: string;
  version: string;
  artifact: { bundle: string; schema: string };
  inputs: Array<{ name: string; type: string; bindTo: string }>;
  outputs: Array<{ name: string; from: string }>;
  actions: string[];
  dataSources: Array<{ datasetId: string; fields: string[] }>;
  permissions: { datasets: string[]; actions: string[] };
  runtime: { requires: string[]; minVersion: string };
}

export interface ManifestRefs {
  name: string;
  version: string;
  bundleFile: string;
  schemaFile: string;
}

export function deriveManifest(schema: ReportSchema, refs: ManifestRefs): ReportManifest {
  const page = getPage(schema);
  const nodes = walkNodes(page);

  const inputs = (page['x-filters'] ?? []).map((f) => ({
    name: f.stateKey,
    type: f.valueType ?? 'string',
    bindTo: `state.${f.stateKey}`,
  }));

  const outputs: Array<{ name: string; from: string }> = [];
  for (const n of nodes) for (const e of n['x-emits'] ?? []) outputs.push({ name: e, from: n.id });

  const dataSources = (page.dataSource?.list ?? []).map((d) => ({
    datasetId: d.options.datasetId,
    fields: d.options.fields ?? [],
  }));

  const datasets = [...new Set(dataSources.map((d) => d.datasetId))];

  return {
    name: refs.name,
    version: refs.version,
    artifact: { bundle: `./${refs.bundleFile}`, schema: `./${refs.schemaFile}` },
    inputs,
    outputs,
    actions: ['reload', 'setFilter', 'highlight'],
    dataSources,
    permissions: { datasets, actions: [] },
    runtime: { requires: ['data', 'state', 'event'], minVersion: '0.1' },
  };
}
