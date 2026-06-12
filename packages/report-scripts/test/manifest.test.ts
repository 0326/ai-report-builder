import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSchema } from '../src/schema-scan.ts';
import { deriveManifest } from '../src/manifest.ts';

const PROJECT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../apps/template-report');

test('deriveManifest 从 schema 派生 inputs/outputs/dataSources/permissions', () => {
  const schema = readSchema(PROJECT);
  const m = deriveManifest(schema, { name: 'weekly-biz-report', version: schema.version, bundleFile: 'bundle.abc.js', schemaFile: 'schema.def.json' });

  assert.deepEqual(m.inputs, [{ name: 'f_region', type: 'enum', bindTo: 'state.f_region' }]);
  assert.deepEqual(m.outputs.sort((a, b) => a.from.localeCompare(b.from)), [
    { name: 'click', from: 'node_channel' },
    { name: 'drill', from: 'node_trend' },
  ].sort((a, b) => a.from.localeCompare(b.from)));

  assert.deepEqual(
    m.dataSources.map((d) => d.datasetId).sort(),
    ['metric_channel', 'metric_dau', 'metric_detail', 'metric_summary'],
  );
  assert.deepEqual(m.permissions.datasets.sort(), ['metric_channel', 'metric_dau', 'metric_detail', 'metric_summary']);
  assert.equal(m.artifact.bundle, './bundle.abc.js');
  assert.deepEqual(m.runtime.requires, ['data', 'state', 'event']);
});
