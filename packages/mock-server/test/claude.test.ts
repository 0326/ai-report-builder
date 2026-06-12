/** claude.ts：SSE 解析、tool_use input 拼接、重试 —— 用本地 stub API 验证（无真实 key）。 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { streamMessage } from '../src/claude.ts';

type Ev = Record<string, unknown>;

function sse(events: Ev[]): string {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

const textTurn = (text: string): Ev[] => [
  { type: 'message_start', message: { usage: { input_tokens: 10 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  ...[...text].map((ch) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ch } })),
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
  { type: 'message_stop' },
];

const servers: Server[] = [];
after(() => servers.forEach((s) => s.close()));

function stub(handler: (callIndex: number) => { status?: number; body: string }): Promise<string> {
  let calls = 0;
  const server = createServer((_req, res) => {
    const r = handler(calls++);
    res.writeHead(r.status ?? 200, { 'content-type': r.status ? 'application/json' : 'text/event-stream' });
    res.end(r.body);
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, () => resolve(`http://localhost:${(server.address() as { port: number }).port}`));
  });
}

const OPTS = { apiKey: 'test', maxRetries: 2 };

test('文本流式累积 + onText 回调', async () => {
  const baseUrl = await stub(() => ({ body: sse(textTurn('你好，世界')) }));
  let streamed = '';
  const final = await streamMessage(
    { model: 'm', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] },
    { ...OPTS, baseUrl },
    { onText: (d) => (streamed += d) },
  );
  assert.equal(streamed, '你好，世界');
  assert.equal(final.stop_reason, 'end_turn');
  assert.deepEqual(final.content, [{ type: 'text', text: '你好，世界' }]);
  assert.equal(final.usage.output_tokens, 5);
});

test('tool_use：input 从 partial_json 分片拼接', async () => {
  const baseUrl = await stub(() => ({
    body: sse([
      { type: 'message_start', message: {} },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '查一下' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'query_dataset' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"datasetId":' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"metric_dau"}' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
      { type: 'message_stop' },
    ]),
  }));
  const names: string[] = [];
  const final = await streamMessage(
    { model: 'm', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] },
    { ...OPTS, baseUrl },
    { onToolUseStart: (n) => names.push(n) },
  );
  assert.equal(final.stop_reason, 'tool_use');
  assert.deepEqual(names, ['query_dataset']);
  const tu = final.content.find((b) => b.type === 'tool_use');
  assert.deepEqual(tu, { type: 'tool_use', id: 'tu_1', name: 'query_dataset', input: { datasetId: 'metric_dau' } });
});

test('529 过载自动重试后成功', async () => {
  const baseUrl = await stub((i) =>
    i === 0
      ? { status: 529, body: JSON.stringify({ error: { type: 'overloaded_error' } }) }
      : { body: sse(textTurn('ok')) },
  );
  const final = await streamMessage(
    { model: 'm', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] },
    { ...OPTS, baseUrl },
  );
  assert.equal((final.content[0] as { text: string }).text, 'ok');
});

test('400 不重试直接抛错', async () => {
  let calls = 0;
  const baseUrl = await stub((i) => {
    calls = i + 1;
    return { status: 400, body: JSON.stringify({ error: { type: 'invalid_request_error', message: 'bad' } }) };
  });
  await assert.rejects(
    streamMessage({ model: 'm', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }, { ...OPTS, baseUrl }),
    /API 400/,
  );
  assert.equal(calls, 1);
});

test('thinking 块累积且 signature 保留', async () => {
  const baseUrl = await stub(() => ({
    body: sse([
      { type: 'message_start', message: {} },
      { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '想一想' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig123' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '答案' } },
      { type: 'content_block_stop', index: 1 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      { type: 'message_stop' },
    ]),
  }));
  const final = await streamMessage(
    { model: 'm', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }], thinking: { type: 'adaptive', display: 'summarized' } },
    { ...OPTS, baseUrl },
  );
  assert.deepEqual(final.content[0], { type: 'thinking', thinking: '想一想', signature: 'sig123' });
});
