import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bridge, type MessageEndpoint, type WireMessage } from '../src/bridge.ts';

/** 内存双端点：模拟 postMessage 异步投递 */
function makePair(): [MessageEndpoint, MessageEndpoint] {
  const aListeners = new Set<(m: WireMessage) => void>();
  const bListeners = new Set<(m: WireMessage) => void>();
  const a: MessageEndpoint = {
    post: (m) => queueMicrotask(() => bListeners.forEach((cb) => cb(m))),
    listen: (cb) => { aListeners.add(cb); return () => aListeners.delete(cb); },
  };
  const b: MessageEndpoint = {
    post: (m) => queueMicrotask(() => aListeners.forEach((cb) => cb(m))),
    listen: (cb) => { bListeners.add(cb); return () => bListeners.delete(cb); },
  };
  return [a, b];
}

test('bridge: call/handle 请求-响应（含异步 handler）', async () => {
  const [ea, eb] = makePair();
  const host = new Bridge(ea, 'tk');
  const sdk = new Bridge(eb, 'tk');
  sdk.handle('echo', async (p) => ({ got: p }));
  const r = await host.call('echo', { x: 1 });
  assert.deepEqual(r, { got: { x: 1 } });
  host.dispose(); sdk.dispose();
});

test('bridge: handler 抛错 → 调用方 reject', async () => {
  const [ea, eb] = makePair();
  const host = new Bridge(ea, 'tk');
  const sdk = new Bridge(eb, 'tk');
  sdk.handle('boom', () => { throw new Error('bad'); });
  await assert.rejects(host.call('boom'), /bad/);
  await assert.rejects(host.call('nope'), /no handler/);
  host.dispose(); sdk.dispose();
});

test('bridge: token 不符直接丢弃（超时拒绝）', async () => {
  const [ea, eb] = makePair();
  const host = new Bridge(ea, 'tk-A', { timeoutMs: 50 });
  const sdk = new Bridge(eb, 'tk-B');
  sdk.handle('echo', (p) => p);
  await assert.rejects(host.call('echo', 1), /timeout/);
  host.dispose(); sdk.dispose();
});

test('bridge: ready 握手带版本', async () => {
  const [ea, eb] = makePair();
  let readyVersion = '';
  const host = new Bridge(ea, 'tk', { onReady: (i) => { readyVersion = i.version; } });
  const sdk = new Bridge(eb, 'tk');
  sdk.announceReady('1.0');
  const info = await host.whenReady;
  assert.equal(info.version, '1.0');
  assert.equal(readyVersion, '1.0');
  assert.equal(host.peerVersion, '1.0');
  host.dispose(); sdk.dispose();
});

test('bridge: notify 单向无响应', async () => {
  const [ea, eb] = makePair();
  const host = new Bridge(ea, 'tk');
  const sdk = new Bridge(eb, 'tk');
  const got: unknown[] = [];
  host.handle('designtime.onSelect', (p) => { got.push(p); });
  sdk.notify('designtime.onSelect', { nodeId: 'n1' });
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(got, [{ nodeId: 'n1' }]);
  host.dispose(); sdk.dispose();
});

test('bridge: dispose 后 pending 全部 reject', async () => {
  const [ea] = makePair();
  const host = new Bridge(ea, 'tk');
  const p = host.call('never');
  host.dispose();
  await assert.rejects(p, /disposed/);
});
