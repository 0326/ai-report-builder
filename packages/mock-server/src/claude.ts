/**
 * Claude Messages API 客户端（零依赖：原生 fetch + 手解 SSE）。
 * - POST {baseUrl}/v1/messages，stream: true
 * - adaptive thinking（display: summarized，过程卡可见思考摘要）
 * - 429/5xx/529 指数退避重试；流中 error 事件抛错
 * 返回完整累积的 assistant content（thinking 块含 signature 原样保留，供多轮回传）。
 */

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'redacted_thinking'; data: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

export interface MessageParam {
  role: 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
}

export interface MessagesRequest {
  model: string;
  max_tokens: number;
  system?: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
  messages: MessageParam[];
  tools?: ToolDef[];
  thinking?: { type: 'adaptive'; display?: 'omitted' | 'summarized' };
  output_config?: { effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' };
}

export interface FinalMessage {
  content: ContentBlock[];
  stop_reason: string | null;
  usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
}

export interface StreamCallbacks {
  onText?: (delta: string) => void;
  onThinking?: (delta: string) => void;
  onToolUseStart?: (name: string, id: string) => void;
}

export interface ClientOptions {
  apiKey?: string;
  authToken?: string;
  baseUrl: string;
  maxRetries?: number;
}

function headers(opts: ClientOptions): Record<string, string> {
  const h: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (opts.authToken) {
    h['authorization'] = `Bearer ${opts.authToken}`;
    h['anthropic-beta'] = 'oauth-2025-04-20';
  } else if (opts.apiKey) {
    h['x-api-key'] = opts.apiKey;
  }
  return h;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 解析 SSE 字节流：按空行分帧，取 data: 行 JSON。 */
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (line.startsWith('data:')) {
            const payload = line.slice(5).trim();
            if (payload && payload !== '[DONE]') yield JSON.parse(payload) as Record<string, unknown>;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** 单次流式调用，累积完整消息。 */
export async function streamMessage(
  req: MessagesRequest,
  opts: ClientOptions,
  cb: StreamCallbacks = {},
): Promise<FinalMessage> {
  const maxRetries = opts.maxRetries ?? 2;
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await delay(Math.min(1000 * 2 ** attempt + Math.random() * 500, 8000));
    let res: Response;
    try {
      res = await fetch(`${opts.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: headers(opts),
        body: JSON.stringify({ ...req, stream: true }),
      });
    } catch (e) {
      lastErr = new Error(`网络错误: ${(e as Error).message}`);
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const retryable = res.status === 429 || res.status >= 500;
      lastErr = new Error(`API ${res.status}: ${truncate(text, 400)}`);
      if (retryable && attempt < maxRetries) continue;
      throw lastErr;
    }
    if (!res.body) throw new Error('API 响应无 body');

    // 流式累积。块按 index 组装；tool_use 的 input 从 partial_json 拼接。
    const blocks: ContentBlock[] = [];
    const partialJson: Record<number, string> = {};
    let stopReason: string | null = null;
    const usage: FinalMessage['usage'] = {};

    for await (const ev of sseEvents(res.body)) {
      const t = ev.type as string;
      if (t === 'content_block_start') {
        const i = ev.index as number;
        const cbk = ev.content_block as Record<string, unknown>;
        if (cbk.type === 'text') blocks[i] = { type: 'text', text: '' };
        else if (cbk.type === 'thinking') blocks[i] = { type: 'thinking', thinking: '' };
        else if (cbk.type === 'redacted_thinking') blocks[i] = { type: 'redacted_thinking', data: (cbk.data as string) ?? '' };
        else if (cbk.type === 'tool_use') {
          blocks[i] = { type: 'tool_use', id: cbk.id as string, name: cbk.name as string, input: {} };
          partialJson[i] = '';
          cb.onToolUseStart?.(cbk.name as string, cbk.id as string);
        }
      } else if (t === 'content_block_delta') {
        const i = ev.index as number;
        const d = ev.delta as Record<string, unknown>;
        const blk = blocks[i];
        if (d.type === 'text_delta' && blk?.type === 'text') {
          blk.text += d.text as string;
          cb.onText?.(d.text as string);
        } else if (d.type === 'thinking_delta' && blk?.type === 'thinking') {
          blk.thinking += d.thinking as string;
          cb.onThinking?.(d.thinking as string);
        } else if (d.type === 'signature_delta' && blk?.type === 'thinking') {
          blk.signature = (blk.signature ?? '') + (d.signature as string);
        } else if (d.type === 'input_json_delta') {
          partialJson[i] = (partialJson[i] ?? '') + (d.partial_json as string);
        }
      } else if (t === 'content_block_stop') {
        const i = ev.index as number;
        const blk = blocks[i];
        if (blk?.type === 'tool_use' && partialJson[i] !== undefined) {
          blk.input = partialJson[i].trim() ? (JSON.parse(partialJson[i]) as Record<string, unknown>) : {};
        }
      } else if (t === 'message_delta') {
        const d = ev.delta as Record<string, unknown> | undefined;
        if (d?.stop_reason) stopReason = d.stop_reason as string;
        const u = ev.usage as Record<string, number> | undefined;
        if (u) Object.assign(usage, u);
      } else if (t === 'message_start') {
        const u = (ev.message as Record<string, unknown> | undefined)?.usage as Record<string, number> | undefined;
        if (u) Object.assign(usage, u);
      } else if (t === 'error') {
        const err = ev.error as Record<string, unknown>;
        throw new Error(`流错误 ${err?.type}: ${err?.message}`);
      }
    }

    return { content: blocks.filter(Boolean), stop_reason: stopReason, usage };
  }

  throw lastErr ?? new Error('API 调用失败');
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
