/** @daf-materials/kit：第一批通用搭建物料（antd + VChart + VTable） */
import type { ComponentType } from 'react';
import { LineChart, BarChart, PieChart } from './charts.tsx';
import { DataTable } from './table.tsx';
import { KPICard, TextBlock } from './display.tsx';

export { LineChart, BarChart, PieChart } from './charts.tsx';
export { DataTable } from './table.tsx';
export { KPICard, TextBlock } from './display.tsx';
export { materialMetas, getMaterialMeta } from './meta.ts';
export type { MaterialMeta } from './meta.ts';

/** 供 buildRegistry 的共享依赖表使用：{ '@daf-materials/kit': kitExports } */
export const kitExports: Record<string, ComponentType<Record<string, unknown>>> = {
  LineChart: LineChart as ComponentType<Record<string, unknown>>,
  BarChart: BarChart as ComponentType<Record<string, unknown>>,
  PieChart: PieChart as ComponentType<Record<string, unknown>>,
  DataTable: DataTable as ComponentType<Record<string, unknown>>,
  KPICard: KPICard as ComponentType<Record<string, unknown>>,
  TextBlock: TextBlock as ComponentType<Record<string, unknown>>,
};
