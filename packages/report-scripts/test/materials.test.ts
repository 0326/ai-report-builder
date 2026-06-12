/**
 * 物料一致性：materialMetas ↔ kitExports 双向覆盖、meta 必备字段、LCE assets 派生全集。
 * kitExports 在 .tsx（node 直跑不可 import），按源码文本核对键名。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { materialMetas } from '@daf-materials/kit/meta';
import { deriveLceAssets } from '../src/lce-assets.ts';

const KIT_INDEX = readFileSync(
  join(resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..'), 'packages/materials/src/index.ts'),
  'utf8',
);
const exportNames = [...KIT_INDEX.matchAll(/^\s{2}(\w+):\s*\w+ as ComponentType/gm)].map((m) => m[1]);

test('每个 meta 都有 kitExports 导出，且导出无多余物料', () => {
  assert.ok(exportNames.length >= 6, 'kitExports 解析失败');
  for (const m of materialMetas) {
    assert.ok(exportNames.includes(m.exportName), `meta ${m.componentName} 缺少 kitExports 导出`);
  }
  for (const name of exportNames) {
    assert.ok(materialMetas.some((m) => m.exportName === name), `导出 ${name} 缺少 meta（Agent/物料面板不可见）`);
  }
});

test('meta 必备字段完整（title/category/defaultSize/x-ai.summary）', () => {
  for (const m of materialMetas) {
    assert.ok(m.title, `${m.componentName} 缺 title`);
    assert.ok(['chart', 'table', 'display'].includes(m.category), `${m.componentName} category 非法`);
    assert.ok(m.defaultSize.w >= 1 && m.defaultSize.w <= 12, `${m.componentName} defaultSize.w 越界`);
    assert.ok(m['x-ai'].summary, `${m.componentName} 缺 x-ai.summary（Agent 选型依据）`);
  }
});

test('LCE assets 派生覆盖全部物料 + AIBlock', () => {
  const assets = deriveLceAssets(materialMetas, { materialsUrl: '/m.js', runtimeDesignUrl: '/r.js' });
  const names = (assets.components as Array<{ componentName: string }>).map((c) => c.componentName);
  for (const m of materialMetas) assert.ok(names.includes(m.componentName), `assets 缺 ${m.componentName}`);
  assert.ok(names.includes('AIBlock'));
  assert.equal(names.length, materialMetas.length + 1);
});
