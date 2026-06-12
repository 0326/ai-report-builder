/** @alilc/lowcode-engine → window.AliLowCodeEngine（UMD engine-core） */
/* eslint-disable @typescript-eslint/no-explicit-any */
const E = (window as any).AliLowCodeEngine;
export default E;
export const {
  init, plugins, project, material, config, event, skeleton, setters, common, hotkey, command, canvas, workspace,
} = E;
