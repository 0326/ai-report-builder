/**
 * LCE 设计器消费的 UMD 物料构建：
 * - materials.umd.js   @daf-materials/kit 全量（antd/vchart/vtable 打入），library=DafMaterials
 * - runtime-design.umd.js  AIBlock 设计态占位组件，library=DafRuntimeDesign
 * react/react-dom 映射到画布 iframe 的 window 全局（react16 UMD，由引擎注入）。
 */
import { build as esbuild, type Plugin } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');

/** import 'react' 等 → window 全局（iife 内联 shim） */
function globalExternals(map: Record<string, string>): Plugin {
  const filter = new RegExp(`^(${Object.keys(map).map((k) => k.replace('/', '\\/')).join('|')})$`);
  return {
    name: 'global-externals',
    setup(build) {
      build.onResolve({ filter }, (args) => ({ path: args.path, namespace: 'global-ext' }));
      build.onLoad({ filter: /.*/, namespace: 'global-ext' }, (args) => ({
        contents: `module.exports = ${map[args.path]};`,
        loader: 'js',
      }));
    },
  };
}

const REACT_GLOBALS = {
  react: 'window.React',
  'react-dom': 'window.ReactDOM',
  'react-dom/client': 'window.ReactDOM', // react16 无 client：createRoot 不会被设计态调用
};

/** AIBlock 设计态占位：画布上展示块身份，真实渲染在运行态预览 */
const AIBLOCK_DESIGN_SRC = `
import * as React from 'react';

export function AIBlock(props) {
  const entry = props.entry ?? '(未设置 entry)';
  return React.createElement('div', {
    style: {
      minHeight: 120, height: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 6,
      border: '1.5px dashed #9254de', borderRadius: 8, background: '#f9f0ff',
      color: '#531dab', fontSize: 13, padding: 12,
    },
  },
    React.createElement('div', { style: { fontSize: 20 } }, '🧩'),
    React.createElement('div', null, 'AI 代码块 · ' + entry),
    React.createElement('div', { style: { fontSize: 11, color: '#9254de' } }, '设计态占位 — 真实渲染见「预览」'),
  );
}
`;

export interface LceBuildResult {
  outDir: string;
  bytes: Record<string, number>;
}

export async function buildLceBundles(artifactsDir: string): Promise<LceBuildResult> {
  const outDir = join(artifactsDir, 'lce');
  mkdirSync(outDir, { recursive: true });
  const bytes: Record<string, number> = {};

  const common = {
    bundle: true,
    format: 'iife' as const,
    platform: 'browser' as const,
    target: 'es2018',
    jsx: 'automatic' as const,
    write: false as const,
    minify: false,
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [globalExternals(REACT_GLOBALS)],
    legalComments: 'none' as const,
  };

  // jsx automatic 会引 react/jsx-runtime —— 也要映射到全局 React.createElement
  const jsxShim: Plugin = {
    name: 'jsx-runtime-shim',
    setup(build) {
      build.onResolve({ filter: /^react\/jsx-runtime$/ }, (args) => ({ path: args.path, namespace: 'jsx-shim' }));
      build.onLoad({ filter: /.*/, namespace: 'jsx-shim' }, () => ({
        contents: `
          var R = window.React;
          function toElement(type, config, maybeKey) {
            var props = config || {};
            var key = maybeKey !== undefined ? maybeKey : props.key;
            var children = props.children;
            var rest = {};
            for (var k in props) if (k !== 'children' && k !== 'key') rest[k] = props[k];
            if (key !== undefined) rest.key = key;
            if (Array.isArray(children)) return R.createElement.apply(null, [type, rest].concat(children));
            if (children !== undefined) return R.createElement(type, rest, children);
            return R.createElement(type, rest);
          }
          exports.jsx = toElement;
          exports.jsxs = toElement;
          exports.Fragment = R.Fragment;
        `,
        loader: 'js',
      }));
    },
  };

  const materials = await esbuild({
    ...common,
    stdin: {
      contents: `export * from '@daf-materials/kit';`,
      resolveDir: REPO_ROOT,
      loader: 'tsx',
      sourcefile: '__lce_materials.tsx',
    },
    globalName: 'DafMaterials',
    plugins: [globalExternals(REACT_GLOBALS), jsxShim],
  });
  writeFileSync(join(outDir, 'materials.umd.js'), materials.outputFiles[0].text);
  bytes['materials.umd.js'] = Buffer.byteLength(materials.outputFiles[0].text);

  const design = await esbuild({
    ...common,
    stdin: { contents: AIBLOCK_DESIGN_SRC, resolveDir: REPO_ROOT, loader: 'jsx', sourcefile: '__lce_aiblock.jsx' },
    globalName: 'DafRuntimeDesign',
  });
  writeFileSync(join(outDir, 'runtime-design.umd.js'), design.outputFiles[0].text);
  bytes['runtime-design.umd.js'] = Buffer.byteLength(design.outputFiles[0].text);

  return { outDir, bytes };
}
