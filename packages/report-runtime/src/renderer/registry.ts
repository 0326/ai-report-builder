/** componentsMap → 组件注册表（公共物料按 package/exportName 从共享依赖解析，不打 bundle） */
import type { ComponentType } from 'react';
import type { ComponentMapEntry } from '../types.ts';
import type { ComponentRegistry } from './ReportRenderer.tsx';

export type PackageExports = Record<string, Record<string, ComponentType<Record<string, unknown>>>>;

/**
 * @param componentsMap schema.componentsMap
 * @param packages 共享依赖表：包名 -> exports（如 { '@daf-materials/kit': kitExports }）
 */
export function buildRegistry(componentsMap: ComponentMapEntry[], packages: PackageExports): ComponentRegistry {
  const registry: ComponentRegistry = {};
  for (const entry of componentsMap) {
    if (entry.componentName === 'AIBlock') continue; // AIBlock 由渲染器内置
    const pkg = packages[entry.package];
    registry[entry.componentName] = pkg?.[entry.exportName ?? entry.componentName];
  }
  return registry;
}
