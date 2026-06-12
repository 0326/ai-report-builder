/** @daf/designtime-sdk：Bridge JSON-RPC + iframe 侧 SDK + 宿主侧连接器 */
export * from './protocol.ts';
export { Bridge, windowEndpoint } from './bridge.ts';
export type { MessageEndpoint, WireMessage, BridgeHandler, BridgeOptions } from './bridge.ts';
export { installDesigntimeSDK } from './iframe.ts';
export type { InstallOptions } from './iframe.ts';
export { connectPreview } from './host.ts';
export type { PreviewHandle, ConnectOptions } from './host.ts';
