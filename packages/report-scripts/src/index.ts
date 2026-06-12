/** @daf/report-scripts 入口：构建 / lint / manifest 派生（仓库内零配置）。 */
export { SHARED_EXTERNALS, ARTIFACTS_DIR, shortHash } from './common.ts';
export { readSchema, scanReport, walkNodes } from './schema-scan.ts';
export type { ScanResult, BlockEntry, HandlerEntry } from './schema-scan.ts';
export { lintReport } from './lint.ts';
export type { LintResult, LintIssue } from './lint.ts';
export { deriveManifest } from './manifest.ts';
export type { ReportManifest } from './manifest.ts';
export { buildReport } from './build.ts';
export type { BuildResult, BuildOptions } from './build.ts';
export { buildVendor, IMPORT_MAP } from './vendor.ts';
export type { VendorBuildResult } from './vendor.ts';
export { buildAll } from './pipeline.ts';
export type { BuildAllResult } from './pipeline.ts';
export { generateBundleEntry } from './template.ts';
