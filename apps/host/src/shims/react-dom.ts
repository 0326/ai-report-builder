/** react-dom → window.ReactDOM（react16 UMD） */
/* eslint-disable @typescript-eslint/no-explicit-any */
const RD = (window as any).ReactDOM;
export default RD;
export const {
  createPortal, findDOMNode, flushSync, hydrate, render, unmountComponentAtNode, version,
} = RD;
