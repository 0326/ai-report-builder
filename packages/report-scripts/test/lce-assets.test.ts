import { test } from 'node:test';
import assert from 'node:assert/strict';
import { materialMetas } from '@daf-materials/kit/meta';
import { deriveLceAssets } from '../src/lce-assets.ts';

test('deriveLceAssets: packages + componentMeta + setters 映射', () => {
  const assets = deriveLceAssets(materialMetas, {
    materialsUrl: '/artifacts/lce/materials.umd.js',
    runtimeDesignUrl: '/artifacts/lce/runtime-design.umd.js',
  });

  // 画布运行库（moment/lodash/next，模拟器 renderer 依赖）+ 两个 DAF 包
  assert.equal(assets.packages.length, 5);
  assert.equal(assets.packages.find((p) => p.package === '@alifd/next')?.library, 'Next');
  assert.equal(assets.packages.find((p) => p.package === '@daf-materials/kit')?.library, 'DafMaterials');
  assert.equal(assets.packages.find((p) => p.package === '@daf/report-runtime')?.library, 'DafRuntimeDesign');

  // 全部物料 + AIBlock
  assert.equal(assets.components.length, materialMetas.length + 1);

  const pie = assets.components.find((c) => c.componentName === 'PieChart') as Record<string, never>;
  const pieProps = pie.props as Array<{ name: string; setter: unknown }>;
  assert.equal(pieProps.find((p) => p.name === 'donut')?.setter, 'BoolSetter');
  assert.ok(pieProps.find((p) => p.name === 'data'), 'dataProp 生成 setter');
  const npm = pie.npm as { package: string; destructuring: boolean };
  assert.equal(npm.package, '@daf-materials/kit');
  assert.equal(npm.destructuring, true);
  const snippets = pie.snippets as Array<{ schema: { props: Record<string, unknown> } }>;
  assert.equal(snippets[0].schema.props.donut, false);

  // enum → SelectSetter with options
  const text = assets.components.find((c) => c.componentName === 'TextBlock') as Record<string, never>;
  const align = (text.props as Array<{ name: string; setter: unknown }>).find((p) => p.name === 'align');
  assert.deepEqual((align?.setter as { componentName: string }).componentName, 'SelectSetter');

  const ai = assets.components.find((c) => c.componentName === 'AIBlock') as Record<string, never>;
  assert.equal((ai.npm as { package: string }).package, '@daf/report-runtime');
});
