/**
 * 共享依赖（vendor）与预览 harness 构建。
 * 这些产物对应 import-map 目标：react / react-dom / runtime / 物料作为共享单例，
 * 报告 bundle 全部 external 指向它们——物料/运行时升级不触发报告重建。
 *
 * 关键：vendor 用「单次 esbuild + code-splitting」产出，react/react-dom/jsx-runtime
 * 被抽到共享 chunk，保证浏览器里只有一个 React 实例（多 react 会让 hooks 崩）。
 */
import { build as esbuild } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url)); // packages/report-scripts/src/
const REPO_ROOT = resolve(HERE, '../../..');

/** import-map：浏览器把 bare specifier 解析到 vendor 入口产物（单例共享）。 */
export const IMPORT_MAP = {
  react: '/artifacts/vendor/react.js',
  'react/jsx-runtime': '/artifacts/vendor/react-jsx-runtime.js',
  'react-dom': '/artifacts/vendor/react-dom.js',
  'react-dom/client': '/artifacts/vendor/react-dom-client.js',
  '@daf/report-runtime': '/artifacts/vendor/report-runtime.js',
  '@daf-materials/kit': '/artifacts/vendor/materials.js',
  '@daf/designtime-sdk': '/artifacts/vendor/designtime-sdk.js',
};

const PROD = { 'process.env.NODE_ENV': '"production"' };

// react / react-dom / jsx-runtime 是 CJS：显式枚举命名导出，
// 保证浏览器原生 ESM 跨产物 `import { useState } from 'react'` 可静态解析。
const REACT_ENTRY = `
import React from 'react';
export default React;
export const {
  Children, Component, Fragment, Profiler, PureComponent, StrictMode, Suspense,
  cloneElement, createContext, createElement, createRef, forwardRef, isValidElement,
  lazy, memo, startTransition, useCallback, useContext, useDebugValue, useDeferredValue,
  useEffect, useId, useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo,
  useReducer, useRef, useState, useSyncExternalStore, useTransition, version,
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
} = React;
`;

const REACT_JSX_RUNTIME_ENTRY = `
import * as rt from 'react/jsx-runtime';
const m = rt.default ?? rt;
export const Fragment = m.Fragment;
export const jsx = m.jsx;
export const jsxs = m.jsxs;
`;

const REACT_DOM_ENTRY = `
import ReactDOM from 'react-dom';
export default ReactDOM;
export const {
  createPortal, findDOMNode, flushSync, hydrate, render, unmountComponentAtNode,
  unstable_batchedUpdates, version,
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,
} = ReactDOM;
`;

const REACT_DOM_CLIENT_ENTRY = `
import client from 'react-dom/client';
export default client;
export const createRoot = client.createRoot;
export const hydrateRoot = client.hydrateRoot;
`;

/** entryName → 入口源码。单次构建 + splitting，名字即 import-map basename。 */
const VENDOR_ENTRIES: Record<string, string> = {
  react: REACT_ENTRY,
  'react-jsx-runtime': REACT_JSX_RUNTIME_ENTRY,
  'react-dom': REACT_DOM_ENTRY,
  'react-dom-client': REACT_DOM_CLIENT_ENTRY,
  'report-runtime': `export * from '@daf/report-runtime';`,
  materials: `export * from '@daf-materials/kit';`,
  'designtime-sdk': `export * from '@daf/designtime-sdk';`,
};

export interface VendorBuildResult {
  vendorDir: string;
  previewFile: string;
  bytes: Record<string, number>;
}

export async function buildVendor(artifactsDir: string): Promise<VendorBuildResult> {
  const vendorDir = join(artifactsDir, 'vendor');
  const previewDir = join(artifactsDir, 'preview');
  const srcDir = join(artifactsDir, '.vendor-src'); // 临时入口文件（写在 .artifacts 下，便于 node_modules 上溯解析）
  mkdirSync(vendorDir, { recursive: true });
  mkdirSync(previewDir, { recursive: true });
  mkdirSync(srcDir, { recursive: true });

  const entryPoints: Array<{ in: string; out: string }> = [];
  for (const [name, code] of Object.entries(VENDOR_ENTRIES)) {
    const file = join(srcDir, `${name}.ts`);
    writeFileSync(file, code);
    entryPoints.push({ in: file, out: name });
  }

  const result = await esbuild({
    entryPoints,
    bundle: true,
    splitting: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    outdir: vendorDir,
    chunkNames: 'chunk-[hash]',
    write: true,
    metafile: true,
    define: PROD,
    legalComments: 'none',
  });

  const bytes: Record<string, number> = {};
  for (const [path, info] of Object.entries(result.metafile.outputs)) {
    bytes[path.replace(`${vendorDir}/`, '').replace(/^.*vendor\//, '')] = info.bytes;
  }

  // 预览 harness：external 全部共享依赖，浏览器经 import-map 解析
  const previewOut = await esbuild({
    entryPoints: [join(HERE, 'preview/entry.tsx')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    jsx: 'automatic',
    write: false,
    external: Object.keys(IMPORT_MAP),
    define: PROD,
    legalComments: 'none',
  });
  const previewCode = previewOut.outputFiles[0].text;
  writeFileSync(join(previewDir, 'preview.js'), previewCode);
  bytes['preview.js'] = Buffer.byteLength(previewCode);

  return { vendorDir, previewFile: join(previewDir, 'preview.js'), bytes };
}
