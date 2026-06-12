/** 一键产出可预览的全套产物：vendor 共享依赖 + preview harness + 报告 bundle/schema/manifest。 */
import { join } from 'node:path';
import { buildVendor, type VendorBuildResult } from './vendor.ts';
import { buildReport, type BuildResult } from './build.ts';

export interface BuildAllResult {
  vendor: VendorBuildResult;
  report: BuildResult;
  reportDir: string;
}

export async function buildAll(projectDir: string, artifactsDir: string): Promise<BuildAllResult> {
  const vendor = await buildVendor(artifactsDir);
  const reportDir = join(artifactsDir, 'report');
  const report = await buildReport(projectDir, { outDir: reportDir });
  return { vendor, report, reportDir };
}
